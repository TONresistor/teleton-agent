/**
 * Context-aware reply probability for human-like behavior.
 *
 * Features:
 * - Variable response probability per context (DM vs group, mention vs reply)
 * - Chat activity tracking — less interruption in active group conversations
 * - Per-chat memory to avoid over-responding
 * - Configurable override per chat
 */

import { createLogger } from "../../utils/logger.js";

const log = createLogger("ReplyProbability");

export interface ReplyProbabilityConfig {
  /** Base probability to respond in DMs (0.0 – 1.0) */
  dmBase: number;
  /** Probability when mentioned in a group (0.0 – 1.0) */
  groupMentioned: number;
  /** Probability when someone replies to our message (0.0 – 1.0) */
  groupRepliedToUs: number;
  /** Probability when not mentioned in group (0.0 – 1.0) */
  groupUnmentioned: number;
  /** Minimum ms between two replies to the same chat */
  minIntervalMs: number;
  /** Messages per minute threshold for "high activity" — reduces reply chance */
  highActivityThreshold: number;
  /** High activity multiplier (applied to base probability) */
  highActivityMultiplier: number;
  /** Enable time-of-day modulation */
  timeOfDayEnabled: boolean;
}

const DEFAULT_CONFIG: ReplyProbabilityConfig = {
  dmBase: 0.85,
  groupMentioned: 0.5,
  groupRepliedToUs: 0.9,
  groupUnmentioned: 0.05,
  minIntervalMs: 3_000,
  highActivityThreshold: 5, // 5+ msgs/min = high activity
  highActivityMultiplier: 0.3,
  timeOfDayEnabled: true,
};

/**
 * Tracks message frequency per chat to detect "active conversations"
 * where the bot should be less intrusive.
 */
class ActivityTracker {
  private windows = new Map<string, number[]>();

  /** Record a message event (from anyone) in a chat */
  recordMessage(chatId: string, now = Date.now()): void {
    let timestamps = this.windows.get(chatId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(chatId, timestamps);
    }
    timestamps.push(now);

    // Trim to last 60s window
    const cutoff = now - 60_000;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    // Evict stale entries to prevent memory leak
    if (this.windows.size > 1000) {
      for (const [id, ts] of this.windows) {
        if (ts.length === 0 || (ts.length === 1 && ts[0] < cutoff)) {
          this.windows.delete(id);
        }
      }
    }
  }

  /** Get messages-per-minute in this chat */
  getActivity(chatId: string, now = Date.now()): number {
    const timestamps = this.windows.get(chatId);
    if (!timestamps || timestamps.length === 0) return 0;
    const cutoff = now - 60_000;
    const recent = timestamps.filter((t) => t >= cutoff);
    return recent.length;
  }

  clear(chatId: string): void {
    this.windows.delete(chatId);
  }
}

/** Per-chat cooldown to prevent rapid-fire replies */
class CooldownTracker {
  private lastReplyAt = new Map<string, number>();

  markReplied(chatId: string, now = Date.now()): void {
    this.lastReplyAt.set(chatId, now);
  }

  msSinceLastReply(chatId: string, now = Date.now()): number {
    const last = this.lastReplyAt.get(chatId);
    if (last === undefined) return Infinity;
    return now - last;
  }

  clear(chatId: string): void {
    this.lastReplyAt.delete(chatId);
  }
}

export const activityTracker = new ActivityTracker();
export const cooldownTracker = new CooldownTracker();

export function getReplyProbabilityConfig(
  overrides?: Partial<ReplyProbabilityConfig>
): ReplyProbabilityConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/**
 * Decide whether to respond to a message based on context and randomness.
 *
 * @returns { probability: number; reason: string }
 */
export function decideReply(options: {
  chatId: string;
  isGroup: boolean;
  isMentioned: boolean;
  isReplyToUs: boolean;
  config: ReplyProbabilityConfig;
}): { shouldReply: boolean; probability: number; reason: string } {
  const { chatId, isGroup, isMentioned, isReplyToUs, config } = options;
  const now = Date.now();

  // 1. Cooldown check — don't reply too fast in the same chat
  const sinceLast = cooldownTracker.msSinceLastReply(chatId, now);
  if (sinceLast < config.minIntervalMs) {
    return {
      shouldReply: false,
      probability: 0,
      reason: `Cooldown: ${sinceLast}ms < ${config.minIntervalMs}ms since last reply`,
    };
  }

  // 2. Base probability
  let probability: number;

  if (!isGroup) {
    // DM
    probability = config.dmBase;
  } else if (isReplyToUs) {
    // Someone replied to our message
    probability = config.groupRepliedToUs;
  } else if (isMentioned) {
    // Mentioned by name
    probability = config.groupMentioned;
  } else {
    // Not mentioned in group — rarely reply
    probability = config.groupUnmentioned;
  }

  // 3. High-activity dampener
  const activity = activityTracker.getActivity(chatId, now);
  if (activity >= config.highActivityThreshold && isGroup) {
    probability *= config.highActivityMultiplier;
    log.debug({ chatId, activity, probability }, "High group activity — reduced reply probability");
  }

  // 4. Clamp
  probability = Math.max(0, Math.min(1, probability));

  // 5. Roll the dice
  const roll = Math.random();
  const shouldReply = roll < probability;

  log.debug(
    { chatId, isGroup, isMentioned, isReplyToUs, activity, probability, roll, shouldReply },
    "Reply probability decision"
  );

  return {
    shouldReply,
    probability,
    reason: shouldReply
      ? `Roll ${roll.toFixed(3)} < ${(probability * 100).toFixed(0)}%`
      : `Roll ${roll.toFixed(3)} >= ${(probability * 100).toFixed(0)}%`,
  };
}
