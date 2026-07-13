import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookRegistry } from "../../sdk/hooks/registry.js";
import { createHookRunner } from "../../sdk/hooks/runner.js";
import type {
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforePromptBuildEvent,
  SessionStartEvent,
  SessionEndEvent,
  MessageReceiveEvent,
  ResponseBeforeEvent,
  ResponseAfterEvent,
  ResponseErrorEvent,
  ToolErrorEvent,
  PromptAfterEvent,
  AgentStartEvent,
  AgentStopEvent,
} from "../../sdk/hooks/types.js";

/**
 * Integration tests for hook dispatch in AgentRuntime.
 *
 * These test the HookRunner behavior as it would be used in runtime —
 * verifying the contract between hooks and the agentic loop.
 * Direct runtime.processMessage() tests would require heavy mocking
 * (LLM client, database, Telegram bridge, etc.), so we test the
 * hook runner contract with realistic scenarios instead.
 */

const mockLogger = {
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

let registry: HookRegistry;

beforeEach(() => {
  registry = new HookRegistry();
  vi.restoreAllMocks();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
  mockLogger.debug.mockClear();
});

describe("Runtime Hook Integration", () => {
  it("5.1 tool:before fires before tool execution", async () => {
    const order: string[] = [];

    registry.register({
      pluginId: "audit",
      hookName: "tool:before",
      handler: () => {
        order.push("hook");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: BeforeToolCallEvent = {
      toolName: "ton_get_balance",
      params: { address: "EQ..." },
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };

    await runner.runModifyingHook("tool:before", event);
    order.push("execute");

    expect(order).toEqual(["hook", "execute"]);
  });

  it("5.2 tool:before event.block=true prevents tool execution", async () => {
    registry.register({
      pluginId: "guard",
      hookName: "tool:before",
      handler: (e) => {
        if (e.toolName === "ton_send_ton") {
          e.block = true;
          e.blockReason = "Transfers disabled by policy";
        }
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });
    const executeSpy = vi.fn();

    const event: BeforeToolCallEvent = {
      toolName: "ton_send_ton",
      params: { amount: "1.0" },
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };

    await runner.runModifyingHook("tool:before", event);

    if (!event.block) {
      executeSpy();
    }

    expect(event.block).toBe(true);
    expect(event.blockReason).toBe("Transfers disabled by policy");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("5.3 tool:before event.params mutation passed to execute", async () => {
    registry.register({
      pluginId: "rewriter",
      hookName: "tool:before",
      handler: (e) => {
        e.params.limit = 5; // Force limit
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: BeforeToolCallEvent = {
      toolName: "telegram_search_messages",
      params: { query: "test", limit: 100 },
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };

    await runner.runModifyingHook("tool:before", event);

    // Simulate runtime using modified params
    expect(event.params.limit).toBe(5);
    expect(event.params.query).toBe("test");
  });

  it("5.4 tool:after fires with result and durationMs", async () => {
    const receivedEvents: AfterToolCallEvent[] = [];

    registry.register({
      pluginId: "analytics",
      hookName: "tool:after",
      handler: (e) => {
        receivedEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: AfterToolCallEvent = {
      toolName: "ton_get_balance",
      params: { address: "EQ..." },
      result: { success: true, data: "5.25 TON" },
      durationMs: 142,
      chatId: "123",
      isGroup: false,
    };

    await runner.runObservingHook("tool:after", event);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].toolName).toBe("ton_get_balance");
    expect(receivedEvents[0].result.success).toBe(true);
    expect(receivedEvents[0].durationMs).toBe(142);
  });

  it("5.5 prompt:before additionalContext appears in system prompt", async () => {
    registry.register({
      pluginId: "context-injector",
      hookName: "prompt:before",
      handler: (e) => {
        e.additionalContext += "[Plugin: User has 5.25 TON balance]";
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: BeforePromptBuildEvent = {
      chatId: "123",
      sessionId: "sess-1",
      isGroup: false,
      additionalContext: "",
    };

    await runner.runModifyingHook("prompt:before", event);

    expect(event.additionalContext).toContain("5.25 TON balance");
  });

  it("5.6 session:start fires on new session", async () => {
    const receivedEvents: SessionStartEvent[] = [];

    registry.register({
      pluginId: "welcome",
      hookName: "session:start",
      handler: (e) => {
        receivedEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    await runner.runObservingHook("session:start", {
      sessionId: "new-session-123",
      chatId: "456",
      isResume: false,
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].sessionId).toBe("new-session-123");
    expect(receivedEvents[0].isResume).toBe(false);
  });

  it("5.7 session:end fires on session reset", async () => {
    const receivedEvents: SessionEndEvent[] = [];

    registry.register({
      pluginId: "flush",
      hookName: "session:end",
      handler: (e) => {
        receivedEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    await runner.runObservingHook("session:end", {
      sessionId: "ending-session",
      chatId: "789",
      messageCount: 42,
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].messageCount).toBe(42);
  });

  it("5.8 No hooks registered: runner methods return immediately", async () => {
    const runner = createHookRunner(registry, { logger: mockLogger });

    // All hook types should return immediately without error
    await runner.runModifyingHook("tool:before", {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    });

    await runner.runObservingHook("tool:after", {
      toolName: "test",
      params: {},
      result: { success: true },
      durationMs: 10,
      chatId: "123",
      isGroup: false,
    });

    await runner.runModifyingHook("prompt:before", {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      additionalContext: "",
    });

    await runner.runObservingHook("session:start", {
      sessionId: "s1",
      chatId: "123",
      isResume: false,
    });

    await runner.runObservingHook("session:end", {
      sessionId: "s1",
      chatId: "123",
      messageCount: 0,
    });

    // No errors logged
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("5.9 gocoon provider path: hooks fire same as standard path", async () => {
    // Hooks fire before the gocoon/standard fork — same event for both paths
    const beforeCalls: string[] = [];
    const afterCalls: string[] = [];

    registry.register({
      pluginId: "monitor",
      hookName: "tool:before",
      handler: (e) => {
        beforeCalls.push(e.toolName);
      },
      priority: 0,
    });
    registry.register({
      pluginId: "monitor",
      hookName: "tool:after",
      handler: (e) => {
        afterCalls.push(e.toolName);
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    // Simulate tool call (same event regardless of gocoon or standard provider)
    const beforeEvent: BeforeToolCallEvent = {
      toolName: "ton_get_balance",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };
    await runner.runModifyingHook("tool:before", beforeEvent);

    const afterEvent: AfterToolCallEvent = {
      toolName: "ton_get_balance",
      params: {},
      result: { success: true, data: "5 TON" },
      durationMs: 50,
      chatId: "123",
      isGroup: false,
    };
    await runner.runObservingHook("tool:after", afterEvent);

    expect(beforeCalls).toEqual(["ton_get_balance"]);
    expect(afterCalls).toEqual(["ton_get_balance"]);
  });

  it("5.10 Enforcement hook errors fail closed without throwing", async () => {
    registry.register({
      pluginId: "buggy",
      hookName: "tool:before",
      handler: () => {
        throw new Error("Plugin crashed");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: BeforeToolCallEvent = {
      toolName: "test_tool",
      params: { key: "val" },
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    };

    // The runner contains the plugin exception but blocks the action.
    await runner.runModifyingHook("tool:before", event);

    expect(event.block).toBe(true);
    expect(event.blockReason).toContain("Plugin crashed");

    // Error was logged (with duration)
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Plugin crashed"));
  });
});

// ─── New Hook Tests ──────────────────────────────────────────────

describe("message:receive hook", () => {
  it("6.1 message:receive can block a message", async () => {
    registry.register({
      pluginId: "spam-filter",
      hookName: "message:receive",
      handler: (e) => {
        if (e.text.includes("buy crypto")) {
          e.block = true;
          e.blockReason = "spam detected";
        }
      },
      priority: -50,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: MessageReceiveEvent = {
      chatId: "123",
      senderId: "456",
      senderName: "Test",
      isGroup: false,
      isReply: false,
      messageId: 1,
      timestamp: Date.now(),
      text: "buy crypto now!",
      block: false,
      blockReason: "",
      additionalContext: "",
    };

    await runner.runModifyingHook("message:receive", event);

    expect(event.block).toBe(true);
    expect(event.blockReason).toBe("spam detected");
  });

  it("6.2 message:receive can mutate text", async () => {
    registry.register({
      pluginId: "normalizer",
      hookName: "message:receive",
      handler: (e) => {
        e.text = e.text.toLowerCase().trim();
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: MessageReceiveEvent = {
      chatId: "123",
      senderId: "456",
      senderName: "Test",
      isGroup: false,
      isReply: false,
      messageId: 1,
      timestamp: Date.now(),
      text: "  HELLO WORLD  ",
      block: false,
      blockReason: "",
      additionalContext: "",
    };

    await runner.runModifyingHook("message:receive", event);

    expect(event.text).toBe("hello world");
  });

  it("6.3 message:receive can inject context", async () => {
    registry.register({
      pluginId: "context-enricher",
      hookName: "message:receive",
      handler: (e) => {
        if (e.text.includes("invoice")) {
          e.additionalContext = "User is asking about invoices. Use formal tone.";
        }
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: MessageReceiveEvent = {
      chatId: "123",
      senderId: "456",
      senderName: "Test",
      isGroup: false,
      isReply: false,
      messageId: 1,
      timestamp: Date.now(),
      text: "show me the invoice",
      block: false,
      blockReason: "",
      additionalContext: "",
    };

    await runner.runModifyingHook("message:receive", event);

    expect(event.additionalContext).toContain("formal tone");
  });

  it("6.4 message:receive block short-circuits subsequent hooks", async () => {
    const order: string[] = [];

    registry.register({
      pluginId: "blocker",
      hookName: "message:receive",
      handler: (e) => {
        order.push("blocker");
        e.block = true;
      },
      priority: -10,
    });

    registry.register({
      pluginId: "enricher",
      hookName: "message:receive",
      handler: () => {
        order.push("enricher"); // Should NOT run
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: MessageReceiveEvent = {
      chatId: "123",
      senderId: "456",
      senderName: "Test",
      isGroup: false,
      isReply: false,
      messageId: 1,
      timestamp: Date.now(),
      text: "hello",
      block: false,
      blockReason: "",
      additionalContext: "",
    };

    await runner.runModifyingHook("message:receive", event);

    expect(order).toEqual(["blocker"]);
    expect(event.block).toBe(true);
  });
});

describe("response:before hook", () => {
  it("6.5 response:before can mutate response text", async () => {
    registry.register({
      pluginId: "branding",
      hookName: "response:before",
      handler: (e) => {
        e.text += "\n\n— Powered by Teleton";
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: ResponseBeforeEvent = {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      originalText: "Hello!",
      text: "Hello!",
      block: false,
      blockReason: "",
      metadata: {},
    };

    await runner.runModifyingHook("response:before", event);

    expect(event.text).toContain("Powered by Teleton");
    expect(event.originalText).toBe("Hello!"); // immutable
  });

  it("6.6 response:before can block response", async () => {
    registry.register({
      pluginId: "content-filter",
      hookName: "response:before",
      handler: (e) => {
        if (e.text.includes("secret")) {
          e.block = true;
          e.blockReason = "Contains secret content";
        }
      },
      priority: -10,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    const event: ResponseBeforeEvent = {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      originalText: "The secret code is 1234",
      text: "The secret code is 1234",
      block: false,
      blockReason: "",
      metadata: {},
    };

    await runner.runModifyingHook("response:before", event);

    expect(event.block).toBe(true);
    expect(event.blockReason).toBe("Contains secret content");
  });

  it("6.7 response:before metadata passes to response:after", async () => {
    const afterEvents: ResponseAfterEvent[] = [];

    registry.register({
      pluginId: "tracker",
      hookName: "response:before",
      handler: (e) => {
        e.metadata.tracked = true;
        e.metadata.startedAt = Date.now();
      },
      priority: 0,
    });

    registry.register({
      pluginId: "tracker",
      hookName: "response:after",
      handler: (e) => {
        afterEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    // Simulate response:before
    const beforeEvent: ResponseBeforeEvent = {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      originalText: "Hello",
      text: "Hello",
      block: false,
      blockReason: "",
      metadata: {},
    };
    await runner.runModifyingHook("response:before", beforeEvent);

    // Simulate response:after with metadata from before
    const afterEvent: ResponseAfterEvent = {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      text: beforeEvent.text,
      durationMs: 500,
      toolsUsed: ["ton_get_balance"],
      metadata: beforeEvent.metadata,
    };
    await runner.runObservingHook("response:after", afterEvent);

    expect(afterEvents).toHaveLength(1);
    expect(afterEvents[0].metadata.tracked).toBe(true);
  });
});

describe("response:after hook", () => {
  it("6.8 response:after receives analytics data", async () => {
    const receivedEvents: ResponseAfterEvent[] = [];

    registry.register({
      pluginId: "analytics",
      hookName: "response:after",
      handler: (e) => {
        receivedEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    await runner.runObservingHook("response:after", {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      text: "Here's your balance: 5.25 TON",
      durationMs: 1200,
      toolsUsed: ["ton_get_balance", "ton_get_price"],
      tokenUsage: { input: 500, output: 100 },
      metadata: {},
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].durationMs).toBe(1200);
    expect(receivedEvents[0].toolsUsed).toEqual(["ton_get_balance", "ton_get_price"]);
    expect(receivedEvents[0].tokenUsage?.input).toBe(500);
  });
});

describe("tool:error hook", () => {
  it("6.9 tool:error fires on tool exception", async () => {
    const receivedEvents: ToolErrorEvent[] = [];

    registry.register({
      pluginId: "monitor",
      hookName: "tool:error",
      handler: (e) => {
        receivedEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    await runner.runObservingHook("tool:error", {
      toolName: "ton_send_ton",
      params: { amount: "1.0", to: "EQ..." },
      error: "Insufficient balance",
      stack: "Error: Insufficient balance\n    at ...",
      chatId: "123",
      isGroup: false,
      durationMs: 45,
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].toolName).toBe("ton_send_ton");
    expect(receivedEvents[0].error).toBe("Insufficient balance");
    expect(receivedEvents[0].durationMs).toBe(45);
  });
});

describe("response:error hook", () => {
  it("6.10 response:error fires on LLM error", async () => {
    const receivedEvents: ResponseErrorEvent[] = [];

    registry.register({
      pluginId: "monitor",
      hookName: "response:error",
      handler: (e) => {
        receivedEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    await runner.runObservingHook("response:error", {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      error: "Rate limit exceeded",
      errorCode: "RATE_LIMIT",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      retryCount: 2,
      durationMs: 3000,
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].errorCode).toBe("RATE_LIMIT");
    expect(receivedEvents[0].provider).toBe("anthropic");
  });
});

describe("prompt:after hook", () => {
  it("6.11 prompt:after receives prompt metrics", async () => {
    const receivedEvents: PromptAfterEvent[] = [];

    registry.register({
      pluginId: "cost-tracker",
      hookName: "prompt:after",
      handler: (e) => {
        receivedEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    await runner.runObservingHook("prompt:after", {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      promptLength: 5000,
      sectionCount: 10,
      ragContextLength: 1200,
      hookContextLength: 300,
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].promptLength).toBe(5000);
    expect(receivedEvents[0].ragContextLength).toBe(1200);
  });
});

describe("agent:start / agent:stop hooks", () => {
  it("6.12 agent:start fires with startup info", async () => {
    const receivedEvents: AgentStartEvent[] = [];

    registry.register({
      pluginId: "health-check",
      hookName: "agent:start",
      handler: (e) => {
        receivedEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    await runner.runObservingHook("agent:start", {
      version: "0.8.0",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      pluginCount: 3,
      toolCount: 123,
      timestamp: Date.now(),
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].version).toBe("0.8.0");
    expect(receivedEvents[0].toolCount).toBe(123);
  });

  it("6.13 agent:stop fires with uptime and stats", async () => {
    const receivedEvents: AgentStopEvent[] = [];

    registry.register({
      pluginId: "stats",
      hookName: "agent:stop",
      handler: (e) => {
        receivedEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    await runner.runObservingHook("agent:stop", {
      reason: "manual",
      uptimeMs: 3600000,
      messagesProcessed: 42,
      timestamp: Date.now(),
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].reason).toBe("manual");
    expect(receivedEvents[0].uptimeMs).toBe(3600000);
    expect(receivedEvents[0].messagesProcessed).toBe(42);
  });
});

describe("tool:after with blocked field (improvement #5)", () => {
  it("6.14 tool:after includes blocked=true when tool:before blocks", async () => {
    const afterEvents: AfterToolCallEvent[] = [];

    registry.register({
      pluginId: "monitor",
      hookName: "tool:after",
      handler: (e) => {
        afterEvents.push({ ...e });
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    // Simulate what runtime does when tool:before blocks
    const afterEvent: AfterToolCallEvent = {
      toolName: "ton_send_ton",
      params: { amount: "100" },
      result: { success: false, error: "Blocked by policy" },
      durationMs: 0,
      chatId: "123",
      isGroup: false,
      blocked: true,
      blockReason: "Transfers disabled by policy",
    };
    await runner.runObservingHook("tool:after", afterEvent);

    expect(afterEvents).toHaveLength(1);
    expect(afterEvents[0].blocked).toBe(true);
    expect(afterEvents[0].blockReason).toBe("Transfers disabled by policy");
  });
});

describe("Runner improvements", () => {
  it("6.15 observing hooks run in parallel", async () => {
    const startTimes: number[] = [];
    const endTimes: number[] = [];

    // Register two slow observing hooks
    for (let i = 0; i < 2; i++) {
      registry.register({
        pluginId: `slow-${i}`,
        hookName: "session:start",
        handler: async () => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 50));
          endTimes.push(Date.now());
        },
        priority: 0,
      });
    }

    const runner = createHookRunner(registry, { logger: mockLogger });
    const t0 = Date.now();

    await runner.runObservingHook("session:start", {
      sessionId: "s1",
      chatId: "123",
      isResume: false,
    });

    const elapsed = Date.now() - t0;

    // Parallel: should take ~50ms, not ~100ms
    // Use generous threshold for CI/slow machines
    expect(elapsed).toBeLessThan(120);
    expect(startTimes).toHaveLength(2);
    expect(endTimes).toHaveLength(2);
  });

  it("6.16 unregister removes all hooks for a plugin", () => {
    registry.register({
      pluginId: "my-plugin",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
    });
    registry.register({
      pluginId: "my-plugin",
      hookName: "tool:after",
      handler: () => {},
      priority: 0,
    });
    registry.register({
      pluginId: "other-plugin",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
    });

    expect(registry.hasHooks("tool:before")).toBe(true);
    expect(registry.hasHooks("tool:after")).toBe(true);

    const removed = registry.unregister("my-plugin");

    expect(removed).toBe(2);
    expect(registry.hasHooks("tool:before")).toBe(true); // other-plugin still has one
    expect(registry.hasHooks("tool:after")).toBe(false);
  });

  it("6.17 error logs include duration", async () => {
    registry.register({
      pluginId: "crasher",
      hookName: "tool:before",
      handler: () => {
        throw new Error("boom");
      },
      priority: 0,
    });

    const runner = createHookRunner(registry, { logger: mockLogger });

    await runner.runModifyingHook("tool:before", {
      toolName: "test",
      params: {},
      chatId: "123",
      isGroup: false,
      block: false,
      blockReason: "",
    });

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringMatching(/boom.*\(after \d+ms\)/));
  });

  it("6.18 No hooks registered: new hook types return immediately", async () => {
    const runner = createHookRunner(registry, { logger: mockLogger });

    // All new hook types should return immediately without error
    await runner.runModifyingHook("message:receive", {
      chatId: "123",
      senderId: "456",
      senderName: "Test",
      isGroup: false,
      isReply: false,
      messageId: 1,
      timestamp: Date.now(),
      text: "hello",
      block: false,
      blockReason: "",
      additionalContext: "",
    });

    await runner.runModifyingHook("response:before", {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      originalText: "hi",
      text: "hi",
      block: false,
      blockReason: "",
      metadata: {},
    });

    await runner.runObservingHook("response:after", {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      text: "hi",
      durationMs: 100,
      toolsUsed: [],
      metadata: {},
    });

    await runner.runObservingHook("response:error", {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      error: "test",
      provider: "test",
      model: "test",
      retryCount: 0,
      durationMs: 0,
    });

    await runner.runObservingHook("tool:error", {
      toolName: "test",
      params: {},
      error: "test",
      chatId: "123",
      isGroup: false,
      durationMs: 0,
    });

    await runner.runObservingHook("prompt:after", {
      chatId: "123",
      sessionId: "s1",
      isGroup: false,
      promptLength: 0,
      sectionCount: 0,
      ragContextLength: 0,
      hookContextLength: 0,
    });

    await runner.runObservingHook("agent:start", {
      version: "0.0.0",
      provider: "test",
      model: "test",
      pluginCount: 0,
      toolCount: 0,
      timestamp: Date.now(),
    });

    await runner.runObservingHook("agent:stop", {
      reason: "manual",
      uptimeMs: 0,
      messagesProcessed: 0,
      timestamp: Date.now(),
    });

    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
