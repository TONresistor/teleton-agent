import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, fromNano } from "@ton/ton";
import { Address, SendMode, internal } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { StonApiClient } from "@ston-fi/api";
import { DEX, pTON } from "@ston-fi/sdk";
import { Factory, Asset, PoolType, ReadinessStatus, JettonRoot, VaultJetton } from "@dedust/sdk";
import { DEDUST_FACTORY_MAINNET, DEDUST_GAS, NATIVE_TON_ADDRESS } from "../dedust/constants.js";

/**
 * Parameters for dex_swap tool
 */
interface DexSwapParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  slippage?: number;
  preferred_dex?: "stonfi" | "dedust" | "auto";
}

/**
 * Quote result for comparison
 */
interface QuoteResult {
  dex: string;
  expectedOutput: number;
  available: boolean;
  error?: string;
}

/**
 * Tool definition for dex_swap
 */
export const dexSwapTool: Tool = {
  name: "dex_swap",
  description:
    "Smart router that executes swap on the best DEX (STON.fi or DeDust). Automatically compares prices and routes to the DEX with better output. Use preferred_dex to force a specific DEX. Use 'ton' for TON or jetton master address.",
  parameters: Type.Object({
    from_asset: Type.String({
      description: "Source asset: 'ton' for TON, or jetton master address (EQ... format)",
    }),
    to_asset: Type.String({
      description: "Destination asset: 'ton' for TON, or jetton master address (EQ... format)",
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
    preferred_dex: Type.Optional(
      Type.Union([Type.Literal("stonfi"), Type.Literal("dedust"), Type.Literal("auto")], {
        description: "Preferred DEX: 'auto' (default, best price), 'stonfi', or 'dedust'",
      })
    ),
  }),
};

/**
 * Get quote from STON.fi
 */
async function getStonfiQuote(
  fromAsset: string,
  toAsset: string,
  amount: number,
  slippage: number
): Promise<QuoteResult & { simulationResult?: any }> {
  try {
    const isTonInput = fromAsset.toLowerCase() === "ton";
    const isTonOutput = toAsset.toLowerCase() === "ton";
    const fromAddress = isTonInput ? NATIVE_TON_ADDRESS : fromAsset;
    const toAddress = isTonOutput ? NATIVE_TON_ADDRESS : toAsset;

    const stonApiClient = new StonApiClient();

    const simulationResult = await stonApiClient.simulateSwap({
      offerAddress: fromAddress,
      askAddress: toAddress,
      offerUnits: toNano(amount).toString(),
      slippageTolerance: slippage.toString(),
    });

    if (!simulationResult) {
      return { dex: "STON.fi", expectedOutput: 0, available: false, error: "No liquidity" };
    }

    const expectedOutput = Number(fromNano(BigInt(simulationResult.askUnits)));

    return {
      dex: "STON.fi",
      expectedOutput,
      available: true,
      simulationResult,
    };
  } catch (error) {
    return {
      dex: "STON.fi",
      expectedOutput: 0,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get quote from DeDust
 */
async function getDedustQuote(
  fromAsset: string,
  toAsset: string,
  amount: number,
  slippage: number,
  tonClient: TonClient
): Promise<
  QuoteResult & {
    pool?: any;
    poolType?: string;
    amountOut?: bigint;
    minAmountOut?: bigint;
    tradeFee?: bigint;
  }
> {
  try {
    const isTonInput = fromAsset.toLowerCase() === "ton";
    const isTonOutput = toAsset.toLowerCase() === "ton";

    const factory = tonClient.open(
      Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET))
    );

    const fromAssetObj = isTonInput ? Asset.native() : Asset.jetton(Address.parse(fromAsset));
    const toAssetObj = isTonOutput ? Asset.native() : Asset.jetton(Address.parse(toAsset));

    let pool;
    let poolType = "volatile";

    try {
      pool = tonClient.open(await factory.getPool(PoolType.VOLATILE, [fromAssetObj, toAssetObj]));
      const status = await pool.getReadinessStatus();
      if (status !== ReadinessStatus.READY) {
        pool = tonClient.open(await factory.getPool(PoolType.STABLE, [fromAssetObj, toAssetObj]));
        const stableStatus = await pool.getReadinessStatus();
        if (stableStatus !== ReadinessStatus.READY) {
          return { dex: "DeDust", expectedOutput: 0, available: false, error: "No pool" };
        }
        poolType = "stable";
      }
    } catch {
      return { dex: "DeDust", expectedOutput: 0, available: false, error: "Pool lookup failed" };
    }

    const amountIn = toNano(amount);
    const { amountOut, tradeFee } = await pool.getEstimatedSwapOut({
      assetIn: fromAssetObj,
      amountIn,
    });

    const minAmountOut = amountOut - (amountOut * BigInt(Math.floor(slippage * 10000))) / 10000n;
    const expectedOutput = Number(fromNano(amountOut));

    return {
      dex: "DeDust",
      expectedOutput,
      available: true,
      pool,
      poolType,
      amountOut,
      minAmountOut,
      tradeFee,
    };
  } catch (error) {
    return {
      dex: "DeDust",
      expectedOutput: 0,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute swap on STON.fi
 */
async function executeStonfiSwap(
  fromAsset: string,
  toAsset: string,
  amount: number,
  slippage: number,
  simulationResult: any,
  walletData: any,
  tonClient: TonClient
): Promise<{ success: boolean; expectedOutput: number; minOutput: number; error?: string }> {
  const isTonInput = fromAsset.toLowerCase() === "ton";
  const isTonOutput = toAsset.toLowerCase() === "ton";
  const toAddress = isTonOutput ? NATIVE_TON_ADDRESS : toAsset;

  const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const walletContract = tonClient.open(wallet);
  const seqno = await walletContract.getSeqno();

  const { router: routerInfo } = simulationResult;
  const router = tonClient.open(new DEX.v1.Router(routerInfo.address));

  let txParams;

  if (isTonInput) {
    const proxyTon = new pTON.v1(routerInfo.ptonMasterAddress);

    txParams = await router.getSwapTonToJettonTxParams({
      userWalletAddress: walletData.address,
      proxyTon,
      askJettonAddress: toAddress,
      offerAmount: BigInt(simulationResult.offerUnits),
      minAskAmount: BigInt(simulationResult.minAskUnits),
    });
  } else {
    txParams = await router.getSwapJettonToJettonTxParams({
      userWalletAddress: walletData.address,
      offerJettonAddress: fromAsset,
      askJettonAddress: toAddress,
      offerAmount: BigInt(simulationResult.offerUnits),
      minAskAmount: BigInt(simulationResult.minAskUnits),
    });
  }

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

  const expectedOutput = Number(fromNano(BigInt(simulationResult.askUnits)));
  const minOutput = Number(fromNano(BigInt(simulationResult.minAskUnits)));

  return { success: true, expectedOutput, minOutput };
}

/**
 * Execute swap on DeDust
 */
async function executeDedustSwap(
  fromAsset: string,
  toAsset: string,
  amount: number,
  pool: any,
  minAmountOut: bigint,
  amountOut: bigint,
  walletData: any,
  tonClient: TonClient
): Promise<{ success: boolean; expectedOutput: number; minOutput: number; error?: string }> {
  const isTonInput = fromAsset.toLowerCase() === "ton";

  const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const walletContract = tonClient.open(wallet);
  const sender = walletContract.sender(keyPair.secretKey);

  const factory = tonClient.open(Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET)));

  const amountIn = toNano(amount);

  if (isTonInput) {
    const tonVault = tonClient.open(await factory.getNativeVault());

    // Use SDK's sendSwap method
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

    // Use SDK's sendTransfer method
    await jettonWallet.sendTransfer(sender, toNano(DEDUST_GAS.SWAP_JETTON_TO_ANY), {
      destination: jettonVault.address,
      amount: amountIn,
      responseAddress: Address.parse(walletData.address),
      forwardAmount: toNano(DEDUST_GAS.FORWARD_GAS),
      forwardPayload: swapPayload,
    });
  }

  const expectedOutput = Number(fromNano(amountOut));
  const minOutput = Number(fromNano(minAmountOut));

  return { success: true, expectedOutput, minOutput };
}

/**
 * Executor for dex_swap tool
 */
export const dexSwapExecutor: ToolExecutor<DexSwapParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, slippage = 0.01, preferred_dex = "auto" } = params;

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Validate addresses
    const isTonInput = from_asset.toLowerCase() === "ton";
    const isTonOutput = to_asset.toLowerCase() === "ton";

    if (!isTonInput && !from_asset.match(/^[EUe][Qq][A-Za-z0-9_-]{46}$/)) {
      return { success: false, error: `Invalid from_asset address: ${from_asset}` };
    }
    if (!isTonOutput && !to_asset.match(/^[EUe][Qq][A-Za-z0-9_-]{46}$/)) {
      return { success: false, error: `Invalid to_asset address: ${to_asset}` };
    }

    // Initialize TON client
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const tonClient = new TonClient({ endpoint });

    // Get quotes based on preference (parallel fetch in auto mode)
    let stonfiQuote: Awaited<ReturnType<typeof getStonfiQuote>> | null = null;
    let dedustQuote: Awaited<ReturnType<typeof getDedustQuote>> | null = null;

    if (preferred_dex === "auto") {
      // Fetch both quotes in parallel for best performance
      [stonfiQuote, dedustQuote] = await Promise.all([
        getStonfiQuote(from_asset, to_asset, amount, slippage),
        getDedustQuote(from_asset, to_asset, amount, slippage, tonClient),
      ]);
    } else if (preferred_dex === "stonfi") {
      stonfiQuote = await getStonfiQuote(from_asset, to_asset, amount, slippage);
    } else if (preferred_dex === "dedust") {
      dedustQuote = await getDedustQuote(from_asset, to_asset, amount, slippage, tonClient);
    }

    // Determine which DEX to use
    let selectedDex: "stonfi" | "dedust";
    let savings = 0;

    if (preferred_dex === "stonfi") {
      if (!stonfiQuote?.available) {
        return { success: false, error: `STON.fi unavailable: ${stonfiQuote?.error}` };
      }
      selectedDex = "stonfi";
    } else if (preferred_dex === "dedust") {
      if (!dedustQuote?.available) {
        return { success: false, error: `DeDust unavailable: ${dedustQuote?.error}` };
      }
      selectedDex = "dedust";
    } else {
      // Auto mode - choose best
      const stonfiAvailable = stonfiQuote?.available;
      const dedustAvailable = dedustQuote?.available;

      if (!stonfiAvailable && !dedustAvailable) {
        return {
          success: false,
          error: `No DEX has liquidity. STON.fi: ${stonfiQuote?.error}, DeDust: ${dedustQuote?.error}`,
        };
      }

      if (!stonfiAvailable) {
        selectedDex = "dedust";
      } else if (!dedustAvailable) {
        selectedDex = "stonfi";
      } else {
        // Both available - compare outputs
        if (stonfiQuote!.expectedOutput >= dedustQuote!.expectedOutput) {
          selectedDex = "stonfi";
          savings = stonfiQuote!.expectedOutput - dedustQuote!.expectedOutput;
        } else {
          selectedDex = "dedust";
          savings = dedustQuote!.expectedOutput - stonfiQuote!.expectedOutput;
        }
      }
    }

    // Execute swap on selected DEX
    let result: { success: boolean; expectedOutput: number; minOutput: number; error?: string };

    if (selectedDex === "stonfi") {
      result = await executeStonfiSwap(
        from_asset,
        to_asset,
        amount,
        slippage,
        stonfiQuote!.simulationResult,
        walletData,
        tonClient
      );
    } else {
      result = await executeDedustSwap(
        from_asset,
        to_asset,
        amount,
        dedustQuote!.pool,
        dedustQuote!.minAmountOut!,
        dedustQuote!.amountOut!,
        walletData,
        tonClient
      );
    }

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const fromSymbol = isTonInput ? "TON" : "Token";
    const toSymbol = isTonOutput ? "TON" : "Token";

    // Build response
    let message = `Swapped ${amount} ${fromSymbol} for ~${result.expectedOutput.toFixed(4)} ${toSymbol} on ${selectedDex === "stonfi" ? "STON.fi" : "DeDust"}\n`;
    message += `  Minimum output: ${result.minOutput.toFixed(4)}\n`;
    message += `  Slippage: ${(slippage * 100).toFixed(2)}%\n`;

    if (savings > 0 && preferred_dex === "auto") {
      const otherDex = selectedDex === "stonfi" ? "DeDust" : "STON.fi";
      message += `  Savings vs ${otherDex}: +${savings.toFixed(4)} ${toSymbol}\n`;
    }

    message += `  Transaction sent (check balance in ~30 seconds)`;

    return {
      success: true,
      data: {
        dex: selectedDex === "stonfi" ? "STON.fi" : "DeDust",
        from: isTonInput ? NATIVE_TON_ADDRESS : from_asset,
        to: isTonOutput ? NATIVE_TON_ADDRESS : to_asset,
        amountIn: amount.toString(),
        expectedOutput: result.expectedOutput.toFixed(6),
        minOutput: result.minOutput.toFixed(6),
        slippage: `${(slippage * 100).toFixed(2)}%`,
        savings: savings > 0 ? savings.toFixed(6) : "0",
        message,
      },
    };
  } catch (error) {
    console.error("Error in dex_swap:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
