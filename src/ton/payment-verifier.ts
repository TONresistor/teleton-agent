import type Database from "better-sqlite3";
import { fromNano } from "@ton/ton";
import { Address } from "@ton/core";
import { getCachedTonClient } from "./wallet-service.js";
import { withBlockchainRetry } from "../utils/retry.js";
import { PAYMENT_TOLERANCE_RATIO } from "../constants/limits.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("TON");

const DEFAULT_MAX_PAYMENT_AGE_MINUTES = 10;

const OP_COMMENT = 0x0;

function parseComment(body: any): string | null {
  if (!body) return null;
  try {
    const slice = body.beginParse();
    if (slice.remainingBits < 32) return null;

    const op = slice.loadUint(32);

    if (op === OP_COMMENT && slice.remainingBits > 0) {
      return slice.loadStringTail();
    }

    return null;
  } catch {
    return null;
  }
}

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
  maxPaymentAgeMinutes?: number;
}

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

    const client = await getCachedTonClient();
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

      if (insertResult.changes === 0) {
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
    log.error({ err: error }, "Error verifying payment");
    return {
      verified: false,
      error: getErrorMessage(error),
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
