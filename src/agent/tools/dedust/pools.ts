import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { DEDUST_API_URL } from "./constants.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";

/**
 * Parameters for dedust_pools tool
 */
interface DedustPoolsParams {
  jetton_address?: string;
  pool_type?: "volatile" | "stable";
  limit?: number;
}

/**
 * DeDust Pool API response type
 */
interface DedustPoolResponse {
  address: string;
  lt: string;
  totalSupply: string;
  type: string;
  tradeFee: string;
  assets: Array<{
    type: string;
    address?: string;
    metadata?: {
      name: string;
      symbol: string;
      decimals: number;
      image?: string;
    };
  }>;
  reserves: string[];
  fees: string[];
  volume?: {
    "24h": string;
  };
  stats?: {
    tvl?: string;
    volume24h?: string;
    fees24h?: string;
  };
}

/**
 * Tool definition for dedust_pools
 */
export const dedustPoolsTool: Tool = {
  name: "dedust_pools",
  description:
    "List liquidity pools on DeDust DEX. Can filter by jetton address or pool type. Shows reserves, fees, and trading volume.",
  parameters: Type.Object({
    jetton_address: Type.Optional(
      Type.String({
        description:
          "Filter by jetton master address (EQ... format) to find pools containing this token",
      })
    ),
    pool_type: Type.Optional(
      Type.Union([Type.Literal("volatile"), Type.Literal("stable")], {
        description: "Filter by pool type: 'volatile' or 'stable'",
      })
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of pools to return (default: 20)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

/**
 * Executor for dedust_pools tool
 */
export const dedustPoolsExecutor: ToolExecutor<DedustPoolsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { jetton_address, pool_type, limit = 20 } = params;

    // Fetch pools from DeDust API
    const response = await fetchWithTimeout(`${DEDUST_API_URL}/pools`);

    if (!response.ok) {
      throw new Error(`DeDust API error: ${response.status} ${response.statusText}`);
    }

    const pools: DedustPoolResponse[] = await response.json();

    // Filter pools
    let filteredPools = pools;

    // Filter by jetton address if specified
    if (jetton_address) {
      const normalizedAddress = jetton_address.toLowerCase();
      filteredPools = filteredPools.filter((pool) =>
        pool.assets.some((asset) => asset.address?.toLowerCase() === normalizedAddress)
      );
    }

    // Filter by pool type if specified
    if (pool_type) {
      filteredPools = filteredPools.filter(
        (pool) => pool.type.toLowerCase() === pool_type.toLowerCase()
      );
    }

    // Sort by TVL or reserves (descending)
    filteredPools.sort((a, b) => {
      const tvlA = parseFloat(a.stats?.tvl || "0");
      const tvlB = parseFloat(b.stats?.tvl || "0");
      if (tvlA !== tvlB) return tvlB - tvlA;

      // Fallback to reserves
      const reserveA = BigInt(a.reserves[0] || "0") + BigInt(a.reserves[1] || "0");
      const reserveB = BigInt(b.reserves[0] || "0") + BigInt(b.reserves[1] || "0");
      return reserveA > reserveB ? -1 : 1;
    });

    // Limit results
    filteredPools = filteredPools.slice(0, limit);

    // Format pool data
    const formattedPools = filteredPools.map((pool) => {
      const asset0 = pool.assets[0];
      const asset1 = pool.assets[1];

      const asset0Name =
        asset0?.type === "native"
          ? "TON"
          : asset0?.metadata?.symbol || asset0?.address?.slice(0, 8) || "Unknown";
      const asset1Name =
        asset1?.type === "native"
          ? "TON"
          : asset1?.metadata?.symbol || asset1?.address?.slice(0, 8) || "Unknown";

      // Convert reserves from nano
      // Note: Uses standard 9 decimals. Some tokens (USDT/USDC) use 6 decimals and will show inflated values.
      // For production, fetch actual decimals from jetton metadata.
      const reserve0 = Number(BigInt(pool.reserves[0] || "0")) / 1e9;
      const reserve1 = Number(BigInt(pool.reserves[1] || "0")) / 1e9;

      // Parse trade fee (usually in basis points or fraction)
      const tradeFee = parseFloat(pool.tradeFee || "0");
      const feePercent = tradeFee < 1 ? tradeFee * 100 : tradeFee / 100;

      return {
        address: pool.address,
        pair: `${asset0Name}/${asset1Name}`,
        type: pool.type,
        tradeFee: `${feePercent.toFixed(2)}%`,
        reserves: {
          [asset0Name]: reserve0.toFixed(4),
          [asset1Name]: reserve1.toFixed(4),
        },
        assets: [
          {
            type: asset0?.type,
            address: asset0?.address || "native",
            symbol: asset0Name,
          },
          {
            type: asset1?.type,
            address: asset1?.address || "native",
            symbol: asset1Name,
          },
        ],
        volume24h: pool.stats?.volume24h || pool.volume?.["24h"] || "N/A",
        tvl: pool.stats?.tvl || "N/A",
      };
    });

    // Build summary message
    let message = `Found ${formattedPools.length} DeDust pools`;
    if (jetton_address) {
      message += ` containing ${jetton_address.slice(0, 8)}...`;
    }
    if (pool_type) {
      message += ` (${pool_type} type)`;
    }
    message += ":\n\n";

    formattedPools.slice(0, 10).forEach((pool, i) => {
      message += `${i + 1}. ${pool.pair} (${pool.type})\n`;
      message += `   Reserves: ${Object.entries(pool.reserves)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ")}\n`;
      message += `   Fee: ${pool.tradeFee}\n`;
    });

    if (formattedPools.length > 10) {
      message += `\n... and ${formattedPools.length - 10} more pools`;
    }

    return {
      success: true,
      data: {
        pools: formattedPools,
        total: filteredPools.length,
        message,
      },
    };
  } catch (error) {
    console.error("Error in dedust_pools:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
