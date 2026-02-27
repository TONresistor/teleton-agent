import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

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
  description: "Edit a channel or group's title and/or description. Requires admin rights.",
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

    log.info(`✏️ edit_channel_info: ${channel.title} - ${updates.join(", ")}`);

    return {
      success: true,
      data: {
        channelId: channel.id.toString(),
        channelTitle: title || channel.title,
        updated: updates,
      },
    };
  } catch (error: any) {
    log.error({ err: error }, "Error editing channel info");

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
      error: getErrorMessage(error),
    };
  }
};
