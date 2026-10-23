import type { Api, Model } from "@earendil-works/pi-ai/compat";

/** Models missing from the bundled pi-ai catalog, including retained legacy models. */
export const ADDITIONAL_MODELS: Record<string, Model<Api>> = {
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
