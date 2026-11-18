import { getModel, type Api, type Model } from "@earendil-works/pi-ai/compat";

function gpt62Model(
  provider: "openai" | "codex" | "openrouter",
  family: "sol" | "astra"
): Model<Api> {
  const registryProvider = provider === "codex" ? "openai-codex" : provider;
  const referenceId = provider === "openrouter" ? "openai/gpt-6.1-sol" : "gpt-6.1-sol";
  const reference =
    provider === "codex"
      ? getModel("openai-codex", "gpt-6.1-sol")
      : provider === "openrouter"
        ? getModel("openrouter", "openai/gpt-6.1-sol")
        : getModel("openai", "gpt-6.1-sol");
  if (!reference) throw new Error(`Missing reference model ${registryProvider}/${referenceId}`);
  const id = `${provider === "openrouter" ? "openai/" : ""}gpt-6.2-${family}`;
  const input = family === "astra" ? 8 : 2;
  const output = family === "astra" ? 40 : 10;
  return {
    ...reference,
    id,
    name: `GPT-6.2 ${family === "astra" ? "Astra" : "Sol"}`,
    contextWindow:
      provider === "openrouter"
        ? 1_050_000
        : provider === "codex" && family === "sol"
          ? 500_000
          : 272_000,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    cost: {
      input,
      output,
      cacheRead: input * 0.05,
      cacheWrite: input * 1.25,
      tiers: [
        {
          inputTokensAbove: 272_000,
          input: input * 2,
          output: output * 1.5,
          cacheRead: input * 0.1,
          cacheWrite: input * 2.5,
        },
      ],
    },
  };
}

/** Models missing from the bundled pi-ai catalog, including retained legacy models. */
export const ADDITIONAL_MODELS: Record<string, Model<Api>> = {
  "openai:gpt-6.2-sol": gpt62Model("openai", "sol"),
  "openai:gpt-6.2-astra": gpt62Model("openai", "astra"),
  "codex:gpt-6.2-sol": gpt62Model("codex", "sol"),
  "codex:gpt-6.2-astra": gpt62Model("codex", "astra"),
  "openrouter:openai/gpt-6.2-sol": gpt62Model("openrouter", "sol"),
  "openrouter:openai/gpt-6.2-astra": gpt62Model("openrouter", "astra"),
  "openrouter:minimax/minimax-m3.1-flash": {
    id: "minimax/minimax-m3.1-flash",
    name: "MiniMax M3.1 Flash",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 524288,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    compat: {
      supportsDeveloperRole: false,
      thinkingFormat: "openrouter",
      supportsStrictMode: true,
      sendSessionAffinityHeaders: true,
    },
  },
  "zai:glm-5.1": {
    id: "glm-5.1",
    name: "GLM-5.1",
    api: "openai-completions",
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      thinkingFormat: "zai",
      zaiToolStream: true,
    },
    contextWindow: 200000,
    maxTokens: 131072,
  },
};
