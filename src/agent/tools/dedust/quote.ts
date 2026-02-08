import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { TonClient, toNano, fromNano } from "@ton/ton";
import { Address } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { Factory, Asset, PoolType, ReadinessStatus } from "@dedust/sdk";
import { DEDUST_FACTORY_MAINNET, NATIVE_TON_ADDRESS } from "./constants.js";

/**
 * Parameters for dedust_quote tool
 */
interface DedustQuoteParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  pool_type?: "volatile" | "stable";
  slippage?: number;
}

/**
 * Tool definition for dedust_quote
 */
export const dedustQuoteTool: Tool = {
  name: "dedust_quote",
  description:
    "Get a price quote for a token swap on DeDust DEX WITHOUT executing it. Shows expected output, minimum output, and pool info. Use 'ton' as from_asset for TON, or jetton master address. Pool types: 'volatile' (default) or 'stable' (for stablecoins).",
  parameters: Type.Object({
    from_asset: Type.String({
      description: "Source asset: 'ton' for TON, or jetton master address (EQ... format)",
    }),
    to_asset: Type.String({
      description: "Destination asset: 'ton' for TON, or jetton master address (EQ... format)",
    }),
    amount: Type.Number({
      description: "Amount to swap in human-readable units",
      minimum: 0.001,
    }),
    pool_type: Type.Optional(
      Type.Union([Type.Literal("volatile"), Type.Literal("stable")], {
        description: "Pool type: 'volatile' (default) or 'stable' for stablecoin pairs",
      })
    ),
    slippage: Type.Optional(
      Type.Number({
        description: "Slippage tolerance (0.01 = 1%, default: 0.01)",
        minimum: 0.001,
        maximum: 0.5,
      })
    ),
  }),
};

/**
 * Executor for dedust_quote tool
 */
export const dedustQuoteExecutor: ToolExecutor<DedustQuoteParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, pool_type = "volatile", slippage = 0.01 } = params;

    // Normalize asset addresses
    const isTonInput = from_asset.toLowerCase() === "ton";
    const isTonOutput = to_asset.toLowerCase() === "ton";

    // Convert addresses to friendly format if needed
    let fromAssetAddr = from_asset;
    let toAssetAddr = to_asset;

    if (!isTonInput) {
      try {
        // Parse and convert to friendly format (handles both raw 0:... and friendly EQ... formats)
        fromAssetAddr = Address.parse(from_asset).toString();
      } catch (error) {
        return {
          success: false,
          error: `Invalid from_asset address: ${from_asset}`,
        };
      }
    }

    if (!isTonOutput) {
      try {
        // Parse and convert to friendly format (handles both raw 0:... and friendly EQ... formats)
        toAssetAddr = Address.parse(to_asset).toString();
      } catch (error) {
        return {
          success: false,
          error: `Invalid to_asset address: ${to_asset}`,
        };
      }
    }

    // Initialize TON client
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const tonClient = new TonClient({ endpoint });

    // Open factory contract
    const factory = tonClient.open(
      Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET))
    );

    // Build assets (use normalized addresses)
    const fromAsset = isTonInput ? Asset.native() : Asset.jetton(Address.parse(fromAssetAddr));
    const toAsset = isTonOutput ? Asset.native() : Asset.jetton(Address.parse(toAssetAddr));

    // Get pool type
    const poolTypeEnum = pool_type === "stable" ? PoolType.STABLE : PoolType.VOLATILE;

    // Get pool
    const pool = tonClient.open(await factory.getPool(poolTypeEnum, [fromAsset, toAsset]));

    // Check pool readiness
    const readinessStatus = await pool.getReadinessStatus();
    if (readinessStatus !== ReadinessStatus.READY) {
      return {
        success: false,
        error: `Pool not ready. Status: ${readinessStatus}. Try the other pool type (${pool_type === "volatile" ? "stable" : "volatile"}) or check if the pool exists.`,
      };
    }

    // Get reserves for additional info
    const reserves = await pool.getReserves();

    // Convert amount to nano units (assuming 9 decimals for TON/most jettons)
    const amountIn = toNano(amount);

    // Get estimated output
    const { amountOut, tradeFee } = await pool.getEstimatedSwapOut({
      assetIn: fromAsset,
      amountIn,
    });

    // Calculate minimum output with slippage
    const minAmountOut = amountOut - (amountOut * BigInt(Math.floor(slippage * 10000))) / 10000n;

    // Calculate rate
    const expectedOutput = Number(fromNano(amountOut));
    const minOutput = Number(fromNano(minAmountOut));
    const rate = expectedOutput / amount;
    const feeAmount = Number(fromNano(tradeFee));

    // Build quote response
    const fromSymbol = isTonInput ? "TON" : "Token";
    const toSymbol = isTonOutput ? "TON" : "Token";

    const quote = {
      dex: "DeDust",
      from: isTonInput ? NATIVE_TON_ADDRESS : fromAssetAddr,
      fromSymbol,
      to: isTonOutput ? NATIVE_TON_ADDRESS : toAssetAddr,
      toSymbol,
      amountIn: amount.toString(),
      expectedOutput: expectedOutput.toFixed(6),
      minOutput: minOutput.toFixed(6),
      rate: rate.toFixed(6),
      slippage: `${(slippage * 100).toFixed(2)}%`,
      fee: feeAmount.toFixed(6),
      poolType: pool_type,
      poolAddress: pool.address.toString(),
      reserves: {
        asset0: fromNano(reserves[0]).toString(),
        asset1: fromNano(reserves[1]).toString(),
      },
    };

    // Build message
    let message = `DeDust Quote: ${amount} ${fromSymbol} -> ${toSymbol}\n\n`;
    message += `Expected output: ${quote.expectedOutput}\n`;
    message += `Minimum output: ${quote.minOutput} (with ${quote.slippage} slippage)\n`;
    message += `Rate: 1 ${fromSymbol} = ${quote.rate} ${toSymbol}\n`;
    message += `Trade fee: ${quote.fee}\n`;
    message += `Pool type: ${pool_type}\n\n`;
    message += `Use dedust_swap to execute this trade.`;

    return {
      success: true,
      data: {
        ...quote,
        message,
      },
    };
  } catch (error) {
    console.error("Error in dedust_quote:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
