import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "@earendil-works/pi-ai/compat";
import { AgentConfigSchema } from "../../config/schema.js";

const mocks = vi.hoisted(() => ({
  appendToTranscript: vi.fn(),
  complete: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/compat", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-ai/compat")>(
    "@earendil-works/pi-ai/compat"
  );
  return {
    ...actual,
    complete: mocks.complete,
    stream: mocks.stream,
  };
});

vi.mock("../../session/transcript.js", () => ({
  appendToTranscript: mocks.appendToTranscript,
  readTranscript: () => [],
}));

import { chatWithContext, streamWithContext } from "../client.js";

const config = AgentConfigSchema.parse({
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  api_key: "test-key",
});

const sendTool: Tool = {
  name: "telegram_send_message",
  description: "Send a Telegram message.",
  parameters: {
    type: "object",
    properties: {},
  },
};

const readTool: Tool = {
  name: "telegram_get_history",
  description: "Read Telegram history.",
  parameters: {
    type: "object",
    properties: {},
  },
};

function assistantMessage() {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "ok" }],
    api: "anthropic-messages" as const,
    provider: "anthropic" as const,
    model: "claude-haiku-4-5-20251001",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

function expectPreparedTools(context: { tools?: Tool[] }) {
  const preparedSend = context.tools?.find((tool) => tool.name === sendTool.name);
  const preparedRead = context.tools?.find((tool) => tool.name === readTool.name);

  expect(preparedSend?.description).toContain("This action sends immediately");
  expect(preparedSend?.description).toContain("return normal assistant text unless");
  expect(preparedSend?.description).toContain("native Rich Message structure");
  expect(preparedSend?.description).toContain("do not return a duplicate confirmation");
  expect(preparedRead).toEqual(readTool);
  expect(sendTool.description).toBe("Send a Telegram message.");
}

describe("Telegram tool preparation", () => {
  beforeEach(() => {
    mocks.complete.mockReset();
    mocks.stream.mockReset();
  });

  it("guards send tools in non-streaming calls without mutating registry definitions", async () => {
    mocks.complete.mockResolvedValue(assistantMessage());

    await chatWithContext(config, {
      context: { messages: [] },
      tools: [sendTool, readTool],
    });

    expectPreparedTools(mocks.complete.mock.calls[0][1]);
  });

  it.each([false, true])("returns every text block in order (streaming: %s)", async (streaming) => {
    const message = assistantMessage();
    message.content = [
      { type: "text", text: "First block" },
      { type: "text", text: "Second block" },
    ];
    mocks.complete.mockResolvedValue(message);
    mocks.stream.mockReturnValue({
      async *[Symbol.asyncIterator]() {},
      result: vi.fn().mockResolvedValue(message),
    });
    const options = { context: { messages: [] } };
    const response = streaming
      ? await streamWithContext(config, options).result
      : await chatWithContext(config, options);

    expect(response.text).toBe("First block\nSecond block");
  });

  it("does not persist tool calls from a truncated response", async () => {
    mocks.appendToTranscript.mockClear();
    mocks.complete.mockResolvedValue({
      ...assistantMessage(),
      stopReason: "length",
      content: [{ type: "toolCall", id: "partial", name: "send", arguments: {} }],
    });
    await chatWithContext(config, {
      context: { messages: [] },
      sessionId: "test",
      persistTranscript: true,
    });
    expect(mocks.appendToTranscript).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "returns local overflow without a provider request (stream: %s)",
    async (streaming) => {
      const options = { context: { systemPrompt: "system ".repeat(150000), messages: [] } };
      const response = streaming
        ? await streamWithContext(config, options).result
        : await chatWithContext(config, options);
      expect(response.message.stopReason).toBe("error");
      expect(response.message.errorMessage).toContain("Context length exceeded");
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.stream).not.toHaveBeenCalled();
    }
  );

  it("applies the same guard to streaming calls", async () => {
    mocks.stream.mockReturnValue({
      async *[Symbol.asyncIterator]() {},
      result: vi.fn().mockResolvedValue(assistantMessage()),
    });

    const streamed = streamWithContext(config, {
      context: { messages: [] },
      tools: [sendTool, readTool],
    });
    await streamed.result;

    expectPreparedTools(mocks.stream.mock.calls[0][1]);
  });
});

describe("streamed think filtering", () => {
  it.each([
    [["public <thi", "nk>secret</th", "ink> after"], "public  after"],
    [["<think>one</think>A<think>two</think>B"], "AB"],
    [["before<think>never closed"], "before"],
    [["before<thi"], "before<thi"],
    [["operator <"], "operator <"],
    [["literal <th"], "literal <th"],
    [["<think>", "secret"], ""],
  ])("filters split and interrupted tags: %j", async (chunks, expected) => {
    const message = assistantMessage();
    message.content = [{ type: "text", text: chunks.join("") }];
    mocks.stream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (const delta of chunks) yield { type: "text_delta", delta };
      },
      result: async () => message,
    });
    const streamed = streamWithContext(config, { context: { messages: [] } });
    let text = "";
    for await (const delta of streamed.textStream) text += delta;
    expect(text).toBe(expected);
    expect((await streamed.result).text).toBe(expected);
  });

  it("keeps filter state isolated between requests", async () => {
    const { createThinkFilter } = await import("../../utils/pi-message.js");
    const first = createThinkFilter();
    const second = createThinkFilter();
    expect(first.push("<think>secret")).toBe("");
    expect(second.push("public")).toBe("public");
    expect(first.push("</think>first")).toBe("first");
  });
  it.each([false, true])(
    "preserves ordered public suffixes in the final reply and transcript (stream: %s)",
    async (streaming) => {
      const message = assistantMessage();
      message.content = [
        { type: "text", text: "operator <" },
        { type: "text", text: "literal <th" },
      ];
      mocks.appendToTranscript.mockClear();
      mocks.complete.mockResolvedValue(message);
      mocks.stream.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          for (const [contentIndex, text] of ["operator <", "literal <th"].entries()) {
            yield { type: "text_start", contentIndex };
            yield { type: "text_delta", contentIndex, delta: text };
          }
        },
        result: async () => message,
      });
      const options = { context: { messages: [] }, sessionId: "suffix", persistTranscript: true };
      let draft = "";
      let result;
      if (streaming) {
        const stream = streamWithContext(config, options);
        for await (const delta of stream.textStream) draft += delta;
        result = await stream.result;
        expect(draft).toBe("operator <\nliteral <th");
      } else result = await chatWithContext(config, options);
      expect(result.text).toBe("operator <\nliteral <th");
      expect(mocks.appendToTranscript).toHaveBeenCalledWith(
        "suffix",
        expect.objectContaining({
          content: [
            { type: "text", text: "operator <" },
            { type: "text", text: "literal <th" },
          ],
        })
      );
    }
  );

  it.each(["aborted", "error", "length"] as const)(
    "never flushes hidden content or pending prefixes after %s",
    async (stopReason) => {
      const message = {
        ...assistantMessage(),
        stopReason,
        content: [{ type: "text" as const, text: "public <think>secret</th" }],
      };
      mocks.appendToTranscript.mockClear();
      mocks.stream.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          for (const delta of ["public <thi", "nk>secret</th"]) yield { type: "text_delta", delta };
        },
        result: async () => message,
      });
      const stream = streamWithContext(config, { context: { messages: [] } });
      let draft = "";
      for await (const delta of stream.textStream) draft += delta;
      expect(draft).toBe("public ");
      expect((await stream.result).text).toBe("public ");
      expect(mocks.appendToTranscript).not.toHaveBeenCalled();
    }
  );
});
