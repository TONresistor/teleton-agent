/**
 * Daily jackpot system for casino
 * Accumulates 5% house edge from each bet
 */

import type Database from "better-sqlite3";
import { CASINO_CONFIG } from "./config.js";

export interface JackpotInfo {
  amount: number;
  lastWinnerId: string | null;
  lastWonAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Get current jackpot amount and info
 */
export function getJackpot(db: Database.Database): JackpotInfo {
  const row = db.prepare("SELECT * FROM casino_jackpot WHERE id = 1").get() as JackpotInfo;

  return row;
}

/**
 * Add amount to the jackpot (from house edge)
 */
export function addToJackpot(db: Database.Database, amount: number): number {
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `
    UPDATE casino_jackpot
    SET amount = amount + ?,
        updated_at = ?
    WHERE id = 1
  `
  ).run(amount, now);

  const updated = getJackpot(db);
  return updated.amount;
}

/**
 * Award jackpot to a winner
 */
export function awardJackpot(
  db: Database.Database,
  winnerId: string
): { amount: number; winnerId: string } {
  const jackpot = getJackpot(db);
  const amount = jackpot.amount;
  const now = Math.floor(Date.now() / 1000);

  // Reset jackpot and record winner
  db.prepare(
    `
    UPDATE casino_jackpot
    SET amount = 0,
        last_winner_id = ?,
        last_won_at = ?,
        updated_at = ?
    WHERE id = 1
  `
  ).run(winnerId, now, now);

  return { amount, winnerId };
}

/**
 * Calculate house edge from a bet
 */
export function calculateHouseEdge(betAmount: number): number {
  return betAmount * (CASINO_CONFIG.houseEdgePercent / 100);
}

/**
 * Process a bet: extract house edge and add to jackpot
 * Returns the amount added to jackpot
 */
export function processBetForJackpot(db: Database.Database, betAmount: number): number {
  const houseEdge = calculateHouseEdge(betAmount);
  addToJackpot(db, houseEdge);
  return houseEdge;
}

/**
 * Get jackpot history (last 10 winners)
 * Note: This requires a separate history table if you want to track all winners
 * For now, we only track the last winner in casino_jackpot table
 */
export function getLastJackpotWinner(
  db: Database.Database
): { winnerId: string; amount: number; wonAt: number } | null {
  const jackpot = getJackpot(db);

  if (!jackpot.lastWinnerId || !jackpot.lastWonAt) {
    return null;
  }

  // We don't have the exact amount from history, but we can estimate from journal
  // This is a simplified version
  return {
    winnerId: jackpot.lastWinnerId,
    amount: 0, // Would need a history table to track this
    wonAt: jackpot.lastWonAt,
  };
}

/**
 * Check if user should win the daily jackpot
 * This is a simple implementation - you might want more sophisticated logic
 * For example: one random winner per day from all players
 */
export function shouldAwardDailyJackpot(db: Database.Database): boolean {
  const jackpot = getJackpot(db);

  // Award if jackpot is over a threshold (e.g., 100 TON)
  // and it's been at least 24 hours since last award
  const cooldownSeconds = CASINO_CONFIG.jackpotCooldownHours * 60 * 60;
  const now = Math.floor(Date.now() / 1000);

  if (jackpot.amount < CASINO_CONFIG.jackpotThreshold) {
    return false;
  }

  if (!jackpot.lastWonAt) {
    return true; // Never awarded before
  }

  const timeSinceLastWin = now - jackpot.lastWonAt;
  return timeSinceLastWin >= cooldownSeconds;
}
