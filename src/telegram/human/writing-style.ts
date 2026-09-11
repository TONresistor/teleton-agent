/**
 * Natural writing style imperfections for human-like text.
 *
 * Features:
 * - Occasional typos (typo -> edit pattern)
 * - Natural fillers and discourse markers
 * - Contractions for informal tone
 * - Sentence length variety suggestions
 * - Emoji usage patterns
 *
 * Note: this module provides *analysis* of writing style for the agent prompt.
 * Actual text modification happens in the LLM via system prompt instructions.
 */

export interface WritingStyleConfig {
  /** Probability of suggesting a typo simulation (0.0 – 1.0) */
  typoSuggestionProbability: number;
  /** Probability of suggesting an edit after send (0.0 – 1.0) */
  editAfterSendProbability: number;
  /** Max delay in ms for edit-after-send simulation */
  maxEditDelayMs: number;
  /** Probability of "staging" — show typing but don't send (0.0 – 1.0) */
  stagingProbability: number;
  /** Enable emoji suggestions */
  emojiEnabled: boolean;
  /** Enable natural filler phrases */
  fillersEnabled: boolean;
}

const DEFAULT_CONFIG: WritingStyleConfig = {
  typoSuggestionProbability: 0.03,
  editAfterSendProbability: 0.05,
  maxEditDelayMs: 15_000,
  stagingProbability: 0.03,
  emojiEnabled: true,
  fillersEnabled: true,
};

export function getWritingStyleConfig(overrides?: Partial<WritingStyleConfig>): WritingStyleConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

export interface StylingSuggestion {
  /** Whether to simulate a typo in this response */
  suggestTypo: boolean;
  /** Whether to simulate an edit-after-send */
  suggestEdit: boolean;
  /** Whether to show typing but not send (staging) */
  suggestStaging: boolean;
  /** Suggested emoji for the response (empty = none) */
  suggestedEmoji: string;
}

const COMMON_EMOJIS = ["😊", "👍", "🙂", "😅", "🤔", "✨", "👀", "💪", "🔥", "🎉", "❤️", "👏"];

/**
 * Roll for writing style suggestions before sending.
 */
export function decideStyle(config: WritingStyleConfig): StylingSuggestion {
  return {
    suggestTypo:
      config.typoSuggestionProbability > 0 && Math.random() < config.typoSuggestionProbability,
    suggestEdit:
      config.editAfterSendProbability > 0 && Math.random() < config.editAfterSendProbability,
    suggestStaging: config.stagingProbability > 0 && Math.random() < config.stagingProbability,
    suggestedEmoji:
      config.emojiEnabled && Math.random() < 0.15
        ? COMMON_EMOJIS[Math.floor(Math.random() * COMMON_EMOJIS.length)]
        : "",
  };
}

/**
 * Get system prompt additions that encourage natural writing.
 */
export function getWritingStyleSystemPrompt(config: WritingStyleConfig): string {
  const parts: string[] = [];

  if (config.emojiEnabled) {
    parts.push("- Use emoji naturally, not in every message. Rarely the same one twice in a row.");
  }

  if (config.fillersEnabled) {
    parts.push(
      "- Write like a real person: vary sentence length, use contractions (it's, don't, I've), and avoid robotic parallelism."
    );
  }

  parts.push(
    "- Don't over-explain. One or two sentences is often enough.",
    "- Avoid AI-isms: 'Certainly!', 'I'd be happy to!', 'I understand your question.', 'That's a great question!', 'Absolutely!', 'Let me know if you need anything else.'",
    "- If a message doesn't need a reply, just say it clearly. Not every message needs a cheerful sign-off.",
    "- Be direct and natural, as if texting a friend — not writing a support ticket.",
    "- In casual chat, starting a message with a lowercase letter is fine and often more natural than a capitalized opener — like how people actually text. Still capitalize proper nouns and use normal capitalization for anything formal.",
    "- If a reply naturally has more than one distinct thought, write it as separate short paragraphs (blank line between them) instead of one long block — they will be sent as separate messages, the way a person sends a quick burst of texts."
  );

  return parts.join("\n");
}

/**
 * Get a greeting/opener that varies by time of day.
 */
export function getTimeBasedGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 18) return "День добрый";
  if (hour >= 18 && hour < 23) return "Добрый вечер";
  return ""; // Night — no greeting
}
