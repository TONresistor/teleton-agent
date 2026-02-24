import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { STONFI_API_BASE_URL } from "../../../constants/api-endpoints.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
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
export const stonfiSearchTool: Tool = {
  name: "stonfi_search",
  description:
    "Search for jettons by name or symbol. Returns addresses for use in swap/price tools.",
  category: "data-bearing",
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
export const stonfiSearchExecutor: ToolExecutor<JettonSearchParams> = async (
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
    log.error({ err: error }, "Error in stonfi_search");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
