import { describe, expect, it } from "vitest";
import { getModelsForProvider } from "../../config/model-catalog.js";
import { getProviderMetadata } from "../../config/providers.js";
import { AgentConfigSchema } from "../../config/schema.js";
import { getProviderModel } from "../model-resolver.js";

const CODEX_MODELS = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;

describe("Codex models", () => {
  it.each(CODEX_MODELS)("resolves %s through the Codex Responses provider", (modelId) => {
    const model = getProviderModel("codex", modelId);

    expect(model.id).toBe(modelId);
    expect(model.provider).toBe("openai-codex");
    expect(model.api).toBe("openai-codex-responses");
    expect(model.input).toContain("image");
    expect(model.contextWindow).toBe(272_000);
    expect(model.maxTokens).toBe(128_000);
  });

  it("offers Astra and every GPT-5.6 model advertised by the Codex backend", () => {
    const modelIds = getModelsForProvider("codex").map((model) => model.value);

    expect(modelIds).toEqual(expect.arrayContaining([...CODEX_MODELS]));
    expect(AgentConfigSchema.safeParse({ provider: "codex", model: "gpt-5.6-luna" }).success).toBe(
      true
    );
  });

  it("uses GPT-5.6 Terra as the balanced Codex default", () => {
    const defaultModel = getProviderMetadata("codex").defaultModel;

    expect(defaultModel).toBe("gpt-5.6-terra");
    expect(getModelsForProvider("codex")[0]?.value).toBe(defaultModel);
  });

  it("keeps old GPT-5.3 Codex configs working through the supported replacement", () => {
    expect(getProviderModel("codex", "gpt-5.3-codex").id).toBe("gpt-5.6-terra");
  });
});
