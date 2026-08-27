import { describe, expect, it } from "vitest";
import { getModelsForProvider } from "../../config/model-catalog.js";
import { getSupportedProviders, type SupportedProvider } from "../../config/providers.js";
import { getProviderModel } from "../model-resolver.js";

const PROVIDERS_WITHOUT_PI_REGISTRY_MODELS = new Set<SupportedProvider>([
  "gocoon",
  "grok-build",
  "local",
]);

const LEGACY_MODEL_CASES: ReadonlyArray<
  readonly [provider: SupportedProvider, legacyId: string, replacementId: string]
> = [
  ["codex", "gpt-5.3-codex", "gpt-5.6-terra"],
  ["codex", "gpt-5.1-codex-mini", "gpt-5.4-mini"],
  ["google", "gemini-3.1-flash-lite-preview", "gemini-3.1-flash-lite"],
  ["google", "gemini-2.5-pro", "gemini-3.1-pro-preview"],
  ["google", "gemini-2.5-flash", "gemini-3.6-flash"],
  ["google", "gemini-2.5-flash-lite", "gemini-3.5-flash-lite"],
  ["google", "gemini-2.0-flash", "gemini-3.6-flash"],
  ["google", "gemini-2.0-flash-lite", "gemini-3.1-flash-lite"],
  ["xai", "grok-4.20-0309-reasoning", "grok-4.5"],
  ["xai", "grok-4.20-0309-non-reasoning", "grok-4.3"],
  ["xai", "grok-4-1-fast-reasoning", "grok-4.3"],
  ["xai", "grok-4-1-fast-non-reasoning", "grok-4.3"],
  ["xai", "grok-3", "grok-4.3"],
  ["xai", "grok-3-mini-fast", "grok-4.3"],
  ["groq", "meta-llama/llama-4-maverick-17b-128e-instruct", "openai/gpt-oss-120b"],
  ["groq", "meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-120b"],
  ["groq", "qwen/qwen3-32b", "openai/gpt-oss-120b"],
  ["groq", "llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
  ["groq", "llama-3.1-8b-instant", "openai/gpt-oss-20b"],
  ["openrouter", "nvidia/nemotron-nano-9b-v2", "nvidia/nemotron-nano-9b-v2:free"],
  ["moonshot", "kimi-k2.5", "kimi-for-coding"],
  ["moonshot", "k2p6", "kimi-for-coding"],
  ["moonshot", "kimi-k2-thinking", "kimi-for-coding"],
  ["mistral", "mistral-medium-3.5", "mistral-medium-latest"],
  ["mistral", "devstral-2512", "mistral-medium-latest"],
  ["mistral", "devstral-small-2507", "mistral-medium-latest"],
  ["cerebras", "qwen-3-235b-a22b-instruct-2507", "gpt-oss-120b"],
  ["cerebras", "qwen-3-32b", "gpt-oss-120b"],
  ["cerebras", "llama3.1-8b", "gemma-4-31b"],
];

describe("provider model catalog", () => {
  it("contains unique model IDs with registry-backed context labels", () => {
    for (const provider of getSupportedProviders()) {
      const options = getModelsForProvider(provider.id);
      const modelIds = options.map((model) => model.value);
      expect(new Set(modelIds).size, `${provider.id} duplicate model IDs`).toBe(modelIds.length);

      if (PROVIDERS_WITHOUT_PI_REGISTRY_MODELS.has(provider.id)) continue;

      for (const option of options) {
        const model = getProviderModel(provider.id, option.value);
        if (/\b(?:vision|multimodal)\b/i.test(option.description)) {
          expect(model.input, `${provider.id}/${option.value} vision label`).toContain("image");
        }
        if (/\breasoning\b/i.test(option.description)) {
          expect(model.reasoning, `${provider.id}/${option.value} reasoning label`).toBe(true);
        }

        const contextLabel = option.description.match(
          /(\d+(?:\.\d+)?)\s*([KM])(?:\s+effective)?\s+context/i
        );
        if (!contextLabel) continue;

        const multiplier = contextLabel[2]?.toUpperCase() === "M" ? 1_000_000 : 1_000;
        const statedContext = Number(contextLabel[1]) * multiplier;
        const registryContext = model.contextWindow;
        const relativeDifference = Math.abs(registryContext - statedContext) / registryContext;

        expect(relativeDifference, `${provider.id}/${option.value} context label`).toBeLessThan(
          0.05
        );
      }
    }
  });

  it("contains resolvable defaults and utility models", () => {
    for (const provider of getSupportedProviders()) {
      if (provider.id === "local") continue;

      const modelIds = getModelsForProvider(provider.id).map((model) => model.value);
      expect(modelIds, `${provider.id} catalog`).toContain(provider.defaultModel);
      expect(modelIds, `${provider.id} catalog`).toContain(provider.utilityModel);

      if (PROVIDERS_WITHOUT_PI_REGISTRY_MODELS.has(provider.id)) continue;
      expect(getProviderModel(provider.id, provider.defaultModel).id).toBe(provider.defaultModel);
      expect(getProviderModel(provider.id, provider.utilityModel).id).toBe(provider.utilityModel);
    }
  });

  it("resolves every static catalog entry through pi-ai", () => {
    for (const provider of getSupportedProviders()) {
      if (PROVIDERS_WITHOUT_PI_REGISTRY_MODELS.has(provider.id)) continue;

      for (const option of getModelsForProvider(provider.id)) {
        expect(getProviderModel(provider.id, option.value).id).toBe(option.value);
      }
    }
  });

  it("uses Mistral's documented rolling alias instead of the unofficial dotted ID", () => {
    const mistral = getSupportedProviders().find((provider) => provider.id === "mistral");
    const modelIds = getModelsForProvider("mistral").map((model) => model.value);

    expect(mistral?.defaultModel).toBe("mistral-medium-latest");
    expect(modelIds).toContain("mistral-medium-latest");
    expect(modelIds).not.toContain("mistral-medium-3.5");
  });

  it.each(LEGACY_MODEL_CASES)("maps %s/%s to %s", (provider, legacyId, replacementId) => {
    expect(getProviderModel(provider, legacyId).id).toBe(replacementId);
  });
});
