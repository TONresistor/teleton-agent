import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { ConfigSchema } from "../../config/schema.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";

const mocks = vi.hoisted(() => {
  const session = {
    sessionId: "session-1",
    chatId: "chat-1",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
  };
  return {
    session,
    runModelIteration: vi.fn(),
    recoverLlmError: vi.fn(),
    selectTools: vi.fn(),
    executeToolBatch: vi.fn(),
    recordToolResults: vi.fn(),
    resolveProviderFallback: vi.fn(),
    appendToTranscript: vi.fn(),
    updateSession: vi.fn(),
    traceStart: vi.fn(),
    traceProgress: vi.fn(),
    traceUpdateTarget: vi.fn(),
    traceFinish: vi.fn(),
    traceFail: vi.fn(),
  };
});

const fakeDb = {
  prepare: vi.fn(() => ({
    get: vi.fn(() => ({ count: 0 })),
    all: vi.fn(() => []),
    run: vi.fn(),
  })),
};

vi.mock("../../memory/index.js", () => ({
  getDatabase: () => ({ getDb: () => fakeDb }),
}));

vi.mock("../../memory/compaction.js", () => ({
  DEFAULT_COMPACTION_CONFIG: { enabled: true, maxMessages: 200, maxTokens: 100_000 },
  CompactionManager: class {
    updateConfig() {}
    getConfig() {
      return { enabled: true, maxMessages: 200, memoryFlushEnabled: false };
    }
    async checkAndCompact() {
      return null;
    }
  },
}));

vi.mock("../../session/store.js", () => ({
  getOrCreateSession: () => mocks.session,
  updateSession: (...args: unknown[]) => mocks.updateSession(...args),
  getSession: () => mocks.session,
  resetSession: () => mocks.session,
  shouldResetSession: () => false,
  resetSessionWithPolicy: () => mocks.session,
}));

vi.mock("../../session/transcript.js", () => ({
  transcriptExists: () => false,
  appendToTranscript: (...args: unknown[]) => mocks.appendToTranscript(...args),
}));

vi.mock("../../session/memory-hook.js", () => ({ saveSessionMemory: vi.fn() }));

vi.mock("../../soul/loader.js", () => ({
  buildSystemPrompt: () => "system",
  captureMemorySnapshot: vi.fn(),
  clearMemorySnapshot: vi.fn(),
}));

vi.mock("../client.js", () => ({
  loadContextFromTranscript: (): Context => ({ messages: [] }),
  getProviderModel: (_provider: string, model: string) => ({
    id: model,
    provider: "test",
    api: "test",
    contextWindow: 100_000,
  }),
  getEffectiveApiKey: () => "test-key",
}));

vi.mock("../loop/llm-iteration.js", () => ({
  runModelIteration: (...args: unknown[]) => mocks.runModelIteration(...args),
  recoverLlmError: (...args: unknown[]) => mocks.recoverLlmError(...args),
}));

vi.mock("../loop/tool-batch.js", () => ({
  executeToolBatch: (...args: unknown[]) => mocks.executeToolBatch(...args),
  recordToolResults: (...args: unknown[]) => mocks.recordToolResults(...args),
  injectDiscoveredTools: () => 0,
}));

vi.mock("../tool-selector.js", () => ({
  computeRagEmbedding: () => undefined,
  enforceProviderToolLimit: (tools: unknown) => tools,
  selectTools: (...args: unknown[]) => mocks.selectTools(...args),
}));

vi.mock("../provider-fallback.js", () => ({
  resolveProviderFallback: (...args: unknown[]) => mocks.resolveProviderFallback(...args),
}));

vi.mock("../turn-trace.js", () => ({
  AgentTurnTraceRecorder: class {
    start(...args: unknown[]) {
      mocks.traceStart(...args);
    }
    progress(...args: unknown[]) {
      mocks.traceProgress(...args);
    }
    updateTarget(...args: unknown[]) {
      mocks.traceUpdateTarget(...args);
    }
    finish(...args: unknown[]) {
      mocks.traceFinish(...args);
    }
    fail(...args: unknown[]) {
      mocks.traceFail(...args);
    }
  },
}));

import { AgentRuntime } from "../runtime.js";

function usage() {
  return {
    input: 10,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 12,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
  model = "claude-haiku-4-5-20251001",
  errorMessage?: string
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "test",
    provider: "test",
    model,
    usage: usage(),
    stopReason,
    errorMessage,
    timestamp: 2,
  };
}

function iteration(message: AssistantMessage, text = "") {
  return {
    response: { message, text, context: { messages: [message] } },
    streamed: false,
    streamAccumulatedText: "",
  };
}

