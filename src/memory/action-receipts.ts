import { createHash } from "node:crypto";
import type { Context, Message, UserMessage } from "@earendil-works/pi-ai/compat";

const RECEIPTS_PREFIX = "[Durable tool receipts]\n";
export interface ContextActionReceipt {
  toolCallId: string;
  toolName: string;
  arguments?: unknown;
  isError: boolean;
  /** The original structured result, including outcome, remote IDs and artifacts. */
  result: unknown;
}

export function hasLegacyActionEvidence(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 3) return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) =>
      /^(tx(hash)?|transaction(hash|id)?|message_?id|remote(id|reference)|receipt)$/i.test(key) ||
      hasLegacyActionEvidence(item, depth + 1)
  );
}

function compactReceiptValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return value.length <= 512 ? value : value.slice(0, 512) + " [full value in artifact/journal]";
  if (value === null || typeof value !== "object") return value;
  if (depth >= 4) return "[nested data in artifact/journal]";
  if (Array.isArray(value))
    return value.slice(0, 16).map((item) => compactReceiptValue(item, depth + 1));
  const entries = Object.entries(value as Record<string, unknown>);
  const selected = entries.filter(([key]) =>
    /id|hash|tx|address|amount|recipient|balance|status|outcome|message|summary|retryable|artifact|reference|read_with|size_bytes/.test(
      key.toLowerCase()
    )
  );
  return Object.fromEntries(
    selected
      .slice(0, 32)
      .map(([key, item]) => [
        key,
        key === "_artifact" ? item : compactReceiptValue(item, depth + 1),
      ])
  );
}

/** Receipts are deterministic state, never delegated to a lossy text summary. */
export function collectActionReceipts(messages: Message[]): ContextActionReceipt[] {
  const receipts = new Map<string, ContextActionReceipt>();
  const calls = new Map<string, unknown>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "toolCall") calls.set(block.id, block.arguments);
      }
    }
    if (
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith(RECEIPTS_PREFIX)
    ) {
      try {
        const saved = JSON.parse(
          message.content.slice(RECEIPTS_PREFIX.length)
        ) as ContextActionReceipt[];
        if (Array.isArray(saved)) {
          for (const receipt of saved) {
            if (typeof receipt.toolCallId === "string" && typeof receipt.toolName === "string")
              receipts.set(receipt.toolCallId, receipt);
          }
        }
      } catch {
        /* A malformed user message cannot invalidate genuine receipts. */
      }
    }
    if (message.role !== "toolResult") continue;
    let parsed: Record<string, unknown> | undefined;
    // The first block is the canonical JSON receipt; later blocks may contain
    // text/media projections and must not invalidate it.
    for (const block of message.content) {
      if (block.type !== "text") continue;
      try {
        parsed = JSON.parse(block.text) as Record<string, unknown>;
        break;
      } catch {
        /* projection text */
      }
    }
    const data =
      parsed?.data && typeof parsed.data === "object"
        ? (parsed.data as Record<string, unknown>)
        : undefined;
    const isAction =
      !!parsed?.execution ||
      !!parsed?.receipt ||
      data?.outcome === "unknown" ||
      hasLegacyActionEvidence(data) ||
      /(?:^|_)(?:send|transfer|swap|buy|sell|mint|create|delete|edit|withdraw|deposit)(?:_|$)/.test(
        message.toolName
      );
    if (!isAction && !data?._artifact) continue;
    const result = {
      success: parsed?.success,
      ...(parsed?.execution ? { execution: parsed.execution } : {}),
      ...(parsed?.receipt ? { receipt: compactReceiptValue(parsed.receipt) } : {}),
      ...(parsed?.error ? { error: String(parsed.error).slice(0, 512) } : {}),
      data: isAction ? compactReceiptValue(data) : { _artifact: data?._artifact },
    };
    receipts.set(message.toolCallId, {
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      arguments: isAction ? calls.get(message.toolCallId) : undefined,
      isError: message.isError,
      result,
    });
  }
  return [...receipts.values()];
}

export function formatActionReceipts(messages: Message[]): string {
  const receipts = collectActionReceipts(messages);
  return receipts.length ? RECEIPTS_PREFIX + JSON.stringify(receipts) : "";
}

