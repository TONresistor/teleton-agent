import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getTonPrice } from "../../../ton/wallet-service.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
export const tonPriceTool: Tool = {
  name: "ton_price",
  description:
    "Fetch the current TON/USD market price. For jetton token prices, use jetton_price. For historical price charts, use ton_chart.",
  category: "data-bearing",
  parameters: Type.Object({}),
};
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
    log.error({ err: error }, "Error in ton_price");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
