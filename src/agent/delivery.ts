import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ITelegramBridge, SentMessage } from "../telegram/bridge-interface.js";
import {
  guestReplyHtml,
  prepareTelegramText,
  type TelegramTextEntity,
} from "../telegram/formatted-text.js";
import { isHeartbeatOk, isSilentReply } from "../constants/tokens.js";
import {
  deliveredTelegramMessageId,
  deliveredTelegramMessageIdFromCall,
  deliveredTelegramStructuredMessage,
  deliveredTelegramText,
} from "./telegram-send-state.js";
import type { AgentResponse } from "./turn-types.js";
import {
  claimDeliveryFragment,
  trackActiveDeliveryAttempt,
  confirmDeliveryFragment,
  confirmLateDeliveryFragment,
  listDeliveryFragments,
  markDeliveryFragment,
  prepareResponseDelivery,
  updateResponseDelivery,
} from "../memory/response-deliveries.js";

export type DeliveryTarget =
  | {
      kind: "telegram";
      bridge: ITelegramBridge;
      chatId: string;
      replyToId?: number;
      isGroup?: boolean;
    }
  | {
      kind: "guest";
      chatId: string;
      send: (html: string) => Promise<SentMessage | void>;
      accountId?: string;
      isGroup?: boolean;
    };
const reservations = new Map<string, Promise<void>>();
/** One turn owns a chat's draft through final policy and delivery, across logical sessions. */
function reservationKey(target: DeliveryTarget): string {
  return target.kind === "telegram"
    ? `${target.bridge.getMode()}:${target.bridge.getOwnUserId()}:${target.chatId}`
    : `guest:${target.accountId ?? ""}:${target.chatId}`;
}
function installReservation(key: string): () => void {
  let resolve!: () => void;
  const next = new Promise<void>((done) => {
    resolve = done;
  });
  reservations.set(key, next);
  return () => {
    resolve();
    if (reservations.get(key) === next) reservations.delete(key);
  };
}
/** Busy destinations may still generate a response with draft previews disabled. */
export function tryReserveDraft(target: DeliveryTarget): (() => void) | undefined {
  const key = reservationKey(target);
  return reservations.has(key) ? undefined : installReservation(key);
}
export async function reserveDraft(target: DeliveryTarget): Promise<() => void> {
  const key = reservationKey(target);
  const previous = reservations.get(key) ?? Promise.resolve();
  const release = installReservation(key);
  await previous;
  return release;
}
/** Expired waiters retain their place until the predecessor finishes, then retire. */
export async function reserveDraftWithinBudget(
  target: DeliveryTarget,
  budget: { deadline: number; signal?: AbortSignal }
): Promise<(() => void) | undefined> {
  if (budget.signal?.aborted || Date.now() >= budget.deadline) return undefined;
  const key = reservationKey(target);
  const predecessor = reservations.get(key) ?? Promise.resolve();
  const release = installReservation(key);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire!: () => void;
  const expired = new Promise<boolean>((resolve) => {
    expire = () => resolve(false);
    timer = setTimeout(expire, Math.max(0, budget.deadline - Date.now()));
  });
  budget.signal?.addEventListener("abort", expire, { once: true });
  if (budget.signal?.aborted) expire();
  try {
    const acquired = await Promise.race([predecessor.then(() => true), expired]);
    if (!acquired || budget.signal?.aborted || Date.now() >= budget.deadline) {
      // Resolving now would let a successor bypass the still-active predecessor.
      void predecessor.then(release, release);
      return undefined;
    }
    return release;
  } finally {
    if (timer) clearTimeout(timer);
    budget.signal?.removeEventListener("abort", expire);
  }
}
export async function clearDeliveryDraft(target: DeliveryTarget): Promise<void> {
  if (target.kind === "telegram" && target.bridge.getMode() === "bot") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        target.bridge.clearDraft?.(target.chatId).catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      target.bridge.resetDraft?.(target.chatId);
    }
  }
}
function definiteRejection(error: unknown): boolean {
  // Only an explicit Telegram API rejection proves that no message was accepted.
  const value = error as { error_code?: number; errorMessage?: string };
  return typeof value?.error_code === "number" && value.error_code >= 400 && value.error_code < 500;
}
function recordFeed(
  db: Database.Database,
  chatId: string,
  id: number,
  text: string,
  date: number,
  isGroup = false,
  media?: { hasMedia?: boolean; mediaType?: string }
): void {
  db.transaction(() => {
    db.prepare(
      "INSERT INTO tg_chats(id,type,is_monitored) VALUES (?,?,1) ON CONFLICT(id) DO NOTHING"
    ).run(chatId, isGroup ? "group" : "dm");
    db.prepare(
      `INSERT INTO tg_messages(id,chat_id,text,embedding_status,is_from_agent,has_media,media_type,timestamp)
      VALUES (?,?,?,'pending',1,?,?,?) ON CONFLICT(chat_id,id) DO NOTHING`
    ).run(String(id), chatId, text, media?.hasMedia ? 1 : 0, media?.mediaType ?? null, date);
  })();
}
/** Called after response hooks and durable ingress result persistence. */
export async function deliverAgentResponse(
  db: Database.Database,
  response: AgentResponse,
  target: DeliveryTarget,
  options: {
    isHeartbeat?: boolean;
    reservationHeld?: boolean;
    deadline?: number;
    signal?: AbortSignal;
  } = {}
): Promise<AgentResponse> {
  const deliveryDeadline = options.deadline ?? Date.now() + 60_000;
  let release: (() => void) | undefined;
  let ownsReservation = options.reservationHeld === true;
  try {
    const rich = deliveredTelegramStructuredMessage(response.toolCalls, target.chatId);
    const exact = deliveredTelegramText(response.toolCalls, target.chatId, response.content);
    if (rich || exact) {
      const rawId = rich
        ? deliveredTelegramMessageIdFromCall(rich)
        : deliveredTelegramMessageId(response.toolCalls, target.chatId, response.content);
      const id = rawId ? Number(rawId) : undefined;
      if (id) {
        const data = rich?.result?.data as
          { renderedText?: string; hasMedia?: boolean; mediaType?: string } | undefined;
        try {
          recordFeed(
            db,
            target.chatId,
            id,
            data?.renderedText ?? response.content,
            Math.floor(Date.now() / 1000),
            target.isGroup,
            data
          );
        } catch {
          /* Remote receipt remains confirmed. */
        }
      }
      response.delivery = {
        state: "delivered",
        messageIds: id ? [id] : [],
        reason: rich ? "structured_tool_response" : "exact_tool_response",
      };
      return response;
    }
    if (
      !response.content.trim() ||
      isSilentReply(response.content) ||
      (options.isHeartbeat && isHeartbeatOk(response.content))
    ) {
      response.delivery = { state: "suppressed", reason: "response_policy" };
      return response;
    }
    const fragments =
      target.kind === "guest"
        ? [{ text: guestReplyHtml(response.content) }]
        : prepareTelegramText(response.content);
    const delivery = prepareResponseDelivery(
      db,
      response.turnId,
      target.chatId,
      target.kind,
      fragments
    );
    const rows = listDeliveryFragments(db, delivery.delivery_id);
    if (
      delivery.status === "unknown" ||
      rows.some((row) => row.status === "unknown" || row.status === "sending")
    ) {
      response.delivery = {
        state: "unknown",
        deliveryId: delivery.delivery_id,
        reason: "Reconciliation required before resend",
        messageIds: rows.flatMap((row) => (row.message_id ? [row.message_id] : [])),
      };
      return response;
    }
    if (!ownsReservation && rows.some((row) => row.status === "prepared")) {
      release = await reserveDraftWithinBudget(target, {
        deadline: deliveryDeadline,
        signal: options.signal,
      });
      if (!release) {
        const state = rows.some((row) => row.status === "delivered") ? "partial" : "prepared";
        const reason = options.signal?.aborted
          ? "Delivery cancelled while waiting for destination"
          : "Delivery deadline expired while waiting for destination";
        updateResponseDelivery(db, delivery.delivery_id, state, reason);
        response.delivery = {
          state,
          deliveryId: delivery.delivery_id,
          reason,
          messageIds: rows.flatMap((row) => (row.message_id ? [row.message_id] : [])),
        };
        return response;
      }
      ownsReservation = true;
    }
    for (const row of rows) {
      if (row.status === "delivered") {
        if (row.message_id && !row.feed_recorded) {
          try {
            recordFeed(
              db,
              target.chatId,
              row.message_id,
              row.text,
              row.sent_at ?? Math.floor(Date.now() / 1000),
              target.isGroup
            );
            db.prepare(
              "UPDATE response_delivery_fragments SET feed_recorded=1 WHERE delivery_id=? AND fragment_index=?"
            ).run(delivery.delivery_id, row.fragment_index);
          } catch {
            /* Rebuild feed on the next delivery resume. */
          }
        }
        continue;
      }
      if (options.signal?.aborted || Date.now() >= deliveryDeadline) {
        const confirmed = listDeliveryFragments(db, delivery.delivery_id);
        const state = confirmed.some((fragment) => fragment.status === "delivered")
          ? "partial"
          : "prepared";
        updateResponseDelivery(
          db,
          delivery.delivery_id,
          state,
          "Delivery deadline expired before send"
        );
        response.delivery = {
          state,
          deliveryId: delivery.delivery_id,
          reason: "Delivery deadline expired before send",
          messageIds: confirmed.flatMap((fragment) =>
            fragment.message_id ? [fragment.message_id] : []
          ),
        };
        return response;
      }
      const attemptToken = randomUUID();
      if (
        row.status === "failed" ||
        !claimDeliveryFragment(db, delivery.delivery_id, row.fragment_index, attemptToken)
      )
        break;
      updateResponseDelivery(db, delivery.delivery_id, "sending");
      let sent: SentMessage | void;
      let sending: Promise<SentMessage | void> | undefined;
      const sendAbort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectInterruption: ((error: Error) => void) | undefined;
      const interruption = new Promise<never>((_resolve, reject) => {
        rejectInterruption = reject;
      });
      const abort = () => {
        sendAbort.abort();
        rejectInterruption?.(new Error("Delivery interrupted during send"));
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        sending =
          target.kind === "guest"
            ? target.send(row.text)
            : target.bridge.sendMessage({
                chatId: target.chatId,
                text: row.text,
                replyToId: row.fragment_index === 0 ? target.replyToId : undefined,
                formattedText: {
                  text: row.text,
                  entities: JSON.parse(row.entities_json ?? "[]") as TelegramTextEntity[],
                },
                signal: sendAbort.signal,
                deadline: deliveryDeadline,
              });
        trackActiveDeliveryAttempt(db, delivery.delivery_id, attemptToken, sending);
        // Retain a rejection handler even if the local deadline wins the race.
        void sending.catch(() => undefined);
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => {
              sendAbort.abort();
              reject(new Error("Delivery deadline expired during send"));
            },
            Math.max(0, deliveryDeadline - Date.now())
          );
        });
        sent = await Promise.race([sending, timeout, interruption]);
      } catch (error) {
        const state = definiteRejection(error) ? "failed" : "unknown";
        markDeliveryFragment(
          db,
          delivery.delivery_id,
          row.fragment_index,
          state,
          error instanceof Error ? error.message : String(error)
        );
        updateResponseDelivery(
          db,
          delivery.delivery_id,
          state,
          error instanceof Error ? error.message : String(error)
        );
        if (
          sending &&
          error instanceof Error &&
          ["Delivery deadline expired during send", "Delivery interrupted during send"].includes(
            error.message
          )
        ) {
          // The timed-out transport may still return a confirmed receipt. Preserve it
          // only while the fragment is unresolved; an operator's CAS resolution wins.
          void sending.then(
            (lateReceipt) => {
              try {
                {
                  const changed = confirmLateDeliveryFragment(
                    db,
                    delivery.delivery_id,
                    row.fragment_index,
                    attemptToken,
                    lateReceipt?.id ?? 0,
                    lateReceipt?.date ?? Math.floor(Date.now() / 1000)
                  );
                  if (!changed) return;
                  if (lateReceipt?.id) {
                    try {
                      recordFeed(
                        db,
                        target.chatId,
                        lateReceipt.id,
                        row.text,
                        lateReceipt.date,
                        target.isGroup
                      );
                      db.prepare(
                        "UPDATE response_delivery_fragments SET feed_recorded=1 WHERE delivery_id=? AND fragment_index=?"
                      ).run(delivery.delivery_id, row.fragment_index);
                    } catch {
                      /* Receipt remains confirmed; feed repair is independent. */
                    }
                  }
                  const remaining = listDeliveryFragments(db, delivery.delivery_id);
                  updateResponseDelivery(
                    db,
                    delivery.delivery_id,
                    remaining.every((fragment) => fragment.status === "delivered")
                      ? "delivered"
                      : "prepared"
                  );
                }
              } catch {
                /* Leave the reservation uncertain when a late receipt cannot be persisted. */
              }
            },
            () => undefined
          );
        }
        break;
      } finally {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      }
      // A receipt persistence failure is uncertain, even though this process saw the receipt.
      try {
        confirmDeliveryFragment(
          db,
          delivery.delivery_id,
          row.fragment_index,
          sent?.id ?? 0,
          sent?.date ?? Math.floor(Date.now() / 1000),
          attemptToken
        );
      } catch (error) {
        try {
          markDeliveryFragment(
            db,
            delivery.delivery_id,
            row.fragment_index,
            "unknown",
            String(error)
          );
          updateResponseDelivery(db, delivery.delivery_id, "unknown", "Receipt persistence failed");
        } catch {
          /* The durable sending reservation forbids resend. */
        }
        response.delivery = {
          state: "unknown",
          deliveryId: delivery.delivery_id,
          reason: "Receipt persistence failed",
          messageIds: sent?.id ? [sent.id] : [],
        };
        return response;
      }
      if (sent?.id) {
        try {
          recordFeed(db, target.chatId, sent.id, row.text, sent.date, target.isGroup);
          db.prepare(
            "UPDATE response_delivery_fragments SET feed_recorded=1 WHERE delivery_id=? AND fragment_index=?"
          ).run(delivery.delivery_id, row.fragment_index);
        } catch {
          /* Projection repair cannot revoke a confirmed remote receipt. */
        }
      }
    }
    const latest = listDeliveryFragments(db, delivery.delivery_id);
    const state = latest.some((row) => row.status === "unknown" || row.status === "sending")
      ? "unknown"
      : latest.every((row) => row.status === "delivered")
        ? "delivered"
        : latest.some((row) => row.status === "delivered")
          ? "partial"
          : "failed";
    try {
      updateResponseDelivery(db, delivery.delivery_id, state);
    } catch {
      /* Fragment receipts remain authoritative if the summary projection fails. */
    }
    response.delivery = {
      state,
      deliveryId: delivery.delivery_id,
      messageIds: latest.flatMap((row) => (row.message_id ? [row.message_id] : [])),
    };
    return response;
  } finally {
    if (ownsReservation) await clearDeliveryDraft(target);
    release?.();
  }
}
