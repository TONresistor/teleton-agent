import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { STONFI_API_BASE_URL } from "../../../constants/api-endpoints.js";

/**
 * Parameters for jetton_search tool
 */
interface JettonSearchParams {
  query: string;
  limit?: number;
}

/**
 * Search result item
 */
interface SearchResult {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  priceUSD: string | null;
  verified: boolean;
  image: string | null;
}

/**
 * Tool definition for jetton_search
 */
export const jettonSearchTool: Tool = {
  name: "jetton_search",
  description:
    "Search for Jettons (tokens) by name or symbol. Returns a list of matching tokens with their addresses, useful for finding a token's address before swapping or checking prices. Search is case-insensitive.",
  parameters: Type.Object({
    query: Type.String({
      description: "Search query - token name or symbol (e.g., 'usdt', 'scale', 'not')",
      minLength: 1,
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of results to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      })
    ),
  }),
};

/**
 * Executor for jetton_search tool
 */
export const jettonSearchExecutor: ToolExecutor<JettonSearchParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { query, limit = 10 } = params;
    const searchQuery = query.toLowerCase().trim();

    // Fetch all assets from STON.fi
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

    // Filter and score results
    const results: (SearchResult & { score: number })[] = [];

    for (const asset of assets) {
      // Skip blacklisted or deprecated
      if (asset.blacklisted || asset.deprecated) {
        continue;
      }

      // Skip native TON (we have ton_get_balance for that)
      if (asset.kind === "Ton") {
        continue;
      }

      const symbol = (asset.symbol || "").toLowerCase();
      const name = (asset.display_name || "").toLowerCase();

      // Calculate relevance score
      let score = 0;

      // Exact symbol match = highest score
      if (symbol === searchQuery) {
        score = 100;
      }
      // Symbol starts with query
      else if (symbol.startsWith(searchQuery)) {
        score = 80;
      }
      // Symbol contains query
      else if (symbol.includes(searchQuery)) {
        score = 60;
      }
      // Exact name match
      else if (name === searchQuery) {
        score = 50;
      }
      // Name starts with query
      else if (name.startsWith(searchQuery)) {
        score = 40;
      }
      // Name contains query
      else if (name.includes(searchQuery)) {
        score = 30;
      }
      // No match
      else {
        continue;
      }

      // Boost verified/popular tokens
      if (asset.tags?.includes("asset:essential")) {
        score += 10;
      }
      if (asset.tags?.includes("asset:popular")) {
        score += 5;
      }
      if (!asset.community) {
        score += 3;
      }

      results.push({
        symbol: asset.symbol || "UNKNOWN",
        name: asset.display_name || "Unknown Token",
        address: asset.contract_address,
        decimals: asset.decimals || 9,
        priceUSD: asset.dex_price_usd || asset.third_party_price_usd || null,
        verified: !asset.community && !asset.blacklisted,
        image: asset.image_url || null,
        score,
      });
    }

    // Sort by score (descending) and limit
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, Math.min(limit, 50));

    // Remove score from output
    const cleanResults: SearchResult[] = topResults.map(({ score, ...rest }) => rest);

    // Build message
    let message = "";
    if (cleanResults.length === 0) {
      message = `No jettons found matching "${query}". Try a different search term.`;
    } else {
      message = `Found ${cleanResults.length} jetton${cleanResults.length !== 1 ? "s" : ""} matching "${query}":\n\n`;
      cleanResults.forEach((r, i) => {
        const verifiedIcon = r.verified ? "✅" : "";
        const price = r.priceUSD ? `$${parseFloat(r.priceUSD).toFixed(4)}` : "N/A";
        message += `${i + 1}. ${verifiedIcon} ${r.symbol} - ${r.name}\n`;
        message += `   Address: ${r.address}\n`;
        message += `   Price: ${price}\n`;
      });
    }

    return {
      success: true,
      data: {
        query,
        count: cleanResults.length,
        results: cleanResults,
        message,
      },
    };
  } catch (error) {
    console.error("Error in jetton_search:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
