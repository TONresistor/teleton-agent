/**
 * Deals System Configuration
 * All deals constants in one place for easy tuning
 *
 * Pattern: mutable object with defaults, initialized at startup via initDealsConfig()
 */

import type { DealsConfig } from "../config/schema.js";

export const DEALS_CONFIG = {
  // Deal expiry
  expirySeconds: 120, // 2 minutes

  // Strategy enforcement (STRATEGY.md rules)
  strategy: {
    buyMaxMultiplier: 1.0, // Max 100% of floor when buying (never above floor)
    sellMinMultiplier: 1.05, // Min 105% of floor when selling (floor + 5%)
  },

  // Verification poller
  verification: {
    pollIntervalMs: 5000, // Check every 5 seconds
    maxRetries: 12, // 12 retries = 60 seconds max wait
    retryDelayMs: 5000,
  },

  // Expiry background check
  expiryCheckIntervalMs: 60_000, // Check for expired deals every 60s
};

/**
 * Initialize deals config from YAML values (called at startup)
 * Merges YAML overrides into the mutable DEALS_CONFIG object
 */
export function initDealsConfig(yaml?: DealsConfig): void {
  if (!yaml) return;

  if (yaml.expiry_seconds !== undefined) DEALS_CONFIG.expirySeconds = yaml.expiry_seconds;
  if (yaml.buy_max_floor_percent !== undefined)
    DEALS_CONFIG.strategy.buyMaxMultiplier = yaml.buy_max_floor_percent / 100;
  if (yaml.sell_min_floor_percent !== undefined)
    DEALS_CONFIG.strategy.sellMinMultiplier = yaml.sell_min_floor_percent / 100;
  if (yaml.poll_interval_ms !== undefined)
    DEALS_CONFIG.verification.pollIntervalMs = yaml.poll_interval_ms;
  if (yaml.max_verification_retries !== undefined)
    DEALS_CONFIG.verification.maxRetries = yaml.max_verification_retries;
  if (yaml.expiry_check_interval_ms !== undefined)
    DEALS_CONFIG.expiryCheckIntervalMs = yaml.expiry_check_interval_ms;
}
