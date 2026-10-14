import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ starts: [] as number[] }));
vi.mock("../../utils/fetch.js", () => ({
  fetchWithTimeout: vi.fn(async () => {
    state.starts.push(Date.now());
    return new Response("{}", { status: 200 });
  }),
}));

beforeEach(() => {
  vi.resetModules();
  state.starts.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("concurrent TonAPI rate limiting", () => {
  it("spaces concurrent unauthenticated requests over separate quota windows", async () => {
    const { tonapiFetch } = await import("../api-endpoints.js");
    const pending = Promise.all(Array.from({ length: 4 }, () => tonapiFetch("/test")));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1050);
    expect(state.starts).toHaveLength(2);
    await vi.runAllTimersAsync();
    await pending;
    expect(state.starts).toHaveLength(4);
    for (let index = 1; index < state.starts.length; index++) {
      expect(state.starts[index] - state.starts[index - 1]).toBeGreaterThanOrEqual(1000);
    }
  });

  it("never admits more than five keyed requests per rolling second", async () => {
    const { setTonapiKey, tonapiFetch } = await import("../api-endpoints.js");
    setTonapiKey("test-key");
    const pending = Promise.all(Array.from({ length: 13 }, () => tonapiFetch("/test")));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.starts).toHaveLength(5);
    await vi.runAllTimersAsync();
    await pending;
    expect(state.starts).toHaveLength(13);
    for (const start of state.starts) {
      expect(
        state.starts.filter((time) => time >= start && time < start + 1000).length
      ).toBeLessThanOrEqual(5);
    }
  });
});
