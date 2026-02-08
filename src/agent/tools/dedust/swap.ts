import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, fromNano } from "@ton/ton";
import { Address } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { Factory, Asset, PoolType, ReadinessStatus, JettonRoot, VaultJetton } from "@dedust/sdk";
import { DEDUST_FACTORY_MAINNET, DEDUST_GAS, NATIVE_TON_ADDRESS } from "./constants.js";

/**
 * Parameters for dedust_swap tool
 */
interface DedustSwapParams {
  from_asset: string;
  to_asset: string;
  amount: number;
  pool_type?: "volatile" | "stable";
  slippage?: number;
}

/**
 * Tool definition for dedust_swap
 */
export const dedustSwapTool: Tool = {
  name: "dedust_swap",
  description:
    "Execute a token swap on DeDust DEX. Supports TON->Jetton and Jetton->TON/Jetton swaps. Use 'ton' as from_asset or to_asset for TON. Pool types: 'volatile' (default) or 'stable' (for stablecoins like USDT/USDC). Use dedust_quote first to preview the swap.",
  parameters: Type.Object({
    from_asset: Type.String({
      description: "Source asset: 'ton' for TON, or jetton master address (EQ... format)",
    }),
    to_asset: Type.String({
      description: "Destination asset: 'ton' for TON, or jetton master address (EQ... format)",
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

/**
 * Executor for dedust_swap tool
 */
export const dedustSwapExecutor: ToolExecutor<DedustSwapParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { from_asset, to_asset, amount, pool_type = "volatile", slippage = 0.01 } = params;

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Normalize asset addresses
    const isTonInput = from_asset.toLowerCase() === "ton";
    const isTonOutput = to_asset.toLowerCase() === "ton";

    // Convert addresses to friendly format if needed
    let fromAssetAddr = from_asset;
    let toAssetAddr = to_asset;

    if (!isTonInput) {
      try {
        // Parse and convert to friendly format (handles both raw 0:... and friendly EQ... formats)
        fromAssetAddr = Address.parse(from_asset).toString();
      } catch (error) {
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
      } catch (error) {
        return {
          success: false,
          error: `Invalid to_asset address: ${to_asset}`,
        };
      }
    }

    // Initialize TON client
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const tonClient = new TonClient({ endpoint });

    // Open factory contract
    const factory = tonClient.open(
      Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET))
    );

    // Build assets (use normalized addresses)
    const fromAssetObj = isTonInput ? Asset.native() : Asset.jetton(Address.parse(fromAssetAddr));
    const toAssetObj = isTonOutput ? Asset.native() : Asset.jetton(Address.parse(toAssetAddr));

    // Get pool type
    const poolTypeEnum = pool_type === "stable" ? PoolType.STABLE : PoolType.VOLATILE;

    // Get pool
    const pool = tonClient.open(await factory.getPool(poolTypeEnum, [fromAssetObj, toAssetObj]));

    // Check pool readiness
    const readinessStatus = await pool.getReadinessStatus();
    if (readinessStatus !== ReadinessStatus.READY) {
      return {
        success: false,
        error: `Pool not ready. Status: ${readinessStatus}. Try the other pool type (${pool_type === "volatile" ? "stable" : "volatile"}) or check if the pool exists.`,
      };
    }

    // Convert amount to nano units
    const amountIn = toNano(amount);

    // Get estimated output
    const { amountOut, tradeFee } = await pool.getEstimatedSwapOut({
      assetIn: fromAssetObj,
      amountIn,
    });

    // Calculate minimum output with slippage
    const minAmountOut = amountOut - (amountOut * BigInt(Math.floor(slippage * 10000))) / 10000n;

    // Prepare wallet and sender
    const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });
    const walletContract = tonClient.open(wallet);
    const sender = walletContract.sender(keyPair.secretKey);

    if (isTonInput) {
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
      await tonVault.sendSwap(sender, {
        poolAddress: pool.address,
        amount: amountIn,
        limit: minAmountOut,
        gasAmount: toNano(DEDUST_GAS.SWAP_TON_TO_JETTON),
      });
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

      // Get user's jetton wallet
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
      await jettonWallet.sendTransfer(sender, toNano(DEDUST_GAS.SWAP_JETTON_TO_ANY), {
        destination: jettonVault.address,
        amount: amountIn,
        responseAddress: Address.parse(walletData.address),
        forwardAmount: toNano(DEDUST_GAS.FORWARD_GAS),
        forwardPayload: swapPayload,
      });
    }

    // Calculate expected output for display
    const expectedOutput = Number(fromNano(amountOut));
    const minOutput = Number(fromNano(minAmountOut));
    const feeAmount = Number(fromNano(tradeFee));

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
        poolType: pool_type,
        poolAddress: pool.address.toString(),
        message: `Swapped ${amount} ${fromSymbol} for ~${expectedOutput.toFixed(4)} ${toSymbol} on DeDust\n  Minimum output: ${minOutput.toFixed(4)}\n  Slippage: ${(slippage * 100).toFixed(2)}%\n  Transaction sent (check balance in ~30 seconds)`,
      },
    };
  } catch (error) {
    console.error("Error in dedust_swap:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
