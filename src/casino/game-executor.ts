/**
 * Shared game execution logic for Teleton Casino
 * Reduces code duplication between spin and dice tools
 */

import type Database from "better-sqlite3";
import { verifyPayment } from "./payment-verifier.js";
import { checkCooldown, updateCooldown } from "./cooldown-manager.js";
import { processBetForJackpot, getJackpot, type JackpotInfo } from "./jackpot-manager.js";
import { sendPayout, getWinMessage } from "./payout-sender.js";
import { checkRateLimit } from "./rate-limiter.js";
import { getWalletAddress, getWalletBalance } from "../ton/wallet-service.js";
import { CASINO_CONFIG } from "./config.js";

export type GameType = "slot" | "dice";

export interface GameParams {
  userId: string; // Telegram user ID (senderId)
  username: string; // Telegram username for memo
  betAmount: number;
  chatId: string;
  gameType: GameType;
}

export interface GameValidationResult {
  valid: boolean;
  error?: string;
  casinoWallet?: string;
  balance?: number;
  maxBet?: number;
}

export interface GameResult {
  success: boolean;
  error?: string;
  data?: {
    gameValue: number;
    won: boolean;
    multiplier: number;
    payoutAmount: string;
    payoutSent: boolean;
    payoutTxHash?: string;
    betAmount: string;
    playerUsername: string;
    playerWallet: string;
    houseEdge: string;
    currentJackpot: string;
    paymentTxHash: string;
    journalId: number;
    interpretation: string;
  };
}

/**
 * Validate username
 */
export function validateUsername(username: string | undefined): { valid: boolean; error?: string } {
  const clean = username?.replace(/^@/, "").toLowerCase().trim();
  if (!clean || clean.length === 0) {
    return {
      valid: false,
      error:
        "❌ You need a Telegram @username to play at Teleton Casino. Set up your username in Telegram settings and try again!",
    };
  }
  return { valid: true };
}

/**
 * Validate bet amount
 */
export function validateBetAmount(
  amount: number,
  balance: number,
  maxMultiplier: number
): { valid: boolean; error?: string; maxBet?: number } {
  const { minBet, maxBetPercent, minBankroll } = CASINO_CONFIG;

  if (balance < minBankroll) {
    return {
      valid: false,
      error: "🚨 Teleton Casino is temporarily closed (insufficient bankroll).",
    };
  }

  // Max bet is limited by two factors:
  // 1. Percentage of bankroll
  // 2. Must be able to cover maximum payout
  const maxBetByPercent = balance * (maxBetPercent / 100);
  const maxBetByCoverage = balance / maxMultiplier;
  const maxBet = Math.min(maxBetByPercent, maxBetByCoverage);

  if (amount > maxBet) {
    return {
      valid: false,
      error: `❌ Bet too high. Maximum bet: ${maxBet.toFixed(2)} TON (current casino balance: ${balance.toFixed(2)} TON)`,
      maxBet,
    };
  }

  if (amount < minBet) {
    return {
      valid: false,
      error: `❌ Minimum bet is ${minBet} TON`,
    };
  }

  return { valid: true, maxBet };
}

/**
 * Pre-game validation (rate limit, cooldown, wallet, balance, bet limits)
 */
export async function validateGame(params: GameParams): Promise<GameValidationResult> {
  const { userId, username, betAmount, gameType } = params;

  // Validate username
  const usernameCheck = validateUsername(username);
  if (!usernameCheck.valid) {
    return { valid: false, error: usernameCheck.error };
  }

  // Check rate limit
  const rateCheck = checkRateLimit(userId, `casino_${gameType}`);
  if (!rateCheck.allowed) {
    return { valid: false, error: rateCheck.message };
  }

  // Get casino wallet
  const casinoWallet = getWalletAddress();
  if (!casinoWallet) {
    return { valid: false, error: "Casino wallet not initialized." };
  }

  // Check casino balance
  const balanceInfo = await getWalletBalance(casinoWallet);
  if (!balanceInfo) {
    return { valid: false, error: "Failed to check casino balance." };
  }

  const balance = parseFloat(balanceInfo.balance);

  // Determine max multiplier based on game type
  const maxMultiplier = gameType === "slot" ? 5 : 2.5;

  // Validate bet amount
  const betCheck = validateBetAmount(betAmount, balance, maxMultiplier);
  if (!betCheck.valid) {
    return { valid: false, error: betCheck.error };
  }

  return {
    valid: true,
    casinoWallet,
    balance,
    maxBet: betCheck.maxBet,
  };
}

/**
 * Process payment verification
 */
