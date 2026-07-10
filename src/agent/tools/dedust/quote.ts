import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { Address } from "@ton/core";
import { NATIVE_TON_ADDRESS } from "./constants.js";
import { fromUnits } from "./asset-cache.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { estimateDedustSwap } from "../../../ton/dex-service.js";

const log = createLogger("Tools");
interface DedustQuoteParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  pool_type?: "volatile" | "stable";
  slippage?: number;
}
export const dedustQuoteTool: Tool = {
  name: "dedust_quote",
  description:
    "Get a price quote for a token swap on DeDust DEX without executing it. Use 'ton' for TON or jetton master address.",
  category: "data-bearing",
  parameters: Type.Object({
    from_asset: Type.String({
      description:
        "Source asset: 'ton' for native TON, or jetton master address (EQ... format). Always pass 'ton' as a string, never an address.",
    }),
    to_asset: Type.String({
      description:
        "Destination asset: 'ton' for native TON, or jetton master address (EQ... format). Always pass 'ton' as a string, never an address.",
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
export const dedustQuoteExecutor: ToolExecutor<DedustQuoteParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, pool_type = "volatile", slippage = 0.01 } = params;

    const isTonInput = from_asset.toLowerCase() === "ton";
    const isTonOutput = to_asset.toLowerCase() === "ton";

    // Convert addresses to friendly format if needed
    let fromAssetAddr = from_asset;
    let toAssetAddr = to_asset;

    if (!isTonInput) {
      try {
        // Parse and convert to friendly format (handles both raw 0:... and friendly EQ... formats)
        fromAssetAddr = Address.parse(from_asset).toString();
      } catch {
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
      } catch {
        return {
          success: false,
          error: `Invalid to_asset address: ${to_asset}`,
        };
      }
    }

    const estimate = await estimateDedustSwap(
      { fromAsset: fromAssetAddr, toAsset: toAssetAddr, amount, slippage },
      { preferredPoolType: pool_type }
    );
    if (!estimate) {
      return {
        success: false,
        error: "No DeDust pool ready for this pair (tried volatile and stable).",
      };
    }
    const { pool, poolType, fromDecimals, toDecimals, amountOut, tradeFee, minAmountOut } =
      estimate;

    // Get reserves for additional info
    const reserves = await pool.getReserves();

    // Calculate rate using correct decimals
    const expectedOutput = fromUnits(amountOut, toDecimals);
    const minOutput = fromUnits(minAmountOut, toDecimals);
    const rate = expectedOutput / amount;
    const feeAmount = fromUnits(tradeFee, toDecimals);

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
      poolType,
      poolAddress: pool.address.toString(),
      reserves: {
        asset0: fromUnits(reserves[0], fromDecimals).toString(),
        asset1: fromUnits(reserves[1], toDecimals).toString(),
      },
    };

    let message = `DeDust Quote: ${amount} ${fromSymbol} -> ${toSymbol}\n\n`;
    message += `Expected output: ${quote.expectedOutput}\n`;
    message += `Minimum output: ${quote.minOutput} (with ${quote.slippage} slippage)\n`;
    message += `Rate: 1 ${fromSymbol} = ${quote.rate} ${toSymbol}\n`;
    message += `Trade fee: ${quote.fee}\n`;
    message += `Pool type: ${poolType}\n\n`;
    message += `Use dedust_swap to execute this trade.`;

    return {
      success: true,
      data: {
        ...quote,
        message,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in dedust_quote");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
