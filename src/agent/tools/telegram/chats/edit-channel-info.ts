import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for editing channel info
 */
interface EditChannelInfoParams {
  channelId: string;
  title?: string;
  about?: string;
}

/**
 * Tool definition for editing channel/group info
 */
export const telegramEditChannelInfoTool: Tool = {
  name: "telegram_edit_channel_info",
  description: `Edit a channel or group's information.

USAGE:
- Pass the channelId and any fields to update
- You must be an admin with the appropriate rights

FIELDS:
- title: Channel/group name (1-255 characters)
- about: Description/bio (0-255 characters)

NOTE: To change the photo, use a separate photo upload tool.

Example: Update your channel @my_channel with a new description.`,
  parameters: Type.Object({
    channelId: Type.String({
      description: "Channel or group ID to edit",
    }),
    title: Type.Optional(
      Type.String({
        description: "New title/name for the channel (1-255 chars)",
        maxLength: 255,
      })
    ),
    about: Type.Optional(
      Type.String({
        description: "New description/about text (0-255 chars)",
        maxLength: 255,
      })
    ),
  }),
};

/**
 * Executor for telegram_edit_channel_info tool
 */
export const telegramEditChannelInfoExecutor: ToolExecutor<EditChannelInfoParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { channelId, title, about } = params;

    if (!title && about === undefined) {
      return {
        success: false,
        error: "Must provide at least one field to update (title or about)",
      };
    }

    const gramJsClient = context.bridge.getClient().getClient();

    // Get channel entity
    const entity = await gramJsClient.getEntity(channelId);

    if (entity.className !== "Channel") {
      return {
        success: false,
        error: `Entity is not a channel/group (got ${entity.className})`,
      };
    }

    const channel = entity as Api.Channel;
    const updates: string[] = [];

    // Update title if provided
    if (title) {
      await gramJsClient.invoke(
        new Api.channels.EditTitle({
          channel: channel,
          title: title,
        })
      );
      updates.push(`title → "${title}"`);
    }

    // Update about/description if provided
    if (about !== undefined) {
      await gramJsClient.invoke(
        new Api.messages.EditChatAbout({
          peer: channel,
          about: about,
        })
      );
      updates.push(`about → "${about.substring(0, 50)}${about.length > 50 ? "..." : ""}"`);
    }

    console.log(`✏️ edit_channel_info: ${channel.title} - ${updates.join(", ")}`);

    return {
      success: true,
      data: {
        channelId: channel.id.toString(),
        channelTitle: title || channel.title,
        updated: updates,
      },
    };
  } catch (error: any) {
    console.error("Error editing channel info:", error);

    // Handle common errors
    if (error.message?.includes("CHAT_ADMIN_REQUIRED")) {
      return {
        success: false,
        error: "You need admin rights to edit this channel",
      };
    }

    if (error.message?.includes("CHAT_NOT_MODIFIED")) {
      return {
        success: true,
        data: {
          message: "No changes made (values are the same)",
        },
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