export async function processPayment(
  db: Database.Database,
  params: {
    casinoWallet: string;
    betAmount: number;
    username: string;
    gameType: GameType;
  }
): Promise<{ verified: boolean; error?: string; playerWallet?: string; txHash?: string }> {
  const requestTime = Date.now();

  const paymentVerification = await verifyPayment(db, {
    botWalletAddress: params.casinoWallet,
    betAmount: params.betAmount,
    requestTime: requestTime - 5 * 60 * 1000, // Allow up to 5 minutes before request
    gameType: params.gameType,
    userId: params.username,
  });

  if (!paymentVerification.verified || !paymentVerification.playerWallet) {
    return {
      verified: false,
      error: paymentVerification.error,
    };
  }

  return {
    verified: true,
    playerWallet: paymentVerification.playerWallet,
    txHash: paymentVerification.txHash,
  };
}

/**
 * Check and update cooldown
 */
export function handleCooldown(
  db: Database.Database,
  userId: string
): { allowed: boolean; error?: string } {
  const cooldownCheck = checkCooldown(db, userId);
  if (!cooldownCheck.allowed) {
    return {
      allowed: false,
      error: cooldownCheck.message || "Please wait before playing again.",
    };
  }
  return { allowed: true };
}

/**
 * Update cooldown after successful game
 */
export function setCooldown(db: Database.Database, userId: string): void {
  updateCooldown(db, userId);
}

/**
 * Process house edge and get jackpot info
 */
export function processHouseEdge(
  db: Database.Database,
  betAmount: number
): { houseEdge: number; jackpot: JackpotInfo } {
  const houseEdge = processBetForJackpot(db, betAmount);
  const jackpot = getJackpot(db);
  return { houseEdge, jackpot };
}

/**
 * Update or create casino user
 */
export function upsertCasinoUser(
  db: Database.Database,
  params: {
    oddsId: string;
    playerWallet: string;
    betAmount: number;
  }
): void {
  db.prepare(
    `
    INSERT INTO casino_users (telegram_id, wallet_address, total_bets, total_wagered, last_bet_at)
    VALUES (?, ?, 1, ?, unixepoch())
    ON CONFLICT(telegram_id) DO UPDATE SET
      wallet_address = excluded.wallet_address,
      total_bets = total_bets + 1,
      total_wagered = total_wagered + ?,
      last_bet_at = unixepoch()
  `
  ).run(params.oddsId, params.playerWallet, params.betAmount, params.betAmount);
}

/**
 * Create journal entry
 */
export function createJournalEntry(
  db: Database.Database,
  params: {
    gameType: GameType;
    betAmount: number;
    gameValue: number;
    txHash: string;
    chatId: string;
    userId: string;
  }
): number {
  const result = db
    .prepare(
      `
    INSERT INTO journal (
      type, action, asset_from, asset_to, amount_from,
      platform, reasoning, outcome, tx_hash, tool_used,
      chat_id, user_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  `
    )
    .run(
      "trade",
      `casino_${params.gameType}`,
      "TON",
      params.gameType.toUpperCase(),
      params.betAmount,
      "telegram_casino",
      `${params.gameType === "slot" ? "Slot" : "Dice"} result: ${params.gameValue}/${params.gameType === "slot" ? 64 : 6}`,
      "pending",
      params.txHash,
      `casino_${params.gameType}`,
      params.chatId,
      params.userId
    );

  return (result as any).lastInsertRowid as number;
}

/**
 * Process win/loss and send payout
 */
export async function processWinLoss(
  db: Database.Database,
  params: {
    won: boolean;
    multiplier: number;
    betAmount: number;
    playerWallet: string;
    journalId: number;
    oddsId: string;
  }
): Promise<{ payoutSent: boolean; payoutTxHash?: string; payoutAmount: number }> {
  const payoutAmount = params.won ? params.betAmount * params.multiplier : 0;

  if (params.won && payoutAmount > 0) {
    const winMessage = getWinMessage(params.multiplier, payoutAmount);
    const payoutResult = await sendPayout(params.playerWallet, payoutAmount, winMessage);

    if (payoutResult.success) {
      // Update journal - casino lost
      db.prepare(
        `
        UPDATE journal SET outcome = 'loss', amount_to = ?, pnl_ton = ?, closed_at = unixepoch()
        WHERE id = ?
      `
      ).run(payoutAmount, -(payoutAmount - params.betAmount), params.journalId);

      // Update player win stats
      db.prepare(
        `
        UPDATE casino_users SET total_wins = total_wins + 1, total_won = total_won + ?
        WHERE telegram_id = ?
      `
      ).run(payoutAmount, params.oddsId);

      return {
        payoutSent: true,
        payoutTxHash: payoutResult.txHash,
        payoutAmount,
      };
    }
  }

  // Player lost or payout failed
  if (!params.won) {
    db.prepare(
      `
      UPDATE journal SET outcome = 'profit', amount_to = 0, pnl_ton = ?, closed_at = unixepoch()
      WHERE id = ?
    `
    ).run(params.betAmount, params.journalId);

    db.prepare(
      `
      UPDATE casino_users SET total_losses = total_losses + 1
      WHERE telegram_id = ?
    `
    ).run(params.oddsId);
  }

  return {
    payoutSent: false,
    payoutAmount,
  };
}
