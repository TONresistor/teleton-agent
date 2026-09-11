/**
 * @deprecated Use src/telegram/human/ modules directly.
 *
 * This file re-exports from the modular human/ directory for backward
 * compatibility. All new code should import from:
 *   - src/telegram/human/index.js (for everything)
 *   - src/telegram/human/typing.js
 *   - src/telegram/human/reply-probability.js
 *   - src/telegram/human/time-of-day.js
 *   - src/telegram/human/writing-style.js
 */

export {
  calculateTypingDelay,
  calculateReadDelay,
  calculateReactionDelay,
  shouldShowTyping,
  isSimpleAcknowledgment,
  getMomentumFactors,
  recordChatActivity,
  getChatActivity,
} from "./human/typing.js";

export type { TypingDelayConfig, MomentumFactors } from "./human/typing.js";
