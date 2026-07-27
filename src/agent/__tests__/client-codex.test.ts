import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigSchema } from "../../config/schema.js";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  stream: vi.fn(),
  getCodexApiKey: vi.fn(() => "codex-session-token"),
  refreshCodexApiKey: vi.fn(),
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

vi.mock("../../providers/codex-credentials.js", () => ({
  getCodexApiKey: mocks.getCodexApiKey,
  refreshCodexApiKey: mocks.refreshCodexApiKey,
}));

import { chatWithContext } from "../client.js";

function assistantMessage(stopReason: "stop" | "error", errorMessage?: string) {
  return {
    role: "assistant" as const,
    content: stopReason === "stop" ? [{ type: "text" as const, text: "ok" }] : [],
    api: "openai-codex-responses" as const,
    provider: "openai-codex" as const,
    model: "gpt-5.6-terra",
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
  provider: "codex",
  model: "gpt-5.6-terra",
  api_key: "",
});

describe("Codex client", () => {
  beforeEach(() => {
    mocks.complete.mockReset();
    mocks.getCodexApiKey.mockReset();
    mocks.getCodexApiKey.mockReturnValue("codex-session-token");
    mocks.refreshCodexApiKey.mockReset();
  });

  it("uses the Codex CLI token when the configured API key is empty", async () => {
    mocks.complete.mockResolvedValue(assistantMessage("stop"));

    const result = await chatWithContext(config, {
      context: { messages: [] },
    });

    expect(mocks.getCodexApiKey).toHaveBeenCalledWith("");
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.complete.mock.calls[0][2]).toMatchObject({
      apiKey: "codex-session-token",
      cacheRetention: "long",
    });
    expect(result.text).toBe("ok");
  });

  it("reloads a rejected Codex credential and retries once", async () => {
    mocks.complete
      .mockResolvedValueOnce(assistantMessage("error", "OpenAI API error (401): Unauthorized"))
      .mockResolvedValueOnce(assistantMessage("stop"));
    mocks.refreshCodexApiKey.mockResolvedValue("refreshed-codex-token");

    const result = await chatWithContext(config, {
      context: { messages: [] },
    });

    expect(mocks.refreshCodexApiKey).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete.mock.calls[1][2]).toMatchObject({
      apiKey: "refreshed-codex-token",
    });
    expect(result.text).toBe("ok");
  });
});
