import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";

/**
 * Parameters for telegram_block_user tool
 */
interface BlockUserParams {
  userId: string;
}

/**
 * Tool definition for blocking Telegram users
 */
export const telegramBlockUserTool: Tool = {
  name: "telegram_block_user",
  description:
    "Block a Telegram user to prevent them from sending you messages or adding you to groups. Use this for spam protection, harassment prevention, or managing unwanted contacts. The blocked user will not be notified.",
  parameters: Type.Object({
    userId: Type.String({
      description: "The user ID or username to block (e.g., '123456789' or '@username')",
    }),
  }),
};

/**
 * Executor for telegram_block_user tool
 */
export const telegramBlockUserExecutor: ToolExecutor<BlockUserParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { userId } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get user entity
    const userEntity = await gramJsClient.getInputEntity(userId);

    // Block user using GramJS
    await gramJsClient.invoke(
      new Api.contacts.Block({
        id: userEntity,
      })
    );

    return {
      success: true,
      data: {
        userId,
        blocked: true,
      },
    };
  } catch (error) {
    console.error("Error blocking Telegram user:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
