import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for checking username
 */
interface CheckUsernameParams {
  username: string;
}

/**
 * Tool definition for checking username availability
 */
export const telegramCheckUsernameTool: Tool = {
  name: "telegram_check_username",
  description: `Check if a Telegram username exists and get basic info about it.

USAGE:
- Pass a username (with or without @)

RETURNS:
- exists: whether the username is taken
- type: "user", "channel", "group", or null if not found
- Basic info about the entity if it exists

Use this to:
- Check if a trader's username is valid
- Verify channel/group names
- See if a username is available`,
  parameters: Type.Object({
    username: Type.String({
      description: "Username to check (with or without @)",
    }),
  }),
};

/**
 * Executor for telegram_check_username tool
 */
export const telegramCheckUsernameExecutor: ToolExecutor<CheckUsernameParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { username } = params;
    const cleanUsername = username.replace("@", "").toLowerCase();

    if (!cleanUsername || cleanUsername.length < 5) {
      return {
        success: false,
        error: "Username must be at least 5 characters",
      };
    }

    const gramJsClient = context.bridge.getClient().getClient();

    try {
      // Try to resolve the username
      const result = await gramJsClient.invoke(
        new Api.contacts.ResolveUsername({
          username: cleanUsername,
        })
      );

      // Determine entity type and extract info
      let entityType: string | null = null;
      let entityInfo: Record<string, any> = {};

      if (result.users && result.users.length > 0) {
        const user = result.users[0] as Api.User;
        entityType = user.bot ? "bot" : "user";
        entityInfo = {
          id: user.id.toString(),
          username: user.username,
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          isBot: user.bot || false,
          isPremium: user.premium || false,
          isVerified: user.verified || false,
        };
      } else if (result.chats && result.chats.length > 0) {
        const chat = result.chats[0];
        if (chat.className === "Channel") {
          const channel = chat as Api.Channel;
          entityType = channel.megagroup ? "group" : "channel";
          entityInfo = {
            id: channel.id.toString(),
            username: channel.username,
            title: channel.title,
            isVerified: channel.verified || false,
            participantsCount: channel.participantsCount || null,
            isMegagroup: channel.megagroup || false,
            isBroadcast: channel.broadcast || false,
          };
        } else if (chat.className === "Chat") {
          const group = chat as Api.Chat;
          entityType = "group";
          entityInfo = {
            id: group.id.toString(),
            title: group.title,
            participantsCount: group.participantsCount || null,
          };
        }
      }

      console.log(`🔍 check_username: @${cleanUsername} → ${entityType}`);

      return {
        success: true,
        data: {
          username: cleanUsername,
          exists: true,
          type: entityType,
          entity: entityInfo,
        },
      };
    } catch (error: any) {
      // Username not found
      if (
        error.message?.includes("USERNAME_NOT_OCCUPIED") ||
        error.message?.includes("No user has") ||
        error.errorMessage === "USERNAME_NOT_OCCUPIED"
      ) {
        console.log(`🔍 check_username: @${cleanUsername} → not found (available)`);
        return {
          success: true,
          data: {
            username: cleanUsername,
            exists: false,
            type: null,
            available: true,
          },
        };
      }

      // Invalid username format
      if (error.message?.includes("USERNAME_INVALID")) {
        return {
          success: false,
          error: `Invalid username format: @${cleanUsername}`,
        };
      }

      throw error;
    }
  } catch (error) {
    console.error("Error checking username:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
