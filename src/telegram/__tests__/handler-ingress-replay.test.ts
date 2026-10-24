import { MessagePipeline } from "../../app/message-pipeline.js";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const transcribe = vi.hoisted(() => vi.fn());
vi.mock("../../sdk/telegram-utils.js", () => ({ transcribeAudio: transcribe }));
vi.mock("../offset-store.js", () => ({ readOffset: () => null, writeOffset: vi.fn() }));
import { MessageHandler } from "../handlers.js";
import { ensureSchema } from "../../memory/schema.js";
import { reserveTurnIngress, completeTurnIngress } from "../../memory/turn-ingress.js";
import type { ProcessMessageOptions, AgentResponse } from "../../agent/turn-types.js";
import type { TelegramMessage, ITelegramBridge } from "../bridge-interface.js";
import type { TelegramConfig } from "../../config/schema.js";
import type { EmbeddingProvider } from "../../memory/embeddings/provider.js";
import type { AgentRuntime } from "../../agent/runtime.js";
import type { MessageStore } from "../../memory/feed/messages.js";
function config(): TelegramConfig {
  return {
    admin_ids: [1],
    allow_from: [2],
    dm_policy: "open",
    group_policy: "open",
    group_allow_from: [],
    require_mention: true,
    typing_simulation: false,
    rate_limit_messages_per_second: 30,
    rate_limit_groups_per_minute: 30,
  } as unknown as TelegramConfig;
}
function message(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    id: 1,
    chatId: "123",
    senderId: 2,
    text: "",
    isGroup: false,
    isChannel: false,
    isBot: false,
    mentionsMe: true,
    timestamp: new Date(),
    hasMedia: true,
    mediaType: "voice",
    replyToId: 8,
    _rawMessage: {} as never,
    ...overrides,
  };
}
describe("handler durable replay admission", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    transcribe
      .mockReset()
      .mockResolvedValueOnce({ text: "original transcription" })
      .mockResolvedValue({ text: "changed transcription" });
  });
  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });
  function bridge() {
    return {
      getMode: () => "user",
      getOwnUserId: () => 1n,
      requiresOffsetDedup: () => true,
      sendMessage: vi.fn(),
      fetchReplyContext: vi.fn().mockResolvedValue({ text: "reply" }),
      setTyping: vi.fn(),
    } as unknown as ITelegramBridge;
  }
  function handler(agent: AgentRuntime, destination = bridge()) {
    return new MessageHandler(
      destination,
      config(),
      agent,
      db,
      { id: "noop", dimensions: 0 } as EmbeddingProvider,
      false,
      undefined,
      { storeMessage: vi.fn().mockResolvedValue(undefined) } as unknown as MessageStore
    );
  }
  it("resumes generated delivery without new hooks, reply lookup or transcription", async () => {
    let generations = 0;
    const process = vi.fn(async (opts: ProcessMessageOptions): Promise<AgentResponse> => {
      const reservation = reserveTurnIngress(db, {
        key: opts.ingressKey!,
        hash: opts.ingressHash,
        chatId: opts.chatId,
        messageId: opts.messageId,
        senderId: opts.toolContext?.senderId,
        text: opts.userMessage,
      });
      if (reservation.kind === "generate") {
        generations++;
        const result: AgentResponse = {
          turnId: reservation.turnId,
          outcome: { status: "completed", reason: "completed" },
          delivery: { state: "unknown" },
          content: "generated reply",
        };
        completeTurnIngress(db, opts.ingressKey!, result);
        return result;
      }
      expect(reservation.kind).toBe("resume");
      const result = reservation.response!;
      result.delivery = { state: "delivered", messageIds: [99] };
      completeTurnIngress(db, opts.ingressKey!, result);
      return result;
    });
    const destination = bridge();
    const instance = handler({ processMessage: process } as unknown as AgentRuntime, destination);
    const hook = vi.fn(async () => {});
    instance.setPluginMessageHooks([hook]);
    await instance.handleMessage(message());
    await instance.handleMessage(message());
    await instance.handleMessage(message());
    expect(generations).toBe(1);
    expect(process).toHaveBeenCalledTimes(2);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(destination.fetchReplyContext).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(process.mock.calls[0][0].ingressHash).toBe(process.mock.calls[1][0].ingressHash);
    expect(process.mock.calls[0][0].userMessage).toContain("original transcription");
    expect(process.mock.calls[1][0].userMessage).toBe("");
  });
  it("dispatches hooks once for a nonresponded input even across handler restarts", async () => {
    const agent = { processMessage: vi.fn() } as unknown as AgentRuntime;
    const hook = vi.fn(async () => {});
    const first = handler(agent);
    first.setPluginMessageHooks([hook]);
    await first.handleMessage(message({ isGroup: true, mentionsMe: false }));
    const restarted = handler(agent);
    restarted.setPluginMessageHooks([hook]);
    await restarted.handleMessage(message({ isGroup: true, mentionsMe: false }));
    expect(hook).toHaveBeenCalledTimes(1);
    expect(agent.processMessage).not.toHaveBeenCalled();
  });
  it("keeps unmentioned arrivals during generation pending for exactly the next turn through the real pipeline", async () => {
    vi.useFakeTimers();
    let release!: (response: AgentResponse) => void;
    const completed = (turnId: string): AgentResponse => ({
      turnId,
      content: "reply",
      outcome: { status: "completed", reason: "completed" },
      delivery: { state: "suppressed" },
    });
    const process = vi
      .fn<(options: ProcessMessageOptions) => Promise<AgentResponse>>()
      .mockImplementationOnce(
        () =>
          new Promise<AgentResponse>((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue(completed("next"));
    const agent = { processMessage: process } as unknown as AgentRuntime;
    const destination = bridge();
    let receive!: (input: TelegramMessage) => Promise<void>;
    destination.onNewMessage = (callback) => {
      receive = callback as typeof receive;
    };
    const instance = handler(agent, destination);
    const pipeline = new MessagePipeline({
      config: { telegram: { ...config(), debounce_ms: 10 } },
      bridge: destination,
      agent,
      messageHandler: instance,
      adminHandler: { parseCommand: () => null, isPaused: () => false },
      scheduledTaskHandler: {},
      modules: [],
      inlineRouter: {},
    } as never);
    pipeline.install();
    pipeline.setAcceptingMessages(true);
    const group = {
      isGroup: true,
      hasMedia: false,
      mediaType: undefined,
      replyToId: undefined,
      _rawMessage: undefined,
    };
    await receive(message({ ...group, id: 101, text: "first", mentionsMe: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(process).toHaveBeenCalledTimes(1);
    await receive(
      message({ ...group, id: 102, text: "DURING_ACTIVE_SENTINEL", mentionsMe: false })
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(process).toHaveBeenCalledTimes(1);
    release(completed("first"));
    await instance.drain();
    await receive(message({ ...group, id: 103, text: "next mention", mentionsMe: true }));
    await vi.advanceTimersByTimeAsync(10);
    await instance.drain();
    expect(process).toHaveBeenCalledTimes(2);
    expect(process.mock.calls[1][0].pendingContext?.match(/DURING_ACTIVE_SENTINEL/g)).toHaveLength(
      1
    );
    await receive(message({ ...group, id: 104, text: "third mention", mentionsMe: true }));
    await vi.advanceTimersByTimeAsync(10);
    await instance.drain();
    expect(process.mock.calls[2][0].pendingContext).toBeNull();
  });
});
