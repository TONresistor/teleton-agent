import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_add_sticker_set tool
 */
interface AddStickerSetParams {
  shortName: string;
}

/**
 * Tool definition for adding sticker packs
 */
export const telegramAddStickerSetTool: Tool = {
  name: "telegram_add_sticker_set",
  description:
    "Add/install a sticker pack to your account by its short name. Once added, you can use the stickers from this pack in conversations. The short name is the part after t.me/addstickers/ in a sticker pack link, or can be found via telegram_search_stickers. Use this to build your sticker collection.",
  parameters: Type.Object({
    shortName: Type.String({
      description:
        "Short name of the sticker pack (e.g., 'Animals' from t.me/addstickers/Animals). Obtainable from telegram_search_stickers results.",
    }),
  }),
};

/**
 * Executor for telegram_add_sticker_set tool
 */
export const telegramAddStickerSetExecutor: ToolExecutor<AddStickerSetParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { shortName } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get the sticker set info first
    const stickerSet: any = await gramJsClient.invoke(
      new Api.messages.GetStickerSet({
        stickerset: new Api.InputStickerSetShortName({
          shortName,
        }),
        hash: 0,
      })
    );

    // Install the sticker set
    await gramJsClient.invoke(
      new Api.messages.InstallStickerSet({
        stickerset: new Api.InputStickerSetShortName({
          shortName,
        }),
        archived: false,
      })
    );

    return {
      success: true,
      data: {
        shortName,
        title: stickerSet.set?.title || shortName,
        count: stickerSet.set?.count || 0,
      },
    };
  } catch (error) {
    console.error("Error adding sticker set:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
