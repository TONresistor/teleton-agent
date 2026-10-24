import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { AgentConfigSchema } from "../../../config/schema.js";
import { collectActionReceipts } from "../../../memory/action-receipts.js";
const mocks = vi.hoisted(() => ({ summarize: vi.fn() }));
vi.mock("../../../memory/ai-summarization.js", () => ({ summarizeWithFallback: mocks.summarize }));
vi.mock("../../../session/memory-hook.js", () => ({ saveSessionMemory: vi.fn() }));
import { recoverLlmError } from "../llm-iteration.js";

describe("provider overflow recovery", () => {
  it("compacts without resetting, retaining earlier requirements, current request and action receipts", async () => {
    mocks.summarize.mockResolvedValue({
      summary: "A compact account of earlier discussion.",
      tokensUsed: 10,
      chunksProcessed: 1,
    });
    const config = AgentConfigSchema.parse({
      provider: "anthropic",
      model: "claude-fable-5-1",
      api_key: "fake",
    });
    const userMsg = { role: "user" as const, content: "continue", timestamp: 100 };
    const context: Context = {
      systemPrompt: "system",
      messages: [
        {
          role: "user",
          content: "Never spend more than 8 TON. Finish the transfer, then report its receipt.",
          timestamp: 1,
        },
        ...Array.from(
          { length: 16 },
          (_, index) =>
            ({
              role: "assistant",
              content: [{ type: "text", text: "Earlier discussion ".repeat(1000) }],
              timestamp: 2 + index,
            }) as AssistantMessage
        ),
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "send", name: "ton_send", arguments: { amount: 8 } }],
          timestamp: 19,
        } as unknown as AssistantMessage,
        {
          role: "toolResult",
          toolCallId: "send",
          toolName: "ton_send",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                execution: { outcome: "succeeded", remoteReference: "tx-8" },
                data: { amount: 8 },
              }),
            },
          ],
          isError: false,
          timestamp: 20,
        },
        userMsg,
      ],
    };
    const session = { sessionId: "unchanged", chatId: "1", messageCount: 1 } as never;
    const recovered = await recoverLlmError(
      config,
      undefined,
      { errorMessage: "maximum context length exceeded" } as AssistantMessage,
      { overflowResets: 0, rateLimitRetries: 0, serverErrorRetries: 0 },
      {
        session,
        context,
        chatId: "1",
        sessionKey: "1",
        effectiveIsGroup: false,
        provider: "anthropic",
        processStartTime: Date.now(),
        userMsg,
      }
    );
    expect(recovered.session).toBe(session);
    expect(JSON.stringify(recovered.context)).toContain("Never spend more than 8 TON");
    expect(JSON.stringify(recovered.context)).toContain("continue");
    expect(collectActionReceipts(recovered.context.messages)).toEqual(
      collectActionReceipts(context.messages)
    );
    expect(JSON.stringify(recovered.context).length).toBeLessThan(JSON.stringify(context).length);
  });
  it("fails explicitly when compaction is unavailable, without rewriting the source context", async () => {
    mocks.summarize.mockResolvedValue({
      summary: "unavailable",
      tokensUsed: 0,
      chunksProcessed: 0,
    });
    const config = AgentConfigSchema.parse({
      provider: "anthropic",
      model: "claude-fable-5-1",
      api_key: "fake",
    });
    const userMsg = { role: "user" as const, content: "continue", timestamp: 2 };
    const context: Context = {
      messages: [{ role: "user", content: "Keep this constraint", timestamp: 1 }, userMsg],
    };
    const copy = structuredClone(context);
    await expect(
      recoverLlmError(
        config,
        undefined,
        { errorMessage: "maximum context length exceeded" } as AssistantMessage,
        { overflowResets: 0, rateLimitRetries: 0, serverErrorRetries: 0 },
        {
          session: { sessionId: "old" } as never,
          context,
          chatId: "1",
          sessionKey: "1",
          effectiveIsGroup: false,
          provider: "anthropic",
          processStartTime: Date.now(),
          userMsg,
        }
      )
    ).rejects.toMatchObject({ name: "ContextBudgetError" });
    expect(context).toEqual(copy);
  });
});

it("refuses Retry-After 60 seconds immediately when only 10 seconds remain", async () => {
  const now = Date.now();
  const config = AgentConfigSchema.parse({ api_key: "fake", max_turn_duration_ms: 10_000 });
  const context: Context = { messages: [{ role: "user", content: "work", timestamp: now }] };
  await expect(
    recoverLlmError(
      config,
      undefined,
      { errorMessage: "429 rate limited; Retry-After: 60" } as AssistantMessage,
      { overflowResets: 0, rateLimitRetries: 0, serverErrorRetries: 0 },
      {
        session: { sessionId: "same" } as never,
        context,
        chatId: "1",
        sessionKey: "1",
        effectiveIsGroup: false,
        provider: "anthropic",
        processStartTime: now,
        userMsg: context.messages[0] as never,
        deadlineAt: now + 10_000,
      }
    )
  ).rejects.toMatchObject({ reason: "time_budget" });
});
