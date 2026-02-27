import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

const USERNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_]{3,30}[a-zA-Z0-9]$/;

interface SetChannelUsernameParams {
  channelId: string;
  username: string;
}

export const telegramSetChannelUsernameTool: Tool = {
  name: "telegram_set_channel_username",
  description:
    "Set or remove the public username of a channel/group you admin. Makes it discoverable at t.me/<username>. Empty string removes the username (makes channel private). Requires admin rights.",
  parameters: Type.Object({
    channelId: Type.String({
      description: "Channel or group ID to update",
    }),
    username: Type.String({
      description:
        "New username (5-32 chars, letters/numbers/underscores, no @). Example: 'my_channel'. Empty string '' to remove username and make channel private.",
      minLength: 0,
      maxLength: 32,
    }),
  }),
};

export const telegramSetChannelUsernameExecutor: ToolExecutor<SetChannelUsernameParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { channelId, username } = params;
    const clean = username.replace(/^@/, "");

    if (clean.length > 0 && !USERNAME_REGEX.test(clean)) {
      return {
        success: false,
        error:
          "Invalid username format. Must be 5-32 characters, alphanumeric and underscores only, cannot start/end with underscore.",
      };
    }

    const gramJsClient = context.bridge.getClient().getClient();
    const entity = await gramJsClient.getEntity(channelId);

    if (entity.className !== "Channel") {
      return {
        success: false,
        error: `Entity is not a channel/group (got ${entity.className})`,
      };
    }

    const channel = entity as Api.Channel;
    await gramJsClient.invoke(
      new Api.channels.UpdateUsername({
        channel,
        username: clean || "",
      })
    );

    return {
      success: true,
      data: {
        channelId: channel.id.toString(),
        username: clean || null,
        link: clean ? `https://t.me/${clean}` : null,
      },
    };
  } catch (error: any) {
    log.error({ err: error }, "Error setting channel username");

    const msg = getErrorMessage(error);

    if (msg.includes("USERNAME_OCCUPIED")) {
      return {
        success: false,
        error: "Username is already taken. Please choose another.",
      };
    }

    if (msg.includes("USERNAME_NOT_MODIFIED")) {
      return {
        success: true,
        data: {
          message: "No changes made (username is the same)",
        },
      };
    }

    if (msg.includes("CHAT_ADMIN_REQUIRED")) {
      return {
        success: false,
        error: "You need admin rights to change this channel's username.",
      };
    }

    if (msg.includes("CHANNELS_ADMIN_PUBLIC_TOO_MUCH")) {
      return {
        success: false,
        error: "You admin too many public channels. Make some channels private first.",
      };
    }

    if (msg.includes("USERNAME_INVALID")) {
      return {
        success: false,
        error: `Invalid username format: "${params.username}"`,
      };
    }

    if (msg.includes("USERNAME_PURCHASE_AVAILABLE")) {
      return {
        success: false,
        error: `Username @${params.username.replace(/^@/, "")} is available for purchase on fragment.com, not for free assignment.`,
      };
    }

    return {
      success: false,
      error: msg,
    };
  }
};
