import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentConfigSchema } from "../../config/schema.js";
import { chatWithContext, streamWithContext } from "../client.js";
import { addUsage, type UsageAccumulator } from "../runtime-utils.js";
import { accumulateTokenUsage, getTokenUsage } from "../token-usage.js";
import type { CostAwareUsage } from "../../providers/openrouter-usage.js";

const mocks = vi.hoisted(() => ({ appendToTranscript: vi.fn() }));
vi.mock("../../session/transcript.js", () => ({
  appendToTranscript: mocks.appendToTranscript,
  readTranscript: () => [],
}));

function response(cost: unknown = 0.02) {
  const chunks = [
    {
      id: "gen-test",
      choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }],
    },
    {
      id: "gen-test",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost },
    },
  ];
  const bytes = new TextEncoder().encode(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join("") +
      "data: [DONE]\r\n\r\n"
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
}

const config = AgentConfigSchema.parse({
  provider: "openrouter",
  model: "example/new-model",
  api_key: "test-key",
});
const context = { messages: [{ role: "user" as const, content: "test", timestamp: 1 }] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("OpenRouter reported cost", () => {
  it.each([0, 0.05])(
    "uses the exact reported amount %s, including genuine free calls",
    async (cost) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response(cost))
      );
      const result = await chatWithContext(config, { context });
      expect(result.message.usage.cost.total).toBe(cost);
      expect((result.message.usage as CostAwareUsage).costIncomplete).not.toBe(true);
    }
  );

  it.each([null, -1, "0.02"])(
    "marks missing or invalid cost %j as incomplete without losing the reply",
    async (cost) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response(cost))
      );
      const result = await chatWithContext(config, { context });
      expect(result.text).toBe("Hello");
      expect((result.message.usage as CostAwareUsage).costIncomplete).toBe(true);
      const acc: UsageAccumulator = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalCost: 0.1,
      };
      addUsage(acc, result.message.usage);
      expect(acc).toMatchObject({ totalCost: 0.1, costIncomplete: true });
      accumulateTokenUsage(acc);
      expect(getTokenUsage().costIncomplete).toBe(true);
    }
  );

  it("does not mix billing metadata between concurrent requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        return response(body.model.endsWith("second") ? 0.07 : 0.02);
      })
    );
    const [first, second] = await Promise.all([
      chatWithContext(config, { context }),
      chatWithContext({ ...config, model: "example/second" }, { context }),
    ]);
    expect(first.message.usage.cost.total).toBe(0.02);
    expect(second.message.usage.cost.total).toBe(0.07);
  });

  it("retains the catalog estimate for known models when no billed cost is returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(null))
    );
    const result = await chatWithContext({ ...config, model: "openai/gpt-6-sol" }, { context });
    expect(result.message.usage.cost.total).toBeGreaterThan(0);
    expect((result.message.usage as CostAwareUsage).costIncomplete).not.toBe(true);
  });

  it("preserves the charged cost before storing the transcript", async () => {
    const fetch = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetch);
    const result = await chatWithContext(config, {
      context,
      sessionId: "test",
      persistTranscript: true,
    });
    expect(result.message.usage.cost.total).toBe(0.02);
    expect(result.message.usage.totalTokens).toBe(12);
    expect(mocks.appendToTranscript).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({
        usage: expect.objectContaining({ cost: expect.objectContaining({ total: 0.02 }) }),
      })
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves streaming text and the charged cost", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response())
    );
    const stream = streamWithContext(config, { context });
    let text = "";
    for await (const delta of stream.textStream) text += delta;
    expect(text).toBe("Hello");
    expect((await stream.result).message.usage.cost.total).toBe(0.02);
  });
});
