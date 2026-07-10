import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { fetchJettonMarketHistory } from "../../../ton/jetton-analytics-service.js";

const log = createLogger("Tools");

interface JettonHistoryParams {
  jetton_address: string;
}

export const jettonHistoryTool: Tool = {
  name: "jetton_history",
  description:
    "Fetch jetton market analytics: price changes (24h/7d/30d), trading volume, fully diluted valuation (FDV), and holder count. For spot price only, use jetton_price.",
  category: "data-bearing",
  parameters: Type.Object({
    jetton_address: Type.String({
      description: "Jetton master contract address (EQ... format)",
    }),
  }),
};

export const jettonHistoryExecutor: ToolExecutor<JettonHistoryParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { jetton_address } = params;

    const history = await fetchJettonMarketHistory(jetton_address);
    const historyWithAddress = {
      ...history,
      address: jetton_address,
    };

    let message = `📊 ${history.name} (${history.symbol}) Price History\n\n`;
    message += `Current Price: ${historyWithAddress.currentPrice}\n`;
    message += `Price in TON: ${historyWithAddress.currentPriceTON}\n\n`;
    message += `Performance:\n`;
    message += `  24h: ${historyWithAddress.changes["24h"]}\n`;
    message += `  7d:  ${historyWithAddress.changes["7d"]}\n`;
    message += `  30d: ${historyWithAddress.changes["30d"]}\n\n`;
    message += `Market Data:\n`;
    message += `  Volume 24h: ${historyWithAddress.volume24h}\n`;
    message += `  FDV: ${historyWithAddress.fdv}\n`;
    message += `  Holders: ${historyWithAddress.holders.toLocaleString()}`;

    return {
      success: true,
      data: {
        ...historyWithAddress,
        message,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in jetton_history");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
