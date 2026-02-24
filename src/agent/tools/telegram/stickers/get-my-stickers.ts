import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { toLong } from "../../../../utils/gramjs-bigint.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_get_my_stickers tool
 */
interface GetMyStickersParams {
  limit?: number;
}

/**
 * Tool definition for getting installed sticker packs
 */
export const telegramGetMyStickersTool: Tool = {
  name: "telegram_get_my_stickers",
  description:
    "List all sticker packs installed on your account. Returns shortName, title, and count per pack.",
  category: "data-bearing",
  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of sticker sets to return (default: 20, 0 for all)",
        minimum: 0,
      })
    ),
  }),
};

/**
 * Executor for telegram_get_my_stickers tool
 */
export const telegramGetMyStickersExecutor: ToolExecutor<GetMyStickersParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { limit = 20 } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get all installed sticker sets
    const result: any = await gramJsClient.invoke(
      new Api.messages.GetAllStickers({
        hash: toLong(0),
      })
    );

    if (result.className === "messages.AllStickersNotModified") {
      return {
        success: true,
        data: {
          sets: [],
          message: "No stickers installed or cache is up to date",
        },
      };
    }

    // Format sticker sets
    let sets = result.sets.map((set: any) => ({
      shortName: set.shortName,
      title: set.title,
      count: set.count,
      validIndices: `0-${set.count - 1}`,
      animated: set.animated || false,
      video: set.videos || false,
      emojis: set.emojis || false,
    }));

    // Apply limit if specified
    if (limit > 0) {
      sets = sets.slice(0, limit);
    }

    return {
      success: true,
      data: {
        sets,
        totalInstalled: result.sets.length,
        showing: sets.length,
        usage:
          "To send: telegram_send_sticker(chatId, stickerSetShortName='<shortName>', stickerIndex=<0 to count-1>)",
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error getting installed stickers");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
