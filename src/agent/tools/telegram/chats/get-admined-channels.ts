import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface GetAdminedChannelsParams {
  forPersonal?: boolean;
}

export const telegramGetAdminedChannelsTool: Tool = {
  name: "telegram_get_admined_channels",
  description:
    "List public channels where the current account has admin rights. Returns channel IDs, titles, usernames, and participant counts.",
  category: "data-bearing",
  parameters: Type.Object({
    forPersonal: Type.Optional(
      Type.Boolean({
        description: "If true, filter for channels suitable as personal channel",
      })
    ),
  }),
};

export const telegramGetAdminedChannelsExecutor: ToolExecutor<GetAdminedChannelsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const gramJsClient = context.bridge.getClient().getClient();

    const result = await gramJsClient.invoke(
      new Api.channels.GetAdminedPublicChannels({
        byLocation: false,
        checkLimit: false,
        forPersonal: params.forPersonal,
      })
    );

    const chats = ("chats" in result ? result.chats : []) as Api.Channel[];

    const channels = chats.map((ch) => ({
      id: ch.id?.toString(),
      title: ch.title,
      username: ch.username || null,
      participantsCount: ch.participantsCount || null,
      isMegagroup: ch.megagroup || false,
      isBroadcast: ch.broadcast || false,
    }));

    log.info(`📡 get_admined_channels: ${channels.length} channels found`);

    return {
      success: true,
      data: {
        count: channels.length,
        channels,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error getting admined channels");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
