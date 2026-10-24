import { afterEach, describe, expect, it, vi } from "vitest";
import { startPluginModules } from "../plugin-lifecycle.js";
import type { PluginModule } from "../../agent/tools/types.js";

// Pino's output worker may schedule its own flush timer under CI stdout load.
// The timer assertion below belongs to lifecycle admission and cleanup.
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}));

afterEach(() => vi.useRealTimers());
describe("startup lifecycle deadline settlement", () => {
  it("never invokes stop concurrently with startup after a local deadline", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const stop = vi.fn(async () => {});
    const module = {
      name: "pending",
      version: "1",
      tools: () => [],
      start: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      stop,
    } satisfies PluginModule;
    const startup = startPluginModules([module], {} as never);
    const rejected = expect(startup).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_001);
    expect(stop).not.toHaveBeenCalled();
    release();
    await rejected;
    expect(stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
