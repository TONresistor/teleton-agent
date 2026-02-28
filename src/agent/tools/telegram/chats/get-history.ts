import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

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
    "Retrieve message history from a chat by ID or @username. Returns sender, text, and timestamp per message. Defaults to 50 messages; set limit (max 100) and offsetId for pagination.",
  category: "data-bearing",
  parameters: Type.Object({
    chatId: Type.String({
      description: "Numeric chat ID (e.g. '123456789') or @username. Never use display names.",
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

    // Use cached peer if available, fall back to raw chatId string
    const entity = context.bridge.getPeer(chatId) || chatId;

    // Fetch messages using GramJS getMessages
    const messages = await gramJsClient.getMessages(entity, {
      limit,
      offsetId,
    });

    // Parse and format messages
    const formattedMessages = messages.map((msg) => ({
      id: msg.id,
      text: msg.message || "",
      senderId: msg.senderId?.toString() || null,
      senderName: msg.sender
        ? msg.sender instanceof Api.User
          ? msg.sender.firstName || msg.sender.username || null
          : null
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
    log.error({ err: error }, "Error getting Telegram history");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
