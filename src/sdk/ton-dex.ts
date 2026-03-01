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
import { Address, SendMode } from "@ton/core";
import { getCachedTonClient, loadWallet, getKeyPair } from "../ton/wallet-service.js";
import { StonApiClient } from "@ston-fi/api";
import { dexFactory } from "@ston-fi/sdk";
import { Factory, Asset, PoolType, ReadinessStatus, JettonRoot, VaultJetton } from "@dedust/sdk";
import { DEDUST_FACTORY_MAINNET, DEDUST_GAS } from "../agent/tools/dedust/constants.js";
import { getDecimals, toUnits, fromUnits } from "../agent/tools/dedust/asset-cache.js";
import { withTxLock } from "../ton/tx-lock.js";

/** Find the best DeDust pool (volatile first, then stable fallback). */
async function findDedustPool(
  tonClient: Awaited<ReturnType<typeof getCachedTonClient>>,
  factory: ReturnType<typeof Factory.createFromAddress> extends infer T ? any : never,
  fromAsset: ReturnType<typeof Asset.native>,
  toAsset: ReturnType<typeof Asset.native>
): Promise<{ pool: any; poolType: string } | null> {
  try {
    const pool = tonClient.open(await factory.getPool(PoolType.VOLATILE, [fromAsset, toAsset]));
    const status = await pool.getReadinessStatus();
    if (status === ReadinessStatus.READY) return { pool, poolType: "volatile" };

    const stablePool = tonClient.open(await factory.getPool(PoolType.STABLE, [fromAsset, toAsset]));
    const stableStatus = await stablePool.getReadinessStatus();
    if (stableStatus === ReadinessStatus.READY) return { pool: stablePool, poolType: "stable" };

    return null;
  } catch {
    return null;
  }
}

const STONFI_NATIVE_TON = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";

const stonApiClient = new StonApiClient();

function isTon(asset: string): boolean {
  return asset.toLowerCase() === "ton";
}

async function getStonfiQuote(
  fromAsset: string,
  toAsset: string,
  amount: number,
  slippage: number,
  log: PluginLogger
): Promise<DexSingleQuote | null> {
  try {
    const isTonInput = isTon(fromAsset);
    const isTonOutput = isTon(toAsset);
    const fromAddress = isTonInput ? STONFI_NATIVE_TON : fromAsset;
    const toAddress = isTonOutput ? STONFI_NATIVE_TON : toAsset;
    const fromDecimals = await getDecimals(fromAsset);
    const toDecimals = await getDecimals(toAsset);

    const simulationResult = await stonApiClient.simulateSwap({
      offerAddress: fromAddress,
      askAddress: toAddress,
      offerUnits: toUnits(amount, fromDecimals).toString(),
      slippageTolerance: slippage.toString(),
    });

    if (!simulationResult) return null;

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
  } catch (err) {
    log.debug("dex.quoteSTONfi() failed:", err);
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
    const isTonInput = isTon(fromAsset);
    const isTonOutput = isTon(toAsset);

    const tonClient = await getCachedTonClient();
    const factory = tonClient.open(
      Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET))
    );

    const fromAssetObj = isTonInput ? Asset.native() : Asset.jetton(Address.parse(fromAsset));
    const toAssetObj = isTonOutput ? Asset.native() : Asset.jetton(Address.parse(toAsset));

    // Try volatile pool first, then stable
    const poolResult = await findDedustPool(tonClient, factory, fromAssetObj, toAssetObj);
    if (!poolResult) return null;
    const { pool, poolType } = poolResult;

    const fromDecimals = await getDecimals(isTonInput ? "ton" : fromAsset);
    const toDecimals = await getDecimals(isTonOutput ? "ton" : toAsset);

    const amountIn = toUnits(amount, fromDecimals);
    const { amountOut, tradeFee } = await pool.getEstimatedSwapOut({
      assetIn: fromAssetObj,
      amountIn,
    });

    const minAmountOut = amountOut - (amountOut * BigInt(Math.floor(slippage * 10000))) / 10000n;

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
  } catch (err) {
    log.debug("dex.quoteDeDust() failed:", err);
    return null;
  }
}

