export type Emotion = "calm" | "curious" | "warm" | "joyful" | "compassionate" | "concerned";

export interface EmotionalState {
  emotion: Emotion;
  intensity: "low" | "medium";
  updatedAt: number;
}

const states = new Map<string, EmotionalState>();
const STATE_TTL_MS = 30 * 60 * 1000;

const SIGNALS: Array<{ emotion: Exclude<Emotion, "calm">; pattern: RegExp }> = [
  {
    emotion: "compassionate",
    pattern: /(sad|sorry|hurt|grief|lonely|тяжело|груст|больно|плохо)/i,
  },
  {
    emotion: "concerned",
    pattern: /(urgent|danger|scam|angry|проблем|срочно|опасн|злюсь)/i,
  },
  { emotion: "joyful", pattern: /(congrats|great|awesome|love|yay|ура|класс|супер|побед)/i },
  { emotion: "warm", pattern: /(thanks|thank you|please|привет|спасибо|благодар)/i },
  { emotion: "curious", pattern: /[?？]|(why|how|what|почему|как|зачем|что)/i },
];

/**
 * Keep a small, transparent affect model per conversation. It is deliberately
 * advisory: it changes conversational tone only, never safety or permissions.
 */
export function updateEmotionalState(
  sessionId: string,
  text: string,
  now = Date.now()
): EmotionalState {
  const previous = states.get(sessionId);
  const match = SIGNALS.find((signal) => signal.pattern.test(text));
  const emotion: Emotion = match?.emotion ?? "calm";
  const intensity: EmotionalState["intensity"] =
    match && previous?.emotion === emotion && now - previous.updatedAt < STATE_TTL_MS
      ? "medium"
      : "low";
  const state = { emotion, intensity, updatedAt: now };
  states.set(sessionId, state);
  return state;
}

export function getEmotionalState(sessionId: string, now = Date.now()): EmotionalState {
  const state = states.get(sessionId);
  if (!state || now - state.updatedAt >= STATE_TTL_MS) {
    return { emotion: "calm", intensity: "low", updatedAt: now };
  }
  return state;
}

export function formatEmotionalState(state: EmotionalState): string {
  const tone: Record<Emotion, string> = {
    calm: "be steady and clear",
    curious: "be engaged and exploratory",
    warm: "be friendly and appreciative",
    joyful: "be positive without becoming noisy",
    compassionate: "be gentle and supportive",
    concerned: "be careful, grounded, and helpful",
  };
  return `[Emotional state: ${state.emotion} (${state.intensity}). Let this influence tone only: ${tone[state.emotion]}. Do not claim to have human feelings or consciousness.]`;
}
