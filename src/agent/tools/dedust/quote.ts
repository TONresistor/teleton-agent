import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { TonClient } from "@ton/ton";
import { Address } from "@ton/core";
import { getCachedHttpEndpoint } from "../../../ton/endpoint.js";
import { Factory, Asset, PoolType, ReadinessStatus } from "@dedust/sdk";
import { DEDUST_FACTORY_MAINNET, NATIVE_TON_ADDRESS } from "./constants.js";
import { getDecimals, toUnits, fromUnits } from "./asset-cache.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

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
export const dedustQuoteExecutor: ToolExecutor<DedustQuoteParams> = async (
  params,
  context
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

    const endpoint = await getCachedHttpEndpoint();
    const tonClient = new TonClient({ endpoint });

    const factory = tonClient.open(
      Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET))
    );

    const fromAsset = isTonInput ? Asset.native() : Asset.jetton(Address.parse(fromAssetAddr));
    const toAsset = isTonOutput ? Asset.native() : Asset.jetton(Address.parse(toAssetAddr));

    const poolTypeEnum = pool_type === "stable" ? PoolType.STABLE : PoolType.VOLATILE;

    const pool = tonClient.open(await factory.getPool(poolTypeEnum, [fromAsset, toAsset]));

    const readinessStatus = await pool.getReadinessStatus();
    if (readinessStatus !== ReadinessStatus.READY) {
      return {
        success: false,
        error: `Pool not ready. Status: ${readinessStatus}. Try the other pool type (${pool_type === "volatile" ? "stable" : "volatile"}) or check if the pool exists.`,
      };
    }

    // Get reserves for additional info
    const reserves = await pool.getReserves();

    // Resolve correct decimals using normalized addresses (friendly format)
    const fromDecimals = await getDecimals(isTonInput ? "ton" : fromAssetAddr);
    const toDecimals = await getDecimals(isTonOutput ? "ton" : toAssetAddr);

    // Convert amount using correct decimals
    const amountIn = toUnits(amount, fromDecimals);

    const { amountOut, tradeFee } = await pool.getEstimatedSwapOut({
      assetIn: fromAsset,
      amountIn,
    });

    // Calculate minimum output with slippage
    const minAmountOut = amountOut - (amountOut * BigInt(Math.floor(slippage * 10000))) / 10000n;

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
      poolType: pool_type,
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
    log.error({ err: error }, "Error in dedust_quote");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
