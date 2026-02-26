import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import {
  loadWallet,
  getKeyPair,
  getCachedTonClient,
  invalidateTonClientCache,
} from "../../../ton/wallet-service.js";
import { WalletContractV5R1, fromNano, internal } from "@ton/ton";
import { SendMode } from "@ton/core";
import { dexFactory } from "@ston-fi/sdk";
import { StonApiClient } from "@ston-fi/api";
import { withTxLock } from "../../../ton/tx-lock.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");

// Native TON address used by STON.fi API
const NATIVE_TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
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
  context
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
    const isTonInput = from_asset.toLowerCase() === "ton" || from_asset === NATIVE_TON_ADDRESS;
    const isTonOutput = to_asset.toLowerCase() === "ton" || to_asset === NATIVE_TON_ADDRESS;
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
    const stonApiClient = new StonApiClient();

    // Fetch decimals for accurate conversion (TON=9, USDT=6, WBTC=8, etc.)
    const fromAssetInfo = await stonApiClient.getAsset(fromAddress);
    const fromDecimals = fromAssetInfo?.decimals ?? 9;
    // String-based conversion to avoid float precision loss with high-decimal tokens
    const amountStr = amount.toFixed(fromDecimals);
    const [whole, frac = ""] = amountStr.split(".");
    const offerUnits = BigInt(
      whole + (frac + "0".repeat(fromDecimals)).slice(0, fromDecimals)
    ).toString();

    log.info(`Simulating swap: ${amount} ${fromAddress} → ${toAddress}`);
    const simulationResult = await stonApiClient.simulateSwap({
      offerAddress: fromAddress,
      askAddress: toAddress,
      offerUnits,
      slippageTolerance: slippage.toString(),
    });

    if (!simulationResult || !simulationResult.router) {
      return {
        success: false,
        error: "Failed to simulate swap. Pool may not exist or have insufficient liquidity.",
      };
    }

    const { router: routerInfo } = simulationResult;
    const contracts = dexFactory(routerInfo);
    const router = tonClient.open(contracts.Router.create(routerInfo.address));

    return withTxLock(async () => {
      const keyPair = await getKeyPair();
      if (!keyPair) {
        return { success: false, error: "Wallet key derivation failed." };
      }
      const wallet = WalletContractV5R1.create({
        workchain: 0,
        publicKey: keyPair.publicKey,
      });
      const walletContract = tonClient.open(wallet);
      const seqno = await walletContract.getSeqno();

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

      await walletContract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
          internal({
            to: txParams.to,
            value: txParams.value,
            body: txParams.body,
            bounce: true,
          }),
        ],
      });

      // Fetch ask asset decimals for accurate output conversion
      const toAssetInfo = await stonApiClient.getAsset(toAddress);
      const askDecimals = toAssetInfo?.decimals ?? 9;
      const expectedOutput = Number(simulationResult.askUnits) / 10 ** askDecimals;
      const minOutput = Number(simulationResult.minAskUnits) / 10 ** askDecimals;

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
          message: `Swapped ${amount} ${isTonInput ? "TON" : "tokens"} for ~${expectedOutput.toFixed(4)} ${isTonOutput ? "TON" : "tokens"}\n  Minimum output: ${minOutput.toFixed(4)}\n  Slippage: ${(slippage * 100).toFixed(2)}%\n  Transaction sent (check balance in ~30 seconds)`,
        },
      };
    }); // withTxLock
  } catch (error: any) {
    // Invalidate node cache on 429/5xx so next attempt picks a fresh node
    const status = error?.status || error?.response?.status;
    if (status === 429 || status >= 500) {
      invalidateTonClientCache();
    }
    log.error({ err: error }, "Error in stonfi_swap");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
