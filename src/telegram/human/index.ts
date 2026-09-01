/**
 * Human-like behavioral patterns — barrel export.
 *
 * Aggregates all humanization modules for convenient import.
 *
 * Modules:
 * - typing.ts — variable typing delays (from human-behavior.ts)
 * - reply-probability.ts — context-aware reply decisions
 * - time-of-day.ts — time-of-day behavioral factors
 * - writing-style.ts — natural language imperfections
 */

export {
  calculateTypingDelay,
  calculateReadDelay,
  calculateReactionDelay,
  shouldShowTyping,
  isSimpleAcknowledgment,
  type TypingDelayConfig,
  type MomentumFactors,
  getMomentumFactors,
  recordChatActivity,
  getChatActivity,
} from "./typing.js";

export {
  decideReply,
  activityTracker,
  cooldownTracker,
  getReplyProbabilityConfig,
  type ReplyProbabilityConfig,
} from "./reply-probability.js";

export {
  getTimeOfDayConfig,
  getLocalHour,
  getTimePeriod,
  getTimeFactors,
  getTimeContextDescription,
  isQuietHours,
  type TimeOfDayConfig,
  type TimePeriod,
  type TimeOfDayFactors,
} from "./time-of-day.js";

export {
  decideStyle,
  getWritingStyleSystemPrompt,
  getTimeBasedGreeting,
  getWritingStyleConfig,
  type WritingStyleConfig,
  type StylingSuggestion,
} from "./writing-style.js";

// Types are defined and exported inline from each module.
// No separate types.ts needed — import from the specific module when needed.
