/**
 * TonSDK implementation — wraps internal TON services for plugin access.
 */

import type Database from "better-sqlite3";
import type {
  TonSDK,
  TonBalance,
  TonPrice,
  TonSendResult,
  TonTransaction,
  SDKVerifyPaymentParams,
  SDKPaymentVerification,
  PluginLogger,
} from "./types.js";
import { PluginSDKError } from "./errors.js";
import { getWalletAddress, getWalletBalance, getTonPrice } from "../ton/wallet-service.js";
import { sendTon } from "../ton/transfer.js";
import { PAYMENT_TOLERANCE_RATIO } from "../constants/limits.js";

/** Default max payment age in minutes */
const DEFAULT_MAX_AGE_MINUTES = 10;

export function createTonSDK(log: PluginLogger, db: Database.Database | null): TonSDK {
  return {
    getAddress(): string | null {
      try {
        return getWalletAddress();
      } catch (err) {
        log.error("ton.getAddress() failed:", err);
        return null;
      }
    },

    async getBalance(address?: string): Promise<TonBalance | null> {
      try {
        const addr = address ?? getWalletAddress();
        if (!addr) return null;
        return await getWalletBalance(addr);
      } catch (err) {
        log.error("ton.getBalance() failed:", err);
        return null;
      }
    },

    async getPrice(): Promise<TonPrice | null> {
      try {
        return await getTonPrice();
      } catch (err) {
        log.error("ton.getPrice() failed:", err);
        return null;
      }
    },

    async sendTON(to: string, amount: number, comment?: string): Promise<TonSendResult> {
      const walletAddr = getWalletAddress();
      if (!walletAddr) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      // Validate amount
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PluginSDKError("Amount must be a positive number", "OPERATION_FAILED");
      }

      // Validate address format before attempting transfer
      try {
        const { Address } = await import("@ton/core");
        Address.parse(to);
      } catch {
        throw new PluginSDKError("Invalid TON address format", "INVALID_ADDRESS");
      }

      try {
        const txRef = await sendTon({
          toAddress: to,
          amount,
          comment,
          bounce: false,
        });

        if (!txRef) {
          throw new PluginSDKError(
            "Transaction failed — no reference returned",
            "OPERATION_FAILED"
          );
        }

        return { txRef, amount };
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send TON: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getTransactions(address: string, limit?: number): Promise<TonTransaction[]> {
      try {
        const { TonClient } = await import("@ton/ton");
        const { Address } = await import("@ton/core");
        const { getCachedHttpEndpoint } = await import("../ton/endpoint.js");
        const { formatTransactions } = await import("../ton/format-transactions.js");

        const addressObj = Address.parse(address);
        const endpoint = await getCachedHttpEndpoint();
        const client = new TonClient({ endpoint });

        const transactions = await client.getTransactions(addressObj, {
          limit: Math.min(limit ?? 10, 50),
        });

        return formatTransactions(transactions);
      } catch (err) {
        log.error("ton.getTransactions() failed:", err);
        return [];
      }
    },

    async verifyPayment(params: SDKVerifyPaymentParams): Promise<SDKPaymentVerification> {
      if (!db) {
        throw new PluginSDKError(
          "No database available — verifyPayment requires migrate() with used_transactions table",
          "OPERATION_FAILED"
        );
      }

      const address = getWalletAddress();
      if (!address) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      const maxAgeMinutes = params.maxAgeMinutes ?? DEFAULT_MAX_AGE_MINUTES;

      try {
        const txs = await this.getTransactions(address, 20);

        for (const tx of txs) {
          if (tx.type !== "ton_received") continue;
          if (!tx.amount || !tx.from) continue;

          // Parse amount: "1.5 TON" → 1.5
          const tonAmount = parseFloat(tx.amount.replace(/ TON$/, ""));
          if (isNaN(tonAmount)) continue;

          // Amount match (1% tolerance)
          if (tonAmount < params.amount * PAYMENT_TOLERANCE_RATIO) continue;

          // Time window
          if (tx.secondsAgo > maxAgeMinutes * 60) continue;

          // Memo match (case-insensitive, strip @)
          const memo = (tx.comment ?? "").trim().toLowerCase().replace(/^@/, "");
          const expected = params.memo.toLowerCase().replace(/^@/, "");
          if (memo !== expected) continue;

          // Replay protection: composite key
          const compositeKey = `${tx.from}:${tx.amount}:${tx.date}`;
          const result = db
            .prepare(
              `INSERT OR IGNORE INTO used_transactions (tx_hash, user_id, amount, game_type, used_at)
               VALUES (?, ?, ?, ?, unixepoch())`
            )
            .run(compositeKey, params.memo, tonAmount, params.gameType);

          if (result.changes === 0) continue; // Already used

          return {
            verified: true,
            compositeKey,
            amount: tonAmount,
            playerWallet: tx.from,
            date: tx.date,
            secondsAgo: tx.secondsAgo,
          };
        }

        return {
          verified: false,
          error: `Payment not found. Send ${params.amount} TON to ${address} with memo: ${params.memo}`,
        };
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("ton.verifyPayment() failed:", err);
        return {
          verified: false,
          error: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
