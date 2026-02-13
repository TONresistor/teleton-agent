/**
 * TON payment verification system.
 * Prevents replay attacks by tracking used transactions.
 * Requires memo with user identifier for security.
 *
 * Used by: deals system (built-in), SDK verifyPayment() for plugins.
 */

import type Database from "better-sqlite3";
import { TonClient, fromNano } from "@ton/ton";
import { Address } from "@ton/core";
import { getCachedHttpEndpoint } from "./endpoint.js";
import { withBlockchainRetry } from "../utils/retry.js";
import { PAYMENT_TOLERANCE_RATIO } from "../constants/limits.js";

/** Default max payment age in minutes */
const DEFAULT_MAX_PAYMENT_AGE_MINUTES = 10;

// Op code for simple text comment
const OP_COMMENT = 0x0;

/**
 * Parse comment from transaction body
 */
function parseComment(body: any): string | null {
  if (!body) return null;
  try {
    const slice = body.beginParse();
    if (slice.remainingBits < 32) return null;

    const op = slice.loadUint(32);

    // Simple comment (op = 0)
    if (op === OP_COMMENT && slice.remainingBits > 0) {
      return slice.loadStringTail();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a memo matches the expected identifier (case-insensitive, strips @)
 */
export function verifyMemo(memo: string | null, identifier: string): boolean {
  if (!memo) return false;
  const cleanMemo = memo.trim().toLowerCase().replace(/^@/, "");
  const cleanId = identifier.toLowerCase().replace(/^@/, "");
  return cleanMemo === cleanId;
}

export interface PaymentVerification {
  verified: boolean;
  txHash?: string;
  amount?: string;
  playerWallet?: string;
  date?: string;
  secondsAgo?: number;
  error?: string;
}

export interface VerifyPaymentParams {
  botWalletAddress: string;
  betAmount: number;
  requestTime: number;
  gameType: string;
  userId: string;
  /** Max age of valid payments in minutes (default: 10) */
  maxPaymentAgeMinutes?: number;
}

/**
 * Verify that a TON payment was received with proper timestamp
 * validation and replay attack prevention.
 *
 * Fetches transactions directly from blockchain via @ton/ton.
 */
export async function verifyPayment(
  db: Database.Database,
  params: VerifyPaymentParams
): Promise<PaymentVerification> {
  try {
    const {
      botWalletAddress,
      betAmount,
      requestTime,
      gameType,
      userId,
      maxPaymentAgeMinutes = DEFAULT_MAX_PAYMENT_AGE_MINUTES,
    } = params;

    const endpoint = await getCachedHttpEndpoint();
    const client = new TonClient({ endpoint });
    const botAddress = Address.parse(botWalletAddress);

    const transactions = await withBlockchainRetry(
      () => client.getTransactions(botAddress, { limit: 20 }),
      "getTransactions"
    );

    for (const tx of transactions) {
      const inMsg = tx.inMessage;
      if (inMsg?.info.type !== "internal") continue;

      const tonAmount = parseFloat(fromNano(inMsg.info.value.coins));
      const fromRaw = inMsg.info.src;
      const txTime = tx.now * 1000;
      const txHash = tx.hash().toString("hex");

      if (tonAmount < betAmount * PAYMENT_TOLERANCE_RATIO) continue;

      if (!fromRaw) continue;
      const playerWallet = fromRaw.toString({ bounceable: false });

      if (txTime < requestTime) continue;

      const now = Date.now();
      if (txTime < now - maxPaymentAgeMinutes * 60 * 1000) continue;

      const comment = parseComment(inMsg.body);
      if (!verifyMemo(comment, userId)) continue;

      const insertResult = db
        .prepare(
          `INSERT OR IGNORE INTO used_transactions (tx_hash, user_id, amount, game_type, used_at)
           VALUES (?, ?, ?, ?, unixepoch())`
        )
        .run(txHash, userId, tonAmount, gameType);

      if ((insertResult as any).changes === 0) {
        continue;
      }

      const date = new Date(txTime).toISOString();
      const secondsAgo = Math.max(0, Math.floor((Date.now() - txTime) / 1000));

      return {
        verified: true,
        txHash,
        amount: `${tonAmount} TON`,
        playerWallet,
        date,
        secondsAgo,
      };
    }

    return {
      verified: false,
      error: `Payment not found. Checklist:
1. Send exactly ${betAmount} TON (or more) to the wallet
2. Include memo: ${userId}
3. Wait a few seconds for blockchain confirmation (~5-10s)
4. Payment must be within last ${maxPaymentAgeMinutes} minutes

If you already sent, wait a moment and try again.`,
    };
  } catch (error) {
    console.error("Error verifying payment:", error);
    return {
      verified: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a transaction hash was already used
 */
export function isTransactionUsed(db: Database.Database, txHash: string): boolean {
  const result = db.prepare("SELECT tx_hash FROM used_transactions WHERE tx_hash = ?").get(txHash);
  return !!result;
}

/**
 * Clean up old used transactions
 */
export function cleanupOldTransactions(db: Database.Database, retentionDays: number = 30): number {
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 24 * 60 * 60;
  const result = db.prepare("DELETE FROM used_transactions WHERE used_at < ?").run(cutoff);
  return result.changes;
}
