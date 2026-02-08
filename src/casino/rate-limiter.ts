/**
 * Simple in-memory rate limiter for casino operations
 * Prevents abuse of payment verification and other expensive operations
 */

import { CASINO_CONFIG } from "./config.js";

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  blocked: boolean;
  blockedUntil?: number;
}

const rateLimits: Map<string, RateLimitEntry> = new Map();

/**
 * Check if a user is rate limited
 * Returns true if allowed, false if blocked
 */
export function checkRateLimit(
  userId: string,
  action: string
): { allowed: boolean; message?: string } {
  const key = `${userId}:${action}`;
  const now = Date.now();

  let entry = rateLimits.get(key);

  // Clean up old entries
  if (entry && entry.firstAttempt < now - CASINO_CONFIG.rateLimit.windowMs && !entry.blocked) {
    rateLimits.delete(key);
    entry = undefined;
  }

  // Check if user is blocked
  if (entry?.blocked) {
    if (entry.blockedUntil && now >= entry.blockedUntil) {
      // Block expired, reset
      rateLimits.delete(key);
      entry = undefined;
    } else {
      const remainingSec = Math.ceil((entry.blockedUntil! - now) / 1000);
      return {
        allowed: false,
        message: `⛔ Too many attempts. Try again in ${remainingSec} seconds.`,
      };
    }
  }

  // Create new entry or increment
  if (!entry) {
    rateLimits.set(key, {
      count: 1,
      firstAttempt: now,
      blocked: false,
    });
    return { allowed: true };
  }

  // Increment count
  entry.count++;

  // Check if exceeded limit
  if (entry.count > CASINO_CONFIG.rateLimit.maxAttempts) {
    entry.blocked = true;
    entry.blockedUntil = now + CASINO_CONFIG.rateLimit.blockDurationMs;
    return {
      allowed: false,
      message: `⛔ Rate limit exceeded. Blocked for ${Math.round(CASINO_CONFIG.rateLimit.blockDurationMs / 60000)} minutes.`,
    };
  }

  return { allowed: true };
}

/**
 * Record a failed attempt (increases rate limit penalty)
 */
export function recordFailedAttempt(userId: string, action: string): void {
  const key = `${userId}:${action}`;
  const entry = rateLimits.get(key);

  if (entry) {
    entry.count += 2; // Failed attempts count more
  }
}

/**
 * Clear rate limit for a user (e.g., after successful operation)
 */
export function clearRateLimit(userId: string, action: string): void {
  const key = `${userId}:${action}`;
  rateLimits.delete(key);
}

/**
 * Clean up expired entries (call periodically)
 */
export function cleanupRateLimits(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of rateLimits.entries()) {
    // Clean unblocked entries older than window
    if (!entry.blocked && entry.firstAttempt < now - CASINO_CONFIG.rateLimit.windowMs) {
      rateLimits.delete(key);
      cleaned++;
    }
    // Clean expired blocks
    if (entry.blocked && entry.blockedUntil && now >= entry.blockedUntil) {
      rateLimits.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}
