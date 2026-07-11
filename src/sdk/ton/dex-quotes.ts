import type { DexSingleQuote, PluginLogger } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { estimateDedustSwap, simulateStonfiSwap } from "../../ton/dex-service.js";
import { fromUnits } from "../../ton/units.js";

export async function getStonfiQuote(
  fromAsset: string,
  toAsset: string,
  amount: number,
  slippage: number,
  log: PluginLogger
): Promise<DexSingleQuote | null> {
  try {
    const quote = await simulateStonfiSwap({ fromAsset, toAsset, amount, slippage });
    if (!quote) return null;
    const { simulation: simulationResult, toDecimals } = quote;

    const expectedOutput = fromUnits(BigInt(simulationResult.askUnits), toDecimals);
    const minOutput = fromUnits(BigInt(simulationResult.minAskUnits), toDecimals);
    const feeAmount = fromUnits(BigInt(simulationResult.feeUnits || "0"), toDecimals);

    return {
      dex: "stonfi",
      expectedOutput: expectedOutput.toFixed(6),
      minOutput: minOutput.toFixed(6),
      rate: (expectedOutput / amount).toFixed(6),
      priceImpact: simulationResult.priceImpact || undefined,
      fee: feeAmount.toFixed(6),
    };
  } catch (error) {
    log.debug("dex.quoteSTONfi() failed:", error);
    return null;
  }
}

export async function getDedustQuote(
  fromAsset: string,
  toAsset: string,
  amount: number,
  slippage: number,
  log: PluginLogger
): Promise<DexSingleQuote | null> {
  try {
    const quote = await estimateDedustSwap({ fromAsset, toAsset, amount, slippage });
    if (!quote) return null;
    const { amountOut, tradeFee, minAmountOut, toDecimals, poolType } = quote;

    const expectedOutput = fromUnits(amountOut, toDecimals);
    const minOutput = fromUnits(minAmountOut, toDecimals);
    const feeAmount = fromUnits(tradeFee, toDecimals);

    return {
      dex: "dedust",
      expectedOutput: expectedOutput.toFixed(6),
      minOutput: minOutput.toFixed(6),
      rate: (expectedOutput / amount).toFixed(6),
      fee: feeAmount.toFixed(6),
      poolType,
    };
  } catch (error) {
    log.debug("dex.quoteDeDust() failed:", error);
    return null;
  }
}

export function validateDexParams(amount: number, slippage?: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PluginSDKError("Amount must be a positive number", "INVALID_INPUT");
  }
  if (slippage !== undefined && (!Number.isFinite(slippage) || slippage < 0 || slippage > 1)) {
    throw new PluginSDKError("Slippage must be between 0 and 1", "INVALID_INPUT");
  }
}
