import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSchema } from "../../memory/schema.js";
import { deliverAgentResponse, reserveDraft, reserveDraftWithinBudget } from "../delivery.js";
import {
  claimDeliveryFragment,
  confirmLateDeliveryFragment,
  markDeliveryFragment,
  prepareDeliveryRetry,
  listDeliveryAttempts,
  listDeliveryFragments,
  prepareResponseDelivery,
  recoverResponseDeliveries,
  resolveResponseDelivery,
} from "../../memory/response-deliveries.js";
import {
  completeTurnIngress,
  recoverTurnIngress,
  reserveTurnIngress,
} from "../../memory/turn-ingress.js";
import type { AgentResponse } from "../turn-types.js";
import type { ITelegramBridge } from "../../telegram/bridge-interface.js";
const response = (content = "hello"): AgentResponse => ({
  turnId: "t1",
  outcome: { status: "completed", reason: "completed" },
  delivery: { state: "not_requested" },
  content,
});
describe("durable response delivery", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });
  afterEach(() => db.close());
  let nextMessageId = 0;
  function target() {
    return {
      kind: "telegram" as const,
      chatId: "1",
      bridge: {
        getMode: () => "bot",
        getOwnUserId: () => 1n,
        sendMessage: vi
          .fn()
          .mockImplementation(async () => ({ id: ++nextMessageId, chatId: "1", date: 100 })),
        clearDraft: vi.fn().mockResolvedValue(undefined),
      } as unknown as ITelegramBridge,
    };
  }
  it("persists generated ingress and resumes without authorizing a second generation", () => {
    const request = { key: "event", chatId: "1", text: "question" };
    expect(reserveTurnIngress(db, request).kind).toBe("generate");
    completeTurnIngress(db, "event", response());
    recoverTurnIngress(db);
    expect(reserveTurnIngress(db, request)).toMatchObject({
      kind: "resume",
      response: { content: "hello" },
    });
    expect(reserveTurnIngress(db, { ...request, text: "changed" }).kind).toBe("conflict");
  });
  it("bounds an ambiguous send and accepts a late confirmed receipt without resending", async () => {
    vi.useFakeTimers();
    try {
      const destination = target();
      let confirm!: (value: { id: number; date: number; chatId: string }) => void;
      vi.mocked(destination.bridge.sendMessage).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            confirm = resolve;
          })
      );
      const pending = deliverAgentResponse(db, response(), destination, {
        deadline: Date.now() + 50,
      });
      await vi.advanceTimersByTimeAsync(50);
      const result = await pending;
      expect(result.delivery.state).toBe("unknown");
      const deliveryRow = db
        .prepare("SELECT revision FROM response_deliveries WHERE delivery_id=?")
        .get(result.delivery.deliveryId) as { revision: number };
      expect(
        resolveResponseDelivery(
          db,
          result.delivery.deliveryId!,
          deliveryRow.revision,
          "not_delivered",
          "unsafe while transport pending"
        )
      ).toBe(false);
      confirm({ id: 77, date: 100, chatId: "1" });
      await Promise.resolve();
      await Promise.resolve();
      expect(listDeliveryFragments(db, result.delivery.deliveryId!)[0]).toMatchObject({
        status: "delivered",
        message_id: 77,
        feed_recorded: 1,
      });
      await deliverAgentResponse(db, response(), destination);
      expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not claim a fragment after the delivery deadline", async () => {
    const destination = target();
    const result = await deliverAgentResponse(db, response(), destination, {
      deadline: Date.now() - 1,
    });
    expect(result.delivery.state).toBe("prepared");
    expect(destination.bridge.sendMessage).not.toHaveBeenCalled();
    expect(listDeliveryFragments(db, result.delivery.deliveryId!)[0].status).toBe("prepared");
  });
  it("does not convert a receipt persistence failure into a safe retry", async () => {
    const destination = target();
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      if (sql.startsWith("UPDATE response_delivery_fragments SET status='delivered'"))
        throw new Error("disk failure");
      return prepare(sql);
    }) as typeof db.prepare);
    const first = await deliverAgentResponse(db, response(), destination);
    expect(first.delivery.state).toBe("unknown");
    await deliverAgentResponse(db, response(), destination);
    expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("keeps a confirmed receipt when feed projection fails and repairs without sending again", async () => {
    db.exec(
      "CREATE TRIGGER reject_feed BEFORE INSERT ON tg_messages BEGIN SELECT RAISE(FAIL, 'projection unavailable'); END"
    );
    const destination = target();
    const first = await deliverAgentResponse(db, response(), destination);
    expect(first.delivery.state).toBe("delivered");
    expect(listDeliveryFragments(db, first.delivery.deliveryId!)[0]).toMatchObject({
      status: "delivered",
      feed_recorded: 0,
    });
    db.exec("DROP TRIGGER reject_feed");
    await deliverAgentResponse(db, response(), destination);
    expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(1);
    expect(listDeliveryFragments(db, first.delivery.deliveryId!)[0].feed_recorded).toBe(1);
  });
  it("rejects changed response content under an existing delivery identity", async () => {
    const destination = target();
    await deliverAgentResponse(db, response(), destination);
    await expect(deliverAgentResponse(db, response("changed"), destination)).rejects.toThrow(
      /payload conflicts/
    );
    expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("rejects a stale attempt receipt even when a new attempt has the same timeout", () => {
    const delivery = prepareResponseDelivery(db, "t1", "1", "telegram", [{ text: "hello" }]);
    claimDeliveryFragment(db, delivery.delivery_id, 0, "attempt-old");
    markDeliveryFragment(db, delivery.delivery_id, 0, "unknown", "same timeout");
    db.prepare("UPDATE response_deliveries SET status='unknown' WHERE delivery_id=?").run(
      delivery.delivery_id
    );
    expect(
      resolveResponseDelivery(
        db,
        delivery.delivery_id,
        delivery.revision,
        "not_delivered",
        "confirmed absent"
      )
    ).toBe(true);
    claimDeliveryFragment(db, delivery.delivery_id, 0, "attempt-new");
    markDeliveryFragment(db, delivery.delivery_id, 0, "unknown", "same timeout");
    expect(confirmLateDeliveryFragment(db, delivery.delivery_id, 0, "attempt-old", 123, 100)).toBe(
      false
    );
    expect(listDeliveryFragments(db, delivery.delivery_id)[0]).toMatchObject({
      status: "unknown",
      attempt_token: "attempt-new",
      message_id: null,
    });
    expect(confirmLateDeliveryFragment(db, delivery.delivery_id, 0, "attempt-new", 456, 100)).toBe(
      true
    );
  });
  it("stores each confirmed chunk and never resends it", async () => {
    const destination = target();
    const result = await deliverAgentResponse(db, response("x".repeat(8200)), destination);
    expect(result.delivery.state).toBe("delivered");
    expect(result.delivery.messageIds).toHaveLength(3);
    await deliverAgentResponse(db, response("x".repeat(8200)), destination);
    expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(3);
    expect(db.prepare("SELECT COUNT(*) AS n FROM tg_messages").get()).toEqual({ n: 3 });
  });
  it("does not resend an ambiguous fragment after restart; explicit non-delivery permits remaining only", async () => {
    const destination = target();
    vi.mocked(destination.bridge.sendMessage)
      .mockResolvedValueOnce({ id: 10, date: 100, chatId: "1" })
      .mockRejectedValueOnce(new Error("connection reset"));
    const first = await deliverAgentResponse(db, response("x".repeat(5000)), destination);
    expect(first.delivery.state).toBe("unknown");
    recoverResponseDeliveries(db);
    await deliverAgentResponse(db, response("x".repeat(5000)), destination);
    expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(2);
    const row = db
      .prepare("SELECT revision FROM response_deliveries WHERE delivery_id=?")
      .get(first.delivery.deliveryId) as { revision: number };
    expect(
      resolveResponseDelivery(
        db,
        first.delivery.deliveryId!,
        row.revision,
        "not_delivered",
        "API evidence"
      )
    ).toBe(true);
    expect(
      (await deliverAgentResponse(db, response("x".repeat(5000)), destination)).delivery.state
    ).toBe("delivered");
    expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(3);
    expect(listDeliveryFragments(db, first.delivery.deliveryId!)[0].message_id).toBe(10);
  });
  it("explicitly retries only a known rejected suffix while preserving attempts and confirmed IDs", async () => {
    const destination = target();
    vi.mocked(destination.bridge.sendMessage)
      .mockResolvedValueOnce({ id: 20, date: 100, chatId: "1" })
      .mockRejectedValueOnce(Object.assign(new Error("rejected"), { error_code: 400 }))
      .mockResolvedValueOnce({ id: 30, date: 100, chatId: "1" });
    const first = await deliverAgentResponse(db, response("x".repeat(5000)), destination);
    expect(first.delivery.state).toBe("partial");
    const id = first.delivery.deliveryId!;
    const revision = (
      db.prepare("SELECT revision FROM response_deliveries WHERE delivery_id=?").get(id) as {
        revision: number;
      }
    ).revision;
    expect(
      prepareDeliveryRetry(db, id, revision, "operator requested retry after correction")
    ).toBe(true);
    const retried = await deliverAgentResponse(db, response("x".repeat(5000)), destination);
    expect(retried.delivery).toMatchObject({ state: "delivered", messageIds: [20, 30] });
    expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(3);
    const attempts = listDeliveryAttempts(db, id);
    expect(attempts).toHaveLength(3);
    expect(attempts.filter((attempt) => attempt.status === "failed")).toHaveLength(1);
    expect(new Set(attempts.map((attempt) => attempt.attempt_token)).size).toBe(3);
  });
  it("converts sending at startup to unknown and refuses automatic resend", async () => {
    const destination = target();
    const delivery = prepareResponseDelivery(db, "t1", "1", "telegram", [{ text: "hello" }]);
    claimDeliveryFragment(db, delivery.delivery_id, 0);
    recoverResponseDeliveries(db);
    expect((await deliverAgentResponse(db, response(), destination)).delivery.state).toBe(
      "unknown"
    );
    expect(destination.bridge.sendMessage).not.toHaveBeenCalled();
  });
  it("applies exact, silent and heartbeat policies at the actual destination", async () => {
    const destination = target();
    expect(
      (await deliverAgentResponse(db, response("__SILENT__"), destination)).delivery.state
    ).toBe("suppressed");
    expect(
      (await deliverAgentResponse(db, response("NO_ACTION"), destination, { isHeartbeat: true }))
        .delivery.state
    ).toBe("suppressed");
    const answer = response();
    answer.toolCalls = [
      {
        name: "telegram_send_message",
        input: { chatId: "2", text: "hello" },
        result: { success: true },
      },
    ];
    expect((await deliverAgentResponse(db, answer, destination)).delivery.state).toBe("delivered");
    expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("returns an already-confirmed response while a later turn owns the destination", async () => {
    const destination = target();
    const first = await deliverAgentResponse(db, response(), destination);
    const owner = await reserveDraft(destination);
    try {
      const replay = await deliverAgentResponse(db, response(), destination, {
        deadline: Date.now() - 1,
      });
      expect(replay.delivery).toMatchObject({
        state: "delivered",
        messageIds: first.delivery.messageIds,
      });
      expect(destination.bridge.sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      owner();
    }
  });
  it("expires destination admission with a durable prepared response and keeps successors behind the active owner", async () => {
    vi.useFakeTimers();
    try {
      const destination = target();
      const owner = await reserveDraft(destination);
      const waiting = deliverAgentResponse(db, response(), destination, {
        deadline: Date.now() + 60_000,
      });
      await Promise.resolve();
      const prepared = db.prepare("SELECT delivery_id FROM response_deliveries").get() as {
        delivery_id: string;
      };
      expect(listDeliveryFragments(db, prepared.delivery_id)[0].status).toBe("prepared");
      let nextOwner = false;
      const following = reserveDraft(destination).then((release) => {
        nextOwner = true;
        return release;
      });
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await waiting;
      expect(result.delivery).toMatchObject({
        state: "prepared",
        reason: "Delivery deadline expired while waiting for destination",
      });
      expect(destination.bridge.sendMessage).not.toHaveBeenCalled();
      expect(destination.bridge.clearDraft).not.toHaveBeenCalled();
      expect(nextOwner).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      owner();
      const releaseNext = await following;
      expect(nextOwner).toBe(true);
      releaseNext();
    } finally {
      vi.useRealTimers();
    }
  });
  it("aborts a queued reservation promptly without releasing or clearing its predecessor", async () => {
    vi.useFakeTimers();
    try {
      const destination = target();
      const owner = await reserveDraft(destination);
      const controller = new AbortController();
      const waiting = deliverAgentResponse(db, response(), destination, {
        signal: controller.signal,
        deadline: Date.now() + 60_000,
      });
      await Promise.resolve();
      controller.abort();
      const result = await waiting;
      expect(result.delivery.state).toBe("prepared");
      expect(result.delivery.reason).toContain("cancelled while waiting");
      let acquired = false;
      const following = reserveDraftWithinBudget(destination, {
        deadline: Date.now() + 120_000,
      }).then((release) => {
        acquired = !!release;
        return release;
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(acquired).toBe(false);
      expect(destination.bridge.sendMessage).not.toHaveBeenCalled();
      expect(destination.bridge.clearDraft).not.toHaveBeenCalled();
      owner();
      const releaseFollowing = await following;
      expect(acquired).toBe(true);
      releaseFollowing?.();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("holds one destination reservation across distinct logical sessions", async () => {
    const destination = target();
    const first = await reserveDraft(destination);
    let secondAcquired = false;
    const pending = reserveDraft(destination).then((release) => {
      secondAcquired = true;
      release();
    });
    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    first();
    await pending;
    expect(secondAcquired).toBe(true);
  });
});
