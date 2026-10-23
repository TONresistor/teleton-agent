import { describe, expect, it, vi } from "vitest";
import { complete } from "@earendil-works/pi-ai/compat";
import { AgentConfigSchema } from "../../config/schema.js";
import { prepareModelRequest } from "../model-request.js";

describe("model request preparation", () => {
  it("forwards custom OpenRouter IDs and tools without optional sampling parameters", async () => {
    const request = prepareModelRequest(
      AgentConfigSchema.parse({
        provider: "openrouter",
        model: "example/brand-new",
        api_key: "sk-test-key",
      }),
      {
        context: { messages: [{ role: "user", content: "test", timestamp: 1 }] },
        tools: [
          {
            name: "read_info",
            description: "Read info",
            parameters: { type: "object", properties: {} },
          },
        ],
      }
    );
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
    expect(payload).toMatchObject({
      model: "example/brand-new",
      tools: [
        expect.objectContaining({ function: expect.objectContaining({ name: "read_info" }) }),
      ],
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("reasoning_effort");
    expect(payload).not.toHaveProperty("reasoning");
  });

  it.each([
    ["openai", "gpt-6-sol"],
    ["anthropic", "claude-fable-5-1"],
    ["anthropic", "claude-opus-5-5"],
  ])("sends compatible cache and thinking parameters for %s/%s", async (provider, model) => {
    const config = AgentConfigSchema.parse({
      provider,
      model,
      api_key: "sk-test-key",
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

  it("omits unsupported prompt cache fields for Groq", async () => {
    const request = prepareModelRequest(
      AgentConfigSchema.parse({
        provider: "groq",
        model: "openai/gpt-oss-120b",
        api_key: "sk-test-key",
      }),
      {
        context: { messages: [{ role: "user", content: "test", timestamp: 1 }] },
        sessionId: "payload-test",
      }
    );
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
    expect(request.options.cacheRetention).toBe("none");
    const wirePayload = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    expect(wirePayload).not.toHaveProperty("prompt_cache_key");
    expect(wirePayload).not.toHaveProperty("prompt_cache_retention");
  });

  it("builds one canonical request shape for all completion modes", () => {
    const config = AgentConfigSchema.parse({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      api_key: "sk-test-key",
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
      apiKey: "sk-test-key",
      maxTokens: 8192,
      temperature: 0.4,
      sessionId: "session-1",
      cacheRetention: "long",
    });
  });

  it.each([
    "gemini-4-argon",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
  ])("omits deprecated sampling parameters from the %s payload", async (model) => {
    const config = AgentConfigSchema.parse({
      provider: "google",
      model,
      api_key: "sk-test-key",
      temperature: 0.4,
    });
    const request = prepareModelRequest(config, {
      context: { messages: [{ role: "user", content: "test", timestamp: 1 }] },
    });
    let payload: unknown;
    const response = await complete(request.model, request.context, {
      ...request.options,
      onPayload(value) {
        payload = value;
        throw new Error("Stop before network request");
      },
    });

    expect(request.options).not.toHaveProperty("temperature");
    expect(payload).toHaveProperty("config.maxOutputTokens", config.max_tokens);
    expect(payload).not.toHaveProperty("config.temperature");
    expect(response.errorMessage).toContain("Stop before network request");
  });

  it("keeps temperature for Gemini 3.5 Flash", () => {
    const config = AgentConfigSchema.parse({
      provider: "google",
      model: "gemini-3.5-flash",
      api_key: "sk-test-key",
      temperature: 0.4,
    });

    const request = prepareModelRequest(config, {
      context: { messages: [] },
    });

    expect(request.options.temperature).toBe(0.4);
  });

  it.each([
    ["openai", "gpt-6-astra"],
    ["openai", "gpt-6.1-sol"],
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
      api_key: "sk-test-key",
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
        api_key: "sk-test-key",
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
      api_key: "sk-test-key",
      reasoning_effort: "medium",
    });

    const request = prepareModelRequest(config, {
      context: { messages: [] },
    });

    expect(request.options.reasoningEffort).toBe("medium");
    expect(request.options).not.toHaveProperty("temperature");
  });

  it.each(["codex", "openai"])("maps unsupported GPT-6.1 Sol efforts to low for %s", (provider) => {
    for (const configuredEffort of ["none", "minimal", "high"] as const) {
      const request = prepareModelRequest(
        AgentConfigSchema.parse({
          provider,
          model: "gpt-6.1-sol",
          api_key: "sk-test-key",
          reasoning_effort: configuredEffort,
          temperature: 0.4,
        }),
        { context: { messages: [] } }
      );

      expect(request.options.reasoningEffort).toBe(configuredEffort === "high" ? "high" : "low");
      expect(request.options).not.toHaveProperty("temperature");
    }
  });

  it.each([
    ["openai", "gpt-5.4-pro", "none", "medium"],
    ["openai", "gpt-5.4", "minimal", "low"],
    ["openai", "gpt-5", "max", "high"],
    ["codex", "gpt-5.5", "minimal", "low"],
  ] as const)(
    "clamps %s/%s reasoning %s using catalog capabilities",
    (provider, model, reasoning_effort, expected) => {
      const request = prepareModelRequest(
        AgentConfigSchema.parse({ provider, model, api_key: "sk-test-key", reasoning_effort }),
        { context: { messages: [] } }
      );
      expect(request.options.reasoningEffort).toBe(expected);
      expect(request.options).not.toHaveProperty("temperature");
    }
  );

  it.each(["glm-5.3", "glm-5.3-flash", "glm-5.3-highspeed"])(
    "keeps required thinking enabled for %s",
    async (model) => {
      for (const reasoning_effort of ["none", "low", "high", "max"] as const) {
        const request = prepareModelRequest(
          AgentConfigSchema.parse({
            provider: "zai",
            model,
            api_key: "test-key",
            reasoning_effort,
          }),
          { context: { messages: [{ role: "user", content: "test", timestamp: 1 }] } }
        );
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
        expect(payload).toHaveProperty("thinking.type", "enabled");
        expect(payload).toHaveProperty(
          "reasoning_effort",
          reasoning_effort === "none" ? "low" : reasoning_effort
        );
      }
    }
  );

  it("uses adaptive thinking metadata for a newly cataloged Claude model", () => {
    const request = prepareModelRequest(
      AgentConfigSchema.parse({
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        api_key: "sk-test-key",
      }),
      { context: { messages: [] } }
    );
    expect(request.options.thinkingEnabled).toBe(true);
    expect(request.options).not.toHaveProperty("temperature");
  });

  it("keeps standard sampling and omits reasoning for non-reasoning OpenAI models", () => {
    const request = prepareModelRequest(
      AgentConfigSchema.parse({
        provider: "openai",
        model: "gpt-4.1",
        api_key: "sk-test-key",
        temperature: 0.4,
        reasoning_effort: "high",
      }),
      { context: { messages: [] } }
    );
    expect(request.options.temperature).toBe(0.4);
    expect(request.options).not.toHaveProperty("reasoningEffort");
  });

  it.each(["codex", "openai"])(
    "preserves low effort in the GPT-6.1 Sol payload through %s",
    async (provider) => {
      const request = prepareModelRequest(
        AgentConfigSchema.parse({
          provider,
          model: "gpt-6.1-sol",
          api_key: "sk-test-key",
          reasoning_effort: "none",
        }),
        { context: { messages: [{ role: "user", content: "test", timestamp: 1 }] } }
      );
      const fetch = vi.fn().mockRejectedValue(new Error("Network disabled in test"));
      let payload: unknown;
      const mockCodexToken = `header.${Buffer.from(
        JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })
      ).toString("base64")}.signature`;
      await complete(request.model, request.context, {
        ...request.options,
        apiKey: provider === "codex" ? mockCodexToken : request.options.apiKey,
        fetch,
        onPayload(value) {
          payload = value;
          throw new Error("Stop after payload capture");
        },
      });

      expect(fetch).not.toHaveBeenCalled();
      if (provider === "openai") {
        expect(payload).toHaveProperty("reasoning.effort", "medium");
        expect(payload).toHaveProperty(
          "input",
          expect.arrayContaining([
            expect.objectContaining({ type: "configuration_update", reasoning: { effort: "low" } }),
          ])
        );
      } else {
        expect(payload).toHaveProperty("reasoning.effort", "low");
      }
      expect(payload).not.toHaveProperty("temperature");
    }
  );
});
