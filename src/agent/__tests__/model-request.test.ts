import { describe, expect, it, vi } from "vitest";
import { complete } from "@earendil-works/pi-ai/compat";
import { AgentConfigSchema } from "../../config/schema.js";
import { prepareModelRequest } from "../model-request.js";

describe("model request preparation", () => {
  it.each([
    ["openai", "gpt-6-sol"],
    ["anthropic", "claude-fable-5-1"],
    ["anthropic", "claude-opus-5-5"],
  ])("sends compatible cache and thinking parameters for %s/%s", async (provider, model) => {
    const config = AgentConfigSchema.parse({
      provider,
      model,
      api_key: "test-key",
      temperature: 0.4,
    });
    const request = prepareModelRequest(config, {
      context: { messages: [{ role: "user", content: "test", timestamp: 1 }] },
      sessionId: "payload-test",
    });
    const fetch = vi.fn().mockRejectedValue(new Error("Network disabled in test"));
    let payload: unknown;
    await complete(request.model, request.context, {
      ...request.options,
      fetch,
      onPayload(value) {
        payload = value;
        throw new Error("Stop after payload capture");
      },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(payload).toBeDefined();
    expect(payload).not.toHaveProperty("temperature");
    if (provider === "openai") {
      expect(payload).toHaveProperty("prompt_cache_options.ttl", "30m");
      expect(payload).not.toHaveProperty("prompt_cache_retention", "24h");
    } else {
      expect(payload).toHaveProperty("thinking.type", "adaptive");
    }
  });

  it("builds one canonical request shape for all completion modes", () => {
    const config = AgentConfigSchema.parse({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      api_key: "test-key",
      max_tokens: 8192,
      temperature: 0.4,
    });

    const request = prepareModelRequest(config, {
      context: { systemPrompt: "context prompt", messages: [] },
      systemPrompt: "override prompt",
      sessionId: "session-1",
    });

    expect(request.provider).toBe("anthropic");
    expect(request.context.systemPrompt).toBe("override prompt");
    expect(request.options).toMatchObject({
      apiKey: "test-key",
      maxTokens: 8192,
      temperature: 0.4,
      sessionId: "session-1",
      cacheRetention: "long",
    });
  });

  it.each(["gemini-3.6-flash", "gemini-3.5-flash-lite"])(
    "omits deprecated sampling parameters for %s",
    (model) => {
      const config = AgentConfigSchema.parse({
        provider: "google",
        model,
        api_key: "test-key",
        temperature: 0.4,
      });

      const request = prepareModelRequest(config, {
        context: { messages: [] },
      });

      expect(request.options).not.toHaveProperty("temperature");
    }
  );

  it("keeps temperature for Gemini 3.5 Flash", () => {
    const config = AgentConfigSchema.parse({
      provider: "google",
      model: "gemini-3.5-flash",
      api_key: "test-key",
      temperature: 0.4,
    });

    const request = prepareModelRequest(config, {
      context: { messages: [] },
    });

    expect(request.options.temperature).toBe(0.4);
  });

  it.each([
    ["openai", "gpt-6-astra"],
    ["openai", "gpt-6-sol"],
    ["openai", "gpt-6-luna"],
    ["openrouter", "openai/gpt-6-sol"],
    ["openrouter", "openai/gpt-6-luna"],
    ["openrouter", "anthropic/claude-opus-5.5"],
    ["openrouter", "anthropic/claude-fable-5.1"],
    ["openrouter", "openai/gpt-6-astra"],
    ["openrouter", "google/gemini-3.8-flash"],
  ])("omits unsupported temperature for %s/%s", (provider, model) => {
    const config = AgentConfigSchema.parse({
      provider,
      model,
      api_key: "test-key",
      temperature: 0.4,
    });
    const request = prepareModelRequest(config, { context: { messages: [] } });

    expect(request.model.id).toBe(model);
    expect(request.options).not.toHaveProperty("temperature");
  });

  it.each(["claude-fable-5-1", "claude-opus-5-5"])(
    "enables mandatory adaptive thinking for %s",
    (model) => {
      const config = AgentConfigSchema.parse({
        provider: "anthropic",
        model,
        api_key: "test-key",
      });
      const request = prepareModelRequest(config, { context: { messages: [] } });

      expect(request.options.thinkingEnabled).toBe(true);
      expect(request.model.compat).toMatchObject({
        forceAdaptiveThinking: true,
      });
    }
  );

  it("passes the configured reasoning effort to Codex", () => {
    const config = AgentConfigSchema.parse({
      provider: "codex",
      model: "gpt-5.6-terra",
      api_key: "test-key",
      reasoning_effort: "medium",
    });

    const request = prepareModelRequest(config, {
      context: { messages: [] },
    });

    expect(request.options.reasoningEffort).toBe("medium");
    expect(request.options).not.toHaveProperty("temperature");
  });
});
