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
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
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
  if (!call || !call.result?.data || typeof call.result.data !== "object") return null;

  const data = call.result.data as Record<string, unknown>;
  const rawId = data.messageId ?? data.message_id;
  if ((typeof rawId !== "string" && typeof rawId !== "number") || String(rawId) === "0") {
    return null;
  }
  return String(rawId);
}
