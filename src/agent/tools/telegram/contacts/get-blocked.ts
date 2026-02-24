import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_get_blocked tool
 */
interface GetBlockedParams {
  limit?: number;
}

/**
 * Tool definition for getting blocked users
 */
export const telegramGetBlockedTool: Tool = {
  name: "telegram_get_blocked",
  description: "Get your list of blocked users.",
  category: "data-bearing",
  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of blocked users to return (default: 50, max: 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

/**
 * Executor for telegram_get_blocked tool
 */
export const telegramGetBlockedExecutor: ToolExecutor<GetBlockedParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { limit = 50 } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get blocked users using GramJS
    const result = await gramJsClient.invoke(
      new Api.contacts.GetBlocked({
        offset: 0,
        limit,
      })
    );

    // Parse blocked users
    const blockedUsers = result.users.map((user: any) => ({
      userId: user.id?.toString(),
      username: user.username || null,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      isBot: user.bot || false,
    }));

    return {
      success: true,
      data: {
        count: blockedUsers.length,
        blocked: blockedUsers,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error getting blocked Telegram users");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
