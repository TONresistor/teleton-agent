import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { TonClient, toNano, fromNano } from "@ton/ton";
import { Address } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { StonApiClient } from "@ston-fi/api";
import { Factory, Asset, PoolType, ReadinessStatus } from "@dedust/sdk";
import { DEDUST_FACTORY_MAINNET, NATIVE_TON_ADDRESS } from "../dedust/constants.js";

/**
 * Parameters for dex_quote tool
 */
interface DexQuoteParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  slippage?: number;
}

/**
 * Quote result from a DEX
 */
interface DexQuoteResult {
  dex: string;
  expectedOutput: number;
  minOutput: number;
  rate: number;
  priceImpact?: string;
  fee?: number;
  poolType?: string;
  available: boolean;
  error?: string;
}

/**
 * Tool definition for dex_quote
 */
export const dexQuoteTool: Tool = {
  name: "dex_quote",
  description:
    "Smart router that compares quotes from STON.fi and DeDust DEX to find the best price. Returns comparison table with expected outputs, fees, and recommends the best DEX for your swap. Use 'ton' for TON or jetton master address.",
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
 * Get quote from STON.fi
 */
async function getStonfiQuote(
  fromAsset: string,
  toAsset: string,
  amount: number,
  slippage: number
): Promise<DexQuoteResult> {
  try {
    const isTonInput = fromAsset.toLowerCase() === "ton";
    const isTonOutput = toAsset.toLowerCase() === "ton";
    const fromAddress = isTonInput ? NATIVE_TON_ADDRESS : fromAsset;
    const toAddress = isTonOutput ? NATIVE_TON_ADDRESS : toAsset;

    const stonApiClient = new StonApiClient();

    const simulationResult = await stonApiClient.simulateSwap({
      offerAddress: fromAddress,
      askAddress: toAddress,
      offerUnits: toNano(amount).toString(),
      slippageTolerance: slippage.toString(),
    });

    if (!simulationResult) {
      return {
        dex: "STON.fi",
        expectedOutput: 0,
        minOutput: 0,
        rate: 0,
        available: false,
        error: "No liquidity",
      };
    }

    const askUnits = BigInt(simulationResult.askUnits);
    const minAskUnits = BigInt(simulationResult.minAskUnits);
    const feeUnits = BigInt(simulationResult.feeUnits || "0");

    const expectedOutput = Number(fromNano(askUnits));
    const minOutput = Number(fromNano(minAskUnits));
    const feeAmount = Number(fromNano(feeUnits));
    const rate = expectedOutput / amount;

    return {
      dex: "STON.fi",
      expectedOutput,
      minOutput,
      rate,
      priceImpact: simulationResult.priceImpact || "N/A",
      fee: feeAmount,
      available: true,
    };
  } catch (error) {
    return {
      dex: "STON.fi",
      expectedOutput: 0,
      minOutput: 0,
      rate: 0,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get quote from DeDust
 */
async function getDedustQuote(
  fromAsset: string,
  toAsset: string,
  amount: number,
  slippage: number,
  tonClient: TonClient
): Promise<DexQuoteResult> {
  try {
    const isTonInput = fromAsset.toLowerCase() === "ton";
    const isTonOutput = toAsset.toLowerCase() === "ton";

    const factory = tonClient.open(
      Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET))
    );

    const fromAssetObj = isTonInput ? Asset.native() : Asset.jetton(Address.parse(fromAsset));
    const toAssetObj = isTonOutput ? Asset.native() : Asset.jetton(Address.parse(toAsset));

    // Try volatile pool first, then stable
    let pool;
    let poolType = "volatile";

    try {
      pool = tonClient.open(await factory.getPool(PoolType.VOLATILE, [fromAssetObj, toAssetObj]));
      const status = await pool.getReadinessStatus();
      if (status !== ReadinessStatus.READY) {
        // Try stable pool
        pool = tonClient.open(await factory.getPool(PoolType.STABLE, [fromAssetObj, toAssetObj]));
        const stableStatus = await pool.getReadinessStatus();
        if (stableStatus !== ReadinessStatus.READY) {
          return {
            dex: "DeDust",
            expectedOutput: 0,
            minOutput: 0,
            rate: 0,
            available: false,
            error: "No pool available",
          };
        }
        poolType = "stable";
      }
    } catch {
      return {
        dex: "DeDust",
        expectedOutput: 0,
        minOutput: 0,
        rate: 0,
        available: false,
        error: "Pool lookup failed",
      };
    }

    const amountIn = toNano(amount);
    const { amountOut, tradeFee } = await pool.getEstimatedSwapOut({
      assetIn: fromAssetObj,
      amountIn,
    });

    const minAmountOut = amountOut - (amountOut * BigInt(Math.floor(slippage * 10000))) / 10000n;

    const expectedOutput = Number(fromNano(amountOut));
    const minOutput = Number(fromNano(minAmountOut));
    const feeAmount = Number(fromNano(tradeFee));
    const rate = expectedOutput / amount;

    return {
      dex: "DeDust",
      expectedOutput,
      minOutput,
      rate,
      fee: feeAmount,
      poolType,
      available: true,
    };
  } catch (error) {
    return {
      dex: "DeDust",
      expectedOutput: 0,
      minOutput: 0,
      rate: 0,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Executor for dex_quote tool
 */
export const dexQuoteExecutor: ToolExecutor<DexQuoteParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, slippage = 0.01 } = params;

    // Initialize TON client for DeDust
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const tonClient = new TonClient({ endpoint });

    // Fetch quotes in parallel
    const [stonfiQuote, dedustQuote] = await Promise.all([
      getStonfiQuote(from_asset, to_asset, amount, slippage),
      getDedustQuote(from_asset, to_asset, amount, slippage, tonClient),
    ]);

    // Determine best DEX
    let recommended: string;
    let savings = 0;
    let savingsPercent = 0;

    const quotes = [stonfiQuote, dedustQuote].filter((q) => q.available);

    if (quotes.length === 0) {
      return {
        success: false,
        error:
          "No DEX has liquidity for this pair. STON.fi: " +
          (stonfiQuote.error || "unavailable") +
          ", DeDust: " +
          (dedustQuote.error || "unavailable"),
      };
    }

    if (quotes.length === 1) {
      recommended = quotes[0].dex;
    } else {
      // Compare outputs
      if (stonfiQuote.expectedOutput > dedustQuote.expectedOutput) {
        recommended = "STON.fi";
        savings = stonfiQuote.expectedOutput - dedustQuote.expectedOutput;
        savingsPercent = (savings / dedustQuote.expectedOutput) * 100;
      } else if (dedustQuote.expectedOutput > stonfiQuote.expectedOutput) {
        recommended = "DeDust";
        savings = dedustQuote.expectedOutput - stonfiQuote.expectedOutput;
        savingsPercent = (savings / stonfiQuote.expectedOutput) * 100;
      } else {
        recommended = "STON.fi"; // Default to STON.fi if equal
      }
    }

    const isTonInput = from_asset.toLowerCase() === "ton";
    const isTonOutput = to_asset.toLowerCase() === "ton";
    const fromSymbol = isTonInput ? "TON" : "Token";
    const toSymbol = isTonOutput ? "TON" : "Token";

    // Build comparison table
    const comparison = {
      stonfi: {
        available: stonfiQuote.available,
        expectedOutput: stonfiQuote.expectedOutput.toFixed(6),
        minOutput: stonfiQuote.minOutput.toFixed(6),
        rate: stonfiQuote.rate.toFixed(6),
        priceImpact: stonfiQuote.priceImpact || "N/A",
        fee: stonfiQuote.fee?.toFixed(6) || "N/A",
        error: stonfiQuote.error,
      },
      dedust: {
        available: dedustQuote.available,
        expectedOutput: dedustQuote.expectedOutput.toFixed(6),
        minOutput: dedustQuote.minOutput.toFixed(6),
        rate: dedustQuote.rate.toFixed(6),
        poolType: dedustQuote.poolType || "N/A",
        fee: dedustQuote.fee?.toFixed(6) || "N/A",
        error: dedustQuote.error,
      },
    };

    // Build message
    let message = `DEX Comparison: ${amount} ${fromSymbol} -> ${toSymbol}\n\n`;
    message += `| DEX      | Output       | Rate          | Fee       |\n`;
    message += `|----------|--------------|---------------|-----------|\n`;

    if (stonfiQuote.available) {
      message += `| STON.fi  | ${stonfiQuote.expectedOutput.toFixed(4)} | ${stonfiQuote.rate.toFixed(6)} | ${stonfiQuote.fee?.toFixed(4) || "N/A"} |\n`;
    } else {
      message += `| STON.fi  | N/A          | N/A           | ${stonfiQuote.error} |\n`;
    }

    if (dedustQuote.available) {
      message += `| DeDust   | ${dedustQuote.expectedOutput.toFixed(4)} | ${dedustQuote.rate.toFixed(6)} | ${dedustQuote.fee?.toFixed(4) || "N/A"} |\n`;
    } else {
      message += `| DeDust   | N/A          | N/A           | ${dedustQuote.error} |\n`;
    }

    message += `\nRecommended: ${recommended}`;
    if (savings > 0) {
      message += ` (+${savings.toFixed(4)} ${toSymbol}, ${savingsPercent.toFixed(2)}% better)`;
    }
    message += `\n\nUse dex_swap to execute on the best DEX, or jetton_swap/dedust_swap for specific DEX.`;

    return {
      success: true,
      data: {
        from: isTonInput ? NATIVE_TON_ADDRESS : from_asset,
        to: isTonOutput ? NATIVE_TON_ADDRESS : to_asset,
        amountIn: amount.toString(),
        slippage: `${(slippage * 100).toFixed(2)}%`,
        comparison,
        recommended,
        savings: savings > 0 ? savings.toFixed(6) : "0",
        savingsPercent: savingsPercent > 0 ? `${savingsPercent.toFixed(2)}%` : "0%",
        message,
      },
    };
  } catch (error) {
    console.error("Error in dex_quote:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
