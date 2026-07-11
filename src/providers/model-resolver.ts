import { getModel, type Model, type Api } from "@earendil-works/pi-ai/compat";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { createLogger } from "../utils/logger.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { getGrokBuildCliVersion } from "./grok-build-credentials.js";
import { assertModelAvailable } from "../config/model-catalog.js";

const log = createLogger("LLM");

const modelCache = new Map<string, Model<Api>>();

const GOCOON_MODELS: Record<string, Model<"openai-completions">> = {};

const GROK_BUILD_MODEL_ID = "grok-build";

function createGrokBuildModel(): Model<"openai-responses"> {
  return {
    id: GROK_BUILD_MODEL_ID,
    name: "Grok Build",
    api: "openai-responses",
    provider: "xai",
    baseUrl: "https://cli-chat-proxy.grok.com/v1",
    headers: {
      "X-XAI-Token-Auth": "xai-grok-cli",
      "x-grok-model-override": GROK_BUILD_MODEL_ID,
      "x-grok-client-version": getGrokBuildCliVersion(),
    },
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 500_000,
    maxTokens: 128_000,
    compat: {
      sendSessionIdHeader: false,
      supportsLongCacheRetention: false,
    },
  };
}

/** Register models discovered from a running gocoon-runner (native OpenAI-compatible API). */
export async function registerGocoonModels(httpPort: number): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`http://localhost:${httpPort}/v1/models`, {
      timeoutMs: 3000,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: { id?: string; name?: string }[];
      models?: { id?: string; name?: string }[];
    };
    const models = body.data || body.models || [];
    if (!Array.isArray(models)) return [];
    const ids: string[] = [];
    for (const m of models) {
      const id = m.id || m.name || String(m);
      GOCOON_MODELS[id] = {
        id,
        name: id,
        api: "openai-completions",
        provider: "gocoon",
        baseUrl: `http://localhost:${httpPort}/v1`,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStrictMode: false,
          maxTokensField: "max_tokens",
        },
      };
      ids.push(id);
    }
    return ids;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      log.warn({ port: httpPort }, "gocoon /v1/models timed out after 3s, returning empty list");
    }
    return [];
  }
}

const LOCAL_MODELS: Record<string, Model<"openai-completions">> = {};

/** Register models discovered from a local OpenAI-compatible server */
export async function registerLocalModels(baseUrl: string): Promise<string[]> {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      log.warn(`Local LLM base_url must use http or https (got ${parsed.protocol})`);
      return [];
    }
    const url = baseUrl.replace(/\/+$/, "");
    const res = await fetchWithTimeout(`${url}/models`, { timeoutMs: 10_000 });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: { id?: string; name?: string }[];
      models?: { id?: string; name?: string }[];
    };
    const rawModels = body.data || body.models || [];
    if (!Array.isArray(rawModels)) return [];
    const models = rawModels.slice(0, 500);
    const ids: string[] = [];
    for (const m of models) {
      const id = m.id || m.name || String(m);
      LOCAL_MODELS[id] = {
        id,
        name: id,
        api: "openai-completions",
        provider: "local",
        baseUrl: url,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStrictMode: false,
          maxTokensField: "max_tokens",
        },
      };
      ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

/** Moonshot backward-compat: old model IDs → kimi-coding IDs */
const MOONSHOT_MODEL_ALIASES: Record<string, string> = {
  "kimi-k2.5": "kimi-for-coding",
  k2p6: "kimi-for-coding",
};

export function getProviderModel(provider: SupportedProvider, modelId: string): Model<Api> {
  assertModelAvailable(provider, modelId);

  const cacheKey = `${provider}:${modelId}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const meta = getProviderMetadata(provider);

  if (meta.piAiProvider === "grok-build") {
    const grokBuildModel = createGrokBuildModel();
    if (modelId !== grokBuildModel.id) {
      log.warn(`Grok Build model "${modelId}" not found, using "${grokBuildModel.id}"`);
    }
    modelCache.set(cacheKey, grokBuildModel);
    return grokBuildModel;
  }

  if (meta.piAiProvider === "gocoon") {
    let model = GOCOON_MODELS[modelId];
    if (!model) {
      // Fall back to the provider default (a served model), not the first registered
      // one, which may be an unusable model with no workers.
      model = GOCOON_MODELS[meta.defaultModel] ?? Object.values(GOCOON_MODELS)[0];
      if (model) log.warn(`gocoon model "${modelId}" not found, using "${model.id}"`);
    }
    if (model) {
      modelCache.set(cacheKey, model);
      return model;
    }
    throw new Error("No gocoon models available. Is the gocoon runner running?");
  }

  if (meta.piAiProvider === "local") {
    let model = LOCAL_MODELS[modelId];
    if (!model) {
      model = Object.values(LOCAL_MODELS)[0];
      if (model) log.warn(`Local model "${modelId}" not found, using "${model.id}"`);
    }
    if (model) {
      modelCache.set(cacheKey, model);
      return model;
    }
    throw new Error("No local models available. Is the LLM server running?");
  }

  // Moonshot backward-compat: remap old model IDs to kimi-coding IDs
  if (provider === "moonshot" && MOONSHOT_MODEL_ALIASES[modelId]) {
    modelId = MOONSHOT_MODEL_ALIASES[modelId];
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- getModel requires literal provider+model types; dynamic strings need casts
    const model = getModel(meta.piAiProvider as any, modelId as any);
    if (!model) {
      throw new Error(`getModel returned undefined for ${provider}/${modelId}`);
    }
    modelCache.set(cacheKey, model);
    return model;
  } catch {
    log.warn(`Model ${modelId} not found for ${provider}, falling back to ${meta.defaultModel}`);
    const fallbackKey = `${provider}:${meta.defaultModel}`;
    const fallbackCached = modelCache.get(fallbackKey);
    if (fallbackCached) return fallbackCached;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same as above: dynamic strings
      const model = getModel(meta.piAiProvider as any, meta.defaultModel as any);
      if (!model) {
        throw new Error(
          `Fallback model ${meta.defaultModel} also returned undefined for ${provider}`
        );
      }
      modelCache.set(fallbackKey, model);
      return model;
    } catch {
      throw new Error(
        `Could not find model ${modelId} or fallback ${meta.defaultModel} for ${provider}`
      );
    }
  }
}

export function getUtilityModel(provider: SupportedProvider, overrideModel?: string): Model<Api> {
  const meta = getProviderMetadata(provider);
  const modelId = overrideModel || meta.utilityModel;
  return getProviderModel(provider, modelId);
}
