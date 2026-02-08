/**
 * Teleton Casino Configuration
 * All casino constants in one place for easy tuning
 *
 * Pattern: mutable object with defaults, initialized at startup via initCasinoConfig()
 */

import type { CasinoConfig } from "../config/schema.js";

export const CASINO_CONFIG = {
  // Betting limits
  minBet: 0.1, // Minimum bet in TON
  maxBetPercent: 5, // Max bet as % of bankroll
  minBankroll: 10, // Minimum TON to operate casino

  // Cooldown
  cooldownSeconds: 30, // Seconds between spins per user

  // House edge
  houseEdgePercent: 5, // % of each bet goes to jackpot

  // Jackpot
  jackpotThreshold: 100, // Minimum TON to award jackpot
  jackpotCooldownHours: 24, // Hours between jackpot awards

  // Slot multipliers (40% house edge, 60% payout)
  slot: {
    jackpot: { range: [64, 64] as [number, number], multiplier: 5 }, // 777
    bigWin: { range: [60, 63] as [number, number], multiplier: 2.5 },
    mediumWin: { range: [55, 59] as [number, number], multiplier: 1.8 },
    smallWin: { range: [43, 54] as [number, number], multiplier: 1.2 },
    // Values 1-42: no win
  },

  // Dice multipliers (6.7% house edge, 93.3% payout)
  dice: {
    jackpot: { value: 6, multiplier: 2.5 },
    bigWin: { value: 5, multiplier: 1.8 },
    smallWin: { value: 4, multiplier: 1.3 },
    // Values 1-3: no win
  },

  // Payment verification
  paymentWindowMinutes: 5, // How old a payment can be
  maxPaymentAgeMinutes: 10, // Reject payments older than this

  // Transaction cleanup
  txRetentionDays: 30, // Days to keep used_transactions records

  // Rate limiting
  rateLimit: {
    maxAttempts: 5,
    windowMs: 60_000, // 1 minute
    blockDurationMs: 300_000, // 5 minutes
  },
};

/**
 * Initialize casino config from YAML values (called at startup)
 * Merges YAML overrides into the mutable CASINO_CONFIG object
 */
export function initCasinoConfig(yaml?: CasinoConfig): void {
  if (!yaml) return;

  if (yaml.min_bet !== undefined) CASINO_CONFIG.minBet = yaml.min_bet;
  if (yaml.max_bet_percent !== undefined) CASINO_CONFIG.maxBetPercent = yaml.max_bet_percent;
  if (yaml.min_bankroll !== undefined) CASINO_CONFIG.minBankroll = yaml.min_bankroll;
  if (yaml.cooldown_seconds !== undefined) CASINO_CONFIG.cooldownSeconds = yaml.cooldown_seconds;
  if (yaml.house_edge_percent !== undefined)
    CASINO_CONFIG.houseEdgePercent = yaml.house_edge_percent;
  if (yaml.jackpot_threshold !== undefined) CASINO_CONFIG.jackpotThreshold = yaml.jackpot_threshold;
  if (yaml.jackpot_cooldown_hours !== undefined)
    CASINO_CONFIG.jackpotCooldownHours = yaml.jackpot_cooldown_hours;
  if (yaml.payment_window_minutes !== undefined)
    CASINO_CONFIG.paymentWindowMinutes = yaml.payment_window_minutes;
  if (yaml.max_payment_age_minutes !== undefined)
    CASINO_CONFIG.maxPaymentAgeMinutes = yaml.max_payment_age_minutes;
  if (yaml.tx_retention_days !== undefined) CASINO_CONFIG.txRetentionDays = yaml.tx_retention_days;
  if (yaml.rate_limit_max_attempts !== undefined)
    CASINO_CONFIG.rateLimit.maxAttempts = yaml.rate_limit_max_attempts;
  if (yaml.rate_limit_window_seconds !== undefined)
    CASINO_CONFIG.rateLimit.windowMs = yaml.rate_limit_window_seconds * 1000;
  if (yaml.rate_limit_block_seconds !== undefined)
    CASINO_CONFIG.rateLimit.blockDurationMs = yaml.rate_limit_block_seconds * 1000;
}

/**
 * Calculate slot multiplier from value
 */
export function getSlotMultiplier(value: number): number {
  const { slot } = CASINO_CONFIG;
  if (value >= slot.jackpot.range[0] && value <= slot.jackpot.range[1])
    return slot.jackpot.multiplier;
  if (value >= slot.bigWin.range[0] && value <= slot.bigWin.range[1]) return slot.bigWin.multiplier;
  if (value >= slot.mediumWin.range[0] && value <= slot.mediumWin.range[1])
    return slot.mediumWin.multiplier;
  if (value >= slot.smallWin.range[0] && value <= slot.smallWin.range[1])
    return slot.smallWin.multiplier;
  return 0;
}

/**
 * Calculate dice multiplier from value
 */
export function getDiceMultiplier(value: number): number {
  const { dice } = CASINO_CONFIG;
  if (value === dice.jackpot.value) return dice.jackpot.multiplier;
  if (value === dice.bigWin.value) return dice.bigWin.multiplier;
  if (value === dice.smallWin.value) return dice.smallWin.multiplier;
  return 0;
}

/**
 * Get slot result interpretation
 */
export function getSlotInterpretation(value: number): string {
  const { slot } = CASINO_CONFIG;
  if (value >= slot.jackpot.range[0] && value <= slot.jackpot.range[1]) return "🎰 JACKPOT 777!";
  if (value >= slot.bigWin.range[0] && value <= slot.bigWin.range[1]) return "🎊 Big win!";
  if (value >= slot.mediumWin.range[0] && value <= slot.mediumWin.range[1]) return "✨ Nice win!";
  if (value >= slot.smallWin.range[0] && value <= slot.smallWin.range[1]) return "🎯 Small win!";
  return `Spin result: ${value}/64`;
}

/**
 * Get dice result interpretation
 */
export function getDiceInterpretation(value: number): string {
  const { dice } = CASINO_CONFIG;
  if (value === dice.jackpot.value) return "🎲 JACKPOT 6!";
  if (value === dice.bigWin.value) return "🎊 Big win (5)!";
  if (value === dice.smallWin.value) return "✨ Nice win (4)!";
  return `Dice: ${value}`;
}
