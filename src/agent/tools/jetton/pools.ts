import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { STONFI_API_BASE_URL } from "../../../constants/api-endpoints.js";

/**
 * Parameters for jetton_pools tool
 */
interface JettonPoolsParams {
  jetton_address?: string;
  limit?: number;
}

/**
 * Tool definition for jetton_pools
 */
export const jettonPoolsTool: Tool = {
  name: "jetton_pools",
  description:
    "Get liquidity pools for a Jetton or list top pools by volume. Shows pool addresses, liquidity, volume, APY, and trading pairs. Useful for finding where to trade a token or analyzing DeFi opportunities.",
  parameters: Type.Object({
    jetton_address: Type.Optional(
      Type.String({
        description:
          "Jetton address to filter pools (optional - if not provided, returns top pools)",
      })
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Number of pools to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      })
    ),
  }),
};

/**
 * Executor for jetton_pools tool
 */
export const jettonPoolsExecutor: ToolExecutor<JettonPoolsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { jetton_address, limit = 10 } = params;

    // Fetch pools from STON.fi
    const response = await fetchWithTimeout(`${STONFI_API_BASE_URL}/pools`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `STON.fi API error: ${response.status}`,
      };
    }

    const data = await response.json();
    let pools = data.pool_list || [];

    // Filter by jetton if provided
    if (jetton_address) {
      const targetAddress = jetton_address.toLowerCase();
      pools = pools.filter((p: any) => {
        const token0 = (p.token0_address || "").toLowerCase();
        const token1 = (p.token1_address || "").toLowerCase();
        return (
          token0.includes(targetAddress) ||
          token1.includes(targetAddress) ||
          targetAddress.includes(token0) ||
          targetAddress.includes(token1)
        );
      });
    }

    // Sort by volume and limit
    pools = pools
      .filter((p: any) => !p.deprecated)
      .sort(
        (a: any, b: any) =>
          parseFloat(b.volume_24h_usd || "0") - parseFloat(a.volume_24h_usd || "0")
      )
      .slice(0, limit);

    // Fetch asset names for better display
    const assetMap: { [key: string]: string } = {};
    try {
      const assetsResponse = await fetchWithTimeout(`${STONFI_API_BASE_URL}/assets`);
      if (assetsResponse.ok) {
        const assetsData = await assetsResponse.json();
        for (const asset of assetsData.asset_list || []) {
          assetMap[asset.contract_address] = asset.symbol || "???";
        }
      }
    } catch {
      // Ignore
    }

    // Format pools
    const formattedPools = pools.map((p: any, index: number) => {
      const token0Symbol = assetMap[p.token0_address] || "???";
      const token1Symbol = assetMap[p.token1_address] || "???";
      const pair = `${token0Symbol}/${token1Symbol}`;
      const volume24h = parseFloat(p.volume_24h_usd || "0");
      const tvl = parseFloat(p.lp_total_supply_usd || "0");
      const apy = parseFloat(p.apy_7d || "0") * 100;

      return {
        rank: index + 1,
        pair,
        poolAddress: p.address,
        token0: { address: p.token0_address, symbol: token0Symbol },
        token1: { address: p.token1_address, symbol: token1Symbol },
        volume24h: volume24h.toFixed(2),
        tvl: tvl.toFixed(2),
        apy7d: apy.toFixed(2),
        lpFee: p.lp_fee || 0,
      };
    });

    // Build message
    let message = jetton_address
      ? `Pools for ${jetton_address}:\n\n`
      : `🏊 Top ${formattedPools.length} Pools by Volume:\n\n`;

    formattedPools.forEach((p: any) => {
      message += `#${p.rank} ${p.pair}\n`;
      message += `   Volume 24h: $${Number(p.volume24h).toLocaleString()}\n`;
      message += `   TVL: $${Number(p.tvl).toLocaleString()}\n`;
      message += `   APY 7d: ${p.apy7d}%\n`;
      message += `   Fee: ${p.lpFee / 100}%\n`;
    });

    if (formattedPools.length === 0) {
      message = jetton_address ? `No pools found for ${jetton_address}` : "No pools found";
    }

    return {
      success: true,
      data: {
        count: formattedPools.length,
        pools: formattedPools,
        message,
      },
    };
  } catch (error) {
    console.error("Error in jetton_pools:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
