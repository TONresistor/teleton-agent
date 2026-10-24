import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { Context, AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { AgentConfigSchema } from "../../config/schema.js";
import { ensureSchema } from "../../memory/schema.js";
import {
  createToolResultArtifact,
  readToolResultArtifact,
} from "../../memory/tool-result-artifacts.js";
import { prepareModelRequest } from "../model-request.js";
import {
  ContextBudgetError,
  frameRetrievedMemory,
  prepareContextBudget,
  type ObservationArtifactStore,
} from "../context-budget.js";
function history(): Context {
  return {
    systemPrompt: "System instructions must remain. Keep the approval rules.",
    messages: [
      {
        role: "user",
        content: "Не трать больше 8 TON. 不得超过 8 TON。 Keep every transaction receipt.",
        timestamp: 1,
      },
      {
        role: "assistant",
        content: Array.from({ length: 60 }, (_, index) => ({
          type: "toolCall",
          id: `read-${index}`,
          name: "history_read",
          arguments: { page: index },
        })),
        timestamp: 2,
      } as unknown as AssistantMessage,
      ...Array.from({ length: 60 }, (_, index): ToolResultMessage => ({
        role: "toolResult",
        toolCallId: `read-${index}`,
        toolName: "history_read",
        isError: false,
        timestamp: index + 3,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              data: { body: `${index}:` + "observation ".repeat(850) },
            }),
          },
          ...(index === 0 ? [{ type: "image" as const, data: "AA==", mimeType: "image/png" }] : []),
        ],
      })),
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "send-1", name: "ton_send", arguments: { amount: 8 } }],
        timestamp: 100,
      } as unknown as AssistantMessage,
      {
        role: "toolResult",
        toolCallId: "send-1",
        toolName: "ton_send",
        isError: false,
        timestamp: 101,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              execution: { outcome: "succeeded", remoteReference: "tx-8" },
              data: { amount: 8, txHash: "tx-8" },
            }),
          },
        ],
      },
    ],
  };
}
const primary = AgentConfigSchema.parse({
  provider: "anthropic",
  model: "claude-fable-5-1",
  api_key: "fake",
});
const fallback = AgentConfigSchema.parse({
  provider: "groq",
  model: "openai/gpt-oss-120b",
  api_key: "fake",
});
describe("fitting a prepared smaller-model payload", () => {
  it("persists moderate optional observations and fits the smaller model without altering mandatory records or tool pairs", () => {
    const db = new Database(":memory:");
    ensureSchema(db);
    try {
      const context = history();
      const original = structuredClone(context);
      const store: ObservationArtifactStore = vi.fn((message) =>
        createToolResultArtifact(db, {
          sessionId: "session",
          chatId: "1",
          toolName: message.toolName,
          content: JSON.stringify(message),
        })
      );
      store.isObservation = (name) => name === "history_read";
      const tools = [
        { name: "history_read", description: "Read history", parameters: { type: "object" } },
      ];
      const first = prepareModelRequest(primary, { context, tools, storeObservation: store });
      expect(store).not.toHaveBeenCalled();
      expect(first.model.contextWindow).toBeGreaterThan(131_072);
      const smaller = prepareModelRequest(fallback, { context, tools, storeObservation: store });
      expect(store).toHaveBeenCalled();
      expect(smaller.context.messages.map((message) => message.role)).toEqual(
        context.messages.map((message) => message.role)
      );
      expect(smaller.context.messages[0]).toEqual(context.messages[0]);
      expect(smaller.context.messages.at(-1)).toEqual(context.messages.at(-1));
      expect(smaller.context.messages.at(-2)).toEqual(context.messages.at(-2));
      expect(smaller.context.tools).toEqual(first.context.tools);
      const budget = prepareContextBudget(smaller.model, smaller.context, fallback.max_tokens);
      expect(budget.reservedInputTokens + budget.maxTokens).toBeLessThanOrEqual(
        smaller.model.contextWindow
      );
      const reduced = smaller.context.messages.find(
        (message) =>
          message.role === "toolResult" &&
          message.content.some(
            (block) => block.type === "text" && block.text.includes('"_contextReduced":true')
          )
      ) as ToolResultMessage;
      const block = reduced.content[0];
      expect(block.type).toBe("text");
      const parsed = JSON.parse(block.type === "text" ? block.text : "{}");
      const stored = readToolResultArtifact(
        db,
        parsed.data._artifact.id,
        "different-authorized-chat",
        0,
        20_000
      );
      expect(JSON.parse(stored?.content ?? "{}")).toEqual(
        context.messages.find(
          (message) => message.role === "toolResult" && message.toolCallId === reduced.toolCallId
        )
      );
      expect(context).toEqual(original);
    } finally {
      db.close();
    }
  });
  it("omits only explicitly tagged RAG bodies while retaining their references and other system instructions", () => {
    const reference = {
      kind: "knowledge",
      id: "fact-1",
      reference: "knowledge:fact-1",
      source: "memory.md",
      trust: "untrusted",
    };
    const context: Context = {
      messages: [{ role: "user", content: "Keep the 8 TON limit", timestamp: 1 }],
      systemPrompt:
        "Mandatory system instruction\n" +
        frameRetrievedMemory("Optional retrieved body ".repeat(25_000), [reference]) +
        "\nMandatory closing instruction",
    };
    const request = prepareModelRequest(fallback, { context });
    expect(request.context.systemPrompt).toContain("Mandatory system instruction");
    expect(request.context.systemPrompt).toContain("Mandatory closing instruction");
    expect(request.context.systemPrompt).toContain("knowledge:fact-1");
    expect(request.context.systemPrompt).toContain("not present in this request");
    expect(request.context.systemPrompt).not.toContain("Optional retrieved body");
    expect(request.context.messages).toEqual(context.messages);
  });
  it("keeps bodies when artifact persistence fails and refuses to slice a mandatory user requirement", () => {
    const context = history();
    const original = structuredClone(context);
    const failure = vi.fn(() => {
      throw new Error("disk unavailable");
    });
    expect(() => prepareModelRequest(fallback, { context, storeObservation: failure })).toThrow(
      ContextBudgetError
    );
    expect(context).toEqual(original);
    const mandatory: Context = {
      messages: [{ role: "user", content: "Exact required content ".repeat(25_000), timestamp: 1 }],
    };
    expect(() => prepareModelRequest(fallback, { context: mandatory })).toThrow(ContextBudgetError);
    expect(mandatory.messages[0].content).toContain("Exact required content");
  });
  it("reduces an existing artifact-bearing observation without requiring a second artifact", () => {
    const context = history();
    for (const message of context.messages)
      if (message.role === "toolResult" && message.toolName === "history_read") {
        const block = message.content[0];
        if (block.type === "text") {
          const parsed = JSON.parse(block.text);
          parsed.data._artifact = {
            id: `artifact-${message.toolCallId}`,
            read_with: "tool_result_read",
          };
          block.text = JSON.stringify(parsed);
        }
      }
    expect(() => prepareModelRequest(fallback, { context })).not.toThrow();
  });
});

it("never reduces an arbitrary legacy action when the registry classifies it as an action", () => {
  const context: Context = {
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "effect",
            name: "custom_effect",
            arguments: { operation: "approved" },
          },
        ],
        timestamp: 1,
      } as unknown as AssistantMessage,
      {
        role: "toolResult",
        toolCallId: "effect",
        toolName: "custom_effect",
        isError: false,
        timestamp: 2,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              data: {
                body: "Effect state must remain exact. ".repeat(25_000),
                _artifact: { id: "existing-action-artifact", read_with: "tool_result_read" },
              },
            }),
          },
        ],
      },
    ],
  };
  const original = structuredClone(context);
  const store: ObservationArtifactStore = vi.fn(() => ({ id: "unexpected", sizeBytes: 1 }));
  store.isObservation = () => false;
  expect(() => prepareModelRequest(fallback, { context, storeObservation: store })).toThrow(
    ContextBudgetError
  );
  expect(store).not.toHaveBeenCalled();
  expect(context).toEqual(original);
});
