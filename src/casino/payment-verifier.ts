/**
 * Payment verification system for casino bets
 * Prevents replay attacks by tracking used transactions
 * Requires memo with user identifier for security
 */

import type Database from "better-sqlite3";
import { TonClient, fromNano } from "@ton/ton";
import { Address } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { withBlockchainRetry } from "./retry.js";
import { CASINO_CONFIG } from "./config.js";
import { PAYMENT_TOLERANCE_RATIO } from "../constants/limits.js";

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
 * Generate the expected memo format for a casino bet
 * Format: just the username (without @)
 */
export function generateExpectedMemo(username: string): string {
  return username.replace(/^@/, "");
}

/**
 * Check if a memo matches the user's username or telegram_id
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
  playerWallet?: string; // Wallet address discovered from TX sender
  date?: string;
  secondsAgo?: number;
  error?: string;
}

export interface VerifyPaymentParams {
  botWalletAddress: string;
  betAmount: number;
  requestTime: number;
  gameType: string;
  userId: string; // Telegram ID - must match memo in TX
}

/**
 * Verify that a TON payment was received from a player
 * with proper timestamp validation and replay attack prevention
 */
export async function verifyPayment(
  db: Database.Database,
  params: VerifyPaymentParams
): Promise<PaymentVerification> {
  try {
    const { botWalletAddress, betAmount, requestTime, gameType, userId } = params;

    // Get decentralized endpoint
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const client = new TonClient({ endpoint });

    // Parse bot address
    const botAddress = Address.parse(botWalletAddress);

    // Get recent transactions (last 20) with retry
    const transactions = await withBlockchainRetry(
      () => client.getTransactions(botAddress, { limit: 20 }),
      "getTransactions"
    );

    // Find matching transaction by MEMO (telegram_id)
    for (const tx of transactions) {
      const inMsg = tx.inMessage;

      // Check if this is an incoming internal message
      if (inMsg?.info.type !== "internal") continue;

      const tonAmount = parseFloat(fromNano(inMsg.info.value.coins));
      const fromRaw = inMsg.info.src;
      const txTime = tx.now * 1000; // Convert to milliseconds
      const txHash = tx.hash().toString("hex");

      // Check if amount matches (with small tolerance for fees)
      if (tonAmount < betAmount * PAYMENT_TOLERANCE_RATIO) continue;

      // Get sender address
      if (!fromRaw) continue;
      const playerWallet = fromRaw.toString({ bounceable: false });

      // CRITICAL: Check if transaction happened AFTER the minimum allowed time
      if (txTime < requestTime) continue;

      // Additional check: transaction should not be more than 10 minutes old from now
      const now = Date.now();
      if (txTime < now - CASINO_CONFIG.maxPaymentAgeMinutes * 60 * 1000) continue;

      // CRITICAL: Verify memo contains user's telegram_id
      // This is how we know which TX belongs to which user
      const comment = parseComment(inMsg.body);
      if (!verifyMemo(comment, userId)) continue;

      // Check if this transaction was already used
      // Use INSERT OR IGNORE to prevent race conditions - if TX already exists, insert silently fails
      const insertResult = db
        .prepare(
          `
        INSERT OR IGNORE INTO used_transactions (tx_hash, user_id, amount, game_type, used_at)
        VALUES (?, ?, ?, ?, unixepoch())
      `
        )
        .run(txHash, userId, tonAmount, gameType);

      // If changes === 0, the TX was already used (PRIMARY KEY conflict)
      if ((insertResult as any).changes === 0) {
        continue; // Skip this transaction, it was already used
      }

      const date = new Date(txTime).toISOString();
      const secondsAgo = Math.max(0, Math.floor((Date.now() - txTime) / 1000));

      return {
        verified: true,
        txHash,
        amount: `${tonAmount} TON`,
        playerWallet, // Return discovered wallet address
        date,
        secondsAgo,
      };
    }

    // No valid transaction found - provide helpful error
    return {
      verified: false,
      error: `Payment not found. Checklist:
1. Send exactly ${betAmount} TON (or more) to the casino wallet
2. Include memo: ${userId} (your username, no @)
3. Wait a few seconds for blockchain confirmation (~5-10s)
4. Payment must be within last 5 minutes

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
 * Clean up old used transactions (older than 30 days)
 */
export function cleanupOldTransactions(db: Database.Database): number {
  const thirtyDaysAgo =
    Math.floor(Date.now() / 1000) - CASINO_CONFIG.txRetentionDays * 24 * 60 * 60;

  const result = db.prepare("DELETE FROM used_transactions WHERE used_at < ?").run(thirtyDaysAgo);

  return result.changes;
}
