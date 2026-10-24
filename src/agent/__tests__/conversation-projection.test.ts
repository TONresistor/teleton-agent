import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai/compat";
import Database from "better-sqlite3";
import { ensureSchema } from "../../memory/schema.js";
import { finalizeAgentResponse } from "../response-finalizer.js";
import { deliverAgentResponse } from "../delivery.js";
import { resolveConversationDelivery } from "../conversation-projection.js";
import { reserveTurnIngress, completeTurnIngress } from "../../memory/turn-ingress.js";
import { AgentConfigSchema } from "../../config/schema.js";
const mocks = vi.hoisted(() => ({ complete: vi.fn(), stored: [] as Message[], append: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", async () => ({
  ...(await vi.importActual("@earendil-works/pi-ai/compat")),
  complete: mocks.complete,
}));
vi.mock("../../session/store.js", () => ({ updateSession: vi.fn() }));
vi.mock("../../session/transcript.js", () => ({
  appendToTranscript: (...args: unknown[]) => mocks.append(...args),
  readTranscript: () => mocks.stored,
}));
import { chatWithContext, loadContextFromTranscript } from "../client.js";
const config = AgentConfigSchema.parse({
  provider: "anthropic",
  api_key: "fake",
  model: "claude-haiku-4-5-20251001",
});
function response(stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "original model text" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: config.model,
    timestamp: 1,
    stopReason,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
beforeEach(() => {
  mocks.stored = [];
  mocks.complete.mockReset();
  mocks.append.mockReset();
  mocks.append.mockImplementation((_session: string, message: Message) => {
    mocks.stored.push(message);
  });
});
describe("raw generation versus delivered conversation", () => {
  it.each(["aborted", "length", "error"] as const)(
    "keeps %s generation as audit diagnostics instead of assistant conversation",
    async (stopReason) => {
      mocks.complete.mockResolvedValue(response(stopReason));
      await chatWithContext(config, {
        context: { messages: [] },
        sessionId: "session",
        turnId: "turn",
        persistTranscript: true,
      });
      expect(mocks.append).toHaveBeenCalledOnce();
      expect(mocks.stored[0]).toMatchObject({
        role: "user",
        _diagnosticOnly: true,
        _turnId: "turn",
      });
      expect(loadContextFromTranscript("session").messages).toEqual([]);
    }
  );
  it("does not project a generated response as received after final delivery failed", () => {
    mocks.stored = [Object.assign(response("stop"), { _generationOnly: true, _turnId: "turn" })];
    const loaded = loadContextFromTranscript("session", undefined, () => ({ state: "failed" }));
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].role).toBe("user");
    expect(JSON.stringify(loaded.messages)).toContain("not confirmed received");
    expect(JSON.stringify(loaded.messages)).not.toContain("original model text");
  });
  it("projects confirmed hook-rewritten final text while retaining the original audit generation", () => {
    mocks.stored = [Object.assign(response("stop"), { _generationOnly: true, _turnId: "turn" })];
    const loaded = loadContextFromTranscript("session", undefined, () => ({
      state: "delivered",
      content: "hook-rewritten final answer",
    }));
    expect(loaded.messages[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "hook-rewritten final answer" }],
    });
    expect(mocks.stored[0]).toMatchObject({
      content: [{ type: "text", text: "original model text" }],
    });
  });
});

it.each(["delivered", "failed"] as const)(
  "projects actual %s delivery after a final hook rewrite without rewriting audit history",
  async (deliveryState) => {
    const db = new Database(":memory:");
    ensureSchema(db);
    try {
      mocks.complete.mockResolvedValue(response("stop"));
      const generated = await chatWithContext(config, {
        context: { messages: [] },
        sessionId: "session",
        turnId: "hook-turn",
        persistTranscript: true,
      });
      const session = { sessionId: "session", messageCount: 0 };
      const final = await finalizeAgentResponse(
        {
          turnId: "hook-turn",
          chatId: "1",
          effectiveIsGroup: false,
          processStartTime: Date.now(),
        } as never,
        {
          session,
          totalToolCalls: [],
          accumulatedTexts: [generated.text],
          accumulatedUsage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalCost: 0 },
          wasStreamed: false,
          activeModel: config.model,
          activeProvider: "anthropic",
          stopReason: "completed",
        } as never,
        generated,
        { chatId: "1", userMessage: "request" },
        {
          runModifyingHook: async (_name: unknown, event: { text: string }) => {
            event.text = "actual hook-rewritten answer";
          },
          runObservingHook: vi.fn(async () => {}),
        } as never
      );
      reserveTurnIngress(db, {
        key: "hook-turn",
        turnId: "hook-turn",
        chatId: "1",
        text: "request",
      });
      completeTurnIngress(db, "hook-turn", final);
      const send =
        deliveryState === "delivered"
          ? vi.fn(async () => ({ id: 77, chatId: "1", date: 1 }))
          : vi.fn(async () => {
              throw { error_code: 400, description: "rejected" };
            });
      const delivered = await deliverAgentResponse(db, final, {
        kind: "telegram",
        chatId: "1",
        bridge: { getMode: () => "user", getOwnUserId: () => 1n, sendMessage: send } as never,
      });
      expect(delivered.delivery.state).toBe(deliveryState);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ text: "actual hook-rewritten answer" })
      );
      const projected = loadContextFromTranscript("session", undefined, (turnId) =>
        resolveConversationDelivery(db, turnId)
      );
      expect(mocks.stored[0]).toMatchObject({
        content: [{ type: "text", text: "original model text" }],
      });
      if (deliveryState === "delivered")
        expect(projected.messages[0]).toMatchObject({
          role: "assistant",
          content: [{ type: "text", text: "actual hook-rewritten answer" }],
        });
      else {
        expect(projected.messages[0].role).toBe("user");
        expect(JSON.stringify(projected)).toContain("not confirmed received");
        expect(JSON.stringify(projected)).not.toContain("original model text");
      }
    } finally {
      db.close();
    }
  }
);

it("projects receipts for the conversation destination and permits another explicit destination", async () => {
  const db = new Database(":memory:");
  ensureSchema(db);
  try {
    const final = {
      turnId: "different-destinations",
      content: "confirmed answer",
      toolCalls: [],
      outcome: { status: "completed" as const, reason: "completed" },
      delivery: { state: "not_requested" as const },
    };
    reserveTurnIngress(db, {
      key: final.turnId,
      turnId: final.turnId,
      chatId: "-100",
      text: "request",
    });
    completeTurnIngress(db, final.turnId, final);
    const sendMessage = vi.fn(async ({ chatId }: { chatId: string }) => ({
      id: 77,
      chatId,
      date: 1,
    }));
    const bridge = { getMode: () => "user", getOwnUserId: () => 1n, sendMessage } as never;
    await deliverAgentResponse(db, final, { kind: "telegram", bridge, chatId: "1" });
    expect(resolveConversationDelivery(db, final.turnId)).toEqual({ state: "not_requested" });
    expect(resolveConversationDelivery(db, final.turnId, "1")).toEqual({
      state: "delivered",
      content: "confirmed answer",
    });
    await deliverAgentResponse(db, final, { kind: "telegram", bridge, chatId: "-100" });
    expect(resolveConversationDelivery(db, final.turnId)).toEqual({
      state: "delivered",
      content: "confirmed answer",
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  } finally {
    db.close();
  }
});
