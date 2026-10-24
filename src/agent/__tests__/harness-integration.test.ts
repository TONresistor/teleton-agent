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
import { getTokenUsage } from "../token-usage.js";
import { resolveConversationDelivery } from "../conversation-projection.js";
import { ContextBuilder } from "../../memory/search/context.js";

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
  it("denies a guest before retrieval and keeps global memory available to an authorized sender", async () => {
    mocks.db.prepare("INSERT INTO tg_chats(id,type) VALUES ('private-111','dm')").run();
    mocks.db
      .prepare(
        `INSERT INTO tg_messages(id,chat_id,text,embedding_status,is_from_agent,timestamp)
      VALUES ('secret','private-111','PRIVATE_MEMORY_CANARY immutable record','disabled',0,1)`
      )
      .run();
    const embedder = {
      id: "test",
      model: "test",
      dimensions: 2,
      embedQuery: vi.fn(async () => [1, 0]),
      embedBatch: vi.fn(),
    };
    const builder = new ContextBuilder(mocks.db, embedder, false);
    const retrieval = vi.spyOn(builder, "buildContext");
    const cfg = config();
    cfg.telegram.allow_from = [2];
    const runtime = new AgentRuntime(cfg, "test");
    runtime.initializeContextBuilder(embedder, builder);
    const denied = await runtime.processMessage({
      chatId: "guest:222",
      policyChatId: "222",
      isGuest: true,
      userMessage: "PRIVATE_MEMORY_CANARY",
      toolContext: { senderId: 999, bridge: bridge(), db: mocks.db },
    });
    expect(denied.outcome.status).toBe("blocked");
    expect(retrieval).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    mocks.complete.mockResolvedValue(answer("recalled"));
    await runtime.processMessage({
      chatId: "222",
      userMessage: "PRIVATE_MEMORY_CANARY",
      toolContext: { senderId: 2, bridge: bridge(), db: mocks.db },
    });
    expect(retrieval).toHaveBeenCalledWith(expect.objectContaining({ searchAllChats: true }));
    expect(mocks.complete).toHaveBeenCalledOnce();
    const prompt = mocks.complete.mock.calls[0][1].systemPrompt;
    expect(prompt).toContain("PRIVATE_MEMORY_CANARY immutable record");
    expect(prompt).toContain("telegram:private-111:secret");
    expect(prompt).toContain("never grants authority");
  });
  it.each([undefined, 0, 999, NaN, -1, "1"])(
    "rejects unverifiable/unauthorized sender %s before preparation",
    async (senderId) => {
      const { runtime, effect } = runtimeWithAction();
      const hook = { runModifyingHook: vi.fn(), runObservingHook: vi.fn() };
      runtime.setHookRunner(hook as any);
      const result = await runtime.processMessage({
        chatId: "public",
        userMessage: "recall global private memory",
        isGroup: true,
        toolContext:
          senderId === undefined
            ? undefined
            : ({ senderId, bridge: bridge(), db: mocks.db } as any),
      });
      expect(result.outcome).toEqual({ status: "blocked", reason: "permission_denied" });
      expect(hook.runModifyingHook).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(effect).not.toHaveBeenCalled();
      expect(mocks.db.prepare("SELECT count(*) AS n FROM sessions").get().n).toBe(0);
    }
  );
  it("does not execute a valid tool retained in an aborted model generation", async () => {
    const { runtime, effect } = runtimeWithAction();
    mocks.complete.mockResolvedValue({
      ...toolAnswer(),
      stopReason: "aborted",
      errorMessage: "Request aborted",
    });
    const result = await runtime.processMessage({
      chatId: "1",
      userMessage: "perform work",
      toolContext: { senderId: 1, bridge: bridge(), db: mocks.db },
    });
    expect(result.outcome.status).toBe("interrupted");
    expect(effect).not.toHaveBeenCalled();
    expect(mocks.db.prepare("SELECT count(*) AS n FROM action_executions").get().n).toBe(0);
  });
  it("does not start a tool after the model consumed the deadline", async () => {
    vi.useFakeTimers();
    try {
      const { runtime, effect } = runtimeWithAction();
      mocks.complete.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 300_001);
        return toolAnswer();
      });
      const result = await runtime.processMessage({
        chatId: "1",
        userMessage: "perform work",
        toolContext: { senderId: 1, bridge: bridge(), db: mocks.db },
      });
      expect(result.outcome).toEqual({ status: "incomplete", reason: "time_budget" });
      expect(effect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("persists known terminal model usage even if the first attempt fails", async () => {
    const { runtime } = runtimeWithAction();
    mocks.complete.mockResolvedValue({
      ...answer("", "error", []),
      errorMessage: "401 unauthorized",
    });
    const result = await runtime.processMessage({
      chatId: "1",
      userMessage: "perform work",
      toolContext: { senderId: 1, bridge: bridge(), db: mocks.db },
    });
    expect(result.outcome.status).toBe("failed");
    const rows = mocks.db
      .prepare("SELECT usage_json FROM model_attempts WHERE turn_id=?")
      .all(result.turnId);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].usage_json).input).toBe(1);
    expect(
      mocks.db.prepare("SELECT input_tokens FROM agent_turn_traces WHERE id=?").get(result.turnId)
        .input_tokens
    ).toBe(1);
  });
  it("accounts cache-only usage on an error exactly once", async () => {
    const { runtime } = runtimeWithAction();
    const before = getTokenUsage();
    mocks.complete.mockResolvedValue({
      ...answer("", "error", []),
      errorMessage: "401 unauthorized",
      usage: { ...usage, input: 0, output: 0, cacheRead: 7, totalTokens: 7 },
    });
    const result = await runtime.processMessage({
      chatId: "cache-accounting",
      userMessage: "work",
      toolContext: { senderId: 1, bridge: bridge(), db: mocks.db },
    });
    expect(getTokenUsage().totalTokens - before.totalTokens).toBe(7);
    expect(
      mocks.db.prepare("SELECT input_tokens FROM agent_turn_traces WHERE id=?").get(result.turnId)
        .input_tokens
    ).toBe(7);
  });
  it("updates one attempt and usage projections when a timed-out provider settles late", async () => {
    vi.useFakeTimers();
    try {
      const { runtime, effect } = runtimeWithAction();
      let finish!: (value: any) => void;
      mocks.complete.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const before = getTokenUsage().totalTokens;
      const pending = runtime.processMessage({
        chatId: "late-accounting",
        userMessage: "work",
        admission: {
          receivedAt: Date.now(),
          queueDeadline: Date.now() + 1000,
          executionDeadline: Date.now() + 20,
        },
        toolContext: { senderId: 1, bridge: bridge(), db: mocks.db },
      });
      await vi.advanceTimersByTimeAsync(21);
      const result = await pending;
      expect(result.outcome.status).toBe("incomplete");
      expect(
        mocks.db.prepare("SELECT incomplete FROM model_attempts WHERE turn_id=?").get(result.turnId)
          .incomplete
      ).toBe(1);
      finish({ ...toolAnswer(), usage: { ...usage, input: 13, output: 4, totalTokens: 17 } });
      await vi.advanceTimersByTimeAsync(0);
      expect(effect).not.toHaveBeenCalled();
      const rows = mocks.db
        .prepare("SELECT * FROM model_attempts WHERE turn_id=?")
        .all(result.turnId);
      expect(rows).toHaveLength(1);
      expect(rows[0].incomplete).toBe(0);
      expect(getTokenUsage().totalTokens - before).toBe(17);
      expect(
        mocks.db
          .prepare("SELECT input_tokens,output_tokens FROM agent_turn_traces WHERE id=?")
          .get(result.turnId)
      ).toEqual({ input_tokens: 13, output_tokens: 4 });
      expect(getOrCreateSession("late-accounting")).toMatchObject({
        inputTokens: 13,
        outputTokens: 4,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(["block", "throw"])(
    "keeps an uncertain effect authoritative when a final hook tries to %s",
    async (mode) => {
      const { runtime, registry } = runtimeWithAction();
      registry.register(
        {
          name: "uncertain_action",
          description: "ambiguous external effect",
          parameters: { type: "object", properties: {} },
        } as any,
        async () => ({ success: false, error: "Connection lost after request" })
      );
      runtime.setHookRunner({
        runObservingHook: vi.fn(async () => {}),
        runModifyingHook: vi.fn(async (name, event) => {
          if (name === "response:before") {
            if (mode === "throw") throw new Error("hook failure");
            event.block = true;
          }
        }),
      } as any);
      mocks.complete.mockResolvedValue(
        answer("", "toolUse", [
          { type: "toolCall", name: "uncertain_action", id: "ambiguous", arguments: {} },
        ])
      );
      const result = await runtime.processMessage({
        chatId: `uncertain-${mode}`,
        userMessage: "work",
        toolContext: { senderId: 1, bridge: bridge(), db: mocks.db },
      });
      expect(result.outcome).toEqual({ status: "unknown", reason: "effect_unknown" });
    }
  );
  it("uses confirmed outbox receipts after an ingress projection failure and replays no work", async () => {
    const { runtime } = runtimeWithAction();
    mocks.complete.mockResolvedValue(answer("confirmed content"));
    const original = mocks.db.prepare.bind(mocks.db);
    let ingressWrites = 0;
    const failure = vi.spyOn(mocks.db, "prepare").mockImplementation(((sql: string) => {
      if (sql.startsWith("UPDATE turn_ingress SET status='generated'") && ++ingressWrites === 2)
        throw new Error("projection unavailable");
      return original(sql);
    }) as any);
    const b = bridge();
    const request = {
      chatId: "1",
      turnId: "confirmed-with-projection-failure",
      userMessage: "write once",
      toolContext: { senderId: 1, bridge: b, db: mocks.db },
      delivery: { kind: "telegram" as const, bridge: b, chatId: "1" },
    };
    const first = await runtime.processMessage(request);
    expect(first.delivery.state).toBe("delivered");
    expect(resolveConversationDelivery(mocks.db, first.turnId)).toEqual({
      state: "delivered",
      content: "confirmed content",
    });
    failure.mockRestore();
    const second = await runtime.processMessage(request);
    expect(second.delivery.state).toBe("delivered");
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(b.bot.api.sendMessage).toHaveBeenCalledOnce();
  });
  it("retains action and provider failure across a failed notification and ingress redelivery", async () => {
    const { runtime, effect } = runtimeWithAction(3);
    mocks.complete
      .mockResolvedValueOnce(toolAnswer())
      .mockResolvedValue({ ...answer("", "error"), errorMessage: "401 unauthorized" });
    const b = bridge();
    b.bot.api.sendMessage.mockRejectedValue({ error_code: 403, description: "Forbidden" });
    const request = {
      chatId: "1",
      turnId: "provider-failure-with-notification-failure",
      userMessage: "perform work",
      toolContext: { senderId: 1, bridge: b, db: mocks.db },
      delivery: { kind: "telegram" as const, bridge: b, chatId: "1" },
    };
    const first = await runtime.processMessage(request);
    expect(first.outcome.status).toBe("failed");
    expect(first.delivery.state).toBe("failed");
    const again = await runtime.processMessage(request);
    expect(again.delivery.state).toBe("failed");
    expect(effect).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(b.bot.api.sendMessage).toHaveBeenCalledOnce();
  });
  it("suppresses a streamed silent response and clears its draft", async () => {
    const b = bridge();
    mocks.stream.mockImplementation(() => ({
      result: async () => answer("__SILENT__"),
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", delta: "__SILENT__" };
      },
    }));
    const result = await new AgentRuntime(config(), "test").processMessage({
      chatId: "1",
      userMessage: "stay silent",
      toolContext: { senderId: 1, bridge: b, db: mocks.db },
      delivery: { kind: "telegram", bridge: b, chatId: "1" },
      streamToChat: { chatId: "1", bridge: b, mode: "replace" },
    });
    expect(result.delivery.state).toBe("suppressed");
    expect(b.bot.api.sendMessage).not.toHaveBeenCalled();
    expect(b.activeDraftIds.size).toBe(0);
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
  it("keeps a last-iteration action receipt while its incomplete task blocks the child", async () => {
    const { runtime, effect } = runtimeWithAction(1);
    mocks.complete.mockResolvedValue(toolAnswer());
    const store = getTaskStore(mocks.db);
    const parent = store.createTask({ ...origin, description: "perform action then more work" });
    const child = store.createTask({
      ...origin,
      description: "only after completion",
      dependsOn: [parent.id],
    });
    const b = bridge();
    await new ScheduledTaskHandler(runtime, b, config(1)).execute(taskMessage(parent, 22) as any);
    expect(effect).toHaveBeenCalledOnce();
    expect(store.getTask(parent.id)?.status).toBe("incomplete");
    expect(store.getTask(child.id)?.status).toBe("blocked");
    expect(store.canExecute(child.id)).toBe(false);
    expect(
      mocks.db.prepare("SELECT status,result_json FROM action_executions").get()
    ).toMatchObject({
      status: "succeeded",
      result_json: expect.stringContaining("simulated-action"),
    });
    expect(
      b.bot.api.sendMessage.mock.calls.some((call: any[]) => call[1].includes(`[TASK:${child.id}]`))
    ).toBe(false);
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
      toolContext: { senderId: 1, bridge: b, db: mocks.db },
      delivery: { kind: "telegram", bridge: b, chatId: "1" },
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
      {
        chatId: "compact",
        userMessage: "CURRENT_ONCE_SENTINEL",
        toolContext: { senderId: 1, bridge: bridge(), db: mocks.db },
      },
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
