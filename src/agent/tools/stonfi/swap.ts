import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import {
  loadWallet,
  getCachedTonClient,
  invalidateTonClientCache,
} from "../../../ton/wallet-service.js";
import { fromNano, internal } from "@ton/ton";
import { dexFactory } from "@ston-fi/sdk";
import { withTxLock } from "../../../ton/tx-lock.js";
import { openWallet } from "../../../ton/wallet-open.js";
import { sendWalletTx, tonExplorerTxUrl } from "../../../ton/confirm.js";
import { getErrorMessage, isHttpError } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { fromUnits } from "../../../ton/units.js";
import { STONFI_PTON_ADDRESS as NATIVE_TON_ADDRESS } from "../../../ton/dex-constants.js";
import { isStonfiTonAsset, simulateStonfiSwap } from "../../../ton/dex-service.js";

const log = createLogger("Tools");
interface JettonSwapParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  slippage?: number;
}
export const stonfiSwapTool: Tool = {
  name: "stonfi_swap",
  description:
    "Execute a token swap on STON.fi. Supports TON<->jetton and jetton<->jetton. Use stonfi_quote first to preview.",
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
    slippage: Type.Optional(
      Type.Number({
        description: "Slippage tolerance (0.01 = 1%, default: 0.01)",
        minimum: 0.001,
        maximum: 0.5,
      })
    ),
  }),
};
export const stonfiSwapExecutor: ToolExecutor<JettonSwapParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, slippage = 0.01 } = params;

    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // STON.fi API requires the native TON address, not the string "ton"
    const isTonInput = isStonfiTonAsset(from_asset);
    const isTonOutput = isStonfiTonAsset(to_asset);
    const fromAddress = isTonInput ? NATIVE_TON_ADDRESS : from_asset;
    const toAddress = isTonOutput ? NATIVE_TON_ADDRESS : to_asset;

    if (!isTonInput && !fromAddress.match(/^[EUe][Qq][A-Za-z0-9_-]{46}$/)) {
      return {
        success: false,
        error: `Invalid from_asset address: ${from_asset}`,
      };
    }
    if (!isTonOutput && !toAddress.match(/^[EUe][Qq][A-Za-z0-9_-]{46}$/)) {
      return {
        success: false,
        error: `Invalid to_asset address: ${to_asset}`,
      };
    }

    const tonClient = await getCachedTonClient();

    log.info(`Simulating swap: ${amount} ${fromAddress} → ${toAddress}`);
    const simulation = await simulateStonfiSwap({
      fromAsset: from_asset,
      toAsset: to_asset,
      amount,
      slippage,
    });
    if (!simulation?.simulation.router) {
      return {
        success: false,
        error: "Failed to simulate swap. Pool may not exist or have insufficient liquidity.",
      };
    }
    const { simulation: simulationResult, toDecimals } = simulation;

    const { router: routerInfo } = simulationResult;
    const contracts = dexFactory(routerInfo);
    const router = tonClient.open(contracts.Router.create(routerInfo.address));

    return withTxLock(async () => {
      const opened = await openWallet(tonClient);
      if (!opened) {
        return { success: false, error: "Wallet key derivation failed." };
      }
      const { keyPair, wallet, contract: walletContract } = opened;

      let txParams;
      const proxyTon = contracts.pTON.create(routerInfo.ptonMasterAddress);

      if (isTonInput) {
        // Check balance for TON swaps with dynamic gas
        const balance = await tonClient.getBalance(wallet.address);
        const gasReserve =
          BigInt(simulationResult.gasParams?.forwardGas || "300000000") +
          BigInt(simulationResult.gasParams?.estimatedGasConsumption || "50000000");
        const requiredAmount = BigInt(simulationResult.offerUnits) + gasReserve;
        if (balance < requiredAmount) {
          return {
            success: false,
            error: `Insufficient balance. Have ${fromNano(balance)} TON, need ~${fromNano(requiredAmount)} TON (including gas).`,
          };
        }

        // TON -> Jetton
        txParams = await router.getSwapTonToJettonTxParams({
          userWalletAddress: walletData.address,
          proxyTon,
          askJettonAddress: toAddress,
          offerAmount: BigInt(simulationResult.offerUnits),
          minAskAmount: BigInt(simulationResult.minAskUnits),
        });
      } else if (isTonOutput) {
        // Jetton -> TON
        txParams = await router.getSwapJettonToTonTxParams({
          userWalletAddress: walletData.address,
          proxyTon,
          offerJettonAddress: fromAddress,
          offerAmount: BigInt(simulationResult.offerUnits),
          minAskAmount: BigInt(simulationResult.minAskUnits),
        });
      } else {
        // Jetton -> Jetton
        txParams = await router.getSwapJettonToJettonTxParams({
          userWalletAddress: walletData.address,
          offerJettonAddress: fromAddress,
          askJettonAddress: toAddress,
          offerAmount: BigInt(simulationResult.offerUnits),
          minAskAmount: BigInt(simulationResult.minAskUnits),
        });
      }

      const sent = await sendWalletTx(tonClient, walletContract, {
        secretKey: keyPair.secretKey,
        messages: [
          internal({
            to: txParams.to,
            value: txParams.value,
            body: txParams.body,
            bounce: true,
          }),
        ],
      });

      if (!sent) {
        return {
          success: false,
          error: "Swap transaction failed or could not be confirmed on-chain.",
        };
      }

      const expectedOutput = fromUnits(BigInt(simulationResult.askUnits), toDecimals);
      const minOutput = fromUnits(BigInt(simulationResult.minAskUnits), toDecimals);

      return {
        success: true,
        data: {
          from: fromAddress,
          to: toAddress,
          amountIn: amount.toString(),
          expectedOutput: expectedOutput.toFixed(6),
          minOutput: minOutput.toFixed(6),
          slippage: `${(slippage * 100).toFixed(2)}%`,
          priceImpact: simulationResult.priceImpact || "N/A",
          router: routerInfo.address,
          txHash: sent.hash,
          message: `Swapped ${amount} ${isTonInput ? "TON" : "tokens"} for ~${expectedOutput.toFixed(4)} ${isTonOutput ? "TON" : "tokens"} — confirmed on-chain\n  Minimum output: ${minOutput.toFixed(4)}\n  Slippage: ${(slippage * 100).toFixed(2)}%\n  tx ${sent.hash}\n  ${tonExplorerTxUrl(sent.hash)}`,
        },
      };
    }); // withTxLock
  } catch (error: unknown) {
    // Invalidate node cache on 429/5xx so next attempt picks a fresh node
    if (isHttpError(error)) {
      const status = error.status ?? error.response?.status;
      if (status === 429 || (status !== undefined && status >= 500)) {
        invalidateTonClientCache();
      }
    }
    log.error({ err: error }, "Error in stonfi_swap");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
