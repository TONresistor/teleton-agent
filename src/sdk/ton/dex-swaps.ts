import type { DexSwapParams, DexSwapResult } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { Address } from "@ton/core";
import type { OpenedContract } from "@ton/ton";
import { internal, toNano, WalletContractV5R1 } from "@ton/ton";
import { JettonRoot, VaultJetton } from "@dedust/sdk";
import { dexFactory } from "@ston-fi/sdk";
import { confirmWalletTx, sendWalletTx, walletTxLt } from "../../ton/confirm.js";
import { DEDUST_GAS } from "../../ton/dex-constants.js";
import { estimateDedustSwap, simulateStonfiSwap } from "../../ton/dex-service.js";
import { withTxLock } from "../../ton/tx-lock.js";
import { fromUnits } from "../../ton/units.js";
import { getCachedTonClient, getKeyPair, loadWallet } from "../../ton/wallet-service.js";

type SwapWallet = ReturnType<typeof WalletContractV5R1.create>;

async function withSwapWallet<T>(
  tonClient: Awaited<ReturnType<typeof getCachedTonClient>>,
  fn: (ctx: {
    keyPair: NonNullable<Awaited<ReturnType<typeof getKeyPair>>>;
    walletContract: OpenedContract<SwapWallet>;
  }) => Promise<T>
): Promise<T> {
  return withTxLock(async () => {
    const keyPair = await getKeyPair();
    if (!keyPair) {
      throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
    }

    const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = tonClient.open(wallet);
    return fn({ keyPair, walletContract });
  });
}

export async function executeStonfiSwap(params: DexSwapParams): Promise<DexSwapResult> {
  const { fromAsset, toAsset, amount, slippage = 0.01 } = params;
  const walletData = loadWallet();
  if (!walletData) {
    throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
  }

  const tonClient = await getCachedTonClient();
  const simulation = await simulateStonfiSwap({ fromAsset, toAsset, amount, slippage });
  if (!simulation?.simulation.router) {
    throw new PluginSDKError("No liquidity for this pair on STON.fi", "OPERATION_FAILED");
  }
  const {
    simulation: simulationResult,
    isTonInput,
    isTonOutput,
    fromAddress,
    toAddress,
    toDecimals,
  } = simulation;

  const routerInfo = simulationResult.router;
  const contracts = dexFactory(routerInfo);
  const router = tonClient.open(contracts.Router.create(routerInfo.address));

  return withSwapWallet(tonClient, async ({ keyPair, walletContract }) => {
    const proxyTon = contracts.pTON.create(routerInfo.ptonMasterAddress);
    const common = {
      userWalletAddress: walletData.address,
      offerAmount: BigInt(simulationResult.offerUnits),
      minAskAmount: BigInt(simulationResult.minAskUnits),
    };

    const txParams = isTonInput
      ? await router.getSwapTonToJettonTxParams({
          ...common,
          proxyTon,
          askJettonAddress: toAddress,
        })
      : isTonOutput
        ? await router.getSwapJettonToTonTxParams({
            ...common,
            proxyTon,
            offerJettonAddress: fromAddress,
          })
        : await router.getSwapJettonToJettonTxParams({
            ...common,
            offerJettonAddress: fromAddress,
            askJettonAddress: toAddress,
          });

    const sent = await sendWalletTx(tonClient, walletContract, {
      secretKey: keyPair.secretKey,
      messages: [
        internal({ to: txParams.to, value: txParams.value, body: txParams.body, bounce: true }),
      ],
    });
    if (!sent) {
      throw new PluginSDKError(
        "Swap transaction failed or could not be confirmed on-chain",
        "OPERATION_FAILED"
      );
    }

    return {
      dex: "stonfi",
      fromAsset,
      toAsset,
      amountIn: amount.toString(),
      expectedOutput: fromUnits(BigInt(simulationResult.askUnits), toDecimals).toFixed(6),
      minOutput: fromUnits(BigInt(simulationResult.minAskUnits), toDecimals).toFixed(6),
      slippage: `${(slippage * 100).toFixed(2)}%`,
      txRef: sent.hash,
    };
  });
}

export async function executeDedustSwap(params: DexSwapParams): Promise<DexSwapResult> {
  const { fromAsset, toAsset, amount, slippage = 0.01 } = params;
  const walletData = loadWallet();
  if (!walletData) {
    throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
  }

  const estimate = await estimateDedustSwap({ fromAsset, toAsset, amount, slippage });
  if (!estimate) {
    throw new PluginSDKError("DeDust pool not ready for this pair", "OPERATION_FAILED");
  }
  const {
    tonClient,
    factory,
    pool,
    isTonInput,
    toDecimals,
    amountIn,
    amountOut,
    minAmountOut,
    fromAddress,
  } = estimate;

  return withSwapWallet(tonClient, async ({ keyPair, walletContract }) => {
    const sender = walletContract.sender(keyPair.secretKey);
    const sinceLt = await walletTxLt(tonClient, walletContract.address);
    let broadcastError: unknown;

    try {
      if (isTonInput) {
        const tonVault = tonClient.open(await factory.getNativeVault());
        await tonVault.sendSwap(sender, {
          poolAddress: pool.address,
          amount: amountIn,
          limit: minAmountOut,
          gasAmount: toNano(DEDUST_GAS.SWAP_TON_TO_JETTON),
        });
      } else {
        const jettonAddress = Address.parse(fromAddress);
        const jettonVault = tonClient.open(await factory.getJettonVault(jettonAddress));
        const jettonRoot = tonClient.open(JettonRoot.createFromAddress(jettonAddress));
        const jettonWallet = tonClient.open(
          await jettonRoot.getWallet(Address.parse(walletData.address))
        );
        const swapPayload = VaultJetton.createSwapPayload({
          poolAddress: pool.address,
          limit: minAmountOut,
        });
        await jettonWallet.sendTransfer(sender, toNano(DEDUST_GAS.SWAP_JETTON_TO_ANY), {
          destination: jettonVault.address,
          amount: amountIn,
          responseAddress: Address.parse(walletData.address),
          forwardAmount: toNano(DEDUST_GAS.FORWARD_GAS),
          forwardPayload: swapPayload,
        });
      }
    } catch (error) {
      broadcastError = error;
    }

    const confirmed = await confirmWalletTx(tonClient, walletContract.address, sinceLt);
    if (!confirmed) {
      if (broadcastError) throw broadcastError;
      throw new PluginSDKError(
        "Swap transaction failed or could not be confirmed on-chain",
        "OPERATION_FAILED"
      );
    }

    return {
      dex: "dedust",
      fromAsset,
      toAsset,
      amountIn: amount.toString(),
      expectedOutput: fromUnits(amountOut, toDecimals).toFixed(6),
      minOutput: fromUnits(minAmountOut, toDecimals).toFixed(6),
      slippage: `${(slippage * 100).toFixed(2)}%`,
      txRef: confirmed.hash,
    };
  });
}
