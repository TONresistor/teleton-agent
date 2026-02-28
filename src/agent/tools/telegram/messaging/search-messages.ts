import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

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
    "Search for messages in a chat by text query. Pass chatId as numeric ID or @username (never display names). Returns matching messages with content, sender, and timestamps. When NOT to use: for reading recent history without a query, use telegram_get_history instead.",
  category: "data-bearing",
  parameters: Type.Object({
    chatId: Type.String({
      description: "Numeric chat ID (e.g. '123456789') or @username. Never use display names.",
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

    const isNumeric = /^-?\d+$/.test(chatId);
    const isUsername = chatId.startsWith("@");
    if (!isNumeric && !isUsername) {
      return {
        success: false,
        error: `"${chatId}" looks like a display name. Use a numeric chat ID or @username. Call telegram_get_dialogs to find chat IDs.`,
      };
    }

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

    // Parse results — all TypeMessages variants have .messages
    const resultData = result as Api.messages.Messages;
    const messages = resultData.messages.map((msg) => {
      const m = msg as Api.Message;
      return {
        id: m.id,
        text: m.message || "",
        senderId: (m.fromId as Api.PeerUser)?.userId?.toString() || null,
        date: m.date,
        timestamp: new Date(m.date * 1000).toISOString(),
      };
    });

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
    log.error({ err: error }, "Error searching Telegram messages");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
