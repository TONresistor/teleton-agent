import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for market_price_history tool
 */
interface PriceHistoryParams {
  collection: string;
  model: string;
  limit?: number;
}

/**
 * Tool definition for getting price history
 */
export const marketPriceHistoryTool: Tool = {
  name: "market_price_history",
  description:
    "Get price history for a specific gift model. Requires both collection and model name. Returns historical floor prices with timestamps (most recent first), floor TON and USD values, and trend analysis (rising, falling, or stable).",
  parameters: Type.Object({
    collection: Type.String({
      description: "Collection name (e.g., 'Plush Pepes')",
    }),
    model: Type.String({
      description: "Model name (e.g., 'Cozy Galaxy')",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of history entries (default: 10, max: 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

/**
 * Executor for market_price_history tool
 */
export const marketPriceHistoryExecutor: ToolExecutor<PriceHistoryParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { collection, model, limit = 10 } = params;

    const marketService = context.marketService;
    if (!marketService) {
      return {
        success: false,
        error: "Market service not available",
      };
    }

    const history = await marketService.getModelPriceHistory(collection, model, limit);

    if (history.length === 0) {
      return {
        success: false,
        error: `No price history found for ${model} in ${collection}`,
      };
    }

    // Calculate trend
    let trend = "stable";
    if (history.length >= 2) {
      const latest = history[0].floor_ton;
      const oldest = history[history.length - 1].floor_ton;
      const change = ((latest - oldest) / oldest) * 100;

      if (change > 5) trend = "rising";
      else if (change < -5) trend = "falling";
    }

    return {
      success: true,
      data: {
        collection,
        model,
        history: history.map((h) => ({
          floorTon: h.floor_ton,
          floorUsd: h.floor_usd,
          timestamp: h.timestamp,
        })),
        count: history.length,
        trend,
        latestPrice: history[0].floor_ton,
        oldestPrice: history[history.length - 1].floor_ton,
        message: `Price history for ${model} (${collection}): ${history.length} entries, trend: ${trend}`,
      },
    };
  } catch (error) {
    console.error("Error in market_price_history:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
