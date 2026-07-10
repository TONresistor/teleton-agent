import type {
  DexSDK,
  DexQuoteParams,
  DexQuoteResult,
  DexSingleQuote,
  DexSwapParams,
  DexSwapResult,
  PluginLogger,
} from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { WalletContractV5R1, toNano, internal } from "@ton/ton";
import { Address } from "@ton/core";
import { getCachedTonClient, loadWallet, getKeyPair } from "../ton/wallet-service.js";
import { sendWalletTx, walletTxLt, confirmWalletTx } from "../ton/confirm.js";
import { dexFactory } from "@ston-fi/sdk";
import { JettonRoot, VaultJetton } from "@dedust/sdk";
import { DEDUST_GAS } from "../ton/dex-constants.js";
import { fromUnits } from "../ton/units.js";
import { withTxLock } from "../ton/tx-lock.js";
import { estimateDedustSwap, simulateStonfiSwap } from "../ton/dex-service.js";

import type { OpenedContract } from "@ton/ton";

async function getStonfiQuote(
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

    const askUnits = BigInt(simulationResult.askUnits);
    const minAskUnits = BigInt(simulationResult.minAskUnits);
    const feeUnits = BigInt(simulationResult.feeUnits || "0");

    const expectedOutput = fromUnits(askUnits, toDecimals);
    const minOutput = fromUnits(minAskUnits, toDecimals);
    const feeAmount = fromUnits(feeUnits, toDecimals);
    const rate = expectedOutput / amount;

    return {
      dex: "stonfi",
      expectedOutput: expectedOutput.toFixed(6),
      minOutput: minOutput.toFixed(6),
      rate: rate.toFixed(6),
      priceImpact: simulationResult.priceImpact || undefined,
      fee: feeAmount.toFixed(6),
    };
  } catch (error) {
    log.debug("dex.quoteSTONfi() failed:", error);
    return null;
  }
}

async function getDedustQuote(
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
    const rate = expectedOutput / amount;

    return {
      dex: "dedust",
      expectedOutput: expectedOutput.toFixed(6),
      minOutput: minOutput.toFixed(6),
      rate: rate.toFixed(6),
      fee: feeAmount.toFixed(6),
      poolType,
    };
  } catch (error) {
    log.debug("dex.quoteDeDust() failed:", error);
    return null;
  }
}

type SwapWallet = ReturnType<typeof WalletContractV5R1.create>;

/**
 * Thin wallet-provisioning wrapper shared by the STON.fi and DeDust swap paths:
 * runs `fn` under the tx lock with a freshly derived key and opened V5R1 contract.
 * The divergent txParams cores stay in each caller's `fn`.
 */
async function withSwapWallet<T>(
  tonClient: Awaited<ReturnType<typeof getCachedTonClient>>,
  fn: (ctx: {
    keyPair: NonNullable<Awaited<ReturnType<typeof getKeyPair>>>;
    wallet: SwapWallet;
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

    return fn({ keyPair, wallet, walletContract });
  });
}

async function executeSTONfiSwap(
  params: DexSwapParams,
  _log: PluginLogger
): Promise<DexSwapResult> {
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

  const { router: routerInfo } = simulationResult;
  const contracts = dexFactory(routerInfo);
  const router = tonClient.open(contracts.Router.create(routerInfo.address));

  return withSwapWallet(tonClient, async ({ keyPair, walletContract }) => {
    const proxyTon = contracts.pTON.create(routerInfo.ptonMasterAddress);

    let txParams;

    if (isTonInput) {
      txParams = await router.getSwapTonToJettonTxParams({
        userWalletAddress: walletData.address,
        proxyTon,
        askJettonAddress: toAddress,
        offerAmount: BigInt(simulationResult.offerUnits),
        minAskAmount: BigInt(simulationResult.minAskUnits),
      });
    } else if (isTonOutput) {
      txParams = await router.getSwapJettonToTonTxParams({
        userWalletAddress: walletData.address,
        proxyTon,
        offerJettonAddress: fromAddress,
        offerAmount: BigInt(simulationResult.offerUnits),
        minAskAmount: BigInt(simulationResult.minAskUnits),
      });
    } else {
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
      throw new PluginSDKError(
        "Swap transaction failed or could not be confirmed on-chain",
        "OPERATION_FAILED"
      );
    }

    const expectedOutput = fromUnits(BigInt(simulationResult.askUnits), toDecimals);
    const minOutput = fromUnits(BigInt(simulationResult.minAskUnits), toDecimals);

    return {
      dex: "stonfi",
      fromAsset,
      toAsset,
      amountIn: amount.toString(),
      expectedOutput: expectedOutput.toFixed(6),
      minOutput: minOutput.toFixed(6),
      slippage: `${(slippage * 100).toFixed(2)}%`,
      txRef: sent.hash,
    };
  });
}

async function executeDedustSwap(
  params: DexSwapParams,
  _log: PluginLogger
): Promise<DexSwapResult> {
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

    const expectedOutput = fromUnits(amountOut, toDecimals);
    const minOutput = fromUnits(minAmountOut, toDecimals);

    return {
      dex: "dedust",
      fromAsset,
      toAsset,
      amountIn: amount.toString(),
      expectedOutput: expectedOutput.toFixed(6),
      minOutput: minOutput.toFixed(6),
      slippage: `${(slippage * 100).toFixed(2)}%`,
      txRef: confirmed.hash,
    };
  });
}

function validateDexParams(amount: number, slippage?: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PluginSDKError("Amount must be a positive number", "OPERATION_FAILED");
  }
  if (slippage !== undefined && (!Number.isFinite(slippage) || slippage < 0 || slippage > 1)) {
    throw new PluginSDKError("Slippage must be between 0 and 1", "OPERATION_FAILED");
  }
}

export function createDexSDK(log: PluginLogger): DexSDK {
  return {
    async quote(params: DexQuoteParams): Promise<DexQuoteResult> {
      validateDexParams(params.amount, params.slippage);
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
        const stonfiOut = parseFloat(stonfi.expectedOutput);
        const dedustOut = parseFloat(dedust.expectedOutput);
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
      return getStonfiQuote(
        params.fromAsset,
        params.toAsset,
        params.amount,
        params.slippage ?? 0.01,
        log
      );
    },

    async quoteDeDust(params: DexQuoteParams): Promise<DexSingleQuote | null> {
      return getDedustQuote(
        params.fromAsset,
        params.toAsset,
        params.amount,
        params.slippage ?? 0.01,
        log
      );
    },

    async swap(params: DexSwapParams): Promise<DexSwapResult> {
      validateDexParams(params.amount, params.slippage);

      if (params.dex === "stonfi") {
        return executeSTONfiSwap(params, log);
      }
      if (params.dex === "dedust") {
        return executeDedustSwap(params, log);
      }

      // Auto-select: quote both, pick the better one
      const quoteResult = await this.quote(params);
      return quoteResult.recommended === "stonfi"
        ? executeSTONfiSwap(params, log)
        : executeDedustSwap(params, log);
    },

    async swapSTONfi(params: DexSwapParams): Promise<DexSwapResult> {
      return executeSTONfiSwap(params, log);
    },

    async swapDeDust(params: DexSwapParams): Promise<DexSwapResult> {
      return executeDedustSwap(params, log);
    },
  };
}
