import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";

/**
 * Parameters for telegram_get_common_chats tool
 */
interface GetCommonChatsParams {
  userId: string;
  limit?: number;
}

/**
 * Tool definition for getting common chats
 */
export const telegramGetCommonChatsTool: Tool = {
  name: "telegram_get_common_chats",
  description:
    "Find groups and channels that you share with another Telegram user. Use this to understand mutual connections, verify relationships, or discover shared communities. Returns list of common chats with their names and IDs.",
  parameters: Type.Object({
    userId: Type.String({
      description:
        "The user ID or username to find common chats with (e.g., '123456789' or '@username')",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of common chats to return (default: 50, max: 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

/**
 * Executor for telegram_get_common_chats tool
 */
export const telegramGetCommonChatsExecutor: ToolExecutor<GetCommonChatsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { userId, limit = 50 } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get user entity
    const userEntity = await gramJsClient.getInputEntity(userId);

    // Get common chats using GramJS
    const result = await gramJsClient.invoke(
      new Api.messages.GetCommonChats({
        userId: userEntity,
        maxId: 0 as any,
        limit,
      })
    );

    // Parse common chats
    const commonChats = result.chats.map((chat: any) => ({
      chatId: chat.id?.toString(),
      title: chat.title || null,
      username: chat.username || null,
      isChannel: chat.broadcast || false,
      isMegagroup: chat.megagroup || false,
      membersCount: chat.participantsCount || null,
    }));

    return {
      success: true,
      data: {
        userId,
        count: commonChats.length,
        chats: commonChats,
      },
    };
  } catch (error) {
    console.error("Error getting common Telegram chats:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
