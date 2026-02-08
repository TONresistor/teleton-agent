import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getTonPrice } from "../../../ton/wallet-service.js";

/**
 * Tool definition for ton_price
 */
export const tonPriceTool: Tool = {
  name: "ton_price",
  description: "Get current TON cryptocurrency price in USD. Returns real-time market price.",
  parameters: Type.Object({}),
};

/**
 * Executor for ton_price tool
 */
export const tonPriceExecutor: ToolExecutor<{}> = async (params, context): Promise<ToolResult> => {
  try {
    const priceData = await getTonPrice();

    if (!priceData) {
      return {
        success: false,
        error: "Failed to fetch TON price. All sources unavailable.",
      };
    }

    return {
      success: true,
      data: {
        price: priceData.usd,
        currency: "USD",
        source: priceData.source,
        timestamp: priceData.timestamp,
        message: `Current TON price: $${priceData.usd.toFixed(4)} USD (via ${priceData.source})`,
      },
    };
  } catch (error) {
    console.error("Error in ton_price:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
