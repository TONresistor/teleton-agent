import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { getClient } from "../../../../sdk/telegram-utils.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_mark_as_read tool
 */
interface MarkAsReadParams {
  chatId: string | number;
  messageId?: number;
  clearMentions?: boolean;
}

/**
 * Tool definition for marking messages as read
 */
export const telegramMarkAsReadTool: Tool = {
  name: "telegram_mark_as_read",
  description:
    "Mark messages as read in a chat. Can mark up to a specific message or clear all unread.",
  parameters: Type.Object({
    chatId: Type.Union([Type.String(), Type.Number()]),
    messageId: Type.Optional(
      Type.Number({
        description:
          "Mark as read up to this message ID. If not provided, marks all messages as read.",
      })
    ),
    clearMentions: Type.Optional(
      Type.Boolean({
        description: "Also clear the mentions badge. Default: true",
      })
    ),
  }),
};

/**
 * Executor for telegram_mark_as_read tool
 */
export const telegramMarkAsReadExecutor: ToolExecutor<MarkAsReadParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const chatId = String(params.chatId);
    const { messageId, clearMentions = true } = params;

    // Get underlying GramJS client
    const gramJsClient = getClient(context.bridge);

    // Resolve entity
    let entity;
    try {
      entity = await gramJsClient.getEntity(chatId);
    } catch {
      return {
        success: false,
        error: `Could not find chat "${chatId}"`,
      };
    }

    // Mark as read
    await gramJsClient.markAsRead(entity, messageId, {
      clearMentions,
    });

    return {
      success: true,
      data: {
        chatId,
        messageId: messageId || "all",
        mentionsCleared: clearMentions,
        message: messageId
          ? `Marked messages up to ${messageId} as read`
          : "Marked all messages as read",
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error marking messages as read");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
