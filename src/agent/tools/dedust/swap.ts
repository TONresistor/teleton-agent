import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import {
  loadWallet,
  getCachedTonClient,
  invalidateTonClientCache,
} from "../../../ton/wallet-service.js";
import { toNano, fromNano } from "@ton/ton";
import { Address } from "@ton/core";
import { ReadinessStatus, JettonRoot, VaultJetton } from "@dedust/sdk";
import { DEDUST_GAS, NATIVE_TON_ADDRESS } from "./constants.js";
import { fromUnits } from "./asset-cache.js";
import { withTxLock } from "../../../ton/tx-lock.js";
import { openWallet } from "../../../ton/wallet-open.js";
import { walletTxLt, confirmWalletTx, tonExplorerTxUrl } from "../../../ton/confirm.js";
import { getErrorMessage, isHttpError } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { estimateDedustSwap } from "../../../ton/dex-service.js";

const log = createLogger("Tools");
interface DedustSwapParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  pool_type?: "volatile" | "stable";
  slippage?: number;
}
export const dedustSwapTool: Tool = {
  name: "dedust_swap",
  description:
    "Execute a token swap on DeDust. Supports TON<->jetton and jetton<->jetton. Use dedust_quote first to preview.",
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
      description: "Amount to swap in human-readable units (e.g., 10 for 10 TON or 10 tokens)",
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
export const dedustSwapExecutor: ToolExecutor<DedustSwapParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, pool_type = "volatile", slippage = 0.01 } = params;

    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

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

    const tonClient = await getCachedTonClient();
    const estimate = await estimateDedustSwap(
      { fromAsset: fromAssetAddr, toAsset: toAssetAddr, amount, slippage },
      { tonClient, preferredPoolType: pool_type }
    );
    if (!estimate) {
      return {
        success: false,
        error: "No DeDust pool ready for this pair (tried volatile and stable).",
      };
    }
    const { factory, pool, poolType, toDecimals, amountIn, amountOut, tradeFee, minAmountOut } =
      estimate;

    // Prepare wallet and sender — wrapped in tx lock to prevent seqno races
    // with concurrent StonFi or other DeDust swaps
    return withTxLock(async () => {
      const opened = await openWallet(tonClient);
      if (!opened) {
        return { success: false, error: "Wallet key derivation failed." };
      }
      const { keyPair, contract: walletContract } = opened;
      const sender = walletContract.sender(keyPair.secretKey);
      const sinceLt = await walletTxLt(tonClient, walletContract.address);
      let broadcastError: unknown;

      if (isTonInput) {
        // Check balance for TON swaps
        const balance = await tonClient.getBalance(Address.parse(walletData.address));
        const requiredAmount = amountIn + toNano(DEDUST_GAS.SWAP_TON_TO_JETTON);
        if (balance < requiredAmount) {
          return {
            success: false,
            error: `Insufficient balance. Have ${fromNano(balance)} TON, need ~${fromNano(requiredAmount)} TON (including gas).`,
          };
        }

        // TON -> Jetton swap using SDK's sendSwap method
        const tonVault = tonClient.open(await factory.getNativeVault());

        // Check vault readiness
        const vaultStatus = await tonVault.getReadinessStatus();
        if (vaultStatus !== ReadinessStatus.READY) {
          return {
            success: false,
            error: "TON vault not ready",
          };
        }

        // Use SDK's sendSwap method
        try {
          await tonVault.sendSwap(sender, {
            poolAddress: pool.address,
            amount: amountIn,
            limit: minAmountOut,
            gasAmount: toNano(DEDUST_GAS.SWAP_TON_TO_JETTON),
          });
        } catch (error) {
          broadcastError = error;
        }
      } else {
        // Jetton -> TON/Jetton swap (use normalized address)
        const jettonAddress = Address.parse(fromAssetAddr);
        const jettonVault = tonClient.open(await factory.getJettonVault(jettonAddress));

        // Check vault readiness
        const vaultStatus = await jettonVault.getReadinessStatus();
        if (vaultStatus !== ReadinessStatus.READY) {
          return {
            success: false,
            error: "Jetton vault not ready. The jetton may not be supported on DeDust.",
          };
        }

        const jettonRoot = tonClient.open(JettonRoot.createFromAddress(jettonAddress));
        const jettonWallet = tonClient.open(
          await jettonRoot.getWallet(Address.parse(walletData.address))
        );

        // Build swap payload using SDK
        const swapPayload = VaultJetton.createSwapPayload({
          poolAddress: pool.address,
          limit: minAmountOut,
        });

        // Send jetton transfer with swap payload
        try {
          await jettonWallet.sendTransfer(sender, toNano(DEDUST_GAS.SWAP_JETTON_TO_ANY), {
            destination: jettonVault.address,
            amount: amountIn,
            responseAddress: Address.parse(walletData.address),
            forwardAmount: toNano(DEDUST_GAS.FORWARD_GAS),
            forwardPayload: swapPayload,
          });
        } catch (error) {
          broadcastError = error;
        }
      }

      const confirmed = await confirmWalletTx(tonClient, walletContract.address, sinceLt);
      if (!confirmed) {
        if (broadcastError) throw broadcastError;
        return {
          success: false,
          error: "Swap transaction failed or could not be confirmed on-chain.",
        };
      }

      // Calculate expected output for display using correct decimals
      const expectedOutput = fromUnits(amountOut, toDecimals);
      const minOutput = fromUnits(minAmountOut, toDecimals);
      const feeAmount = fromUnits(tradeFee, toDecimals);

      const fromSymbol = isTonInput ? "TON" : "Token";
      const toSymbol = isTonOutput ? "TON" : "Token";

      return {
        success: true,
        data: {
          dex: "DeDust",
          from: isTonInput ? NATIVE_TON_ADDRESS : fromAssetAddr,
          to: isTonOutput ? NATIVE_TON_ADDRESS : toAssetAddr,
          amountIn: amount.toString(),
          expectedOutput: expectedOutput.toFixed(6),
          minOutput: minOutput.toFixed(6),
          slippage: `${(slippage * 100).toFixed(2)}%`,
          tradeFee: feeAmount.toFixed(6),
          poolType,
          poolAddress: pool.address.toString(),
          txHash: confirmed.hash,
          message: `Swapped ${amount} ${fromSymbol} for ~${expectedOutput.toFixed(4)} ${toSymbol} on DeDust — confirmed on-chain\n  Minimum output: ${minOutput.toFixed(4)}\n  Slippage: ${(slippage * 100).toFixed(2)}%\n  tx ${confirmed.hash}\n  ${tonExplorerTxUrl(confirmed.hash)}`,
        },
      };
    }); // withTxLock
  } catch (error: unknown) {
    if (isHttpError(error)) {
      const status = error.status ?? error.response?.status;
      if (status === 429 || (status !== undefined && status >= 500)) {
        invalidateTonClientCache();
      }
    }
    log.error({ err: error }, "Error in dedust_swap");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
