/**
 * Cooldown manager for casino games
 * Prevents spam by enforcing time delays between spins
 */

import type Database from "better-sqlite3";
import { CASINO_CONFIG } from "./config.js";

export interface CooldownCheck {
  allowed: boolean;
  remainingSeconds?: number;
  message?: string;
}

/**
 * Check if a user is allowed to spin (cooldown passed)
 */
export function checkCooldown(db: Database.Database, userId: string): CooldownCheck {
  const now = Math.floor(Date.now() / 1000);

  // Get last spin time
  const row = db
    .prepare("SELECT last_spin_at FROM casino_cooldowns WHERE user_id = ?")
    .get(userId) as { last_spin_at: number } | undefined;

  if (!row) {
    // First spin, no cooldown
    return { allowed: true };
  }

  const elapsed = now - row.last_spin_at;
  const remaining = CASINO_CONFIG.cooldownSeconds - elapsed;

  if (remaining > 0) {
    return {
      allowed: false,
      remainingSeconds: remaining,
      message: `⏳ Please wait ${remaining} seconds before spinning again`,
    };
  }

  return { allowed: true };
}

/**
 * Atomic check-and-update cooldown (prevents race conditions).
 * Returns allowed=true and sets cooldown in a single transaction.
 */
export function checkAndUpdateCooldown(db: Database.Database, userId: string): CooldownCheck {
  const txn = db.transaction(() => {
    const check = checkCooldown(db, userId);
    if (check.allowed) {
      updateCooldown(db, userId);
    }
    return check;
  });
  return txn();
}

/**
 * Update the last spin time for a user
 */
export function updateCooldown(db: Database.Database, userId: string): void {
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `
    INSERT INTO casino_cooldowns (user_id, last_spin_at)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_spin_at = excluded.last_spin_at
  `
  ).run(userId, now);
}

/**
 * Reset cooldown for a user (admin function)
 */
export function resetCooldown(db: Database.Database, userId: string): void {
  db.prepare("DELETE FROM casino_cooldowns WHERE user_id = ?").run(userId);
}

/**
 * Get cooldown info for a user
 */
export function getCooldownInfo(
  db: Database.Database,
  userId: string
): { lastSpinAt: number | null; canSpinIn: number } {
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .prepare("SELECT last_spin_at FROM casino_cooldowns WHERE user_id = ?")
    .get(userId) as { last_spin_at: number } | undefined;

  if (!row) {
    return { lastSpinAt: null, canSpinIn: 0 };
  }

  const elapsed = now - row.last_spin_at;
  const canSpinIn = Math.max(0, CASINO_CONFIG.cooldownSeconds - elapsed);

  return {
    lastSpinAt: row.last_spin_at,
    canSpinIn,
  };
}
