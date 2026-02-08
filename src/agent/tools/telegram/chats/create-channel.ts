import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_create_channel tool
 */
interface CreateChannelParams {
  title: string;
  about?: string;
  megagroup?: boolean;
}

/**
 * Tool definition for creating channels
 */
export const telegramCreateChannelTool: Tool = {
  name: "telegram_create_channel",
  description:
    "Create a new Telegram channel or megagroup. Channels are one-way broadcast tools where only admins can post, ideal for announcements or content distribution. Megagroups are large groups supporting up to 200k members with admin controls. Use this to establish a new communication platform for announcements, communities, or projects.",
  parameters: Type.Object({
    title: Type.String({
      description: "Name of the channel/megagroup (max 128 characters)",
      maxLength: 128,
    }),
    about: Type.Optional(
      Type.String({
        description: "Description of the channel/megagroup (max 255 characters). Visible in info.",
        maxLength: 255,
      })
    ),
    megagroup: Type.Optional(
      Type.Boolean({
        description:
          "Create as megagroup (large group with chat) instead of broadcast channel. Default: false (creates broadcast channel).",
      })
    ),
  }),
};

/**
 * Executor for telegram_create_channel tool
 */
export const telegramCreateChannelExecutor: ToolExecutor<CreateChannelParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { title, about = "", megagroup = false } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Create channel
    const result: any = await gramJsClient.invoke(
      new Api.channels.CreateChannel({
        title,
        about,
        megagroup,
        broadcast: !megagroup,
      })
    );

    // Extract channel info from updates
    const channel = result.chats?.[0];

    return {
      success: true,
      data: {
        channelId: channel?.id?.toString() || "unknown",
        title,
        type: megagroup ? "megagroup" : "channel",
        accessHash: channel?.accessHash?.toString(),
      },
    };
  } catch (error) {
    console.error("Error creating channel:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
