import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";

/**
 * Parameters for telegram_search_messages tool
 */
interface SearchMessagesParams {
  chatId: string;
  query: string;
  limit?: number;
}

/**
 * Tool definition for searching messages in Telegram chats
 */
export const telegramSearchMessagesTool: Tool = {
  name: "telegram_search_messages",
  description:
    "Search for messages in a Telegram chat by text query. Use this to find past conversations, retrieve specific information, or locate messages containing keywords. Returns matching messages with their content and metadata.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to search in",
    }),
    query: Type.String({
      description: "The search query text to find in messages",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of results to return (default: 50, max: 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

/**
 * Executor for telegram_search_messages tool
 */
export const telegramSearchMessagesExecutor: ToolExecutor<SearchMessagesParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, query, limit = 50 } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get chat entity
    const entity = await gramJsClient.getEntity(chatId);

    // Search messages using GramJS
    const result = await gramJsClient.invoke(
      new Api.messages.Search({
        peer: entity,
        q: query,
        filter: new Api.InputMessagesFilterEmpty(),
        limit,
      })
    );

    // Parse results
    const resultData = result as any;
    const messages = resultData.messages.map((msg: any) => ({
      id: msg.id,
      text: msg.message || "",
      senderId: msg.fromId?.userId?.toString() || null,
      date: msg.date,
      timestamp: new Date(msg.date * 1000).toISOString(),
    }));

    return {
      success: true,
      data: {
        query,
        chatId,
        count: messages.length,
        messages,
      },
    };
  } catch (error) {
    console.error("Error searching Telegram messages:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
