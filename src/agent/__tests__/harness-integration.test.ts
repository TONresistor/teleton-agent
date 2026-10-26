import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
const testHome = vi.hoisted(() => {
  const p = `/tmp/teleton-runtime-regression-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.TELETON_HOME = p;
  return p;
});
afterAll(() => rmSync(testHome, { recursive: true, force: true }));
const mocks = vi.hoisted(() => ({ db: null as any, complete: vi.fn(), stream: vi.fn() }));
vi.mock("../../memory/index.js", () => ({ getDatabase: () => ({ getDb: () => mocks.db }) }));
vi.mock("@earendil-works/pi-ai/compat", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  complete: mocks.complete,
  stream: mocks.stream,
}));
// Only model I/O and the database locator are replaced. The actual runtime,
// preparation, registry, task store, compaction, finalizer and transcripts run.
import { ensureSchema } from "../../memory/schema.js";
import { ConfigSchema } from "../../config/schema.js";
import { AgentRuntime } from "../../agent/runtime.js";
import { ToolRegistry } from "../../agent/tools/registry.js";
import { getTaskStore } from "../../memory/agent/tasks.js";
import { ScheduledTaskHandler } from "../../scheduled-tasks.js";
import { GrammyBotBridge } from "../../telegram/bridges/bot.js";
import { getOrCreateSession } from "../../session/store.js";
import {
  appendToTranscript,
  flushAllTranscripts,
  getTranscriptPath,
} from "../../session/transcript.js";
import { CompactionManager } from "../../memory/compaction.js";
import { prepareTurn } from "../../agent/turn-preparation.js";
import {
  summarizeViaClaude,
  summarizeInChunks,
  summarizeWithFallback,
} from "../../memory/ai-summarization.js";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const answer = (text = "done", stopReason = "stop", content?: any[]) => ({
  role: "assistant",
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  timestamp: Date.now(),
  usage,
  stopReason,
  content: content ?? [{ type: "text", text }],
});
const toolAnswer = () =>
  answer("", "toolUse", [
    { type: "toolCall", name: "probe_action", id: `call-${Math.random()}`, arguments: {} },
  ]);
function config(iterations = 5) {
  return ConfigSchema.parse({
    agent: { api_key: "simulated", max_agentic_iterations: iterations },
    tool_search: { enabled: false },
    tool_rag: { enabled: false },
    telegram: { mode: "bot", bot_token: "123:fake", owner_id: 1, admin_ids: [1] },
  });
}
function bridge() {
  const b = Object.create(GrammyBotBridge.prototype) as any;
  b.activeDraftIds = new Map();
  b.bot = {
    api: {
      sendMessageDraft: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => ({ message_id: 100, date: 1 })),
    },
  };
  return b;
}
function taskMessage(task: any, id = 1) {
  return { text: `[TASK:${task.id}] work`, id, chatId: "1", senderId: 1, timestamp: new Date() };
}
const origin = { description: "work", originSenderId: 1, originChatId: "1", originIsGroup: false };
function runtimeWithAction(iterations = 1) {
  const registry = new ToolRegistry("bot");
  const effect = vi.fn(async () => ({ success: true, data: { proof: "simulated-action" } }));
  registry.register(
    {
      name: "probe_action",
      description: "simulated action",
      parameters: { type: "object", properties: {} },
    } as any,
    effect
  );
  return { runtime: new AgentRuntime(config(iterations), "test soul", registry), effect, registry };
}
beforeEach(() => {
  mkdirSync(`${testHome}/workspace`, { recursive: true });
  mocks.db = new Database(":memory:");
  ensureSchema(mocks.db);
  mocks.complete.mockReset();
  mocks.stream.mockReset();
});
afterEach(async () => {
  await flushAllTranscripts();
  mocks.db.close();
  vi.restoreAllMocks();
});

describe("Minimal harness regressions", () => {
  it("uses the fallback immediately when the primary quota is exhausted", async () => {
    const cfg = config();
    cfg.agent.fallbacks = [{ provider: "openai", model: "gpt-4.1", api_key: "fallback-key" }];
    mocks.complete
      .mockResolvedValueOnce({ ...answer("", "error"), errorMessage: "429 insufficient_quota" })
      .mockResolvedValueOnce(answer("Fallback answer"));

    const result = await new AgentRuntime(cfg, "test").processMessage({
      chatId: "quota-test",
      userMessage: "answer this",
    });

    expect(result.content).toBe("Fallback answer");
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete.mock.calls[1][0]).toMatchObject({ provider: "openai", id: "gpt-4.1" });
  });

  it.each([false, true])(
    "rejects an aborted response before tools run (tools: %s)",
    async (withTools) => {
      const { runtime, effect } = runtimeWithAction();
      const interrupted = answer(
        "Partial answer",
        "aborted",
        withTools ? toolAnswer().content : undefined
      );
      mocks.complete.mockResolvedValue(interrupted);

      await expect(
        runtime.processMessage({
          chatId: "abort-test",
          userMessage: "perform action",
          toolContext: { bridge: bridge(), db: mocks.db, config: config(), senderId: 1 },
        })
      ).rejects.toThrow("Model response was aborted");

      expect(effect).not.toHaveBeenCalled();
      expect(mocks.complete).toHaveBeenCalledOnce();
      await flushAllTranscripts();
      const session = getOrCreateSession("abort-test");
      const rows = readFileSync(getTranscriptPath(session.sessionId), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(rows.filter((row) => row.role === "assistant")).toEqual([]);
      expect(
        mocks.db.prepare("SELECT status FROM agent_turn_traces WHERE chat_id = ?").get("abort-test")
      ).toEqual({ status: "error" });
    }
  );

  it("clears an aborted streaming draft without publishing partial text", async () => {
    const interrupted = answer("Partial answer", "aborted");
    mocks.stream.mockReturnValue({
      result: async () => interrupted,
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", delta: "Partial answer" };
      },
    });
    const b = bridge();
    await expect(
      new AgentRuntime(config(), "test").processMessage({
        chatId: "1",
        userMessage: "write response",
        streamToChat: { chatId: "1", bridge: b, mode: "replace" },
      })
    ).rejects.toThrow("Model response was aborted");

    expect(b.bot.api.sendMessage).not.toHaveBeenCalled();
    expect(b.activeDraftIds.size).toBe(0);
    expect(b.bot.api.sendMessageDraft).toHaveBeenLastCalledWith(1, expect.any(Number), " ");
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each(["error", "aborted", "empty"])(
    "rejects a failed summary response: %s",
    async (failure) => {
      mocks.complete.mockResolvedValue({
        ...answer(
          failure === "empty" ? " " : "Partial summary",
          failure === "empty" ? "stop" : failure
        ),
        errorMessage: failure === "error" ? "401 Invalid API key" : undefined,
      });
      await expect(
        summarizeViaClaude({
          messages: [{ role: "user", content: "Preserve this fact", timestamp: 1 }],
          apiKey: "simulated",
        })
      ).rejects.toThrow();
    }
  );

  it.each(["error", "aborted", "empty"])("rejects a failed summary merge: %s", async (failure) => {
    mocks.complete
      .mockResolvedValueOnce(answer("First summary"))
      .mockResolvedValueOnce(answer("Second summary"))
      .mockResolvedValueOnce(
        answer(failure === "empty" ? " " : "Partial merge", failure === "empty" ? "stop" : failure)
      );
    await expect(
      summarizeInChunks({
        messages: [
          { role: "user", content: "First fact", timestamp: 1 },
          { role: "user", content: "Second fact", timestamp: 2 },
        ],
        apiKey: "simulated",
        maxChunkTokens: 1,
      })
    ).rejects.toThrow();
    expect(mocks.complete).toHaveBeenCalledTimes(3);
  });

  it("does not return a placeholder when every summary attempt fails", async () => {
    mocks.complete.mockResolvedValue({
      ...answer("", "error"),
      errorMessage: "401 Invalid API key",
    });
    await expect(
      summarizeWithFallback({
        messages: [{ role: "user", content: "Keep this fact", timestamp: 1 }],
        apiKey: "simulated",
        contextWindow: 128000,
      })
    ).rejects.toThrow("AI summarization failed for all fallback attempts");
  });

  it("preserves the current transcript and inbound message when actual summary calls fail", async () => {
    const session = getOrCreateSession("failed-compaction");
    appendToTranscript(session.sessionId, { role: "user", content: "KEEP_OLD_FACT", timestamp: 1 });
    appendToTranscript(session.sessionId, answer("Previous answer") as any);
    mocks.complete.mockResolvedValue({
      ...answer("", "error"),
      errorMessage: "401 Invalid API key",
    });
    const result = await prepareTurn(
      { chatId: "failed-compaction", userMessage: "CURRENT_ONCE" },
      Date.now(),
      {
        config: config(),
        soul: "test",
        compactionManager: new CompactionManager({
          enabled: true,
          maxMessages: 3,
          keepRecentMessages: 1,
          memoryFlushEnabled: false,
        }),
        contextBuilder: null,
        embedder: null,
        toolRegistry: null,
        getMemoryStats: () => ({ totalMessages: 0, totalChats: 0, knowledgeChunks: 0 }),
      }
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.turn.session.sessionId).toBe(session.sessionId);
    expect(
      result.turn.context.messages.some(
        (msg) => msg.role === "user" && msg.content === "KEEP_OLD_FACT"
      )
    ).toBe(true);
    await flushAllTranscripts();
    const rows = readFileSync(getTranscriptPath(session.sessionId), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      rows.filter((row) => typeof row.content === "string" && row.content.includes("CURRENT_ONCE"))
    ).toHaveLength(1);
    expect(rows.some((row) => row.content === "KEEP_OLD_FACT")).toBe(true);
  });

  it("C03: distinct Telegram triggers of one running task execute only once", async () => {
    const { runtime, effect } = runtimeWithAction();
    let release!: () => void;
    mocks.complete
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return toolAnswer();
      })
      .mockResolvedValue(toolAnswer());
    const task = getTaskStore(mocks.db).createTask(origin);
    const handler = new ScheduledTaskHandler(runtime, bridge(), config(1));
    const first = handler.execute(taskMessage(task, 10) as any);
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
    const second = handler.execute(taskMessage(task, 11) as any);
    await second;
    expect((runtime as any).turnCoordinator.stats.pending).toBe(1);
    expect(runtime.getActiveTurnCount()).toBe(1);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(runtime.getActiveTurnCount()).toBe(0);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(mocks.db.prepare("SELECT COUNT(*) AS n FROM action_executions").get().n).toBe(1);
  });
  it("C05: complete runtime plus actual bot sender publishes final text once", async () => {
    const text = "A".repeat(4000) + "TAIL";
    mocks.stream.mockImplementation(() => ({
      result: async () => answer(text),
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", delta: "A".repeat(4000) };
        yield { type: "text_delta", delta: "TAIL" };
      },
    }));
    const b = bridge();
    const result = await new AgentRuntime(config(), "test").processMessage({
      chatId: "1",
      userMessage: "write response",
      streamToChat: { chatId: "1", bridge: b, mode: "replace" },
    });
    expect(result.streamed).toBe(true);
    expect(b.bot.api.sendMessage.mock.calls.map((call: any[]) => call[1].length)).toEqual([4004]);
  });
  it("C06: real compaction and JSONL persistence retain one copy of the inbound message", async () => {
    const session = getOrCreateSession("compact");
    appendToTranscript(session.sessionId, { role: "user", content: "previous", timestamp: 1 });
    appendToTranscript(session.sessionId, answer("previous reply") as any);
    mocks.complete.mockResolvedValue(answer("summary"));
    const result = await prepareTurn(
      { chatId: "compact", userMessage: "CURRENT_ONCE_SENTINEL" },
      Date.now(),
      {
        config: config(),
        soul: "test",
        compactionManager: new CompactionManager({
          enabled: true,
          maxMessages: 3,
          keepRecentMessages: 1,
          memoryFlushEnabled: false,
        }),
        contextBuilder: null,
        embedder: null,
        toolRegistry: null,
        getMemoryStats: () => ({ totalMessages: 0, totalChats: 0, knowledgeChunks: 0 }),
      }
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    await flushAllTranscripts();
    const rows = readFileSync(getTranscriptPath(result.turn.session.sessionId), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      rows.filter(
        (row) => typeof row.content === "string" && row.content.includes("CURRENT_ONCE_SENTINEL")
      )
    ).toHaveLength(1);
  });
});
