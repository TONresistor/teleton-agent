import { telegramCreateScheduledTaskExecutor } from "../tools/telegram/tasks/create-scheduled-task.js";
import Database from "better-sqlite3";
import { Type } from "@sinclair/typebox";
import { mkdirSync, rmSync } from "fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@earendil-works/pi-ai";
const taskHome = vi.hoisted(() => {
  const path = `/tmp/teleton-correction-contracts-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.TELETON_HOME = path;
  return path;
});
const mocks = vi.hoisted(() => ({
  db: null as Database.Database | null,
  complete: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("../../memory/index.js", () => ({ getDatabase: () => ({ getDb: () => mocks.db }) }));
vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  complete: mocks.complete,
  stream: mocks.stream,
}));
import { ensureSchema } from "../../memory/schema.js";
import { ConfigSchema } from "../../config/schema.js";
import { ToolRegistry } from "../tools/registry.js";
import { executeToolBatch } from "../loop/tool-batch.js";
import { AgentRuntime } from "../runtime.js";
import { GrammyBotBridge } from "../../telegram/bridges/bot.js";
import { MessageHandler } from "../../telegram/handlers.js";
import { ScheduledTaskHandler } from "../../scheduled-tasks.js";
import { getTaskStore } from "../../memory/agent/tasks.js";
import { flushAllTranscripts } from "../../session/transcript.js";
import type { ITelegramBridge, TelegramMessage } from "../../telegram/bridge-interface.js";
import type { MessageStore } from "../../memory/feed/messages.js";
import type { EmbeddingProvider } from "../../memory/embeddings/provider.js";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const answer = (text: string, content?: unknown[]) => ({
  role: "assistant",
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  timestamp: Date.now(),
  usage,
  stopReason: content ? "toolUse" : "stop",
  content: content ?? [{ type: "text", text }],
});
const sendCall: ToolCall = {
  type: "toolCall",
  id: "send",
  name: "telegram_send_message",
  arguments: { chatId: "1", text: "tool-delivered text" },
};
function config() {
  return ConfigSchema.parse({
    agent: { api_key: "fake", max_agentic_iterations: 5 },
    tool_search: { enabled: false },
    tool_rag: { enabled: false },
    telegram: {
      mode: "bot",
      bot_token: "123:fake",
      owner_id: 1,
      admin_ids: [1],
      typing_simulation: false,
    },
  });
}
function bridge() {
  const destination = Object.create(GrammyBotBridge.prototype) as GrammyBotBridge;
  Object.assign(destination, {
    activeDraftIds: new Map(),
    botInfo: { id: 100, firstName: "Agent" },
    bot: {
      api: {
        sendMessageDraft: vi.fn(async () => {}),
        sendMessage: vi.fn(async () => ({ message_id: 77, date: 1 })),
      },
    },
  });
  return destination;
}
function registerSend(registry: ToolRegistry, destination: GrammyBotBridge, rich = false) {
  registry.register(
    {
      name: "telegram_send_message",
      description: "simulated remote send",
      category: "action",
      parameters: Type.Object({ chatId: Type.String(), text: Type.String() }),
    },
    async (params) => {
      const input = params as { chatId: string; text: string };
      const sent = await destination.sendMessage({ chatId: input.chatId, text: input.text });
      return {
        success: true,
        data: {
          chatId: input.chatId,
          messageId: sent.id,
          ...(rich ? { deliveryKind: "rich", renderedText: "rendered rich message" } : {}),
        },
      };
    }
  );
}
function message(id = 1): TelegramMessage {
  return {
    id,
    chatId: "1",
    senderId: 1,
    text: "work",
    isGroup: false,
    isChannel: false,
    isBot: false,
    mentionsMe: true,
    timestamp: new Date(),
    hasMedia: false,
  };
}
beforeEach(() => {
  mkdirSync(`${taskHome}/workspace`, { recursive: true });
  mocks.db = new Database(":memory:");
  ensureSchema(mocks.db);
  mocks.complete.mockReset();
  mocks.stream.mockReset();
});
afterEach(async () => {
  await flushAllTranscripts();
  vi.useRealTimers();
  mocks.db?.close();
});
afterAll(() => rmSync(taskHome, { recursive: true, force: true }));

describe("correction contracts through real boundaries", () => {
  it("rejects schema-invalid parameters changed by tool:before using the real validator before any action", async () => {
    const db = mocks.db!;
    const registry = new ToolRegistry("bot");
    registry.setAdminIds([1]);
    const effect = vi.fn(async () => ({ success: true }));
    registry.register(
      {
        name: "amount_action",
        description: "effect",
        category: "action",
        parameters: Type.Object({ amount: Type.Integer({ minimum: 1 }) }),
      },
      effect
    );
    const call: ToolCall = {
      type: "toolCall",
      id: "amount",
      name: "amount_action",
      arguments: { amount: 1 },
    };
    const hook = {
      runModifyingHook: async (_event: string, event: { params: unknown }) => {
        event.params = { amount: { invalid: true } };
      },
    };
    const batch = await executeToolBatch(
      registry,
      hook as never,
      [call],
      { bridge: bridge(), db, senderId: 1, chatId: "1", isGroup: false, turnId: "mutated" },
      "1",
      false
    );
    expect(batch.execResults[0].result.success).toBe(false);
    expect(batch.execResults[0].result.error).toMatch(/amount|argument|parameter/i);
    expect(effect).not.toHaveBeenCalled();
    expect(call.arguments).toEqual({ amount: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM action_executions").get()).toEqual({ n: 0 });
  });

  it("suppresses a streamed acknowledgement after a rich send through the actual runtime and message handler", async () => {
    const destination = bridge();
    const registry = new ToolRegistry("bot");
    registerSend(registry, destination, true);
    let iteration = 0;
    mocks.stream.mockImplementation(() => {
      const current = iteration++;
      return {
        result: async () =>
          current === 0 ? answer("", [sendCall]) : answer("acknowledgement that must not be sent"),
        async *[Symbol.asyncIterator]() {
          if (current > 0)
            yield { type: "text_delta", delta: "acknowledgement that must not be sent" };
        },
      };
    });
    const runtime = new AgentRuntime(config(), "test", registry);
    const handler = new MessageHandler(
      destination,
      config().telegram,
      runtime,
      mocks.db!,
      { id: "noop", dimensions: 0 } as EmbeddingProvider,
      false,
      config(),
      { storeMessage: vi.fn().mockResolvedValue(undefined) } as unknown as MessageStore
    );
    await handler.handleMessage(message());
    expect(destination.getBot().api.sendMessage).toHaveBeenCalledTimes(1);
    expect(destination.getBot().api.sendMessage).toHaveBeenCalledWith(
      1,
      "tool-delivered text",
      expect.any(Object),
      undefined
    );
    expect(destination.getBot().api.sendMessageDraft).toHaveBeenCalled();
    expect(
      (destination as unknown as { activeDraftIds: Map<string, number> }).activeDraftIds.size
    ).toBe(0);
    expect(
      mocks
        .db!.prepare("SELECT COUNT(*) AS n FROM action_executions WHERE status='succeeded'")
        .get()
    ).toEqual({ n: 1 });
  });

  it.each(["silent", "exact"])(
    "uses common %s suppression in real scheduled execution without publishing another response",
    async (kind) => {
      const destination = bridge();
      const registry = new ToolRegistry("bot");
      if (kind === "exact") {
        registerSend(registry, destination);
        mocks.complete
          .mockResolvedValueOnce(answer("", [sendCall]))
          .mockResolvedValueOnce(answer("tool-delivered text"));
      } else mocks.complete.mockResolvedValueOnce(answer("__SILENT__"));
      const runtime = new AgentRuntime(config(), "test", registry);
      const store = getTaskStore(mocks.db!);
      const task = store.createTask({
        description: "scheduled",
        originSenderId: 1,
        originChatId: "1",
        originIsGroup: false,
      });
      await new ScheduledTaskHandler(runtime, destination as ITelegramBridge, config()).execute({
        ...message(),
        text: `[TASK:${task.id}] scheduled`,
      });
      expect(store.getTask(task.id)?.status).toBe("done");
      expect(destination.getBot().api.sendMessage).toHaveBeenCalledTimes(kind === "silent" ? 0 : 1);
      const ingress = mocks.db!.prepare("SELECT response_json FROM turn_ingress").get() as {
        response_json: string;
      };
      expect(JSON.parse(ingress.response_json).delivery).toMatchObject({
        state: kind === "silent" ? "suppressed" : "delivered",
      });
    }
  );
  it("starts the scheduled budget before its real data-bearing pre-read and never calls the model after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const configuration = config();
    configuration.agent.max_turn_duration_ms = 1_000;
    const destination = bridge();
    const registry = new ToolRegistry("bot");
    const read = vi.fn(
      async (_params: unknown, context: { deadlineAt?: number; signal?: AbortSignal }) => {
        expect(context.deadlineAt).toBe(11_000);
        expect(context.signal).toBeDefined();
        await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
        return { success: true, data: "late read" };
      }
    );
    registry.register(
      {
        name: "scheduled_read",
        description: "read",
        category: "data-bearing",
        parameters: Type.Object({}),
      },
      read
    );
    const runtime = new AgentRuntime(configuration, "test", registry);
    const store = getTaskStore(mocks.db!);
    const task = store.createTask({
      description: "slow scheduled read",
      originSenderId: 1,
      originChatId: "1",
      originIsGroup: false,
      payload: JSON.stringify({ type: "tool_call", tool: "scheduled_read", params: {} }),
    });
    const child = store.createTask({ description: "requires completion", dependsOn: [task.id] });
    const pending = new ScheduledTaskHandler(runtime, destination, configuration).execute({
      ...message(),
      text: `[TASK:${task.id}] slow read`,
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce(), { interval: 1, timeout: 100 });
    await vi.advanceTimersByTimeAsync(11_000 - Date.now());
    await pending;
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(store.getTask(task.id)?.status).toBe("incomplete");
    expect(store.getTask(child.id)?.status).toBe("blocked");
    expect(store.listTaskRuns(task.id)).toMatchObject([
      { status: "incomplete", outcome_reason: "time_budget" },
    ]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", "incomplete"],
    ["unknown", "unknown"],
  ])(
    "requires a confirmed delivery for an explicit send goal (%s)",
    async (delivery, taskStatus) => {
      const destination = bridge();
      vi.mocked(destination.getBot().api.sendMessage).mockRejectedValueOnce(
        delivery === "failed"
          ? { error_code: 400, description: "rejected" }
          : new Error("transport outcome unknown")
      );
      mocks.complete.mockResolvedValueOnce(answer("required report"));
      const runtime = new AgentRuntime(config(), "test", new ToolRegistry("bot"));
      const store = getTaskStore(mocks.db!);
      const task = store.createTask({
        description: "deliver report",
        originSenderId: 1,
        originChatId: "1",
        originIsGroup: false,
        payload: JSON.stringify({
          type: "agent_task",
          instructions: "Send the daily report",
          requiresDelivery: true,
        }),
      });
      const child = store.createTask({
        description: "after delivered report",
        dependsOn: [task.id],
      });
      await new ScheduledTaskHandler(runtime, destination, config()).execute({
        ...message(),
        text: `[TASK:${task.id}] deliver report`,
      });
      expect(store.getTask(task.id)?.status).toBe(taskStatus);
      expect(store.getTask(child.id)?.status).toBe("blocked");
      expect(store.startTask(child.id)).toBeUndefined();
      expect(store.listTaskRuns(task.id)).toMatchObject([
        { status: taskStatus, outcome_reason: "required_delivery" },
      ]);
      expect(destination.getBot().api.sendMessage).toHaveBeenCalledTimes(1);
      expect(mocks.complete).toHaveBeenCalledTimes(1);
    }
  );

  it("rejects a nonboolean requiresDelivery payload flag before scheduling or sending", async () => {
    const destination = bridge();
    const result = await telegramCreateScheduledTaskExecutor(
      {
        description: "report",
        scheduleInSeconds: 60,
        payload: JSON.stringify({
          type: "agent_task",
          instructions: "Send a report",
          requiresDelivery: "yes",
        }),
      },
      { bridge: destination, db: mocks.db!, chatId: "1", isGroup: false, senderId: 1 }
    );
    expect(result).toMatchObject({
      success: false,
      error: 'Payload "requiresDelivery" must be a boolean',
    });
    expect(mocks.db!.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
    expect(destination.getBot().api.sendMessage).not.toHaveBeenCalled();
  });
  it("keeps the independent delivery budget after a scheduled pre-read completes within execution time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const configuration = config();
    configuration.agent.max_turn_duration_ms = 1_000;
    const destination = bridge();
    const registry = new ToolRegistry("bot");
    const read = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      return { success: true, data: "ready" };
    });
    registry.register(
      {
        name: "budgeted_read",
        description: "read",
        category: "data-bearing",
        parameters: Type.Object({}),
      },
      read
    );
    let confirmDelivery!: (receipt: { message_id: number; date: number }) => void;
    vi.mocked(destination.getBot().api.sendMessage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirmDelivery = resolve;
        }) as never
    );
    mocks.complete.mockResolvedValueOnce(answer("report ready"));
    const runtime = new AgentRuntime(configuration, "test", registry);
    const store = getTaskStore(mocks.db!);
    const task = store.createTask({
      description: "deliver after reading",
      originSenderId: 1,
      originChatId: "1",
      originIsGroup: false,
      payload: JSON.stringify({
        type: "tool_call",
        tool: "budgeted_read",
        params: {},
        requiresDelivery: true,
      }),
    });
    const pending = new ScheduledTaskHandler(runtime, destination, configuration).execute({
      ...message(),
      text: `[TASK:${task.id}] report`,
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce(), { interval: 1, timeout: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(destination.getBot().api.sendMessage).toHaveBeenCalledOnce(), {
      interval: 1,
      timeout: 200,
    });
    expect(Date.now()).toBeLessThan(11_000);
    await vi.advanceTimersByTimeAsync(11_001 - Date.now());
    expect(store.getTask(task.id)?.status).toBe("in_progress");
    const signal = vi.mocked(destination.getBot().api.sendMessage).mock.calls[0][3];
    expect(signal?.aborted).toBe(false);
    confirmDelivery({ message_id: 77, date: 11 });
    await pending;
    expect(store.getTask(task.id)?.status).toBe("done");
    expect(store.listTaskRuns(task.id)).toMatchObject([
      { status: "done", outcome_reason: "completed" },
    ]);
    expect(destination.getBot().api.sendMessage).toHaveBeenCalledOnce();
  });
});
