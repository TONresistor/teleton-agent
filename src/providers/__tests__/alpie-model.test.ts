import { describe, expect, it } from "vitest";
import { prepareModelRequest } from "../../agent/model-request.js";
import { getModelsForProvider } from "../../config/model-catalog.js";
import { getProviderMetadata, validateApiKeyFormat } from "../../config/providers.js";
import { AgentConfigSchema } from "../../config/schema.js";
import { getProviderModel } from "../model-resolver.js";

describe("Alpie provider", () => {
  it("registers Alpie 32B as the default reasoning model", () => {
    const metadata = getProviderMetadata("alpie");
    const models = getModelsForProvider("alpie");

    expect(metadata.defaultModel).toBe("alpie-32b");
    expect(metadata.utilityModel).toBe("alpie-32b");
    expect(metadata.toolLimit).toBe(0);
    expect(models.map((model) => model.value)).toEqual(["alpie-32b"]);
    expect(validateApiKeyFormat("alpie", "invalid")).toMatch(/pi-/);
    expect(validateApiKeyFormat("alpie", "pi-test")).toBeUndefined();
  });

  it("resolves the official OpenAI-compatible endpoint and limits", () => {
    const model = getProviderModel("alpie", "alpie-32b");

    expect(model).toMatchObject({
      id: "alpie-32b",
      api: "openai-completions",
      provider: "alpie",
      baseUrl: "https://api.169pi.com/v1",
      headers: { "User-Agent": "Teleton-Agent" },
      reasoning: true,
      input: ["text"],
      contextWindow: 65_000,
      maxTokens: 16_384,
    });
  });

  it("passes the configured API key to completion requests", () => {
    const config = AgentConfigSchema.parse({
      provider: "alpie",
      model: "alpie-32b",
      api_key: "pi-test",
    });
    const request = prepareModelRequest(config, { context: { messages: [] } });

    expect(request.provider).toBe("alpie");
    expect(request.options.apiKey).toBe("pi-test");
    expect(request.options.maxTokens).toBe(4096);
    expect(request.context.tools).toBeUndefined();
  });
});
