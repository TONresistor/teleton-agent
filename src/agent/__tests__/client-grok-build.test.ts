import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigSchema } from "../../config/schema.js";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  stream: vi.fn(),
  getGrokBuildApiKey: vi.fn(() => "grok-session-token"),
  refreshGrokBuildApiKey: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/compat", async () => {
  const actual =
    await vi.importActual<typeof import("@earendil-works/pi-ai")>("@earendil-works/pi-ai");
  return {
    ...actual,
    complete: mocks.complete,
    stream: mocks.stream,
  };
});

vi.mock("../../providers/grok-build-credentials.js", () => ({
  getGrokBuildApiKey: mocks.getGrokBuildApiKey,
  refreshGrokBuildApiKey: mocks.refreshGrokBuildApiKey,
  getGrokBuildCliVersion: vi.fn(() => "0.2.77"),
}));

import { chatWithContext, streamWithContext } from "../client.js";

function assistantMessage(stopReason: "stop" | "error", errorMessage?: string) {
  return {
    role: "assistant" as const,
    content: stopReason === "stop" ? [{ type: "text" as const, text: "ok" }] : [],
    api: "openai-responses" as const,
    provider: "xai" as const,
    model: "grok-build",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

const config = AgentConfigSchema.parse({
  provider: "grok-build",
  model: "grok-build",
  api_key: "",
});

describe("Grok Build client", () => {
  beforeEach(() => {
    mocks.complete.mockReset();
    mocks.stream.mockReset();
    mocks.getGrokBuildApiKey.mockReset();
    mocks.getGrokBuildApiKey.mockReturnValue("grok-session-token");
    mocks.refreshGrokBuildApiKey.mockReset();
  });

  it("uses the CLI token without temperature or long cache retention", async () => {
    mocks.complete.mockResolvedValue(assistantMessage("stop"));

    await chatWithContext(config, { context: { messages: [] } });

    const [, context, options] = mocks.complete.mock.calls[0];
    expect(options).toMatchObject({
      apiKey: "grok-session-token",
      cacheRetention: "none",
    });
    expect(options).not.toHaveProperty("temperature");
    expect(options.onPayload({ model: "grok-build" })).toMatchObject({
      model: "grok-build",
      parallel_tool_calls: false,
    });
    expect(context.messages).toEqual([]);
  });

  it("refreshes a rejected streaming credential and completes the same turn", async () => {
    const unauthorized = assistantMessage("error", "OpenAI API error (401): Unauthorized");
    mocks.stream.mockReturnValue({
      async *[Symbol.asyncIterator]() {},
      result: vi.fn().mockResolvedValue(unauthorized),
    });
    mocks.refreshGrokBuildApiKey.mockResolvedValue("refreshed-session-token");
    mocks.complete.mockResolvedValue(assistantMessage("stop"));

    const streamed = streamWithContext(config, { context: { messages: [] } });
    for await (const _chunk of streamed.textStream) {
      // The initial 401 produces no text.
    }
    const result = await streamed.result;

    expect(mocks.refreshGrokBuildApiKey).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.complete.mock.calls[0][2]).toMatchObject({
      apiKey: "refreshed-session-token",
      cacheRetention: "none",
    });
    expect(mocks.complete.mock.calls[0][2].onPayload({})).toEqual({
      parallel_tool_calls: false,
    });
    expect(result.text).toBe("ok");
  });
});
