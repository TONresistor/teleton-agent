import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { STONFI_API_BASE_URL } from "../../../constants/api-endpoints.js";

/**
 * Parameters for jetton_trending tool
 */
interface JettonTrendingParams {
  limit?: number;
}

/**
 * Tool definition for jetton_trending
 */
export const jettonTrendingTool: Tool = {
  name: "jetton_trending",
  description:
    "Get trending/popular Jettons on the TON blockchain. Shows tokens ranked by trading volume and liquidity. Useful for discovering popular tokens.",
  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Number of trending tokens to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      })
    ),
  }),
};

/**
 * Executor for jetton_trending tool
 */
export const jettonTrendingExecutor: ToolExecutor<JettonTrendingParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { limit = 10 } = params;

    // Fetch assets from STON.fi (sorted by popularity)
    const response = await fetchWithTimeout(`${STONFI_API_BASE_URL}/assets`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `STON.fi API error: ${response.status}`,
      };
    }

    const data = await response.json();
    const assets = data.asset_list || [];

    // Filter and sort by popularity
    const trending = assets
      .filter((a: any) => {
        // Skip blacklisted, deprecated, and native TON
        if (a.blacklisted || a.deprecated || a.kind === "Ton") return false;
        // Must have some popularity
        if (!a.popularity_index || a.popularity_index <= 0) return false;
        return true;
      })
      .sort((a: any, b: any) => (b.popularity_index || 0) - (a.popularity_index || 0))
      .slice(0, limit)
      .map((a: any, index: number) => ({
        rank: index + 1,
        symbol: a.symbol || "UNKNOWN",
        name: a.display_name || "Unknown",
        address: a.contract_address,
        priceUSD: a.dex_price_usd || a.third_party_price_usd || null,
        verified: !a.community && a.tags?.includes("asset:essential"),
        popularityScore: a.popularity_index,
        tags: a.tags?.filter((t: string) => t.includes("liquidity") || t.includes("popular")) || [],
      }));

    // Build message
    let message = `🔥 Top ${trending.length} Trending Jettons:\n\n`;
    trending.forEach((t: any) => {
      const verifiedIcon = t.verified ? "✅" : "";
      const price = t.priceUSD ? `$${parseFloat(t.priceUSD).toFixed(4)}` : "N/A";
      message += `#${t.rank} ${verifiedIcon} ${t.symbol} - ${t.name}\n`;
      message += `   Price: ${price}\n`;
      message += `   Address: ${t.address}\n`;
    });

    return {
      success: true,
      data: {
        count: trending.length,
        trending,
        message,
      },
    };
  } catch (error) {
    console.error("Error in jetton_trending:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
