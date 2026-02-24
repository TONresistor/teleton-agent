import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { StonApiClient } from "@ston-fi/api";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");

// Native TON address used by STON.fi API
const NATIVE_TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
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
export const stonfiQuoteExecutor: ToolExecutor<JettonQuoteParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, slippage = 0.01 } = params;

    // STON.fi API requires the native TON address, not the string "ton"
    const isTonInput = from_asset.toLowerCase() === "ton";
    const fromAddress = isTonInput ? NATIVE_TON_ADDRESS : from_asset;
    const toAddress = to_asset;

    // Initialize STON.fi API client
    const stonApiClient = new StonApiClient();

    // Fetch decimals for accurate conversion (TON=9, USDT=6, WBTC=8, etc.)
    const fromAssetInfo = await stonApiClient.getAsset(fromAddress);
    const fromDecimals = fromAssetInfo?.decimals ?? 9;
    const amountStr = amount.toFixed(fromDecimals);
    const [whole, frac = ""] = amountStr.split(".");
    const offerUnits = BigInt(
      whole + (frac + "0".repeat(fromDecimals)).slice(0, fromDecimals)
    ).toString();

    const simulationResult = await stonApiClient.simulateSwap({
      offerAddress: fromAddress,
      askAddress: toAddress,
      offerUnits,
      slippageTolerance: slippage.toString(),
    });

    if (!simulationResult) {
      return {
        success: false,
        error: "Failed to get quote. Pool may not exist or have insufficient liquidity.",
      };
    }

    // Parse results
    const askUnits = BigInt(simulationResult.askUnits);
    const minAskUnits = BigInt(simulationResult.minAskUnits);
    const feeUnits = BigInt(simulationResult.feeUnits || "0");

    // Fetch ask asset decimals for accurate output conversion
    const toAssetInfo = await stonApiClient.getAsset(toAddress);
    const askDecimals = toAssetInfo?.decimals ?? 9;
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
