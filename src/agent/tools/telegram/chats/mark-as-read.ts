import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_mark_as_read tool
 */
interface MarkAsReadParams {
  chatId: string;
  messageId?: number;
  clearMentions?: boolean;
}

/**
 * Tool definition for marking messages as read
 */
export const telegramMarkAsReadTool: Tool = {
  name: "telegram_mark_as_read",
  description:
    "Mark messages as read in a Telegram chat. Can mark up to a specific message or clear all unread. Use this to manage your inbox and acknowledge messages.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to mark as read",
    }),
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
    const { chatId, messageId, clearMentions = true } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Resolve entity
    let entity;
    try {
      entity = await gramJsClient.getEntity(chatId);
    } catch (error) {
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
    console.error("Error marking messages as read:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
