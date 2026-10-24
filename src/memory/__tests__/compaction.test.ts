import type { Context, Message } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transcripts: new Map<string, Message[]>(),
  summarize: vi.fn(),
}));

vi.mock("../../session/transcript.js", () => ({
  appendToTranscript: (sessionId: string, message: Message) => {
    const transcript = mocks.transcripts.get(sessionId) ?? [];
    transcript.push(message);
    mocks.transcripts.set(sessionId, transcript);
  },
  readTranscript: (sessionId: string) => [...(mocks.transcripts.get(sessionId) ?? [])],
  flushTranscript: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../ai-summarization.js", () => ({
  summarizeWithFallback: mocks.summarize,
}));

vi.mock("../daily-logs.js", () => ({
  writeSummaryToDailyLog: vi.fn(),
}));

vi.mock("../../session/memory-hook.js", () => ({
  saveSessionMemory: vi.fn(),
}));

import { ContextBudgetError, prepareContextBudget } from "../../agent/context-budget.js";
import { maskOldToolResults } from "../observation-masking.js";
import {
  collectActionReceipts,
  collectProtectedRequirements,
  PROTECTED_REQUIREMENTS_PREFIX,
} from "../action-receipts.js";
import { shouldCompact, compactContext, CompactionManager } from "../compaction.js";

function context(label: string): Context {
  return {
    messages: [
      { role: "user", content: `${label} old`, timestamp: 1 },
      { role: "user", content: `${label} recent`, timestamp: 2 },
    ],
  };
}

describe("CompactionManager", () => {
  beforeEach(() => {
    mocks.transcripts.clear();
    mocks.summarize.mockReset();
    mocks.summarize
      .mockResolvedValueOnce({ summary: "SUMMARY A", tokensUsed: 1, chunksProcessed: 1 })
      .mockResolvedValueOnce({ summary: "SUMMARY B", tokensUsed: 1, chunksProcessed: 1 });
  });

  it("never carries a previous summary into another chat", async () => {
    const manager = new CompactionManager({
      enabled: true,
      maxMessages: 2,
      keepRecentMessages: 1,
      memoryFlushEnabled: false,
    });

    await manager.checkAndCompact("session-a", context("A"), "key", "chat-a", "anthropic");
    await manager.checkAndCompact("session-b", context("B"), "key", "chat-b", "anthropic");

    expect(mocks.summarize).toHaveBeenCalledTimes(2);
    const secondInstructions = mocks.summarize.mock.calls[1][0].customInstructions as string;
    expect(secondInstructions).not.toContain("SUMMARY A");
  });

  it("reuses the summary embedded in the same conversation transcript", async () => {
    const manager = new CompactionManager({
      enabled: true,
      maxMessages: 2,
      keepRecentMessages: 1,
      memoryFlushEnabled: false,
    });

    const compactedSession = await manager.checkAndCompact(
      "session-a",
      context("A"),
      "key",
      "chat-a",
      "anthropic"
    );
    expect(compactedSession).not.toBeNull();

    const compactedContext: Context = {
      messages: [...(mocks.transcripts.get(compactedSession!) ?? [])],
    };
    await manager.checkAndCompact(
      compactedSession!,
      compactedContext,
      "key",
      "chat-a",
      "anthropic"
    );

    const secondInstructions = mocks.summarize.mock.calls[1][0].customInstructions as string;
    expect(secondInstructions).toContain("SUMMARY A");
  });
});

describe("receipt retention during compaction", () => {
  it("preserves exact action outcomes after summary failure and a second compaction", async () => {
    mocks.summarize.mockRejectedValue(new Error("provider unavailable"));
    const original: Context = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "send-1",
              name: "send",
              arguments: { recipient: "alice", amount: 8 },
            },
          ],
          timestamp: 1,
        } as never,
        {
          role: "toolResult",
          toolCallId: "send-1",
          toolName: "send",
          isError: false,
          timestamp: 2,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                execution: { outcome: "succeeded", remoteId: "tx-1" },
              }),
            },
          ],
        },
        { role: "user", content: "continue", timestamp: 3 },
      ],
    };
    const config = { enabled: true, keepRecentMessages: 1 };
    const first = await compactContext(original, config, "key");
    const second = await compactContext(first, config, "key");
    expect(collectActionReceipts(second.messages)).toEqual(
      collectActionReceipts(original.messages)
    );
  });
});

it("counts a 500k-character read result before compaction even when masking exempts it", () => {
  const context: Context = {
    messages: [
      {
        role: "toolResult",
        toolCallId: "read",
        toolName: "history",
        isError: false,
        timestamp: 1,
        content: [{ type: "text", text: "x".repeat(500_000) }],
      },
    ],
  };
  const masked = {
    ...context,
    messages: maskOldToolResults(context.messages, {
      toolRegistry: { getToolCategory: () => "data-bearing" } as never,
      config: {
        keepRecentCount: 1,
        keepErrorResults: true,
        truncationThreshold: 1,
        truncationKeepChars: 1,
      },
      currentIterationStartIndex: 2,
    }),
  };
  expect(masked.messages).toEqual(context.messages);
  expect(shouldCompact(masked, { enabled: true, maxTokens: 96_000 })).toBe(true);
  expect(() =>
    prepareContextBudget({ id: "small", contextWindow: 96_000, maxTokens: 4096 }, masked, 4096)
  ).toThrow(ContextBudgetError);
});

it("protects exact multilingual requirements across two lossy summaries without duplicating the recent user", async () => {
  mocks.summarize.mockResolvedValue({
    summary: "The summary deliberately omits the spending limit and objective.",
    tokensUsed: 10,
    chunksProcessed: 1,
  });
  const limit = {
    role: "user" as const,
    content:
      "Finish the transfer. Не трать больше 8 TON. Ne dépense pas plus de 8 TON. 不得超过 8 TON。",
    timestamp: 1,
  };
  const current = { role: "user" as const, content: "continue-current-once", timestamp: 10 };
  const prose = (timestamp: number): Message =>
    ({ role: "assistant", content: [{ type: "text", text: "discussion" }], timestamp }) as never;
  const original: Context = { messages: [limit, prose(2), prose(3), current] };
  const config = { enabled: true, keepRecentMessages: 1 };
  const first = await compactContext(original, config, "key");
  const second = await compactContext(
    { messages: [...first.messages.slice(0, -1), prose(11), prose(12), current] },
    config,
    "key"
  );
  const projection = second.messages.find(
    (message) =>
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith(PROTECTED_REQUIREMENTS_PREFIX)
  );
  expect(projection?.role === "user" && projection.content).toContain(limit.content);
  expect(collectProtectedRequirements(second.messages)).toEqual(
    collectProtectedRequirements(original.messages)
  );
  expect(JSON.stringify(second).match(/continue-current-once/g)).toHaveLength(1);
  const encoded = JSON.parse(
    (projection?.content as string).slice(PROTECTED_REQUIREMENTS_PREFIX.length)
  );
  expect(encoded).toMatchObject({ version: 1, requirements: [{ content: limit.content }] });
  expect(encoded.requirements).toHaveLength(1);
});
