import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { DEDUST_API_URL } from "./constants.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
interface DedustPricesParams {
  symbols?: string[];
}

/**
 * Price entry from the DeDust API
 */
interface PriceEntry {
  symbol: string;
  price: number;
  updatedAt: string;
}
export const dedustPricesTool: Tool = {
  name: "dedust_prices",
  description: "Get real-time token prices from DeDust. Optionally filter by symbol(s).",
  category: "data-bearing",
  parameters: Type.Object({
    symbols: Type.Optional(
      Type.Array(
        Type.String({
          description: "Token symbol to filter (e.g. 'TON', 'BTC', 'USDT')",
        }),
        {
          description: "Filter by specific symbols. Omit to get all available prices.",
        }
      )
    ),
  }),
};
export const dedustPricesExecutor: ToolExecutor<DedustPricesParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { symbols } = params;

    const response = await fetchWithTimeout(`${DEDUST_API_URL}/prices`);
    if (!response.ok) {
      throw new Error(`DeDust API error: ${response.status} ${response.statusText}`);
    }

    let prices: PriceEntry[] = await response.json();

    // Filter by symbols if provided
    if (symbols && symbols.length > 0) {
      const upper = symbols.map((s) => s.toUpperCase());
      prices = prices.filter((p) => upper.includes(p.symbol.toUpperCase()));
    }

    // Sort by symbol
    prices.sort((a, b) => a.symbol.localeCompare(b.symbol));

    let message = `DeDust Prices (${prices.length} tokens):\n\n`;
    for (const p of prices) {
      const priceStr =
        p.price >= 1
          ? `$${p.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : `$${p.price.toFixed(6)}`;
      message += `${p.symbol}: ${priceStr}\n`;
    }

    return {
      success: true,
      data: {
        prices: prices.map((p) => ({
          symbol: p.symbol,
          price: p.price,
          updatedAt: p.updatedAt,
        })),
        count: prices.length,
        message,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in dedust_prices");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