/** Reattach state after compaction/overflow; also carries it through later compactions. */
export function preserveActionReceipts(
  context: Context,
  source: Message[] = context.messages
): Context {
  const text = formatActionReceipts(source);
  if (!text) return context;
  const messages = context.messages.filter(
    (message) =>
      !(
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.startsWith(RECEIPTS_PREFIX)
      )
  );
  return {
    ...context,
    messages: [
      { role: "user", content: text, timestamp: source[0]?.timestamp ?? Date.now() },
      ...messages,
    ],
  };
}

export function hasStructuredReceipt(message: Message): boolean {
  if (message.role !== "toolResult") return false;
  return message.content.some((block) => {
    if (block.type !== "text") return false;
    try {
      const result = JSON.parse(block.text);
      return !!(
        result.execution ||
        result.receipt ||
        result.data?._artifact ||
        result.data?.outcome
      );
    } catch {
      return false;
    }
  });
}

export const PROTECTED_REQUIREMENTS_PREFIX = "[Protected user requirements]\n";
export interface ProtectedUserRequirement {
  id: string;
  timestamp: number;
  content: UserMessage["content"];
}
interface ProtectedRequirementsProjection {
  version: 1;
  requirements: ProtectedUserRequirement[];
}
function isPseudoUser(message: Message): boolean {
  if (message.role !== "user") return false;
  const marked = message as Message & { _diagnosticOnly?: boolean };
  const content = message.content;
  return (
    !!marked._diagnosticOnly ||
    (typeof content === "string" &&
      [
        RECEIPTS_PREFIX,
        PROTECTED_REQUIREMENTS_PREFIX,
        "[Auto-compacted",
        "[Delivery state for turn ",
      ].some((prefix) => content.startsWith(prefix)))
  );
}
function requirement(message: UserMessage): ProtectedUserRequirement {
  return {
    id: createHash("sha256")
      .update(JSON.stringify([message.timestamp, message.content]))
      .digest("hex"),
    timestamp: message.timestamp,
    content: message.content,
  };
}
export function collectProtectedRequirements(messages: Message[]): ProtectedUserRequirement[] {
  const records = new Map<string, ProtectedUserRequirement>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (
      typeof message.content === "string" &&
      message.content.startsWith(PROTECTED_REQUIREMENTS_PREFIX)
    ) {
      try {
        const saved = JSON.parse(
          message.content.slice(PROTECTED_REQUIREMENTS_PREFIX.length)
        ) as ProtectedRequirementsProjection;
        if (saved.version === 1 && Array.isArray(saved.requirements)) {
          for (const record of saved.requirements)
            if (
              typeof record.id === "string" &&
              typeof record.timestamp === "number" &&
              (typeof record.content === "string" || Array.isArray(record.content))
            )
              records.set(record.id, record);
        }
      } catch {
        /* Invalid pseudo-messages cannot overwrite real user records. */
      }
    } else if (!isPseudoUser(message)) {
      const record = requirement(message);
      records.set(record.id, record);
    }
  }
  return [...records.values()];
}
/** Exact prior requirements are protected state, independent of summary quality. */
export function preserveUserRequirements(
  context: Context,
  source: Message[] = context.messages
): Context {
  const messages = context.messages.filter(
    (message) =>
      !(
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.startsWith(PROTECTED_REQUIREMENTS_PREFIX)
      )
  );
  const visible = new Set(
    messages
      .filter(
        (message): message is UserMessage => message.role === "user" && !isPseudoUser(message)
      )
      .map((message) => requirement(message).id)
  );
  const requirements = collectProtectedRequirements(source).filter(
    (record) => !visible.has(record.id)
  );
  if (!requirements.length) return { ...context, messages };
  const projection: ProtectedRequirementsProjection = { version: 1, requirements };
  return {
    ...context,
    messages: [
      {
        role: "user",
        content: PROTECTED_REQUIREMENTS_PREFIX + JSON.stringify(projection),
        timestamp: requirements[0].timestamp,
      },
      ...messages,
    ],
  };
}
