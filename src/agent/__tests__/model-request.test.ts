import { describe, expect, it } from "vitest";
import { AgentConfigSchema } from "../../config/schema.js";
import { prepareModelRequest } from "../model-request.js";

describe("model request preparation", () => {
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

  it("enables mandatory adaptive thinking for Claude Fable 5.1", () => {
    const config = AgentConfigSchema.parse({
      provider: "anthropic",
      model: "claude-fable-5-1",
      api_key: "test-key",
    });
    const request = prepareModelRequest(config, { context: { messages: [] } });

    expect(request.options.thinkingEnabled).toBe(true);
    expect(request.model.compat).toMatchObject({
      forceAdaptiveThinking: true,
      supportsTemperature: false,
    });
  });

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
