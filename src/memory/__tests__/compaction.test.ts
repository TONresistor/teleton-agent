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

import { CompactionManager } from "../compaction.js";

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
