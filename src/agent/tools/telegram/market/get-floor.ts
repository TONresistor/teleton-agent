import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for market_get_floor tool
 */
interface GetFloorParams {
  collection?: string;
  model?: string;
}

/**
 * Tool definition for getting floor prices
 */
export const marketGetFloorTool: Tool = {
  name: "market_get_floor",
  description:
    "Get floor price for a Telegram gift collection or specific model from MarketApp.ws. Pass collection name only for collection floor, or both collection and model for specific model floor. Returns floor price in TON, USD (if available), rarity percentage, and cache age. Data is cached for 15 minutes and automatically refreshed every 60 minutes.",
  parameters: Type.Object({
    collection: Type.Optional(
      Type.String({
        description: "Collection name (e.g., 'Plush Pepes', 'Heart Lockets')",
      })
    ),
    model: Type.Optional(
      Type.String({
        description: "Model name (e.g., 'Cozy Galaxy', 'Telegram', 'Resistance')",
      })
    ),
  }),
};

/**
 * Executor for market_get_floor tool
 */
export const marketGetFloorExecutor: ToolExecutor<GetFloorParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { collection, model } = params;

    if (!collection) {
      return {
        success: false,
        error: "Collection name is required",
      };
    }

    const marketService = context.marketService;
    if (!marketService) {
      return {
        success: false,
        error: "Market service not available",
      };
    }

    if (model) {
      // Get specific model floor
      const result = await marketService.getModelFloor(collection, model);

      if (!result) {
        return {
          success: false,
          error: `Model not found: ${model} in ${collection}. Try searching with market_search.`,
        };
      }

      const cacheAgeMin = Math.round(result.cacheAge / 1000 / 60);
      const cacheStatus = result.cacheAge > 15 * 60 * 1000 ? "stale" : "fresh";

      return {
        success: true,
        data: {
          collection: result.collection,
          model: result.model,
          floorTon: result.floorTon,
          rarityPercent: result.rarityPercent,
          count: result.count,
          updatedAt: result.updatedAt,
          cacheAgeMinutes: cacheAgeMin,
          cacheStatus,
          message: `${result.model} in ${result.collection}: ${result.floorTon?.toLocaleString() ?? "N/A"} TON (${result.rarityPercent}% rarity, ${cacheAgeMin} min old)`,
        },
      };
    } else {
      // Get collection floor
      const result = await marketService.getCollectionFloor(collection);

      if (!result) {
        return {
          success: false,
          error: `Collection not found: ${collection}. Try searching with market_search.`,
        };
      }

      const cacheAgeMin = Math.round(result.cacheAge / 1000 / 60);
      const cacheStatus = result.cacheAge > 15 * 60 * 1000 ? "stale" : "fresh";

      return {
        success: true,
        data: {
          collection: result.name,
          floorTon: result.floorTon,
          floorUsd: result.floorUsd,
          volume7d: result.volume7d,
          listedCount: result.listedCount,
          updatedAt: result.updatedAt,
          cacheAgeMinutes: cacheAgeMin,
          cacheStatus,
          message: `${result.name} floor: ${result.floorTon?.toLocaleString() ?? "N/A"} TON (~$${result.floorUsd?.toLocaleString() || "N/A"}, ${cacheAgeMin} min old)`,
        },
      };
    }
  } catch (error) {
    console.error("Error in market_get_floor:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
