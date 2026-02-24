import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface SetPersonalChannelParams {
  channelId?: string;
}

export const telegramSetPersonalChannelTool: Tool = {
  name: "telegram_set_personal_channel",
  description:
    "Set or remove the personal channel displayed on your Telegram profile. Provide a channel ID to set, or omit to remove.",
  parameters: Type.Object({
    channelId: Type.Optional(
      Type.String({
        description: "Channel ID or username to set as personal channel. Omit to remove.",
      })
    ),
  }),
};

export const telegramSetPersonalChannelExecutor: ToolExecutor<SetPersonalChannelParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const gramJsClient = context.bridge.getClient().getClient();

    let channel: Api.TypeEntityLike;
    let action: "set" | "removed";

    if (params.channelId) {
      channel = await gramJsClient.getEntity(params.channelId);
      action = "set";
    } else {
      channel = new Api.InputChannelEmpty();
      action = "removed";
    }

    await gramJsClient.invoke(new Api.account.UpdatePersonalChannel({ channel }));

    log.info(`👤 set_personal_channel: ${action} (${params.channelId || "empty"})`);

    return {
      success: true,
      data: {
        action,
        channelId: params.channelId || null,
      },
    };
  } catch (error: any) {
    if (error.errorMessage === "CHANNEL_INVALID") {
      return {
        success: false,
        error: "Invalid channel — make sure you are an admin of this public channel.",
      };
    }
    if (error.errorMessage === "CHANNELS_ADMIN_PUBLIC_TOO_MUCH") {
      return {
        success: false,
        error: "You administer too many public channels to set a personal channel.",
      };
    }

    log.error({ err: error }, "Error setting personal channel");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
