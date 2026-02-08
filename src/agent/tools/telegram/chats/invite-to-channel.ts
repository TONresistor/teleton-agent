import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for inviting users to channel
 */
interface InviteToChannelParams {
  channelId: string;
  userIds?: string[];
  usernames?: string[];
}

/**
 * Tool definition for inviting users to a channel/group
 */
export const telegramInviteToChannelTool: Tool = {
  name: "telegram_invite_to_channel",
  description: `Invite users to a channel or group.

USAGE:
- Pass channelId and either userIds or usernames (or both)
- You must be an admin with invite rights
- Users must allow being added to groups (privacy settings)

LIMITS:
- Can invite up to 200 users at once
- Some users may have privacy settings preventing invites

For public channels, you can also share the invite link instead.`,
  parameters: Type.Object({
    channelId: Type.String({
      description: "Channel or group ID to invite users to",
    }),
    userIds: Type.Optional(
      Type.Array(Type.String(), {
        description: "List of user IDs to invite",
      })
    ),
    usernames: Type.Optional(
      Type.Array(Type.String(), {
        description: "List of usernames to invite (with or without @)",
      })
    ),
  }),
};

/**
 * Executor for telegram_invite_to_channel tool
 */
export const telegramInviteToChannelExecutor: ToolExecutor<InviteToChannelParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { channelId, userIds = [], usernames = [] } = params;

    if (userIds.length === 0 && usernames.length === 0) {
      return {
        success: false,
        error: "Must provide at least one userId or username to invite",
      };
    }

    const gramJsClient = context.bridge.getClient().getClient();

    // Get channel entity
    const channelEntity = await gramJsClient.getEntity(channelId);

    if (channelEntity.className !== "Channel") {
      return {
        success: false,
        error: `Entity is not a channel/group (got ${channelEntity.className})`,
      };
    }

    const channel = channelEntity as Api.Channel;

    // Resolve all users
    const users: Api.TypeInputUser[] = [];
    const resolved: string[] = [];
    const failed: string[] = [];

    // Resolve by ID
    for (const userId of userIds) {
      try {
        const user = await gramJsClient.getEntity(userId);
        if (user.className === "User") {
          const apiUser = user as Api.User;
          users.push(
            new Api.InputUser({
              userId: apiUser.id,
              accessHash: apiUser.accessHash ?? (BigInt(0) as any),
            })
          );
          resolved.push(userId);
        } else {
          failed.push(`${userId} (not a user)`);
        }
      } catch (error) {
        failed.push(`${userId} (not found)`);
      }
    }

    // Resolve by username
    for (const username of usernames) {
      try {
        const cleanUsername = username.replace("@", "");
        const user = await gramJsClient.getEntity(cleanUsername);
        if (user.className === "User") {
          const apiUser = user as Api.User;
          users.push(
            new Api.InputUser({
              userId: apiUser.id,
              accessHash: apiUser.accessHash ?? (BigInt(0) as any),
            })
          );
          resolved.push(`@${cleanUsername}`);
        } else {
          failed.push(`@${cleanUsername} (not a user)`);
        }
      } catch (error) {
        failed.push(`@${username.replace("@", "")} (not found)`);
      }
    }

    if (users.length === 0) {
      return {
        success: false,
        error: `Could not resolve any users to invite. Failed: ${failed.join(", ")}`,
      };
    }

    // Invite users to channel
    const result = await gramJsClient.invoke(
      new Api.channels.InviteToChannel({
        channel: channel,
        users: users,
      })
    );

    console.log(`📨 invite_to_channel: Invited ${resolved.length} users to ${channel.title}`);

    return {
      success: true,
      data: {
        channelId: channel.id.toString(),
        channelTitle: channel.title,
        invited: resolved,
        failed: failed.length > 0 ? failed : undefined,
        invitedCount: resolved.length,
        failedCount: failed.length,
      },
    };
  } catch (error: any) {
    console.error("Error inviting to channel:", error);

    // Handle common errors
    if (error.message?.includes("CHAT_ADMIN_REQUIRED")) {
      return {
        success: false,
        error: "You need admin rights to invite users to this channel",
      };
    }

    if (error.message?.includes("USER_PRIVACY_RESTRICTED")) {
      return {
        success: false,
        error: "User's privacy settings prevent being added to groups",
      };
    }

    if (error.message?.includes("USER_NOT_MUTUAL_CONTACT")) {
      return {
        success: false,
        error: "You can only add mutual contacts to this group",
      };
    }

    if (error.message?.includes("USERS_TOO_MUCH")) {
      return {
        success: false,
        error: "Too many users in the channel",
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
