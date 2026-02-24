import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { DEDUST_API_URL } from "./constants.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { findAsset, findAssetBySymbol, fromUnits } from "./asset-cache.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
interface DedustTokenInfoParams {
  token: string;
}
export const dedustTokenInfoTool: Tool = {
  name: "dedust_token_info",
  description:
    "Get jetton info from DeDust: metadata, top holders, top traders, largest buys. Accepts address or symbol.",
  category: "data-bearing",
  parameters: Type.Object({
    token: Type.String({
      description: "Jetton master address (EQ... format) or token symbol (e.g. 'USDT', 'DUST')",
    }),
  }),
};

/**
 * Safely fetch JSON from an endpoint, returning null on error.
 */
async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

interface JettonMetadata {
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
  description?: string;
}

interface TopTrader {
  walletAddress: string;
  volume: string;
  swaps: number;
}

interface TopBuy {
  lt: string;
  ts: string;
  walletAddress: string;
  amount: string;
}

interface Holder {
  owner: string;
  balance: string;
}
export const dedustTokenInfoExecutor: ToolExecutor<DedustTokenInfoParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { token } = params;

    // Resolve address: if it looks like a symbol, look it up
    let address: string;
    const isAddress = /^[EUeu][Qq][A-Za-z0-9_-]{46}$/.test(token);

    if (isAddress) {
      address = token;
    } else {
      const asset = await findAssetBySymbol(token);
      if (!asset || !asset.address) {
        return {
          success: false,
          error: `Token "${token}" not found in DeDust asset list. Try using the jetton master address directly.`,
        };
      }
      address = asset.address;
    }

    // Fetch all data in parallel
    const [metadata, topTraders, topBuys, holders, assetInfo] = await Promise.all([
      safeFetch<JettonMetadata>(`${DEDUST_API_URL}/jettons/${address}/metadata`),
      safeFetch<TopTrader[]>(`${DEDUST_API_URL}/jettons/${address}/top-traders`),
      safeFetch<TopBuy[]>(`${DEDUST_API_URL}/jettons/${address}/top-buys`),
      safeFetch<Holder[]>(`${DEDUST_API_URL}/jettons/${address}/holders`),
      findAsset(address),
    ]);

    if (!metadata && !assetInfo) {
      return {
        success: false,
        error: `Could not find token info for address ${address}. Verify the jetton master address is correct.`,
      };
    }

    // Use the best source for decimals
    const decimals = metadata?.decimals ?? assetInfo?.decimals ?? 9;
    const name = metadata?.name ?? assetInfo?.name ?? "Unknown";
    const symbol = metadata?.symbol ?? assetInfo?.symbol ?? "???";

    // Format holders (top 10)
    const topHolders = (holders ?? []).slice(0, 10).map((h) => ({
      owner: h.owner,
      balance: fromUnits(BigInt(h.balance), decimals).toFixed(2),
    }));

    // Format top traders (top 10)
    const formattedTraders = (topTraders ?? []).slice(0, 10).map((t) => ({
      wallet: t.walletAddress,
      volume: fromUnits(BigInt(t.volume), decimals).toFixed(2),
      swaps: t.swaps,
    }));

    // Format top buys (top 10)
    const formattedBuys = (topBuys ?? []).slice(0, 10).map((b) => ({
      wallet: b.walletAddress,
      amount: fromUnits(BigInt(b.amount), decimals).toFixed(2),
      time: b.ts,
    }));

    let message = `${name} (${symbol})\n`;
    message += `Address: ${address}\n`;
    message += `Decimals: ${decimals}\n`;
    if (metadata?.description) {
      message += `Description: ${metadata.description}\n`;
    }
    if (assetInfo?.buy_tax != null || assetInfo?.sell_tax != null) {
      message += `Buy tax: ${((assetInfo.buy_tax ?? 0) / 100).toFixed(2)}% | Sell tax: ${((assetInfo.sell_tax ?? 0) / 100).toFixed(2)}%\n`;
    }

    if (topHolders.length > 0) {
      message += `\nTop Holders:\n`;
      topHolders.slice(0, 5).forEach((h, i) => {
        message += `  ${i + 1}. ${h.owner.slice(0, 12)}... — ${h.balance} ${symbol}\n`;
      });
    }

    if (formattedTraders.length > 0) {
      message += `\nTop Traders (by volume):\n`;
      formattedTraders.slice(0, 5).forEach((t, i) => {
        message += `  ${i + 1}. ${t.wallet.slice(0, 12)}... — ${t.volume} ${symbol} (${t.swaps} swaps)\n`;
      });
    }

    if (formattedBuys.length > 0) {
      message += `\nLargest Recent Buys:\n`;
      formattedBuys.slice(0, 5).forEach((b, i) => {
        message += `  ${i + 1}. ${b.wallet.slice(0, 12)}... — ${b.amount} ${symbol} at ${b.time}\n`;
      });
    }

    return {
      success: true,
      data: {
        address,
        name,
        symbol,
        decimals,
        description: metadata?.description ?? null,
        image: metadata?.image ?? assetInfo?.image ?? null,
        buyTax: assetInfo?.buy_tax ?? null,
        sellTax: assetInfo?.sell_tax ?? null,
        topHolders,
        topTraders: formattedTraders,
        topBuys: formattedBuys,
        message,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in dedust_token_info");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
