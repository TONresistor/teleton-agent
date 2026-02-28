import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

const USERNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_]{3,30}[a-zA-Z0-9]$/;

interface CheckChannelUsernameParams {
  channelId: string;
  username: string;
}

export const telegramCheckChannelUsernameTool: Tool = {
  name: "telegram_check_channel_username",
  description:
    "Verify whether a username is available for a specific channel/group you admin. Returns availability status; use telegram_set_channel_username to apply.",
  parameters: Type.Object({
    channelId: Type.String({
      description: "Channel or group ID to check availability for",
    }),
    username: Type.String({
      description:
        "Username to check (5-32 chars, letters/numbers/underscores, no @ symbol). Example: 'my_channel'",
    }),
  }),
};

export const telegramCheckChannelUsernameExecutor: ToolExecutor<
  CheckChannelUsernameParams
> = async (params, context): Promise<ToolResult> => {
  try {
    const { channelId, username } = params;
    const clean = username.replace(/^@/, "");

    if (!USERNAME_REGEX.test(clean)) {
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
    const available = await gramJsClient.invoke(
      new Api.channels.CheckUsername({
        channel,
        username: clean,
      })
    );

    return {
      success: true,
      data: {
        channelId: channel.id.toString(),
        username: clean,
        available: !!available,
      },
    };
  } catch (error: any) {
    log.error({ err: error }, "Error checking channel username");

    const msg = getErrorMessage(error);

    if (msg.includes("USERNAME_INVALID")) {
      return {
        success: false,
        error: `Invalid username format: "${params.username}"`,
      };
    }

    if (msg.includes("CHANNELS_ADMIN_PUBLIC_TOO_MUCH")) {
      return {
        success: false,
        error:
          "You admin too many public channels. Make some channels private before assigning a new public username.",
      };
    }

    if (msg.includes("USERNAME_PURCHASE_AVAILABLE")) {
      return {
        success: true,
        data: {
          channelId: params.channelId,
          username: params.username.replace(/^@/, ""),
          available: false,
          purchaseAvailable: true,
          message: "This username is available for purchase on fragment.com",
        },
      };
    }

    return {
      success: false,
      error: msg,
    };
  }
};
