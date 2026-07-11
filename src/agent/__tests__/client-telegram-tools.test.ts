import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "@earendil-works/pi-ai/compat";
import { AgentConfigSchema } from "../../config/schema.js";

const mocks = vi.hoisted(() => ({
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
  expect(preparedSend?.description).toContain("return normal assistant text instead");
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
