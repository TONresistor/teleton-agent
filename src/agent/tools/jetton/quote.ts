import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { toNano } from "@ton/ton";
import { StonApiClient } from "@ston-fi/api";

// Native TON address used by STON.fi API
const NATIVE_TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";

/**
 * Parameters for jetton_quote tool
 */
interface JettonQuoteParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  slippage?: number;
}

/**
 * Tool definition for jetton_quote
 */
export const jettonQuoteTool: Tool = {
  name: "jetton_quote",
  description:
    "Get a price quote for a token swap WITHOUT executing it. Shows expected output, minimum output, price impact, and fees. Use this to preview a swap before committing. Use 'ton' as from_asset for TON, or jetton master address.",
  parameters: Type.Object({
    from_asset: Type.String({
      description: "Source asset: 'ton' for TON, or jetton master address (EQ... format)",
    }),
    to_asset: Type.String({
      description: "Destination jetton master address (EQ... format)",
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
 * Executor for jetton_quote tool
 */
export const jettonQuoteExecutor: ToolExecutor<JettonQuoteParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, slippage = 0.01 } = params;

    // Normalize asset addresses
    // STON.fi API requires the native TON address, not the string "ton"
    const isTonInput = from_asset.toLowerCase() === "ton";
    const fromAddress = isTonInput ? NATIVE_TON_ADDRESS : from_asset;
    const toAddress = to_asset;

    // Initialize STON.fi API client
    const stonApiClient = new StonApiClient();

    // Simulate swap
    const simulationResult = await stonApiClient.simulateSwap({
      offerAddress: fromAddress,
      askAddress: toAddress,
      offerUnits: toNano(amount).toString(),
      slippageTolerance: slippage.toString(),
    });

    if (!simulationResult) {
      return {
        success: false,
        error: "Failed to get quote. Pool may not exist or have insufficient liquidity.",
      };
    }

    // Parse results
    const offerUnits = BigInt(simulationResult.offerUnits);
    const askUnits = BigInt(simulationResult.askUnits);
    const minAskUnits = BigInt(simulationResult.minAskUnits);
    const feeUnits = BigInt(simulationResult.feeUnits || "0");

    // Assuming 9 decimals for simplicity (would need to fetch actual decimals for precision)
    const askDecimals = 9;
    const expectedOutput = Number(askUnits) / 10 ** askDecimals;
    const minOutput = Number(minAskUnits) / 10 ** askDecimals;
    const feeAmount = Number(feeUnits) / 10 ** askDecimals;

    // Calculate effective rate
    const rate = expectedOutput / amount;
    const priceImpact = simulationResult.priceImpact || "0";

    // Get asset names if possible
    const fromSymbol = isTonInput ? "TON" : "Token";
    const toSymbol = "Token";

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

    // Build message
    let message = `Quote: ${amount} ${fromSymbol} → ${toSymbol}\n\n`;
    message += `Expected output: ${quote.expectedOutput}\n`;
    message += `Minimum output: ${quote.minOutput} (with ${quote.slippage} slippage)\n`;
    message += `Rate: 1 ${fromSymbol} = ${quote.rate} ${toSymbol}\n`;
    message += `Price impact: ${quote.priceImpact}\n`;
    message += `Fee: ${quote.fee} (${quote.feePercent})\n\n`;
    message += `⚠️ This is a quote only - use jetton_swap to execute.`;

    return {
      success: true,
      data: {
        ...quote,
        message,
      },
    };
  } catch (error) {
    console.error("Error in jetton_quote:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
