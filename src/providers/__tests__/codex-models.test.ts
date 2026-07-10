import { describe, expect, it } from "vitest";
import { getModelsForProvider } from "../../config/model-catalog.js";
import { getProviderMetadata } from "../../config/providers.js";
import { getProviderModel } from "../model-resolver.js";

const GPT_56_CODEX_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;

describe("Codex GPT-5.6 models", () => {
  it.each(GPT_56_CODEX_MODELS)("resolves %s through the Codex Responses provider", (modelId) => {
    const model = getProviderModel("codex", modelId);

    expect(model.id).toBe(modelId);
    expect(model.provider).toBe("openai-codex");
    expect(model.api).toBe("openai-codex-responses");
    expect(model.contextWindow).toBe(372_000);
    expect(model.maxTokens).toBe(128_000);
  });

  it("exposes every GPT-5.6 variant in the shared Codex catalog", () => {
    const modelIds = getModelsForProvider("codex").map((model) => model.value);

    expect(modelIds).toEqual(expect.arrayContaining(GPT_56_CODEX_MODELS));
  });

  it("keeps GPT-5.5 as the Codex default while GPT-5.6 is in preview", () => {
    const defaultModel = getProviderMetadata("codex").defaultModel;

    expect(defaultModel).toBe("gpt-5.5");
    expect(getModelsForProvider("codex")[0]?.value).toBe(defaultModel);
  });
});
