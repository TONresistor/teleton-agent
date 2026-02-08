import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_leave_channel tool
 */
interface LeaveChannelParams {
  channel: string;
}

/**
 * Tool definition for leaving a Telegram channel or group
 */
export const telegramLeaveChannelTool: Tool = {
  name: "telegram_leave_channel",
  description:
    "Leave a Telegram channel or group that you're currently a member of. Use this to unsubscribe from channels or exit groups you no longer wish to participate in. Accepts username or channel ID.",
  parameters: Type.Object({
    channel: Type.String({
      description:
        "Channel username (with or without @) or numeric channel ID to leave. Examples: '@mychannel', 'mychannel', '-1001234567890'",
    }),
  }),
};

/**
 * Executor for telegram_leave_channel tool
 */
export const telegramLeaveChannelExecutor: ToolExecutor<LeaveChannelParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { channel } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Resolve the channel entity
    let channelEntity;
    try {
      channelEntity = await gramJsClient.getEntity(channel);
    } catch (error) {
      return {
        success: false,
        error: `Could not find channel "${channel}". Make sure it exists and you have access to it.`,
      };
    }

    // Leave the channel using the API
    await gramJsClient.invoke(
      new Api.channels.LeaveChannel({
        channel: channelEntity,
      })
    );

    // Get channel info before leaving
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
        message: `Successfully left ${channelTitle}`,
      },
    };
  } catch (error) {
    console.error("Error leaving Telegram channel:", error);

    // Handle common errors
    if (error instanceof Error) {
      if (error.message.includes("USER_NOT_PARTICIPANT")) {
        return {
          success: true,
          data: {
            channel: params.channel,
            message: `Not a member of ${params.channel}`,
          },
        };
      }
      if (error.message.includes("CHANNEL_PRIVATE")) {
        return {
          success: false,
          error: "Channel is private or you don't have access to it",
        };
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