async function executeSTONfiSwap(params: DexSwapParams, log: PluginLogger): Promise<DexSwapResult> {
  const { fromAsset, toAsset, amount, slippage = 0.01 } = params;

  const walletData = loadWallet();
  if (!walletData) {
    throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
  }

  const isTonInput = isTon(fromAsset);
  const isTonOutput = isTon(toAsset);
  const fromAddress = isTonInput ? STONFI_NATIVE_TON : fromAsset;
  const toAddress = isTonOutput ? STONFI_NATIVE_TON : toAsset;

  const tonClient = await getCachedTonClient();

  const fromDecimals = await getDecimals(isTonInput ? "ton" : fromAsset);
  const offerUnits = toUnits(amount, fromDecimals).toString();

  const simulationResult = await stonApiClient.simulateSwap({
    offerAddress: fromAddress,
    askAddress: toAddress,
    offerUnits,
    slippageTolerance: slippage.toString(),
  });

  if (!simulationResult?.router) {
    throw new PluginSDKError("No liquidity for this pair on STON.fi", "OPERATION_FAILED");
  }

  const { router: routerInfo } = simulationResult;
  const contracts = dexFactory(routerInfo);
  const router = tonClient.open(contracts.Router.create(routerInfo.address));

  return withTxLock(async () => {
    const keyPair = await getKeyPair();
    if (!keyPair) {
      throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
    }

    const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = tonClient.open(wallet);
    const seqno = await walletContract.getSeqno();
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

    const toDecimals = await getDecimals(isTonOutput ? "ton" : toAsset);
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
    };
  });
}

async function executeDedustSwap(params: DexSwapParams, log: PluginLogger): Promise<DexSwapResult> {
  const { fromAsset, toAsset, amount, slippage = 0.01 } = params;

  const walletData = loadWallet();
  if (!walletData) {
    throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
  }

  const isTonInput = isTon(fromAsset);
  const isTonOutput = isTon(toAsset);

  const tonClient = await getCachedTonClient();
  const factory = tonClient.open(Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET)));

  const fromAssetObj = isTonInput ? Asset.native() : Asset.jetton(Address.parse(fromAsset));
  const toAssetObj = isTonOutput ? Asset.native() : Asset.jetton(Address.parse(toAsset));

  const poolResult = await findDedustPool(tonClient, factory, fromAssetObj, toAssetObj);
  if (!poolResult) {
    throw new PluginSDKError("DeDust pool not ready for this pair", "OPERATION_FAILED");
  }
  const { pool } = poolResult;

  const fromDecimals = await getDecimals(isTonInput ? "ton" : fromAsset);
  const toDecimals = await getDecimals(isTonOutput ? "ton" : toAsset);
  const amountIn = toUnits(amount, fromDecimals);

  const { amountOut, tradeFee } = await pool.getEstimatedSwapOut({
    assetIn: fromAssetObj,
    amountIn,
  });
  const minAmountOut = amountOut - (amountOut * BigInt(Math.floor(slippage * 10000))) / 10000n;

  return withTxLock(async () => {
    const keyPair = await getKeyPair();
    if (!keyPair) {
      throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
    }

    const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = tonClient.open(wallet);
    const sender = walletContract.sender(keyPair.secretKey);

    if (isTonInput) {
      const tonVault = tonClient.open(await factory.getNativeVault());
      await tonVault.sendSwap(sender, {
        poolAddress: pool.address,
        amount: amountIn,
        limit: minAmountOut,
        gasAmount: toNano(DEDUST_GAS.SWAP_TON_TO_JETTON),
      });
    } else {
      const jettonAddress = Address.parse(fromAsset);
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
        if (stonfiOut >= dedustOut) {
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
