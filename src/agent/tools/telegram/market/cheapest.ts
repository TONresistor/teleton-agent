import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for market_cheapest tool
 */
interface CheapestParams {
  maxTon: number;
  limit?: number;
}

/**
 * Tool definition for finding cheapest models
 */
export const marketCheapestTool: Tool = {
  name: "market_cheapest",
  description:
    "Find the cheapest gift models under a certain TON price. Returns models sorted by floor price (cheapest first) with collection name, floor price in TON, and rarity percentage. Useful for finding affordable gifts.",
  parameters: Type.Object({
    maxTon: Type.Number({
      description: "Maximum TON price",
      minimum: 0,
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of results (default: 20, max: 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

/**
 * Executor for market_cheapest tool
 */
export const marketCheapestExecutor: ToolExecutor<CheapestParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { maxTon, limit = 20 } = params;

    const marketService = context.marketService;
    if (!marketService) {
      return {
        success: false,
        error: "Market service not available",
      };
    }

    const results = await marketService.getCheapestModels(maxTon, limit);

    if (results.length === 0) {
      return {
        success: true,
        data: {
          results: [],
          count: 0,
          maxTon,
          message: `No models found under ${maxTon} TON`,
        },
      };
    }

    return {
      success: true,
      data: {
        maxTon,
        results: results.map((r) => ({
          collection: r.collection,
          model: r.model,
          floorTon: r.floorTon,
          rarityPercent: r.rarityPercent,
        })),
        count: results.length,
        cheapest: results[0],
        message: `Found ${results.length} model(s) under ${maxTon} TON. Cheapest: ${results[0].model} (${results[0].collection}) at ${results[0].floorTon} TON`,
      },
    };
  } catch (error) {
    console.error("Error in market_cheapest:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
