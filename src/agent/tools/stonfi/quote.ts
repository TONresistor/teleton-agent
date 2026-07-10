import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { fromUnits } from "../../../ton/units.js";
import { simulateStonfiSwap } from "../../../ton/dex-service.js";

const log = createLogger("Tools");
interface JettonQuoteParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  slippage?: number;
}
export const stonfiQuoteTool: Tool = {
  name: "stonfi_quote",
  description: "Get a swap price quote on STON.fi without executing. Use stonfi_swap to execute.",
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
    slippage: Type.Optional(
      Type.Number({
        description: "Slippage tolerance (0.01 = 1%, default: 0.01)",
        minimum: 0.001,
        maximum: 0.5,
      })
    ),
  }),
};
export const stonfiQuoteExecutor: ToolExecutor<JettonQuoteParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, slippage = 0.01 } = params;

    const simulation = await simulateStonfiSwap({
      fromAsset: from_asset,
      toAsset: to_asset,
      amount,
      slippage,
    });
    if (!simulation) {
      return {
        success: false,
        error: "Failed to get quote. Pool may not exist or have insufficient liquidity.",
      };
    }
    const {
      simulation: simulationResult,
      fromAddress,
      toAddress,
      isTonInput,
      isTonOutput,
      toDecimals,
    } = simulation;

    // Parse results
    const askUnits = BigInt(simulationResult.askUnits);
    const minAskUnits = BigInt(simulationResult.minAskUnits);
    const feeUnits = BigInt(simulationResult.feeUnits || "0");

    const expectedOutput = fromUnits(askUnits, toDecimals);
    const minOutput = fromUnits(minAskUnits, toDecimals);
    const feeAmount = fromUnits(feeUnits, toDecimals);

    // Calculate effective rate
    const rate = expectedOutput / amount;
    const priceImpact = simulationResult.priceImpact || "0";

    // Get asset names if possible
    const fromSymbol = isTonInput ? "TON" : "Token";
    const toSymbol = isTonOutput ? "TON" : "Token";

    // Build quote response
    const quote = {
      from: fromAddress,
      fromSymbol,
      to: toAddress,
      toSymbol,
      amountIn: amount.toString(),
      expectedOutput: expectedOutput.toFixed(6),
      minOutput: minOutput.toFixed(6),
      rate: rate.toFixed(6),
      priceImpact: priceImpact,
      slippage: `${(slippage * 100).toFixed(2)}%`,
      fee: feeAmount.toFixed(6),
      feePercent: simulationResult.feePercent || "N/A",
      router: simulationResult.router?.address || "N/A",
    };

    let message = `Quote: ${amount} ${fromSymbol} → ${toSymbol}\n\n`;
    message += `Expected output: ${quote.expectedOutput}\n`;
    message += `Minimum output: ${quote.minOutput} (with ${quote.slippage} slippage)\n`;
    message += `Rate: 1 ${fromSymbol} = ${quote.rate} ${toSymbol}\n`;
    message += `Price impact: ${quote.priceImpact}\n`;
    message += `Fee: ${quote.fee} (${quote.feePercent})\n\n`;
    message += `This is a quote only - use stonfi_swap to execute.`;

    return {
      success: true,
      data: {
        ...quote,
        message,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in stonfi_quote");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
