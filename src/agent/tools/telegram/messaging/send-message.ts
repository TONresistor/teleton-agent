import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../../constants/limits.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

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
    "Send a text message to a Telegram chat. For custom keyboards use telegram_reply_keyboard; for media use telegram_send_photo/gif/sticker.",
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
    log.error({ err: error }, "Error sending Telegram message");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
