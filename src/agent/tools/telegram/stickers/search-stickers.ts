import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_search_stickers tool
 */
interface SearchStickersParams {
  query: string;
  limit?: number;
}

/**
 * Tool definition for searching stickers
 */
export const telegramSearchStickersTool: Tool = {
  name: "telegram_search_stickers",
  description:
    "Search for sticker packs globally in Telegram's catalog by keyword or emoji. Returns both installed and uninstalled packs with their installation status. Use this to discover new packs or find specific ones. For a focused view of ONLY your installed packs, use telegram_get_my_stickers instead. Results include shortName and count. To send: telegram_send_sticker(chatId, stickerSetShortName, stickerIndex 0 to count-1).",
  parameters: Type.Object({
    query: Type.String({
      description:
        "Search query (sticker pack name, emoji, or keywords). Example: 'pepe', '😀', 'cat'",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of sticker sets to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      })
    ),
  }),
};

/**
 * Executor for telegram_search_stickers tool
 */
export const telegramSearchStickersExecutor: ToolExecutor<SearchStickersParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { query, limit = 10 } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Search for sticker sets
    const result = await gramJsClient.invoke(
      new Api.messages.SearchStickerSets({
        q: query,
        excludeFeatured: false,
      })
    );

    if (result.className !== "messages.FoundStickerSets") {
      return {
        success: false,
        error: "Unexpected result type from sticker search",
      };
    }

    const sets = result.sets.slice(0, limit).map((set: any) => ({
      shortName: set.set.shortName,
      title: set.set.title,
      count: set.set.count,
      validIndices: `0-${set.set.count - 1}`,
      installed: set.set.installed || false,
    }));

    return {
      success: true,
      data: {
        sets,
        totalFound: result.sets.length,
        usage:
          "To send a sticker: telegram_send_sticker(chatId, stickerSetShortName='<shortName>', stickerIndex=<0 to count-1>)",
      },
    };
  } catch (error) {
    console.error("Error searching stickers:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
