import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";

export interface CompletedToolCall {
  name: string;
  input: Record<string, unknown>;
  durationMs?: number;
  attempted?: boolean;
  result?: { success: boolean; data?: unknown; error?: string };
}

function targetChatId(call: CompletedToolCall): string | null {
  const raw = call.name === "telegram_forward_message" ? call.input.toChatId : call.input.chatId;
  if (typeof raw === "string" || typeof raw === "number") return String(raw);
  if (call.result?.data && typeof call.result.data === "object") {
    const resultChatId = (call.result.data as Record<string, unknown>).chatId;
    if (typeof resultChatId === "string" || typeof resultChatId === "number") {
      return String(resultChatId);
    }
  }
  return null;
}

export function sentSuccessfullyToChat(call: CompletedToolCall, chatId: string): boolean {
  return (
    TELEGRAM_SEND_TOOLS.has(call.name) &&
    call.result?.success === true &&
    targetChatId(call) === String(chatId)
  );
}

export function deliveredTelegramText(
  calls: CompletedToolCall[] | undefined,
  chatId: string,
  text: string
): boolean {
  const normalizedText = text.trim();
  if (!normalizedText) return false;

  return (
    calls?.some(
      (call) =>
        sentSuccessfullyToChat(call, chatId) &&
        typeof call.input.text === "string" &&
        call.input.text.trim() === normalizedText
    ) ?? false
  );
}

/** Return the successful structured send made to this chat, when present. */
export function deliveredTelegramStructuredMessage(
  calls: CompletedToolCall[] | undefined,
  chatId: string
): CompletedToolCall | null {
  return (
    calls?.find(
      (call) =>
        call.name === "telegram_send_message" &&
        sentSuccessfullyToChat(call, chatId) &&
        call.result?.data !== null &&
        typeof call.result?.data === "object" &&
        (call.result.data as Record<string, unknown>).deliveryKind === "rich"
    ) ?? null
  );
}

export function deliveredTelegramMessageIdFromCall(call: CompletedToolCall): string | null {
  if (!call.result?.data || typeof call.result.data !== "object") return null;
  const data = call.result.data as Record<string, unknown>;
  const rawId = data.messageId ?? data.message_id;
  if ((typeof rawId !== "string" && typeof rawId !== "number") || String(rawId) === "0") {
    return null;
  }
  return String(rawId);
}

/** Return the Telegram ID produced by the matching send tool, when available. */
export function deliveredTelegramMessageId(
  calls: CompletedToolCall[] | undefined,
  chatId: string,
  text: string
): string | null {
  const normalizedText = text.trim();
  const call = calls?.find(
    (candidate) =>
      sentSuccessfullyToChat(candidate, chatId) &&
      typeof candidate.input.text === "string" &&
      candidate.input.text.trim() === normalizedText
  );
  return call ? deliveredTelegramMessageIdFromCall(call) : null;
}
