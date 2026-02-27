import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import {
  loadWallet,
  getKeyPair,
  getCachedTonClient,
  invalidateTonClientCache,
} from "../../../ton/wallet-service.js";
import { WalletContractV5R1, toNano, fromNano } from "@ton/ton";
import { Address } from "@ton/core";
import { Factory, Asset, PoolType, ReadinessStatus, JettonRoot, VaultJetton } from "@dedust/sdk";
import { DEDUST_FACTORY_MAINNET, DEDUST_GAS, NATIVE_TON_ADDRESS } from "./constants.js";
import { getDecimals, toUnits, fromUnits } from "./asset-cache.js";
import { withTxLock } from "../../../ton/tx-lock.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

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
  context
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

    const tonClient = await getCachedTonClient();

    const factory = tonClient.open(
      Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET))
    );

    const fromAssetObj = isTonInput ? Asset.native() : Asset.jetton(Address.parse(fromAssetAddr));
    const toAssetObj = isTonOutput ? Asset.native() : Asset.jetton(Address.parse(toAssetAddr));

    const poolTypeEnum = pool_type === "stable" ? PoolType.STABLE : PoolType.VOLATILE;

    const pool = tonClient.open(await factory.getPool(poolTypeEnum, [fromAssetObj, toAssetObj]));

    const readinessStatus = await pool.getReadinessStatus();
    if (readinessStatus !== ReadinessStatus.READY) {
      return {
        success: false,
        error: `Pool not ready. Status: ${readinessStatus}. Try the other pool type (${pool_type === "volatile" ? "stable" : "volatile"}) or check if the pool exists.`,
      };
    }

    // Resolve correct decimals using normalized addresses (friendly format)
    const fromDecimals = await getDecimals(isTonInput ? "ton" : fromAssetAddr);
    const toDecimals = await getDecimals(isTonOutput ? "ton" : toAssetAddr);

    // Convert amount using correct decimals
    const amountIn = toUnits(amount, fromDecimals);

    const { amountOut, tradeFee } = await pool.getEstimatedSwapOut({
      assetIn: fromAssetObj,
      amountIn,
    });

    // Calculate minimum output with slippage
    const minAmountOut = amountOut - (amountOut * BigInt(Math.floor(slippage * 10000))) / 10000n;

    // Prepare wallet and sender — wrapped in tx lock to prevent seqno races
    // with concurrent StonFi or other DeDust swaps
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
      const sender = walletContract.sender(keyPair.secretKey);

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
          poolType: pool_type,
          poolAddress: pool.address.toString(),
          message: `Swapped ${amount} ${fromSymbol} for ~${expectedOutput.toFixed(4)} ${toSymbol} on DeDust\n  Minimum output: ${minOutput.toFixed(4)}\n  Slippage: ${(slippage * 100).toFixed(2)}%\n  Transaction sent (check balance in ~30 seconds)`,
        },
      };
    }); // withTxLock
  } catch (error: any) {
    const status = error?.status || error?.response?.status;
    if (status === 429 || status >= 500) {
      invalidateTonClientCache();
    }
    log.error({ err: error }, "Error in dedust_swap");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
