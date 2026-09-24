import type { Api, Model } from "@earendil-works/pi-ai/compat";

/** Legacy models retained for existing configurations after upstream catalog removal. */
export const ADDITIONAL_MODELS: Record<string, Model<Api>> = {
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