function config() {
  return ConfigSchema.parse({
    agent: {
      provider: "anthropic",
      api_key: "test-key",
      model: "claude-haiku-4-5-20251001",
      max_agentic_iterations: 3,
      max_turn_duration_ms: 60_000,
      fallbacks: [{ provider: "codex", model: "gpt-5.6-terra" }],
    },
    telegram: {
      mode: "bot",
      bot_token: "123:test",
      owner_id: 1,
      admin_ids: [1],
      dm_policy: "open",
      group_policy: "open",
    },
  });
}

const registry = {
  setAllowFrom: vi.fn(),
  setAdminIds: vi.fn(),
  getToolCategory: vi.fn(() => "data-bearing"),
} as unknown as ToolRegistry;

const toolContext = {
  bridge: { getMode: () => "bot" },
  db: fakeDb,
  senderId: 1,
} as unknown as Omit<ToolContext, "chatId" | "isGroup">;

describe("AgentRuntime characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.messageCount = 0;
    mocks.selectTools.mockResolvedValue(undefined);
    mocks.resolveProviderFallback.mockReturnValue(null);
    mocks.updateSession.mockReturnValue(mocks.session);
  });

  it("returns and persists a simple model response", async () => {
    const message = assistantMessage([{ type: "text", text: "hello" }]);
    mocks.runModelIteration.mockResolvedValueOnce(iteration(message, "hello"));

    const result = await new AgentRuntime(config()).processMessage({
      chatId: "chat-1",
      userMessage: "hi",
      toolContext,
    });

    expect(result).toEqual({ content: "hello", toolCalls: [], streamed: false });
    expect(mocks.runModelIteration).toHaveBeenCalledOnce();
    expect(mocks.updateSession).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ messageCount: 1, provider: "anthropic" })
    );
    expect(mocks.traceFinish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", stopReason: "completed" })
    );
  });

  it("executes one tool batch before returning the final response", async () => {
    const toolCall = { type: "toolCall" as const, id: "call-1", name: "lookup", arguments: {} };
    const first = assistantMessage([toolCall], "toolUse");
    const final = assistantMessage([{ type: "text", text: "done" }]);
    mocks.selectTools.mockResolvedValue([
      { name: "lookup", description: "Lookup", parameters: Type.Object({}) },
    ]);
    mocks.runModelIteration
      .mockResolvedValueOnce(iteration(first))
      .mockResolvedValueOnce(iteration(final, "done"));
    mocks.executeToolBatch.mockResolvedValue({
      toolPlans: [{ block: toolCall, blocked: false, blockReason: "", params: {} }],
      execResults: [{ result: { success: true, data: { value: 1 } }, durationMs: 1 }],
    });
    mocks.recordToolResults.mockImplementation(
      async (
        _runner: unknown,
        _plans: unknown,
        _results: unknown,
        sink: { totalToolCalls: Array<Record<string, unknown>> }
      ) => {
        sink.totalToolCalls.push({
          name: "lookup",
          input: {},
          durationMs: 1,
          attempted: true,
          result: { success: true, data: { value: 1 } },
        });
        const result: ToolResultMessage = {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "lookup",
          content: [{ type: "text", text: '{"value":1}' }],
          isError: false,
          timestamp: 3,
        };
        return [result];
      }
    );

    const result = await new AgentRuntime(config(), "", registry).processMessage({
      chatId: "chat-1",
      userMessage: "look it up",
      toolContext,
    });

    expect(result.content).toBe("done");
    expect(result.toolCalls).toHaveLength(1);
    expect(mocks.runModelIteration).toHaveBeenCalledTimes(2);
    expect(mocks.executeToolBatch).toHaveBeenCalledOnce();
  });

  it("falls back once after a provider error without executing a tool", async () => {
    const failed = assistantMessage([], "error", "claude-haiku-4-5-20251001", "429 rate limit");
    const recovered = assistantMessage(
      [{ type: "text", text: "fallback" }],
      "stop",
      "gpt-5.6-terra"
    );
    mocks.runModelIteration
      .mockResolvedValueOnce(iteration(failed))
      .mockResolvedValueOnce(iteration(recovered, "fallback"));
    mocks.recoverLlmError.mockRejectedValueOnce(new Error("rate limited"));
    mocks.resolveProviderFallback.mockImplementation(
      (primary: ReturnType<typeof config>["agent"]) => ({
        provider: "codex",
        nextIndex: 1,
        config: { ...primary, provider: "codex", model: "gpt-5.6-terra", fallbacks: [] },
      })
    );

    const result = await new AgentRuntime(config()).processMessage({
      chatId: "chat-1",
      userMessage: "retry",
      toolContext,
    });

    expect(result.content).toBe("fallback");
    expect(mocks.runModelIteration).toHaveBeenCalledTimes(2);
    expect(mocks.executeToolBatch).not.toHaveBeenCalled();
    expect(mocks.traceUpdateTarget).toHaveBeenCalledWith(
      "codex",
      "gpt-5.6-terra",
      expect.any(String)
    );
  });
});
