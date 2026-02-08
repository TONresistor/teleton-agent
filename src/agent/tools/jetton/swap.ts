import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, internal } from "@ton/ton";
import { SendMode } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { DEX, pTON } from "@ston-fi/sdk";
import { StonApiClient } from "@ston-fi/api";

// Native TON address used by STON.fi API
const NATIVE_TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";

/**
 * Parameters for jetton_swap tool
 */
interface JettonSwapParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  slippage?: number;
}

/**
 * Tool definition for jetton_swap
 */
export const jettonSwapTool: Tool = {
  name: "jetton_swap",
  description:
    "Swap tokens on STON.fi DEX. Supports TON↔Jetton and Jetton↔Jetton swaps. Use 'ton' as from_asset to buy jettons with TON, or provide jetton master address. Amount is in human-readable units (will be converted based on decimals). Example: swap 10 TON for USDT, or swap USDT for SCALE.",
  parameters: Type.Object({
    from_asset: Type.String({
      description: "Source asset: 'ton' for TON, or jetton master address (EQ... format)",
    }),
    to_asset: Type.String({
      description: "Destination jetton master address (EQ... format)",
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

/**
 * Executor for jetton_swap tool
 */
export const jettonSwapExecutor: ToolExecutor<JettonSwapParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, slippage = 0.01 } = params;

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Normalize asset addresses
    // STON.fi API requires the native TON address, not the string "ton"
    const isTonInput = from_asset.toLowerCase() === "ton";
    const fromAddress = isTonInput ? NATIVE_TON_ADDRESS : from_asset;
    const toAddress = to_asset;

    // Validate addresses (skip validation for native TON)
    if (!isTonInput && !fromAddress.match(/^[EUe][Qq][A-Za-z0-9_-]{46}$/)) {
      return {
        success: false,
        error: `Invalid from_asset address: ${from_asset}`,
      };
    }
    if (!toAddress.match(/^[EUe][Qq][A-Za-z0-9_-]{46}$/)) {
      return {
        success: false,
        error: `Invalid to_asset address: ${toAddress}`,
      };
    }

    // Initialize STON.fi clients
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const tonClient = new TonClient({ endpoint });
    const stonApiClient = new StonApiClient();

    // Simulate swap to get routing and expected amounts
    console.log(`Simulating swap: ${amount} ${fromAddress} → ${toAddress}`);
    const simulationResult = await stonApiClient.simulateSwap({
      offerAddress: fromAddress,
      askAddress: toAddress,
      offerUnits: toNano(amount).toString(),
      slippageTolerance: slippage.toString(),
    });

    if (!simulationResult || !simulationResult.router) {
      return {
        success: false,
        error: "Failed to simulate swap. Pool may not exist or have insufficient liquidity.",
      };
    }

    // Build DEX contracts from router metadata
    const { router: routerInfo } = simulationResult;
    const router = tonClient.open(new DEX.v1.Router(routerInfo.address));

    // Prepare wallet
    const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });
    const walletContract = tonClient.open(wallet);
    const seqno = await walletContract.getSeqno();

    // Determine swap type and build transaction
    let txParams;

    if (isTonInput) {
      // TON → Jetton swap
      const proxyTon = new pTON.v1(routerInfo.ptonMasterAddress);

      txParams = await router.getSwapTonToJettonTxParams({
        userWalletAddress: walletData.address,
        proxyTon,
        askJettonAddress: toAddress,
        offerAmount: BigInt(simulationResult.offerUnits),
        minAskAmount: BigInt(simulationResult.minAskUnits),
      });
    } else {
      // Jetton → Jetton or Jetton → TON swap
      txParams = await router.getSwapJettonToJettonTxParams({
        userWalletAddress: walletData.address,
        offerJettonAddress: fromAddress,
        askJettonAddress: toAddress,
        offerAmount: BigInt(simulationResult.offerUnits),
        minAskAmount: BigInt(simulationResult.minAskUnits),
      });
    }

    // Execute swap
    await walletContract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: txParams.to,
          value: txParams.value,
          body: txParams.body,
          bounce: true,
        }),
      ],
    });

    // Calculate expected output
    const expectedOutput = Number(BigInt(simulationResult.askUnits) / BigInt(10 ** 9)) / 10 ** 9; // Approximate

    return {
      success: true,
      data: {
        from: fromAddress,
        to: toAddress,
        amountIn: amount.toString(),
        expectedOutput: expectedOutput.toFixed(6),
        minOutput: (Number(simulationResult.minAskUnits) / 10 ** 9).toFixed(6),
        slippage: `${(slippage * 100).toFixed(2)}%`,
        priceImpact: simulationResult.priceImpact || "N/A",
        router: routerInfo.address,
        message: `Swapped ${amount} ${isTonInput ? "TON" : "tokens"} for ~${expectedOutput.toFixed(4)} tokens\n  Minimum output: ${(Number(simulationResult.minAskUnits) / 10 ** 9).toFixed(4)}\n  Slippage: ${(slippage * 100).toFixed(2)}%\n  Transaction sent (check balance in ~30 seconds)`,
      },
    };
  } catch (error) {
    console.error("Error in jetton_swap:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
