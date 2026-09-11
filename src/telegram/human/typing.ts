/**
 * Human-like behavioral patterns for more natural interaction.
 * Extracted from human-behavior.ts with conversational momentum support.
 *
 * Features:
 * - Variable typing delays based on message length
 * - Read receipts with realistic delays
 * - Reaction timing variance
 * - Conversational momentum: faster replies in active dialog
 */

import { createLogger } from "../../utils/logger.js";

const log = createLogger("HumanBehavior");

export interface TypingDelayConfig {
  baseDelayMs: number;
  charsPerSecond: number;
  minDelayMs: number;
  maxDelayMs: number;
  variancePercent: number;
}

const DEFAULT_TYPING_CONFIG: TypingDelayConfig = {
  baseDelayMs: 300,
  charsPerSecond: 150,
  minDelayMs: 500,
  maxDelayMs: 4000,
  variancePercent: 30,
};

// ─── Conversational Momentum Tracker ────────────────────────────────

/**
 * Tracks the conversational flow per chat.
 * When the user replies quickly to our replies, we speed up (momentum).
 * When the conversation stalls, we slow back down (decay).
 */
class MomentumTracker {
  private states = new Map<string, MomentumFactors>();

  recordReply(chatId: string, now = Date.now()): void {
    const prev = this.states.get(chatId);
    if (!prev) {
      this.states.set(chatId, {
        momentumLevel: 1.0,
        lastReplyAt: now,
        consecutiveFastReplies: 0,
      });
      return;
    }

    const elapsed = now - prev.lastReplyAt;
    let level = prev.momentumLevel;
    let fast = prev.consecutiveFastReplies;

    // Decay momentum if gap was long (> 5 min)
    if (elapsed > 300_000) {
      level = 1.0;
      fast = 0;
    } else if (elapsed < 120_000) {
      // Fast reply — build momentum
      fast = Math.min(fast + 1, 5);
      level = 1.0 + fast * 0.1; // +10% per fast reply, max +50%
    } else {
      // Medium gap — slight decay
      level = Math.max(1.0, level - 0.15);
      fast = Math.max(0, fast - 1);
    }

    this.states.set(chatId, {
      momentumLevel: level,
      lastReplyAt: now,
      consecutiveFastReplies: fast,
    });

    // Evict stale entries
    if (this.states.size > 500) {
      const cutoff = now - 600_000; // 10 min
      for (const [id, s] of this.states) {
        if (s.lastReplyAt < cutoff) this.states.delete(id);
      }
    }
  }

  getMomentum(chatId: string): MomentumFactors {
    return (
      this.states.get(chatId) ?? {
        momentumLevel: 1.0,
        lastReplyAt: 0,
        consecutiveFastReplies: 0,
      }
    );
  }

  clear(chatId: string): void {
    this.states.delete(chatId);
  }
}

export interface MomentumFactors {
  /** Typing speed multiplier (1.0 = normal, >1 = faster) */
  momentumLevel: number;
  /** Timestamp of last reply in this chat */
  lastReplyAt: number;
  /** How many replies in a row were fast */
  consecutiveFastReplies: number;
}

const momentumTracker = new MomentumTracker();

export function getMomentumFactors(chatId: string): MomentumFactors {
  return momentumTracker.getMomentum(chatId);
}

export function recordChatActivity(chatId: string): void {
  momentumTracker.recordReply(chatId);
}

export function getChatActivity(chatId: string): number {
  return momentumTracker.getMomentum(chatId).momentumLevel;
}

// ─── Typing Delay ───────────────────────────────────────────────────

/**
 * Calculate realistic typing delay based on response length and conversational momentum.
 */
export function calculateTypingDelay(
  responseLength: number,
  isGroup: boolean = false,
  config: Partial<TypingDelayConfig> = {},
  momentumLevel: number = 1.0
): number {
  const cfg = { ...DEFAULT_TYPING_CONFIG, ...config };

  // Base delay (thinking time)
  let delay = cfg.baseDelayMs;

  // Add typing time based on character count
  const typingTime = (responseLength / cfg.charsPerSecond) * 1000;
  delay += typingTime;

  // Groups get faster responses (less thinking, faster typing)
  const groupMultiplier = isGroup ? 0.6 : 1.0;
  delay *= groupMultiplier;

  // Conversational momentum: faster replies in active dialog
  if (momentumLevel > 1.0) {
    delay /= momentumLevel;
  }

  // Apply variance (±30% random)
  const variance = (Math.random() * 2 - 1) * (cfg.variancePercent / 100);
  delay *= 1 + variance;

  // Clamp to realistic bounds
  delay = Math.max(cfg.minDelayMs, Math.min(cfg.maxDelayMs, delay));

  log.debug(
    { responseLength, isGroup, momentumLevel, calculatedDelay: Math.round(delay) },
    "Calculated typing delay"
  );

  return Math.round(delay);
}

/**
 * Calculate delay before marking message as read.
 */
export function calculateReadDelay(messageLength: number): number {
  const CHARS_PER_SECOND = 20;
  const MIN_READ_MS = 200;
  const MAX_READ_MS = 3000;

  const readTime = (messageLength / CHARS_PER_SECOND) * 1000;
  const variance = Math.random() * 0.4 - 0.2;

  const delay = readTime * (1 + variance);
  return Math.round(Math.max(MIN_READ_MS, Math.min(MAX_READ_MS, delay)));
}

/**
 * Calculate delay before sending a reaction.
 */
export function calculateReactionDelay(): number {
  const MIN_MS = 200;
  const MAX_MS = 2000;
  return Math.round(MIN_MS + Math.random() * (MAX_MS - MIN_MS));
}

/**
 * Decide whether to show typing indicator based on response complexity.
 */
export function shouldShowTyping(responseLength: number, isSimpleAck: boolean): boolean {
  if (isSimpleAck) return Math.random() > 0.5;
  if (responseLength < 20) return Math.random() > 0.3;
  return true;
}

/**
 * Detect if response is a simple acknowledgment.
 */
export function isSimpleAcknowledgment(text: string): boolean {
  const simple = /^(ok|okay|got it|done|yes|no|sure|thanks|спасибо|ок|да|нет|понятно|хорошо)\\.?$/i;
  return simple.test(text.trim());
}
