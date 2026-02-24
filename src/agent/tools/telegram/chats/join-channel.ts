import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

function extractInviteHash(input: string): string | null {
  const patterns = [
    /t\.me\/\+([A-Za-z0-9_-]+)/,
    /t\.me\/joinchat\/([A-Za-z0-9_-]+)/,
    /tg:\/\/join\?invite=([A-Za-z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

interface JoinChannelParams {
  channel: string;
}

/**
 * Tool definition for joining a Telegram channel or group
 */
export const telegramJoinChannelTool: Tool = {
  name: "telegram_join_channel",
  description: "Join a channel or group. Accepts username, channel ID, or private invite link.",
  parameters: Type.Object({
    channel: Type.String({
      description:
        "Channel username (with or without @), numeric channel ID, or invite link. Examples: '@mychannel', 'mychannel', '-1001234567890', 'https://t.me/+AbCdEf123'",
    }),
  }),
};

/**
 * Executor for telegram_join_channel tool
 */
export const telegramJoinChannelExecutor: ToolExecutor<JoinChannelParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { channel } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Try invite link first if the input looks like one
    const inviteHash = extractInviteHash(channel);

    if (inviteHash) {
      // Check the invite before importing
      const checkResult = await gramJsClient.invoke(
        new Api.messages.CheckChatInvite({ hash: inviteHash })
      );

      if (checkResult instanceof Api.ChatInviteAlready) {
        const chat = checkResult.chat;
        const chatTitle =
          chat instanceof Api.Channel || chat instanceof Api.Chat ? chat.title : channel;
        return {
          success: true,
          data: {
            channel: channel,
            channelId: chat.id?.toString() || null,
            channelTitle: chatTitle,
            message: `Already a member of ${chatTitle}`,
          },
        };
      }

      const updates = await gramJsClient.invoke(
        new Api.messages.ImportChatInvite({ hash: inviteHash })
      );

      // Extract chat info from updates
      const chats =
        updates instanceof Api.Updates || updates instanceof Api.UpdatesCombined
          ? updates.chats
          : [];
      const joinedChat = chats[0];
      const chatTitle =
        joinedChat instanceof Api.Channel || joinedChat instanceof Api.Chat
          ? joinedChat.title
          : channel;
      const chatId = joinedChat?.id?.toString() || null;

      return {
        success: true,
        data: {
          channel: channel,
          channelId: chatId,
          channelTitle: chatTitle,
          message: `Successfully joined ${chatTitle}`,
        },
      };
    }

    // Resolve the channel entity (handles both usernames and IDs)
    let channelEntity;
    try {
      channelEntity = await gramJsClient.getEntity(channel);
    } catch {
      // GramJS VALID_USERNAME_RE rejects usernames <5 chars (collectible/Fragment usernames).
      // Bypass getEntity and call ResolveUsername directly.
      const clean = channel.replace(/^@/, "");
      try {
        const resolved = await gramJsClient.invoke(
          new Api.contacts.ResolveUsername({ username: clean })
        );
        channelEntity = resolved.chats[0] || resolved.users[0];
      } catch {
        // Genuinely not found
      }
      if (!channelEntity) {
        return {
          success: false,
          error: `Could not find channel "${channel}". Make sure it's a public channel or you have access to it.`,
        };
      }
    }

    await gramJsClient.invoke(
      new Api.channels.JoinChannel({
        channel: channelEntity,
      })
    );

    const channelTitle =
      channelEntity instanceof Api.Channel
        ? channelEntity.title
        : channelEntity instanceof Api.User
          ? channelEntity.username
          : channel;
    const channelId = channelEntity.id?.toString() || null;

    return {
      success: true,
      data: {
        channel: channel,
        channelId: channelId,
        channelTitle: channelTitle,
        message: `Successfully joined ${channelTitle}`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error joining Telegram channel");

    if (error instanceof Error) {
      if (error.message.includes("USER_ALREADY_PARTICIPANT")) {
        return {
          success: true,
          data: {
            channel: params.channel,
            message: `Already a member of ${params.channel}`,
          },
        };
      }
      if (error.message.includes("INVITE_HASH_INVALID")) {
        return {
          success: false,
          error: "Invalid invite link. The link may be malformed or revoked.",
        };
      }
      if (error.message.includes("INVITE_HASH_EXPIRED")) {
        return {
          success: false,
          error: "This invite link has expired.",
        };
      }
      if (error.message.includes("INVITE_REQUEST_SENT")) {
        return {
          success: true,
          data: {
            channel: params.channel,
            message: "Join request sent. Waiting for admin approval.",
          },
        };
      }
      if (error.message.includes("CHANNELS_TOO_MUCH")) {
        return {
          success: false,
          error: "You've joined too many channels. Leave some before joining new ones.",
        };
      }
    }

    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
