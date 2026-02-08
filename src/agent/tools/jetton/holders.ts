import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

/**
 * Parameters for jetton_holders tool
 */
interface JettonHoldersParams {
  jetton_address: string;
  limit?: number;
}

/**
 * Tool definition for jetton_holders
 */
export const jettonHoldersTool: Tool = {
  name: "jetton_holders",
  description:
    "Get the top holders of a Jetton (token). Shows wallet addresses and their balances. Useful to analyze token distribution and identify whale wallets.",
  parameters: Type.Object({
    jetton_address: Type.String({
      description: "Jetton master contract address (EQ... or 0:... format)",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Number of top holders to return (default: 10, max: 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

/**
 * Executor for jetton_holders tool
 */
export const jettonHoldersExecutor: ToolExecutor<JettonHoldersParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { jetton_address, limit = 10 } = params;

    // Fetch holders from TonAPI
    const response = await fetchWithTimeout(
      `${TONAPI_BASE_URL}/jettons/${jetton_address}/holders?limit=${Math.min(limit, 100)}`,
      {
        headers: tonapiHeaders(),
      }
    );

    if (response.status === 404) {
      return {
        success: false,
        error: `Jetton not found: ${jetton_address}`,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `TonAPI error: ${response.status}`,
      };
    }

    const data = await response.json();
    const addresses = data.addresses || [];

    // Fetch jetton info for decimals and symbol
    let decimals = 9;
    let symbol = "TOKEN";
    try {
      const infoResponse = await fetchWithTimeout(`${TONAPI_BASE_URL}/jettons/${jetton_address}`, {
        headers: tonapiHeaders(),
      });
      if (infoResponse.ok) {
        const infoData = await infoResponse.json();
        decimals = parseInt(infoData.metadata?.decimals || "9");
        symbol = infoData.metadata?.symbol || symbol;
      }
    } catch {
      // Ignore
    }

    // Parse holders
    const holders = addresses.map((h: any, index: number) => {
      const balanceRaw = BigInt(h.balance || "0");
      const balanceFormatted = Number(balanceRaw) / 10 ** decimals;

      return {
        rank: index + 1,
        address: h.owner?.address || h.address,
        name: h.owner?.name || null,
        balance: balanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        balanceRaw: h.balance,
        isWallet: h.owner?.is_wallet || false,
      };
    });

    // Calculate concentration (top holder %)
    const totalTop = holders.reduce(
      (sum: number, h: any) => sum + parseFloat(h.balance.replace(/,/g, "")),
      0
    );

    // Build message
    let message = `Top ${holders.length} holders of ${symbol}:\n\n`;
    holders.forEach((h: any) => {
      const nameTag = h.name ? ` (${h.name})` : "";
      message += `#${h.rank}: ${h.balance} ${symbol}\n`;
      message += `   ${h.address}${nameTag}\n`;
    });

    return {
      success: true,
      data: {
        jettonAddress: jetton_address,
        symbol,
        holdersCount: holders.length,
        holders,
        message,
      },
    };
  } catch (error) {
    console.error("Error in jetton_holders:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
