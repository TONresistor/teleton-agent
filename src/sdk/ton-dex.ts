import type {
  DexQuoteParams,
  DexQuoteResult,
  DexSDK,
  DexSingleQuote,
  DexSwapParams,
  DexSwapResult,
  PluginLogger,
} from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { getDedustQuote, getStonfiQuote, validateDexParams } from "./ton/dex-quotes.js";
import { executeDedustSwap, executeStonfiSwap } from "./ton/dex-swaps.js";
import { requireNonEmpty } from "./validation.js";

function validatePair(params: DexQuoteParams): void {
  const fromAsset = requireNonEmpty(params.fromAsset, "Source asset");
  const toAsset = requireNonEmpty(params.toAsset, "Destination asset");
  if (fromAsset.toLowerCase() === toAsset.toLowerCase()) {
    throw new PluginSDKError("Source and destination assets must differ", "INVALID_INPUT");
  }
  validateDexParams(params.amount, params.slippage);
}

export function createDexSDK(log: PluginLogger): DexSDK {
  return {
    async quote(params: DexQuoteParams): Promise<DexQuoteResult> {
      validatePair(params);
      const slippage = params.slippage ?? 0.01;
      const [stonfi, dedust] = await Promise.all([
        getStonfiQuote(params.fromAsset, params.toAsset, params.amount, slippage, log),
        getDedustQuote(params.fromAsset, params.toAsset, params.amount, slippage, log),
      ]);

      if (!stonfi && !dedust) {
        throw new PluginSDKError("No DEX has liquidity for this pair", "OPERATION_FAILED");
      }

      let recommended: "stonfi" | "dedust";
      let savings = "0%";
      if (!stonfi) {
        recommended = "dedust";
      } else if (!dedust) {
        recommended = "stonfi";
      } else {
        const stonfiOut = Number(stonfi.expectedOutput);
        const dedustOut = Number(dedust.expectedOutput);
        if (!Number.isFinite(stonfiOut) && !Number.isFinite(dedustOut)) {
          throw new PluginSDKError("Failed to parse DEX quotes", "OPERATION_FAILED");
        }
        if (!Number.isFinite(stonfiOut)) {
          recommended = "dedust";
        } else if (!Number.isFinite(dedustOut)) {
          recommended = "stonfi";
        } else if (stonfiOut >= dedustOut) {
          recommended = "stonfi";
          if (dedustOut > 0) {
            savings = `${(((stonfiOut - dedustOut) / dedustOut) * 100).toFixed(2)}%`;
          }
        } else {
          recommended = "dedust";
          if (stonfiOut > 0) {
            savings = `${(((dedustOut - stonfiOut) / stonfiOut) * 100).toFixed(2)}%`;
          }
        }
      }

      return { stonfi, dedust, recommended, savings };
    },

    async quoteSTONfi(params: DexQuoteParams): Promise<DexSingleQuote | null> {
      validatePair(params);
      return getStonfiQuote(
        params.fromAsset,
        params.toAsset,
        params.amount,
        params.slippage ?? 0.01,
        log
      );
    },

    async quoteDeDust(params: DexQuoteParams): Promise<DexSingleQuote | null> {
      validatePair(params);
      return getDedustQuote(
        params.fromAsset,
        params.toAsset,
        params.amount,
        params.slippage ?? 0.01,
        log
      );
    },

    async swap(params: DexSwapParams): Promise<DexSwapResult> {
      validatePair(params);
      if (params.dex === "stonfi") return executeStonfiSwap(params);
      if (params.dex === "dedust") return executeDedustSwap(params);

      const quoteResult = await this.quote(params);
      return quoteResult.recommended === "stonfi"
        ? executeStonfiSwap(params)
        : executeDedustSwap(params);
    },

    async swapSTONfi(params: DexSwapParams): Promise<DexSwapResult> {
      validatePair(params);
      return executeStonfiSwap(params);
    },

    async swapDeDust(params: DexSwapParams): Promise<DexSwapResult> {
      validatePair(params);
      return executeDedustSwap(params);
    },
  };
}
