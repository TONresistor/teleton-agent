import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";

export interface CompletedToolCall {
  name: string;
  input: Record<string, unknown>;
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
