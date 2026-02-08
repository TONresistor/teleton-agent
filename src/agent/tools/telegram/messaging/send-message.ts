import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../../constants/limits.js";

/**
 * Parameters for telegram_send_message tool
 */
interface SendMessageParams {
  chatId: string;
  text: string;
  replyToId?: number;
}

/**
 * Tool definition for sending Telegram messages
 */
export const telegramSendMessageTool: Tool = {
  name: "telegram_send_message",
  description:
    "Send a text message to a Telegram chat. Supports up to 4096 characters. Use this for standard text responses in DMs or groups. For messages with custom keyboards, use telegram_reply_keyboard. For media, use specific media tools (telegram_send_photo, etc.).",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the message to",
    }),
    text: Type.String({
      description: "The message text to send (max 4096 characters)",
      maxLength: TELEGRAM_MAX_MESSAGE_LENGTH,
    }),
    replyToId: Type.Optional(
      Type.Number({
        description: "Optional message ID to reply to",
      })
    ),
  }),
};

/**
 * Executor for telegram_send_message tool
 */
export const telegramSendMessageExecutor: ToolExecutor<SendMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, text, replyToId } = params;

    // Send message via Telegram bridge
    const sentMessage = await context.bridge.sendMessage({
      chatId,
      text,
      replyToId,
    });

    return {
      success: true,
      data: {
        messageId: sentMessage?.id ?? null,
        date: sentMessage?.date ?? null,
      },
    };
  } catch (error) {
    console.error("Error sending Telegram message:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
