import type { Context, Message } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it.each(["Summary unavailable", "Summary response length"])(
    "keeps the original session and transcript when summarization fails: %s",
    async (failure) => {
      const original = context("retained");
      mocks.transcripts.set("original-session", [...original.messages]);
      mocks.summarize.mockReset().mockRejectedValue(new Error(failure));
      const manager = new CompactionManager({
        enabled: true,
        maxMessages: 2,
        keepRecentMessages: 1,
        memoryFlushEnabled: false,
      });

      expect(
        await manager.checkAndCompact("original-session", original, "key", "chat", "anthropic")
      ).toBeNull();
      expect([...mocks.transcripts.keys()]).toEqual(["original-session"]);
      expect(mocks.transcripts.get("original-session")).toEqual(original.messages);
    }
  );

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

function summaryResponse(texts: string[], stop = "end_turn"): Response {
  const events: unknown[] = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [],
        model: "test",
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    },
  ];
  texts.forEach((text, index) => {
    if (index > 0)
      events.push(
        {
          type: "content_block_start",
          index: index + 100,
          content_block: { type: "thinking", thinking: "", signature: "test" },
        },
        {
          type: "content_block_delta",
          index: index + 100,
          delta: { type: "thinking_delta", thinking: "private reasoning" },
        },
        { type: "content_block_stop", index: index + 100 }
      );
    events.push(
      { type: "content_block_start", index, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index, delta: { type: "text_delta", text } },
      { type: "content_block_stop", index }
    );
  });
  events.push(
    { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 5 } },
    { type: "message_stop" }
  );
  return new Response(
    events
      .map((e) => {
        const event = e as { type: string };
        return `event: ${event.type}\ndata: ${JSON.stringify(e)}\n\n`;
      })
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

describe("summary adapter responses", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects a truncated direct summary", async () => {
    const actual =
      await vi.importActual<typeof import("../ai-summarization.js")>("../ai-summarization.js");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      summaryResponse(["partial"], "max_tokens")
    );
    await expect(
      actual.summarizeViaClaude({ messages: context("source").messages, apiKey: "test-key" })
    ).rejects.toThrow("length");
  });

  it("rejects a truncated merge after successful chunks", async () => {
    const actual =
      await vi.importActual<typeof import("../ai-summarization.js")>("../ai-summarization.js");
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => summaryResponse(["chunk 1"]))
      .mockImplementationOnce(async () => summaryResponse(["chunk 2"]))
      .mockImplementationOnce(async () => summaryResponse(["partial merge"], "max_tokens"));
    await expect(
      actual.summarizeInChunks({
        messages: context("source").messages,
        apiKey: "test-key",
        maxChunkTokens: 1,
      })
    ).rejects.toThrow("length");
  });
  it.each([false, true])(
    "keeps ordered text blocks but not reasoning (merge: %s)",
    async (merge) => {
      const actual =
        await vi.importActual<typeof import("../ai-summarization.js")>("../ai-summarization.js");
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        summaryResponse(["FIRST", "SECOND"])
      );
      const params = { messages: context("source").messages, apiKey: "test-key" };
      const summary = merge
        ? (await actual.summarizeInChunks({ ...params, maxChunkTokens: 1 })).summary
        : await actual.summarizeViaClaude(params);
      expect(summary).toBe("FIRST\nSECOND");
    }
  );
  it("sends bounded tool arguments, receipts and errors without mutating the transcript", async () => {
    const actual =
      await vi.importActual<typeof import("../ai-summarization.js")>("../ai-summarization.js");
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "receipt-call",
            name: "transfer",
            arguments: { amount: 12345, binary: "AAAA" },
          },
        ],
        api: "test",
        provider: "test",
        model: "test",
        stopReason: "toolUse",
        timestamp: 1,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
      {
        role: "toolResult",
        toolCallId: "receipt-call",
        toolName: "transfer",
        content: [
          {
            type: "text",
            text:
              "receipt=EXACT_RECEIPT; failed: insufficient balance; " + "long text ".repeat(10000),
          },
          { type: "image", data: "DO_NOT_SEND", mimeType: "image/png" },
        ],
        isError: true,
        timestamp: 2,
      },
    ];
    const before = JSON.stringify(messages);
    let body = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      body = String(init?.body);
      return summaryResponse(["summary"]);
    });
    await actual.summarizeViaClaude({ messages, apiKey: "test-key" });
    for (const value of [
      "12345",
      "EXACT_RECEIPT",
      "insufficient balance",
      "receipt-call",
      "isError=true",
    ])
      expect(body).toContain(value);
    expect(body).not.toContain("DO_NOT_SEND");
    expect(body).not.toContain("AAAA");
    expect(actual.formatMessagesForSummary(messages).length).toBeLessThan(17000);
    expect(actual.splitMessagesByTokens(messages, 100)).toHaveLength(2);
    expect(JSON.stringify(messages)).toBe(before);
  });
  it("does not truncate ordinary conversation text before chunking", async () => {
    const actual =
      await vi.importActual<typeof import("../ai-summarization.js")>("../ai-summarization.js");
    const content = "ordinary text ".repeat(3000) + "IMPORTANT_TAIL";
    expect(actual.formatMessagesForSummary([{ role: "user", content, timestamp: 1 }])).toContain(
      "IMPORTANT_TAIL"
    );
  });
  it("uses the configured endpoint for chunks and merge", async () => {
    const actual =
      await vi.importActual<typeof import("../ai-summarization.js")>("../ai-summarization.js");
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      urls.push(String(url));
      return summaryResponse(["summary"]);
    });
    for (const baseUrl of ["https://first.test", "https://second.test"]) {
      await actual.summarizeInChunks({
        messages: context("source").messages,
        apiKey: "test-key",
        maxChunkTokens: 1,
        baseUrl,
      });
    }
    expect(urls.slice(0, 3).every((url) => url.startsWith("https://first.test/"))).toBe(true);
    expect(urls.slice(3).every((url) => url.startsWith("https://second.test/"))).toBe(true);
    expect(urls).toHaveLength(6);
  });
});
