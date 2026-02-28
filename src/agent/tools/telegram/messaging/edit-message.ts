import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { markdownToTelegramHtml } from "../../../../telegram/formatting.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../../constants/limits.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_edit_message tool
 */
interface EditMessageParams {
  chatId: string;
  messageId: number;
  text: string;
}

/**
 * Tool definition for editing Telegram messages
 */
export const telegramEditMessageTool: Tool = {
  name: "telegram_edit_message",
  description:
    "Modify a previously sent message in-place. Requires chatId + messageId. Only your own messages can be edited, within 48h. Supports Markdown formatting.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the message was sent",
    }),
    messageId: Type.Number({
      description: "The ID of the message to edit",
    }),
    text: Type.String({
      description: "The new text content for the message (max 4096 characters)",
      maxLength: TELEGRAM_MAX_MESSAGE_LENGTH,
    }),
  }),
};

/**
 * Executor for telegram_edit_message tool
 */
export const telegramEditMessageExecutor: ToolExecutor<EditMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageId, text } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Convert Markdown to Telegram HTML
    const formattedText = markdownToTelegramHtml(text);

    // Edit message using GramJS high-level method with HTML parseMode
    const result = await gramJsClient.editMessage(chatId, {
      message: messageId,
      text: formattedText,
      parseMode: "html",
    });

    return {
      success: true,
      data: {
        messageId,
        chatId,
        edited: true,
        date: result?.date || Math.floor(Date.now() / 1000),
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error editing Telegram message");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
