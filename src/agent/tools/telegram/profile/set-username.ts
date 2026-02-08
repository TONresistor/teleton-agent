import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_set_username tool
 */
interface SetUsernameParams {
  username: string;
}

/**
 * Tool definition for setting username
 */
export const telegramSetUsernameTool: Tool = {
  name: "telegram_set_username",
  description:
    "Set or change your Telegram username (the @handle people use to find you). Usernames are unique across Telegram - must be 5-32 characters, alphanumeric plus underscores, and available. Use this to claim a memorable handle or update your public identifier. Empty string removes username. Warning: Changing username breaks existing t.me/username links.",
  parameters: Type.Object({
    username: Type.String({
      description:
        "New username (5-32 chars, letters/numbers/underscores only, no @ symbol). Example: 'cool_user_123'. Empty string '' to remove username.",
      minLength: 0,
      maxLength: 32,
    }),
  }),
};

/**
 * Executor for telegram_set_username tool
 */
export const telegramSetUsernameExecutor: ToolExecutor<SetUsernameParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { username } = params;

    // Validate username format
    if (username.length > 0) {
      if (username.length < 5) {
        return {
          success: false,
          error: "Username must be at least 5 characters (or empty to remove)",
        };
      }

      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return {
          success: false,
          error: "Username can only contain letters, numbers, and underscores",
        };
      }
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Update username
    const result = await gramJsClient.invoke(
      new Api.account.UpdateUsername({
        username: username || "",
      })
    );

    return {
      success: true,
      data: {
        username: username || null,
        link: username ? `https://t.me/${username}` : null,
      },
    };
  } catch (error) {
    console.error("Error setting username:", error);

    // Handle specific errors
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("USERNAME_OCCUPIED")) {
      return {
        success: false,
        error: "Username is already taken. Please choose another.",
      };
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
};
