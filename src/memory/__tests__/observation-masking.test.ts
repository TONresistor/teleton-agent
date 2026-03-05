import { describe, it, expect } from "vitest";
import type { Message, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import {
  maskOldToolResults,
  DEFAULT_MASKING_CONFIG,
  type MaskingConfig,
} from "../observation-masking.js";

// ── Helpers ─────────────────────────────────────────────────────

function makeToolResult(name: string, text: string, isError = false): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: `call_${name}`,
    toolName: name,
    content: [{ type: "text", text }],
    isError,
    timestamp: Date.now(),
  };
}

function makeUserMsg(text: string): UserMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function makeCocoonToolResult(text: string): UserMessage {
  return {
    role: "user",
    content: [{ type: "text", text: `<tool_response>${text}</tool_response>` }],
    timestamp: Date.now(),
  };
}

const SHORT_RESULT = JSON.stringify({ success: true, data: { message: "Done" } });
const LONG_RESULT = JSON.stringify({
  success: true,
  data: {
    message: "Search completed",
    results: Array.from({ length: 100 }, (_, i) => ({
      id: i,
      title: `Result item number ${i} with a fairly long description to pad the text`,
      body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(5),
    })),
  },
});

// ── Phase 1: Classic masking (existing behavior) ────────────────

describe("maskOldToolResults — classic masking", () => {
  it("returns same array when fewer results than keepRecentCount", () => {
    const messages: Message[] = [makeUserMsg("hi"), makeToolResult("t1", SHORT_RESULT)];
    const result = maskOldToolResults(messages);
    expect(result).toBe(messages); // same reference
  });

  it("masks old results beyond keepRecentCount", () => {
    const config: MaskingConfig = {
      ...DEFAULT_MASKING_CONFIG,
      keepRecentCount: 2,
      truncationThreshold: 0,
    };
    const messages: Message[] = [
      makeToolResult("old1", SHORT_RESULT),
      makeToolResult("old2", SHORT_RESULT),
      makeToolResult("recent1", SHORT_RESULT),
      makeToolResult("recent2", SHORT_RESULT),
    ];
    const result = maskOldToolResults(messages, { config });
    expect(result[0]).not.toBe(messages[0]);
    const text = (result[0] as ToolResultMessage).content[0];
    expect(text.type === "text" && text.text).toContain("[Tool: old1 - OK");
    // Recent kept intact
    expect(result[2]).toBe(messages[2]);
    expect(result[3]).toBe(messages[3]);
  });

  it("preserves error results when keepErrorResults is true", () => {
    const config: MaskingConfig = {
      ...DEFAULT_MASKING_CONFIG,
      keepRecentCount: 1,
      truncationThreshold: 0,
    };
    const messages: Message[] = [
      makeToolResult("err_tool", SHORT_RESULT, true),
      makeToolResult("recent", SHORT_RESULT),
    ];
    const result = maskOldToolResults(messages, { config });
    // Error result kept intact (not masked)
    expect(result[0]).toBe(messages[0]);
  });

  it("extracts summary from masked results", () => {
    const config: MaskingConfig = {
      ...DEFAULT_MASKING_CONFIG,
      keepRecentCount: 1,
      truncationThreshold: 0,
    };
    const withSummary = JSON.stringify({ success: true, data: { summary: "Found 5 items" } });
    const messages: Message[] = [
      makeToolResult("search", withSummary),
      makeToolResult("recent", SHORT_RESULT),
    ];
    const result = maskOldToolResults(messages, { config });
    const text = (result[0] as ToolResultMessage).content[0];
    expect(text.type === "text" && text.text).toContain("Found 5 items");
  });
});

// ── Phase 2: Inter-iteration truncation ─────────────────────────

