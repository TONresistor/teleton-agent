import { describe, it, expect } from "vitest";
import {
  classifyLlmError,
  isContextOverflowError,
  isTrivialMessage,
} from "../../agent/runtime-utils.js";

// ─── T10: isContextOverflowError ────────────────────────────────

describe("isContextOverflowError (replicated from runtime.ts — not exported)", () => {
  it("T10a: detects 'prompt is too long'", () => {
    expect(isContextOverflowError("Error: prompt is too long for this model")).toBe(true);
  });

  it("T10b: detects 'context length exceeded'", () => {
    expect(isContextOverflowError("context length exceeded: 200000 > 128000")).toBe(true);
  });

  it("T10c: detects 'maximum context length'", () => {
    expect(isContextOverflowError("This model's maximum context length is 128000 tokens")).toBe(
      true
    );
  });

  it("T10d: detects 'too many tokens'", () => {
    expect(isContextOverflowError("too many tokens in the request")).toBe(true);
  });

  it("T10e: detects 'request_too_large'", () => {
    expect(isContextOverflowError("request_too_large")).toBe(true);
  });

  it("T10f: detects compound 'exceeds' + 'maximum'", () => {
    expect(isContextOverflowError("Input exceeds the maximum allowed size")).toBe(true);
  });

  it("T10g: detects compound 'context' + 'limit'", () => {
    expect(isContextOverflowError("You have hit the context limit for this conversation")).toBe(
      true
    );
  });

  it("T10h: case-insensitive detection", () => {
    expect(isContextOverflowError("PROMPT IS TOO LONG")).toBe(true);
    expect(isContextOverflowError("Context Length Exceeded")).toBe(true);
    expect(isContextOverflowError("TOO MANY TOKENS")).toBe(true);
  });

  it("T10i: returns false for unrelated errors", () => {
    expect(isContextOverflowError("Rate limit exceeded")).toBe(false);
    expect(isContextOverflowError("Internal server error")).toBe(false);
    expect(isContextOverflowError("Connection timeout")).toBe(false);
    expect(isContextOverflowError("Invalid API key")).toBe(false);
    expect(isContextOverflowError("502 Bad Gateway")).toBe(false);
  });

  it("T10j: returns false for undefined/empty", () => {
    expect(isContextOverflowError(undefined)).toBe(false);
    expect(isContextOverflowError("")).toBe(false);
  });

  it("T10k: does not false-positive on partial matches", () => {
    // "exceeds" alone without "maximum" → false
    expect(isContextOverflowError("Rate exceeds allowed threshold")).toBe(false);
    // "maximum" alone without "exceeds" → false
    expect(isContextOverflowError("maximum retries reached")).toBe(false);
    // "context" alone without "limit" → false
    expect(isContextOverflowError("context is empty")).toBe(false);
    // "limit" alone without "context" → false
    expect(isContextOverflowError("rate limit reached")).toBe(false);
  });
});

// ─── T11: isTrivialMessage ──────────────────────────────────────

describe("isTrivialMessage (replicated from runtime.ts — not exported)", () => {
  it("T11a: 'ok' is trivial", () => {
    expect(isTrivialMessage("ok")).toBe(true);
  });

  it("T11b: 'K' (uppercase) is trivial", () => {
    expect(isTrivialMessage("K")).toBe(true);
  });

  it("T11c: 'oui' is trivial", () => {
    expect(isTrivialMessage("oui")).toBe(true);
  });

  it("T11d: 'merci' is trivial", () => {
    expect(isTrivialMessage("merci")).toBe(true);
  });

  it("T11e: 'ok let me check' is NOT trivial (multi-word)", () => {
    expect(isTrivialMessage("ok let me check")).toBe(false);
  });

  it("T11f: pure emoji is trivial (no alphanumeric chars)", () => {
    expect(isTrivialMessage("👍")).toBe(true);
    expect(isTrivialMessage("😂🔥")).toBe(true);
    expect(isTrivialMessage("🎉✨💯")).toBe(true);
  });

  it("T11g: empty/whitespace is trivial", () => {
    expect(isTrivialMessage("")).toBe(true);
    expect(isTrivialMessage("   ")).toBe(true);
    expect(isTrivialMessage("\n\t")).toBe(true);
  });

  it("T11h: all trivial keywords detected", () => {
    const trivialWords = [
      "ok",
      "okay",
      "k",
      "oui",
      "non",
      "yes",
      "no",
      "yep",
      "nope",
      "sure",
      "thanks",
      "merci",
      "thx",
      "ty",
      "lol",
      "haha",
      "cool",
      "nice",
      "wow",
      "bravo",
      "top",
      "parfait",
      "d'accord",
      "alright",
      "fine",
      "got it",
      "np",
      "gg",
    ];
    for (const word of trivialWords) {
      expect(isTrivialMessage(word)).toBe(true);
    }
  });

  it("T11i: trivial words with trailing punctuation", () => {
    expect(isTrivialMessage("ok.")).toBe(true);
    expect(isTrivialMessage("ok!")).toBe(true);
    expect(isTrivialMessage("merci!")).toBe(true);
    expect(isTrivialMessage("cool.")).toBe(true);
  });

  it("T11j: case-insensitive trivial detection", () => {
    expect(isTrivialMessage("OK")).toBe(true);
    expect(isTrivialMessage("Merci")).toBe(true);
    expect(isTrivialMessage("COOL")).toBe(true);
    expect(isTrivialMessage("Yes")).toBe(true);
    expect(isTrivialMessage("GG")).toBe(true);
  });

  it("T11k: leading/trailing whitespace stripped", () => {
    expect(isTrivialMessage("  ok  ")).toBe(true);
    expect(isTrivialMessage("\nmerci\n")).toBe(true);
  });

  it("T11l: non-trivial messages are detected as non-trivial", () => {
    expect(isTrivialMessage("What is the TON price?")).toBe(false);
    expect(isTrivialMessage("Send 1 TON to EQ...")).toBe(false);
    expect(isTrivialMessage("Can you check my balance?")).toBe(false);
    expect(isTrivialMessage("hello there")).toBe(false);
    expect(isTrivialMessage("ok but also check this")).toBe(false);
  });

  it("T11m: Cyrillic alphanumeric alone (without trivial pattern) is non-trivial", () => {
    expect(isTrivialMessage("Привет")).toBe(false);
    expect(isTrivialMessage("Да конечно")).toBe(false);
  });

  it("T11n: pure symbols (no letters/digits) are trivial", () => {
    expect(isTrivialMessage("...")).toBe(true);
    expect(isTrivialMessage("!!!")).toBe(true);
    expect(isTrivialMessage("???")).toBe(true);
    expect(isTrivialMessage("—")).toBe(true);
  });
});

describe("LLM error classification", () => {
  it.each([
    "429 rate limit",
    "usage limit reached",
    "insufficient_quota",
    "quota exceeded for this account",
  ])("classifies quota exhaustion as rate limiting: %s", (message) => {
    expect(classifyLlmError(message).kind).toBe("rate_limit");
  });

  it("does not treat authentication failures as fallback-safe", () => {
    expect(classifyLlmError("401 unauthorized").kind).toBe("unknown");
    expect(classifyLlmError("failed to generate an image").kind).toBe("unknown");
  });
});
