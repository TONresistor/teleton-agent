import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { GECKOTERMINAL_API_URL, tonapiFetch } from "../../../constants/api-endpoints.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");

interface JettonHistoryParams {
  jetton_address: string;
}

export const jettonHistoryTool: Tool = {
  name: "jetton_history",
  description: "Get jetton price history: 24h/7d/30d changes, volume, FDV, and holder count.",
  category: "data-bearing",
  parameters: Type.Object({
    jetton_address: Type.String({
      description: "Jetton master contract address (EQ... format)",
    }),
  }),
};

export const jettonHistoryExecutor: ToolExecutor<JettonHistoryParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { jetton_address } = params;

    const ratesResponse = await tonapiFetch(
      `/rates?tokens=${encodeURIComponent(jetton_address)}&currencies=usd,ton`
    );

    const geckoResponse = await fetchWithTimeout(
      `${GECKOTERMINAL_API_URL}/networks/ton/tokens/${jetton_address}`,
      { headers: { Accept: "application/json" } }
    );

    const infoResponse = await tonapiFetch(`/jettons/${jetton_address}`);

    let symbol = "TOKEN";
    let name = "Unknown Token";
    let holdersCount = 0;

    if (infoResponse.ok) {
      const infoData = await infoResponse.json();
      symbol = infoData.metadata?.symbol || symbol;
      name = infoData.metadata?.name || name;
      holdersCount = infoData.holders_count || 0;
    }

    let priceUSD: number | null = null;
    let priceTON: number | null = null;
    let change24h: string | null = null;
    let change7d: string | null = null;
    let change30d: string | null = null;

    if (ratesResponse.ok) {
      const ratesData = await ratesResponse.json();
      const rateInfo = ratesData.rates?.[jetton_address];
      if (rateInfo) {
        priceUSD = rateInfo.prices?.USD || null;
        priceTON = rateInfo.prices?.TON || null;
        change24h = rateInfo.diff_24h?.USD || null;
        change7d = rateInfo.diff_7d?.USD || null;
        change30d = rateInfo.diff_30d?.USD || null;
      }
    }

    let volume24h: string | null = null;
    let fdv: string | null = null;
    let marketCap: string | null = null;

    if (geckoResponse.ok) {
      const geckoData = await geckoResponse.json();
      const attrs = geckoData.data?.attributes;
      if (attrs) {
        if (attrs.volume_usd?.h24) {
          volume24h = parseFloat(attrs.volume_usd.h24).toLocaleString(undefined, {
            maximumFractionDigits: 0,
          });
        }
        if (attrs.fdv_usd) {
          fdv = parseFloat(attrs.fdv_usd).toLocaleString(undefined, { maximumFractionDigits: 0 });
        }
        if (attrs.market_cap_usd) {
          marketCap = parseFloat(attrs.market_cap_usd).toLocaleString(undefined, {
            maximumFractionDigits: 0,
          });
        }
      }
    }

    const history = {
      symbol,
      name,
      address: jetton_address,
      currentPrice: priceUSD ? `$${priceUSD.toFixed(6)}` : "N/A",
      currentPriceTON: priceTON ? `${priceTON.toFixed(6)} TON` : "N/A",
      changes: {
        "24h": change24h || "N/A",
        "7d": change7d || "N/A",
        "30d": change30d || "N/A",
      },
      volume24h: volume24h ? `$${volume24h}` : "N/A",
      fdv: fdv ? `$${fdv}` : "N/A",
      marketCap: marketCap ? `$${marketCap}` : "N/A",
      holders: holdersCount,
    };

    let message = `📊 ${name} (${symbol}) Price History\n\n`;
    message += `Current Price: ${history.currentPrice}\n`;
    message += `Price in TON: ${history.currentPriceTON}\n\n`;
    message += `Performance:\n`;
    message += `  24h: ${history.changes["24h"]}\n`;
    message += `  7d:  ${history.changes["7d"]}\n`;
    message += `  30d: ${history.changes["30d"]}\n\n`;
    message += `Market Data:\n`;
    message += `  Volume 24h: ${history.volume24h}\n`;
    message += `  FDV: ${history.fdv}\n`;
    message += `  Holders: ${holdersCount.toLocaleString()}`;

    return {
      success: true,
      data: {
        ...history,
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
