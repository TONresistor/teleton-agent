import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookRegistry } from "../registry.js";
import { createHookRunner } from "../runner.js";
import type { BeforeToolCallEvent, AfterToolCallEvent } from "../types.js";

const mockLogger = {
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

let registry: HookRegistry;

beforeEach(() => {
  registry = new HookRegistry();
  vi.restoreAllMocks();
});

describe("Hook Runner", () => {
  it("3.1 runObservingHook fires all handlers sequentially", async () => {
    const order: number[] = [];
    registry.register({
      pluginId: "a",
      hookName: "tool:after",
      handler: async () => {
        order.push(1);
      },
      priority: 0,
    });
    registry.register({
      pluginId: "b",
      hookName: "tool:after",
      handler: async () => {
        order.push(2);
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    const event: AfterToolCallEvent = {
      toolName: "test",
      params: {},
      result: { success: true },
      durationMs: 10,
      chatId: "123",
      isGroup: false,
    };
    await runner.runObservingHook("tool:after", event);
    // Both fire (parallel via Promise.allSettled, order = registration order for same priority)
    expect(order).toEqual([1, 2]);
  });

  it("3.2 runObservingHook catches handler errors without propagating", async () => {
    registry.register({
      pluginId: "a",
      hookName: "tool:after",
      handler: () => {
        throw new Error("boom");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    const event: AfterToolCallEvent = {
      toolName: "test",
      params: {},
      result: { success: true },
      durationMs: 10,
      chatId: "123",
      isGroup: false,
    };
    // Should not throw
    await runner.runObservingHook("tool:after", event);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("3.3 runModifyingHook runs handlers in priority order (low->high)", async () => {
    const order: string[] = [];
    registry.register({
      pluginId: "high",
      hookName: "tool:before",
      handler: () => {
        order.push("high-10");
      },
      priority: 10,
    });
    registry.register({
      pluginId: "low",
      hookName: "tool:before",
      handler: () => {
        order.push("low-0");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    const event: BeforeToolCallEvent = {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };
    await runner.runModifyingHook("tool:before", event);
    expect(order).toEqual(["low-0", "high-10"]);
  });

  it("3.4 runModifyingHook: handler mutates event.params, next handler sees mutation", async () => {
    registry.register({
      pluginId: "a",
      hookName: "tool:before",
      handler: (e) => {
        e.params.modified = true;
      },
      priority: 0,
    });
    registry.register({
      pluginId: "b",
      hookName: "tool:before",
      handler: (e) => {
        e.params.seenModified = e.params.modified;
      },
      priority: 1,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    const event: BeforeToolCallEvent = {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };
    await runner.runModifyingHook("tool:before", event);
    expect(event.params.modified).toBe(true);
    expect(event.params.seenModified).toBe(true);
  });

  it("3.5 runModifyingHook fails closed when an enforcement hook times out", async () => {
    vi.useFakeTimers();

    registry.register({
      pluginId: "slow",
      hookName: "tool:before",
      handler: () => new Promise(() => {}), // never resolves
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger, timeoutMs: 100 });
    const event: BeforeToolCallEvent = {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };

    const promise = runner.runModifyingHook("tool:before", event);
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Hook timeout"));
    expect(event.block).toBe(true);
    expect(event.blockReason).toContain("Hook timeout");

    vi.useRealTimers();
  });

  it("3.6 runModifyingHook returns early when no hooks registered", async () => {
    const runner = createHookRunner(registry, { logger: mockLogger });
    const event: BeforeToolCallEvent = {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };
    // Should return immediately without error
    await runner.runModifyingHook("tool:before", event);
  });

  it("3.7 hasHooks returns false for unregistered hook names", () => {
    expect(registry.hasHooks("session:start")).toBe(false);
    expect(registry.hasHooks("session:end")).toBe(false);
  });

  it("3.8 Hook with priority 0 runs before priority 10 before priority 100", async () => {
    const order: number[] = [];
    registry.register({
      pluginId: "c",
      hookName: "tool:before",
      handler: () => {
        order.push(100);
      },
      priority: 100,
    });
    registry.register({
      pluginId: "a",
      hookName: "tool:before",
      handler: () => {
        order.push(0);
      },
      priority: 0,
    });
    registry.register({
      pluginId: "b",
      hookName: "tool:before",
      handler: () => {
        order.push(10);
      },
      priority: 10,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    const event: BeforeToolCallEvent = {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };
    await runner.runModifyingHook("tool:before", event);
    expect(order).toEqual([0, 10, 100]);
  });

  it("3.9 Error in one observing handler doesn't affect others", async () => {
    const called: string[] = [];
    registry.register({
      pluginId: "a",
      hookName: "session:start",
      handler: () => {
        called.push("a");
      },
      priority: 0,
    });
    registry.register({
      pluginId: "b",
      hookName: "session:start",
      handler: () => {
        throw new Error("fail");
      },
      priority: 0,
    });
    registry.register({
      pluginId: "c",
      hookName: "session:start",
      handler: () => {
        called.push("c");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    await runner.runObservingHook("session:start", {
      sessionId: "s1",
      chatId: "123",
      isResume: false,
    });
    // All fire in parallel; b errors but a and c still run
    expect(called).toEqual(["a", "c"]);
  });

  it("3.10 tool:before: event.block=true short-circuits remaining handlers", async () => {
    const called: string[] = [];
    registry.register({
      pluginId: "blocker",
      hookName: "tool:before",
      handler: (e) => {
        e.block = true;
        e.blockReason = "nope";
        called.push("blocker");
      },
      priority: 0,
    });
    registry.register({
      pluginId: "second",
      hookName: "tool:before",
      handler: () => {
        called.push("second");
      },
      priority: 1,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    const event: BeforeToolCallEvent = {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };
    await runner.runModifyingHook("tool:before", event);
    expect(event.block).toBe(true);
    expect(event.blockReason).toBe("nope");
    expect(called).toEqual(["blocker"]);
  });

  it("3.11 Reentrancy: hooks skipped when hookDepth > 0", async () => {
    const innerCalled: boolean[] = [];

    registry.register({
      pluginId: "outer",
      hookName: "tool:before",
      handler: async (e) => {
        // Simulate a nested hook call (as if a tool triggered another tool)
        await runner.runModifyingHook("tool:before", {
          toolName: "nested",
          params: {},
          chatId: "123",
          isGroup: false,
          block: false,
          blockReason: "",
        });
        innerCalled.push(true);
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    const event: BeforeToolCallEvent = {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };
    await runner.runModifyingHook("tool:before", event);
    expect(innerCalled).toEqual([true]);
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining("reentrancy"));
    expect(runner.depth).toBe(0);
  });

  it("3.12 runObservingHook fires handlers in registration order (same priority)", async () => {
    const order: string[] = [];
    registry.register({
      pluginId: "A",
      hookName: "session:end",
      handler: () => {
        order.push("A");
      },
      priority: 0,
    });
    registry.register({
      pluginId: "B",
      hookName: "session:end",
      handler: () => {
        order.push("B");
      },
      priority: 0,
    });
    registry.register({
      pluginId: "C",
      hookName: "session:end",
      handler: () => {
        order.push("C");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    await runner.runObservingHook("session:end", {
      sessionId: "s1",
      chatId: "123",
      messageCount: 5,
    });
    expect(order).toEqual(["A", "B", "C"]);
  });

  it("3.13 Timeout: slow handler skipped, fast handler still runs", async () => {
    vi.useFakeTimers();

    const called: string[] = [];
    registry.register({
      pluginId: "slow",
      hookName: "session:start",
      handler: () => new Promise(() => {}), // never resolves
      priority: 0,
    });
    registry.register({
      pluginId: "fast",
      hookName: "session:start",
      handler: () => {
        called.push("fast");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger, timeoutMs: 100 });
    const promise = runner.runObservingHook("session:start", {
      sessionId: "s1",
      chatId: "123",
      isResume: false,
    });

    // Both fire in parallel — fast resolves, slow times out
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(called).toContain("fast");
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Hook timeout"));

    vi.useRealTimers();
  });

  it("3.14 catchErrors=false: errors propagate", async () => {
    registry.register({
      pluginId: "bad",
      hookName: "tool:before",
      handler: () => {
        throw new Error("propagated");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger, catchErrors: false });
    const event: BeforeToolCallEvent = {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };
    await expect(runner.runModifyingHook("tool:before", event)).rejects.toThrow("propagated");
  });

  it("3.15 catchErrors=false: errors propagate from observing hooks", async () => {
    registry.register({
      pluginId: "bad",
      hookName: "tool:after",
      handler: () => {
        throw new Error("observing-propagated");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger, catchErrors: false });
    const event: AfterToolCallEvent = {
      toolName: "test",
      params: {},
      result: { success: true },
      durationMs: 10,
      chatId: "123",
      isGroup: false,
    };
    await expect(runner.runObservingHook("tool:after", event)).rejects.toThrow(
      "observing-propagated"
    );
  });

  it("3.16 does not confuse concurrent hook events with nested reentrancy", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => (firstStarted = resolve));
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const seen: string[] = [];

    registry.register({
      pluginId: "observer",
      hookName: "tool:after",
      handler: async (event) => {
        seen.push(event.toolName);
        if (event.toolName === "first") {
          firstStarted();
          await gate;
        }
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    const first = runner.runObservingHook("tool:after", {
      toolName: "first",
      params: {},
      result: { success: true },
      durationMs: 1,
      chatId: "chat-a",
      isGroup: false,
    });
    await started;
    const second = runner.runObservingHook("tool:after", {
      toolName: "second",
      params: {},
      result: { success: true },
      durationMs: 1,
      chatId: "chat-b",
      isGroup: false,
    });
    releaseFirst();
    await Promise.all([first, second]);

    expect(seen).toEqual(["first", "second"]);
  });
});
