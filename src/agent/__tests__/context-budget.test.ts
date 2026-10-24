import { describe, expect, it } from "vitest";
import type { Context } from "@earendil-works/pi-ai/compat";
import {
  ContextBudgetError,
  estimateRequestTokens,
  prepareContextBudget,
} from "../context-budget.js";

const model = { id: "small", contextWindow: 12_000, maxTokens: 3_000 };
describe("final request context budget", () => {
  it("counts tools, tool outputs, thinking, arguments and images as well as text", () => {
    const base: Context = { messages: [] };
    const context: Context = {
      systemPrompt: "system".repeat(30),
      tools: [
        { name: "read", description: "description".repeat(30), parameters: { type: "object" } },
      ],
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "plan".repeat(100) },
            { type: "toolCall", id: "1", name: "read", arguments: { query: "q".repeat(500) } },
          ],
          timestamp: 1,
        } as never,
        {
          role: "toolResult",
          toolCallId: "1",
          toolName: "read",
          content: [
            { type: "text", text: "r".repeat(1000) },
            { type: "image", data: "AA==", mimeType: "image/png" },
          ],
          isError: false,
          timestamp: 2,
        },
      ],
    };
    expect(estimateRequestTokens(context)).toBeGreaterThan(estimateRequestTokens(base) + 1_500);
    const budget = prepareContextBudget(model, context, 9_000);
    expect(budget.reservedInputTokens).toBe(Math.ceil(budget.inputTokens * 1.2) + 4096);
    expect(budget.maxTokens).toBeLessThanOrEqual(model.maxTokens);
    expect(budget.maxTokens + budget.reservedInputTokens).toBeLessThanOrEqual(model.contextWindow);
  });
  it("clamps output to remaining room and refuses an oversized payload without mutating it", () => {
    const context: Context = {
      messages: [{ role: "user", content: "x".repeat(15_000), timestamp: 1 }],
    };
    const budget = prepareContextBudget(model, context, 9_000);
    expect(budget.maxTokens).toBeLessThan(3_000);
    const original = structuredClone(context);
    expect(() => prepareContextBudget({ ...model, contextWindow: 5_000 }, context, 10)).toThrow(
      ContextBudgetError
    );
    expect(context).toEqual(original);
  });
});
