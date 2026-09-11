import { describe, expect, it } from "vitest";
import { formatEmotionalState, getEmotionalState, updateEmotionalState } from "../emotions.js";

describe("emotional state", () => {
  it("uses the message tone and grows when it repeats", () => {
    const now = 1_000_000;
    expect(updateEmotionalState("warm-session", "Thanks for your help", now)).toMatchObject({
      emotion: "warm",
      intensity: "low",
    });
    expect(updateEmotionalState("warm-session", "Thank you again", now + 1_000)).toMatchObject({
      emotion: "warm",
      intensity: "medium",
    });
  });

  it("returns calm after the state expires", () => {
    updateEmotionalState("expired-session", "This is urgent", 1_000_000);
    expect(getEmotionalState("expired-session", 1_000_000 + 30 * 60 * 1000)).toMatchObject({
      emotion: "calm",
      intensity: "low",
    });
  });

  it("keeps the prompt context honest about simulated affect", () => {
    expect(formatEmotionalState({ emotion: "joyful", intensity: "low", updatedAt: 0 })).toContain(
      "Do not claim to have human feelings"
    );
  });
});
