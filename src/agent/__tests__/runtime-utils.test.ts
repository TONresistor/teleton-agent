import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyLlmError,
  parseRetryAfterMs,
  isContextOverflowError,
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
    "upstream_stream_read_error",
    "upstream_request_failed",
    "stream disconnected before completion: stream closed before response.completed",
    "HTTP/2 stream failed",
    "fetch failed",
    "504 Gateway Timeout",
    "529 overloaded",
  ])("classifies transient transport failures: %s", (message) => {
    expect(classifyLlmError(message).kind).toBe("server_error");
  });

  it.each(["Invalid request req_011CU503xyz", "Invalid request req_500_abc", "5242880 bytes"])(
    "does not treat request IDs or byte counts as status codes: %s",
    (message) => {
      expect(classifyLlmError(message).kind).toBe("unknown");
    }
  );
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

describe("HTTP retry metadata and cancellation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it.each([
    [{ "retry-after": "30" }, 30000],
    [{ "retry-after": "Mon, 26 Oct 2026 12:00:30 GMT" }, 30000],
    [{ "retry-after-ms": "1250", "retry-after": "30" }, 1250],
    [{ "retry-after": "invalid" }, undefined],
  ])("captures retry headers %j without retaining previous attempts", async (headers, expected) => {
    const { createRetryAfterTracker } = await import("../../utils/fetch.js");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers }))
      .mockResolvedValueOnce(new Response("ok"));
    const tracker = createRetryAfterTracker(fetcher);
    await tracker.fetch("https://test.invalid");
    expect(tracker.retryAfterMs()).toBe(expected);
    await tracker.fetch("https://test.invalid");
    expect(tracker.retryAfterMs()).toBeUndefined();
  });
  it("waits the full delay, refuses insufficient budget, and aborts promptly", async () => {
    const { waitForRetry } = await import("../../utils/fetch.js");
    vi.useFakeTimers();
    let done = false;
    const pending = waitForRetry(30000, undefined, Date.now() + 60000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(29999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
    await expect(waitForRetry(30000, undefined, Date.now() + 10000)).rejects.toThrow(
      "remaining turn budget"
    );
    const controller = new AbortController();
    const cancelled = waitForRetry(30000, controller.signal).catch((error: unknown) => error);
    controller.abort(new Error("cancelled"));
    expect(await cancelled).toMatchObject({ message: "cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("uses structured Google retry info when its adapter cannot expose HTTP headers", () => {
  expect(parseRetryAfterMs('{"details":[{"retryDelay":"30.5s"}]}')).toBe(30500);
});
