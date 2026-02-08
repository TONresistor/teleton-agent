import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

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
    "List all sticker packs that are installed/saved to your account. Returns your personal sticker collection with shortName, title, and count for each pack. Use this to see what stickers you already have before sending. To send a sticker from your collection: use telegram_send_sticker with the shortName + stickerIndex.",
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
        hash: BigInt(0) as any,
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
    console.error("Error getting installed stickers:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
