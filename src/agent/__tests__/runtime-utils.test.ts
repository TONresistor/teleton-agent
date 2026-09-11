import { describe, expect, it } from "vitest";
import {
  classifyLlmError,
  isContextOverflowError,
  isServerError,
  isTrivialMessage,
} from "../../agent/runtime-utils.js";

const CONTEXT_OVERFLOW_MESSAGES = [
  "Error: prompt is too long for this model",
  "context length exceeded: 200000 > 128000",
  "This model's maximum context length is 128000 tokens",
  "too many tokens in the request",
  "request_too_large",
  "Input exceeds the maximum allowed size",
  "You have hit the context limit for this conversation",
  "PROMPT IS TOO LONG",
  "Context Length Exceeded",
  "TOO MANY TOKENS",
] as const;

const NON_CONTEXT_OVERFLOW_MESSAGES = [
  "Rate limit exceeded",
  "Internal server error",
  "Connection timeout",
  "Invalid API key",
  "502 Bad Gateway",
  undefined,
  "",
  "Rate exceeds allowed threshold",
  "maximum retries reached",
  "context is empty",
  "rate limit reached",
] as const;

const TRIVIAL_MESSAGES = [
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
  "K",
  "👍",
  "😂🔥",
  "🎉✨💯",
  "",
  "   ",
  "\n\t",
  "ok.",
  "ok!",
  "merci!",
  "cool.",
  "OK",
  "Merci",
  "COOL",
  "Yes",
  "GG",
  "  ok  ",
  "\nmerci\n",
  "...",
  "!!!",
  "???",
  "—",
] as const;

const NON_TRIVIAL_MESSAGES = [
  "ok let me check",
  "What is the TON price?",
  "Send 1 TON to EQ...",
  "Can you check my balance?",
  "hello there",
  "ok but also check this",
  "Привет",
  "Да конечно",
] as const;

describe("isContextOverflowError", () => {
  it.each(CONTEXT_OVERFLOW_MESSAGES)("detects %j", (message) => {
    expect(isContextOverflowError(message)).toBe(true);
  });

  it.each(NON_CONTEXT_OVERFLOW_MESSAGES)("rejects %j", (message) => {
    expect(isContextOverflowError(message)).toBe(false);
  });
});

describe("isServerError", () => {
  it("treats provider timeouts as transient failures", () => {
    expect(isServerError("API error: Request timed out.")).toBe(true);
    expect(classifyLlmError("API error: Request timed out.")).toMatchObject({
      kind: "server_error",
      code: "PROVIDER_ERROR",
    });
  });
});

describe("isTrivialMessage", () => {
  it.each(TRIVIAL_MESSAGES)("classifies %j as trivial", (message) => {
    expect(isTrivialMessage(message)).toBe(true);
  });

  it.each(NON_TRIVIAL_MESSAGES)("classifies %j as non-trivial", (message) => {
    expect(isTrivialMessage(message)).toBe(false);
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

  it.each(["401 unauthorized", "failed to generate an image"])(
    "does not classify non-retryable errors as fallback-safe: %s",
    (message) => {
      expect(classifyLlmError(message).kind).toBe("unknown");
    }
  );
});
