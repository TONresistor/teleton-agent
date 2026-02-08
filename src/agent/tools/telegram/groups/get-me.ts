import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Tool definition for getting own user information
 */
export const telegramGetMeTool: Tool = {
  name: "telegram_get_me",
  description:
    "Get information about yourself (the currently authenticated Telegram account). Returns your user ID, username, name, phone number, and whether you're a bot. Use this for self-awareness and to understand your own account details.",
  parameters: Type.Object({}), // No parameters needed
};

/**
 * Executor for telegram_get_me tool
 */
export const telegramGetMeExecutor: ToolExecutor<{}> = async (
  _params,
  context
): Promise<ToolResult> => {
  try {
    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get own user info using getMe()
    const me = (await gramJsClient.getMe()) as Api.User;

    // Extract and format user information
    return {
      success: true,
      data: {
        id: me.id.toString(),
        username: me.username || null,
        firstName: me.firstName || null,
        lastName: me.lastName || null,
        phone: me.phone || null,
        isBot: me.bot || false,
        isPremium: me.premium || false,
        languageCode: me.langCode || null,
        // Full name for convenience
        fullName: [me.firstName, me.lastName].filter(Boolean).join(" ") || null,
      },
    };
  } catch (error) {
    console.error("Error getting own Telegram user info:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
