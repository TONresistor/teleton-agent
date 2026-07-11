import { afterEach, describe, expect, it } from "vitest";
import { getModelsForProvider } from "../../config/model-catalog.js";
import { getProviderMetadata } from "../../config/providers.js";
import { AgentConfigSchema } from "../../config/schema.js";
import { getProviderModel } from "../model-resolver.js";

const ENABLED_GPT_56_CODEX_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra"] as const;
const LUNA_MODEL = "gpt-5.6-luna";

describe("Codex GPT-5.6 models", () => {
  afterEach(() => {
    delete process.env.TELETON_ENABLE_CODEX_LUNA;
  });

  it.each(ENABLED_GPT_56_CODEX_MODELS)(
    "resolves %s through the Codex Responses provider",
    (modelId) => {
      const model = getProviderModel("codex", modelId);

      expect(model.id).toBe(modelId);
      expect(model.provider).toBe("openai-codex");
      expect(model.api).toBe("openai-codex-responses");
      expect(model.contextWindow).toBe(372_000);
      expect(model.maxTokens).toBe(128_000);
    }
  );

  it("hides and rejects Luna while the live backend does not advertise it", () => {
    const modelIds = getModelsForProvider("codex").map((model) => model.value);

    expect(modelIds).toEqual(expect.arrayContaining(ENABLED_GPT_56_CODEX_MODELS));
    expect(modelIds).not.toContain(LUNA_MODEL);
    expect(() => getProviderModel("codex", LUNA_MODEL)).toThrow(
      "gpt-5.6-luna is disabled because the Codex backend does not currently advertise it"
    );
    expect(AgentConfigSchema.safeParse({ provider: "codex", model: LUNA_MODEL }).success).toBe(
      false
    );
    expect(
      AgentConfigSchema.safeParse({
        provider: "codex",
        model: "gpt-5.6-terra",
        utility_model: LUNA_MODEL,
      }).success
    ).toBe(false);
  });

  it("allows a controlled Luna revalidation behind an explicit feature flag", () => {
    process.env.TELETON_ENABLE_CODEX_LUNA = "true";

    expect(getModelsForProvider("codex").map((model) => model.value)).toContain(LUNA_MODEL);
    expect(getProviderModel("codex", LUNA_MODEL).id).toBe(LUNA_MODEL);
    expect(AgentConfigSchema.safeParse({ provider: "codex", model: LUNA_MODEL }).success).toBe(
      true
    );
  });

  it("keeps GPT-5.5 as the Codex default while GPT-5.6 is in preview", () => {
    const defaultModel = getProviderMetadata("codex").defaultModel;

    expect(defaultModel).toBe("gpt-5.5");
    expect(getModelsForProvider("codex")[0]?.value).toBe(defaultModel);
  });
});
