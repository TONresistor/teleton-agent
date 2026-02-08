import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for market_search tool
 */
interface SearchParams {
  query: string;
  limit?: number;
}

/**
 * Tool definition for searching gift models
 */
export const marketSearchTool: Tool = {
  name: "market_search",
  description:
    "Search for gift models by name (fuzzy search). Searches both collection names and model names with case-insensitive partial matches. Returns up to 'limit' results (default: 10). Examples: 'galaxy' finds Cozy Galaxy models, 'plush' finds all Plush Pepes models.",
  parameters: Type.Object({
    query: Type.String({
      description: "Search query (collection or model name)",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of results (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      })
    ),
  }),
};

/**
 * Executor for market_search tool
 */
export const marketSearchExecutor: ToolExecutor<SearchParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { query, limit = 10 } = params;

    const marketService = context.marketService;
    if (!marketService) {
      return {
        success: false,
        error: "Market service not available",
      };
    }

    const results = await marketService.searchModels(query, limit);

    if (results.length === 0) {
      return {
        success: true,
        data: {
          results: [],
          count: 0,
          message: `No models found matching "${query}"`,
        },
      };
    }

    return {
      success: true,
      data: {
        query,
        results: results.map((r) => ({
          collection: r.collection,
          model: r.model,
          floorTon: r.floorTon,
          rarityPercent: r.rarityPercent,
        })),
        count: results.length,
        message: `Found ${results.length} model(s) matching "${query}"`,
      },
    };
  } catch (error) {
    console.error("Error in market_search:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
