import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

/**
 * Parameters for jetton_price tool
 */
interface JettonPriceParams {
  jetton_address: string;
}

/**
 * Tool definition for jetton_price
 */
export const jettonPriceTool: Tool = {
  name: "jetton_price",
  description:
    "Get the current price of a Jetton (token) in USD and TON, along with 24h, 7d, and 30d price changes. Useful to check token value before swapping or to monitor investments.",
  parameters: Type.Object({
    jetton_address: Type.String({
      description: "Jetton master contract address (EQ... or 0:... format)",
    }),
  }),
};

/**
 * Executor for jetton_price tool
 */
export const jettonPriceExecutor: ToolExecutor<JettonPriceParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { jetton_address } = params;

    // Fetch price from TonAPI rates endpoint
    const response = await fetchWithTimeout(
      `${TONAPI_BASE_URL}/rates?tokens=${encodeURIComponent(jetton_address)}&currencies=usd,ton`,
      {
        headers: tonapiHeaders(),
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: `TonAPI error: ${response.status}`,
      };
    }

    const data = await response.json();
    const rateData = data.rates?.[jetton_address];

    if (!rateData) {
      // Try to get jetton info for better error message
      const infoResponse = await fetchWithTimeout(`${TONAPI_BASE_URL}/jettons/${jetton_address}`, {
        headers: tonapiHeaders(),
      });

      if (infoResponse.status === 404) {
        return {
          success: false,
          error: `Jetton not found: ${jetton_address}`,
        };
      }

      return {
        success: false,
        error: `Price data not available for this jetton. It may be too new or have low liquidity.`,
      };
    }

    const prices = rateData.prices || {};
    const diff24h = rateData.diff_24h || {};
    const diff7d = rateData.diff_7d || {};
    const diff30d = rateData.diff_30d || {};

    // Also fetch jetton metadata for symbol
    let symbol = "TOKEN";
    let name = "Unknown Token";
    try {
      const infoResponse = await fetchWithTimeout(`${TONAPI_BASE_URL}/jettons/${jetton_address}`, {
        headers: tonapiHeaders(),
      });
      if (infoResponse.ok) {
        const infoData = await infoResponse.json();
        symbol = infoData.metadata?.symbol || symbol;
        name = infoData.metadata?.name || name;
      }
    } catch {
      // Ignore errors fetching metadata
    }

    const priceInfo = {
      symbol,
      name,
      address: jetton_address,
      priceUSD: prices.USD || null,
      priceTON: prices.TON || null,
      change24h: diff24h.USD || null,
      change7d: diff7d.USD || null,
      change30d: diff30d.USD || null,
      change24hTON: diff24h.TON || null,
      change7dTON: diff7d.TON || null,
      change30dTON: diff30d.TON || null,
    };

    // Build human-readable message
    let message = `${name} (${symbol})\n\n`;

    if (priceInfo.priceUSD !== null) {
      message += `Price: $${priceInfo.priceUSD.toFixed(6)}`;
      if (priceInfo.priceTON !== null) {
        message += ` (${priceInfo.priceTON.toFixed(6)} TON)`;
      }
      message += "\n\n";
    }

    message += "Changes (USD):\n";
    message += `  24h: ${priceInfo.change24h || "N/A"}\n`;
    message += `  7d:  ${priceInfo.change7d || "N/A"}\n`;
    message += `  30d: ${priceInfo.change30d || "N/A"}`;

    return {
      success: true,
      data: {
        ...priceInfo,
        message,
      },
    };
  } catch (error) {
    console.error("Error in jetton_price:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
