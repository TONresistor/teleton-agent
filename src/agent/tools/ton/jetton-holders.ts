import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { tonapiFetch } from "../../../constants/api-endpoints.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
interface JettonHoldersParams {
  jetton_address: string;
  limit?: number;
}
export const jettonHoldersTool: Tool = {
  name: "jetton_holders",
  description:
    "List top holders of a jetton ranked by balance. Returns wallet addresses and amounts. Useful for whale analysis and token distribution checks.",
  category: "data-bearing",
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
export const jettonHoldersExecutor: ToolExecutor<JettonHoldersParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { jetton_address, limit = 10 } = params;

    const response = await tonapiFetch(
      `/jettons/${jetton_address}/holders?limit=${Math.min(limit, 100)}`
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

    let decimals = 9;
    let symbol = "TOKEN";
    try {
      const infoResponse = await tonapiFetch(`/jettons/${jetton_address}`);
      if (infoResponse.ok) {
        const infoData = await infoResponse.json();
        decimals = parseInt(infoData.metadata?.decimals || "9");
        symbol = infoData.metadata?.symbol || symbol;
      }
    } catch {
      // Ignore
    }

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
    log.error({ err: error }, "Error in jetton_holders");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
