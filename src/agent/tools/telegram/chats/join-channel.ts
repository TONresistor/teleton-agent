import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_join_channel tool
 */
interface JoinChannelParams {
  channel: string;
}

/**
 * Tool definition for joining a Telegram channel or group
 */
export const telegramJoinChannelTool: Tool = {
  name: "telegram_join_channel",
  description:
    "Join a public Telegram channel or group. Use this to become a member of a community, follow updates, or participate in group discussions. Accepts username (e.g., '@channelname') or channel/group ID.",
  parameters: Type.Object({
    channel: Type.String({
      description:
        "Channel username (with or without @) or numeric channel ID. Examples: '@mychannel', 'mychannel', '-1001234567890'",
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

    // Resolve the channel entity (handles both usernames and IDs)
    let channelEntity;
    try {
      channelEntity = await gramJsClient.getEntity(channel);
    } catch (error) {
      return {
        success: false,
        error: `Could not find channel "${channel}". Make sure it's a public channel or you have access to it.`,
      };
    }

    // Join the channel using the API
    await gramJsClient.invoke(
      new Api.channels.JoinChannel({
        channel: channelEntity,
      })
    );

    // Get channel info after joining
    const channelTitle =
      (channelEntity as any)?.title || (channelEntity as any)?.username || channel;
    const channelId =
      (channelEntity as any)?.id?.toString() ||
      (channelEntity as any)?.channelId?.toString() ||
      null;

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
    console.error("Error joining Telegram channel:", error);

    // Handle common errors
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
          error: "Invalid invite link or channel is private",
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
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
