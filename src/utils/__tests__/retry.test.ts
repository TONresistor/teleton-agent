import { describe, it, expect, vi, afterEach } from "vitest";

// Mock constants to use tiny delays (1ms) so non-timeout tests run instantly
vi.mock("../../constants/timeouts.js", () => ({
  RETRY_DEFAULT_MAX_ATTEMPTS: 3,
  RETRY_DEFAULT_BASE_DELAY_MS: 1,
  RETRY_DEFAULT_MAX_DELAY_MS: 1,
  RETRY_DEFAULT_TIMEOUT_MS: 5000,
  RETRY_BLOCKCHAIN_BASE_DELAY_MS: 1,
  RETRY_BLOCKCHAIN_MAX_DELAY_MS: 1,
  RETRY_BLOCKCHAIN_TIMEOUT_MS: 5000,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { withRetry, withBlockchainRetry } = await import("../retry.js");

describe("withRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exhausts maxAttempts then throws last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, timeout: 5000 })
    ).rejects.toThrow("always fails");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("succeeds on 2nd attempt and returns result", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("success");

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 1,
      timeout: 5000,
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears its timeout immediately after a successful operation", async () => {
    vi.useFakeTimers();
    await expect(withRetry(async () => "confirmed", { timeout: 30_000 })).resolves.toBe(
      "confirmed"
    );
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with timeout when fn hangs forever", async () => {
    vi.useFakeTimers();

    const fn = vi.fn(() => new Promise<never>(() => {})); // never resolves

    const promise = withRetry(fn, { maxAttempts: 1, timeout: 100 });

    // Attach catch before advancing timers to prevent unhandled rejection warning
    const caughtPromise = promise.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(100);

    const error = await caughtPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Operation timeout");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withBlockchainRetry", () => {
  it("wraps error with operation name after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(withBlockchainRetry(fn, "transfer TON")).rejects.toThrow(
      "transfer TON failed after retries: network down"
    );

    expect(fn).toHaveBeenCalledTimes(3);
  });
});
