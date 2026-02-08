import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_search_gifs tool
 */
interface SearchGifsParams {
  query: string;
  limit?: number;
}

/**
 * Tool definition for searching GIFs
 */
export const telegramSearchGifsTool: Tool = {
  name: "telegram_search_gifs",
  description:
    "Search for GIF animations using Telegram's built-in GIF search (@gif bot). Returns GIF results with IDs and query_id. To send a GIF: 1) Use this tool to search, 2) Note the queryId and a result's id, 3) Use telegram_send_gif with queryId + resultId. This ensures proper sending via Telegram's inline bot system.",
  parameters: Type.Object({
    query: Type.String({
      description: "Search query for GIFs. Example: 'happy', 'dancing', 'thumbs up', 'laughing'",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of GIFs to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      })
    ),
  }),
};

/**
 * Executor for telegram_search_gifs tool
 */
export const telegramSearchGifsExecutor: ToolExecutor<SearchGifsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { query, limit = 10 } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get @gif bot entity
    const gifBot = await gramJsClient.getEntity("@gif");

    // Search for GIFs using inline bot query
    const result: any = await gramJsClient.invoke(
      new Api.messages.GetInlineBotResults({
        bot: gifBot,
        peer: "me",
        query,
        offset: "",
      })
    );

    const gifs = result.results.slice(0, limit).map((res: any, idx: number) => ({
      id: res.id,
      type: res.type,
      title: res.title || `GIF ${idx + 1}`,
    }));

    return {
      success: true,
      data: {
        queryId: result.queryId.toString(),
        gifs,
        totalFound: result.results.length,
        usage: "To send a GIF: telegram_send_gif(chatId, queryId='<queryId>', resultId='<gif id>')",
      },
    };
  } catch (error) {
    console.error("Error searching GIFs:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