describe("maskOldToolResults — inter-iteration truncation", () => {
  it("does not truncate when currentIterationStartIndex is undefined", () => {
    const config: MaskingConfig = { ...DEFAULT_MASKING_CONFIG, keepRecentCount: 20 };
    const messages: Message[] = [makeToolResult("big", LONG_RESULT)];
    const result = maskOldToolResults(messages, { config });
    expect(result).toBe(messages);
  });

  it("truncates oversized results from previous iterations", () => {
    const config: MaskingConfig = { ...DEFAULT_MASKING_CONFIG, keepRecentCount: 20 };
    const messages: Message[] = [
      makeUserMsg("search something"),
      makeToolResult("search", LONG_RESULT), // index 1, from prev iteration
      makeToolResult("send", SHORT_RESULT), // index 2, from current iteration
    ];
    // Current iteration starts at index 2
    const result = maskOldToolResults(messages, { config, currentIterationStartIndex: 2 });
    // LONG_RESULT at index 1 should be truncated
    const truncatedText = (result[1] as ToolResultMessage).content[0];
    expect(truncatedText.type === "text" && truncatedText.text.length).toBeLessThan(
      LONG_RESULT.length
    );
    expect(truncatedText.type === "text" && truncatedText.text).toContain("Search completed");
    // SHORT_RESULT at index 2 should be intact (current iteration)
    expect(result[2]).toBe(messages[2]);
  });

  it("does not truncate results from the current iteration", () => {
    const config: MaskingConfig = { ...DEFAULT_MASKING_CONFIG, keepRecentCount: 20 };
    const messages: Message[] = [
      makeToolResult("big", LONG_RESULT), // index 0, current iteration
    ];
    const result = maskOldToolResults(messages, { config, currentIterationStartIndex: 0 });
    expect(result[0]).toBe(messages[0]);
  });

  it("does not truncate results below threshold", () => {
    const config: MaskingConfig = { ...DEFAULT_MASKING_CONFIG, keepRecentCount: 20 };
    const messages: Message[] = [
      makeToolResult("small", SHORT_RESULT), // index 0, prev iteration
      makeToolResult("current", SHORT_RESULT), // index 1, current
    ];
    const result = maskOldToolResults(messages, { config, currentIterationStartIndex: 1 });
    expect(result[0]).toBe(messages[0]);
  });

  it("skips data-bearing tools during truncation", () => {
    const config: MaskingConfig = { ...DEFAULT_MASKING_CONFIG, keepRecentCount: 20 };
    const mockRegistry = {
      getToolCategory: (name: string) => (name === "memory_read" ? "data-bearing" : "action"),
    } as any;
    const messages: Message[] = [
      makeToolResult("memory_read", LONG_RESULT), // data-bearing, should skip
      makeToolResult("current", SHORT_RESULT),
    ];
    const result = maskOldToolResults(messages, {
      config,
      toolRegistry: mockRegistry,
      currentIterationStartIndex: 1,
    });
    expect(result[0]).toBe(messages[0]); // kept intact
  });

  it("skips error results during truncation", () => {
    const config: MaskingConfig = { ...DEFAULT_MASKING_CONFIG, keepRecentCount: 20 };
    const messages: Message[] = [
      makeToolResult("failed", LONG_RESULT, true), // error, should skip
      makeToolResult("current", SHORT_RESULT),
    ];
    const result = maskOldToolResults(messages, { config, currentIterationStartIndex: 1 });
    expect(result[0]).toBe(messages[0]); // kept intact
  });

  it("truncates Cocoon-style tool results", () => {
    const config: MaskingConfig = { ...DEFAULT_MASKING_CONFIG, keepRecentCount: 20 };
    const longCocoon = "x".repeat(5000);
    const messages: Message[] = [
      makeCocoonToolResult(longCocoon), // index 0, prev iteration
      makeToolResult("current", SHORT_RESULT), // index 1, current
    ];
    const result = maskOldToolResults(messages, { config, currentIterationStartIndex: 1 });
    const text = (result[0] as UserMessage).content[0];
    expect(text.type === "text" && text.text.length).toBeLessThan(longCocoon.length + 30);
    expect(text.type === "text" && text.text).toContain("truncated");
  });

  it("uses summary field for truncation when available", () => {
    const config: MaskingConfig = { ...DEFAULT_MASKING_CONFIG, keepRecentCount: 20 };
    const withSummary = JSON.stringify({
      success: true,
      data: {
        summary: "Found 42 messages",
        messages: Array.from({ length: 200 }, () => "long message content ".repeat(10)),
      },
    });
    const messages: Message[] = [
      makeToolResult("search", withSummary),
      makeToolResult("current", SHORT_RESULT),
    ];
    const result = maskOldToolResults(messages, { config, currentIterationStartIndex: 1 });
    const text = (result[0] as ToolResultMessage).content[0];
    expect(text.type === "text" && text.text).toContain("Found 42 messages");
    expect(text.type === "text" && text.text).toContain("_truncated");
  });

  it("wraps truncated summary in data object for consistency", () => {
    const config: MaskingConfig = { ...DEFAULT_MASKING_CONFIG, keepRecentCount: 20 };
    const withMessage = JSON.stringify({
      success: true,
      data: {
        message: "Sent OK",
        details: "x".repeat(5000),
      },
    });
    const messages: Message[] = [
      makeToolResult("tool", withMessage),
      makeToolResult("current", SHORT_RESULT),
    ];
    const result = maskOldToolResults(messages, { config, currentIterationStartIndex: 1 });
    const text = (result[0] as ToolResultMessage).content[0];
    if (text.type === "text") {
      const parsed = JSON.parse(text.text);
      expect(parsed.data.summary).toBe("Sent OK");
      expect(parsed.data._truncated).toBe(true);
    }
  });
});
