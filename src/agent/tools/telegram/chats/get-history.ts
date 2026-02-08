import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_get_history tool
 */
interface GetHistoryParams {
  chatId: string;
  limit?: number;
  offsetId?: number;
}

/**
 * Tool definition for getting chat history
 */
export const telegramGetHistoryTool: Tool = {
  name: "telegram_get_history",
  description:
    "Retrieve message history from a Telegram chat. Use this to read past messages and understand conversation context.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to retrieve history from",
    }),
    limit: Type.Optional(
      Type.Number({
        description:
          "Maximum number of messages to retrieve (default: 50, max recommended: 100 for performance)",
        minimum: 1,
        maximum: 100,
      })
    ),
    offsetId: Type.Optional(
      Type.Number({
        description:
          "Message ID to start from (for pagination). Messages older than this ID will be retrieved.",
      })
    ),
  }),
};

/**
 * Executor for telegram_get_history tool
 */
export const telegramGetHistoryExecutor: ToolExecutor<GetHistoryParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, limit = 50, offsetId } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Fetch messages using GramJS getMessages
    const messages = await gramJsClient.getMessages(chatId, {
      limit,
      offsetId,
    });

    // Parse and format messages
    const formattedMessages = messages.map((msg) => ({
      id: msg.id,
      text: msg.message || "",
      senderId: msg.senderId?.toString() || null,
      senderName: msg.sender
        ? (msg.sender as any).firstName || (msg.sender as any).username || null
        : null,
      timestamp: msg.date,
      isOutgoing: msg.out || false,
    }));

    return {
      success: true,
      data: {
        messages: formattedMessages,
        count: formattedMessages.length,
        chatId,
      },
    };
  } catch (error) {
    console.error("Error getting Telegram history:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
