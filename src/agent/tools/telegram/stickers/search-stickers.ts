import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

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
    "Search sticker packs globally by keyword or emoji. Returns packs with shortName, count, and install status. For installed-only, use telegram_get_my_stickers.",
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
    log.error({ err: error }, "Error searching stickers");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
