/**
 * Moderation tools: kick, ban, unban users from groups/channels
 */

import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

// ============================================
// KICK USER
// ============================================

interface KickUserParams {
  chat_id: string;
  user_id: string;
}

export const telegramKickUserTool: Tool = {
  name: "telegram_kick_user",
  description: `Kick a user from a group or channel. The user can rejoin unless banned. You need admin rights with ban permission.`,
  parameters: Type.Object({
    chat_id: Type.String({
      description: "Group/channel ID or username",
    }),
    user_id: Type.String({
      description: "User ID or username to kick",
    }),
  }),
};

export const telegramKickUserExecutor: ToolExecutor<KickUserParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chat_id, user_id } = params;

    const client = context.bridge.getClient().getClient();

    // Kick = ban then immediately unban
    await client.invoke(
      new Api.channels.EditBanned({
        channel: chat_id,
        participant: user_id,
        bannedRights: new Api.ChatBannedRights({
          untilDate: 0,
          viewMessages: true,
          sendMessages: true,
          sendMedia: true,
          sendStickers: true,
          sendGifs: true,
          sendGames: true,
          sendInline: true,
          embedLinks: true,
        }),
      })
    );

    // Immediately unban so they can rejoin
    await client.invoke(
      new Api.channels.EditBanned({
        channel: chat_id,
        participant: user_id,
        bannedRights: new Api.ChatBannedRights({
          untilDate: 0,
        }),
      })
    );

    return {
      success: true,
      data: {
        chat_id,
        user_id,
        kicked: true,
        message: `👢 User ${user_id} kicked from chat`,
      },
    };
  } catch (error) {
    console.error("Error in telegram_kick_user:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ============================================
// BAN USER
// ============================================

interface BanUserParams {
  chat_id: string;
  user_id: string;
  delete_messages?: boolean;
  duration_hours?: number;
}

export const telegramBanUserTool: Tool = {
  name: "telegram_ban_user",
  description: `Ban a user from a group or channel. Banned users cannot rejoin until unbanned. You need admin rights with ban permission.`,
  parameters: Type.Object({
    chat_id: Type.String({
      description: "Group/channel ID or username",
    }),
    user_id: Type.String({
      description: "User ID or username to ban",
    }),
    delete_messages: Type.Optional(
      Type.Boolean({
        description: "Delete all messages from this user in the chat (default: false)",
      })
    ),
    duration_hours: Type.Optional(
      Type.Number({
        description: "Ban duration in hours. If not set, ban is permanent.",
        minimum: 1,
      })
    ),
  }),
};

export const telegramBanUserExecutor: ToolExecutor<BanUserParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chat_id, user_id, delete_messages = false, duration_hours } = params;

    const client = context.bridge.getClient().getClient();

    // Calculate until_date (0 = permanent)
    const untilDate = duration_hours ? Math.floor(Date.now() / 1000) + duration_hours * 3600 : 0;

    await client.invoke(
      new Api.channels.EditBanned({
        channel: chat_id,
        participant: user_id,
        bannedRights: new Api.ChatBannedRights({
          untilDate,
          viewMessages: true,
          sendMessages: true,
          sendMedia: true,
          sendStickers: true,
          sendGifs: true,
          sendGames: true,
          sendInline: true,
          embedLinks: true,
        }),
      })
    );

    // Optionally delete all messages from user
    if (delete_messages) {
      try {
        await client.invoke(
          new Api.channels.DeleteParticipantHistory({
            channel: chat_id,
            participant: user_id,
          })
        );
      } catch (e) {
        // Ignore if deletion fails (might not have permission)
        console.warn("Could not delete user messages:", e);
      }
    }

    const durationStr = duration_hours ? `for ${duration_hours}h` : "permanently";

    return {
      success: true,
      data: {
        chat_id,
        user_id,
        banned: true,
        duration_hours: duration_hours ?? null,
        messages_deleted: delete_messages,
        message: `🚫 User ${user_id} banned ${durationStr}`,
      },
    };
  } catch (error) {
    console.error("Error in telegram_ban_user:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ============================================
// UNBAN USER
// ============================================

interface UnbanUserParams {
  chat_id: string;
  user_id: string;
}

export const telegramUnbanUserTool: Tool = {
  name: "telegram_unban_user",
  description: `Unban a user from a group or channel, allowing them to rejoin. You need admin rights with ban permission.`,
  parameters: Type.Object({
    chat_id: Type.String({
      description: "Group/channel ID or username",
    }),
    user_id: Type.String({
      description: "User ID or username to unban",
    }),
  }),
};

export const telegramUnbanUserExecutor: ToolExecutor<UnbanUserParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chat_id, user_id } = params;

    const client = context.bridge.getClient().getClient();

    await client.invoke(
      new Api.channels.EditBanned({
        channel: chat_id,
        participant: user_id,
        bannedRights: new Api.ChatBannedRights({
          untilDate: 0,
          // All false = no restrictions
        }),
      })
    );

    return {
      success: true,
      data: {
        chat_id,
        user_id,
        unbanned: true,
        message: `✅ User ${user_id} unbanned`,
      },
    };
  } catch (error) {
    console.error("Error in telegram_unban_user:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
