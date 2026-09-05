import { getModel, type Model, type Api } from "@earendil-works/pi-ai/compat";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { createLogger } from "../utils/logger.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { getGrokBuildCliVersion } from "./grok-build-credentials.js";
import { assertModelAvailable } from "../config/model-catalog.js";
import { ADDITIONAL_MODELS } from "./additional-models.js";

const log = createLogger("LLM");

const modelCache = new Map<string, Model<Api>>();

const GOCOON_MODELS: Record<string, Model<"openai-completions">> = {};

function clearProviderModels(provider: SupportedProvider): void {
  for (const key of modelCache.keys()) {
    if (key.startsWith(`${provider}:`)) modelCache.delete(key);
  }
}

function createGrokBuildModel(modelId: string): Model<"openai-responses"> {
  return {
    id: modelId,
    name: modelId === "grok-4.6" ? "Grok 4.6" : modelId === "grok-4.5" ? "Grok 4.5" : modelId,
    api: "openai-responses",
    provider: "xai",
    baseUrl: "https://cli-chat-proxy.grok.com/v1",
    headers: {
      "X-XAI-Token-Auth": "xai-grok-cli",
      "x-grok-model-override": modelId,
      "x-grok-client-version": getGrokBuildCliVersion(),
    },
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 500_000,
    maxTokens: 128_000,
    compat: {
      supportsLongCacheRetention: false,
    },
  };
}

/** Register models discovered from a running gocoon-runner (native OpenAI-compatible API). */
export async function registerGocoonModels(httpPort: number): Promise<string[]> {
  for (const key of Object.keys(GOCOON_MODELS)) delete GOCOON_MODELS[key];
  clearProviderModels("gocoon");
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
  for (const key of Object.keys(LOCAL_MODELS)) delete LOCAL_MODELS[key];
  clearProviderModels("local");
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

/**
 * Provider-scoped compatibility aliases for model IDs removed from the curated
 * catalog or retired upstream. Existing config files remain untouched; the
 * runtime resolves them to the supported replacement and logs the migration.
 */
const LEGACY_MODEL_ALIASES: Partial<Record<SupportedProvider, Readonly<Record<string, string>>>> = {
  codex: {
    "gpt-5.3-codex": "gpt-5.6-terra",
    "gpt-5.1-codex-mini": "gpt-5.4-mini",
  },
  "grok-build": {
    "grok-build": "grok-4.6",
  },
  google: {
    "gemini-3.1-flash-lite-preview": "gemini-3.1-flash-lite",
    "gemini-2.5-pro": "gemini-3.1-pro-preview",
    "gemini-2.5-flash": "gemini-3.6-flash",
    "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.0-flash": "gemini-3.6-flash",
    "gemini-2.0-flash-lite": "gemini-3.1-flash-lite",
  },
  xai: {
    "grok-4.20-0309-reasoning": "grok-4.5",
    "grok-4.20-0309-non-reasoning": "grok-4.3",
    "grok-4-1-fast-reasoning": "grok-4.3",
    "grok-4-1-fast-non-reasoning": "grok-4.3",
    "grok-3": "grok-4.3",
    "grok-3-mini-fast": "grok-4.3",
  },
  groq: {
    "meta-llama/llama-4-maverick-17b-128e-instruct": "openai/gpt-oss-120b",
    "meta-llama/llama-4-scout-17b-16e-instruct": "openai/gpt-oss-120b",
    "qwen/qwen3-32b": "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
    "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  },
  openrouter: {
    "nvidia/nemotron-nano-9b-v2": "nvidia/nemotron-nano-9b-v2:free",
  },
  moonshot: {
    "kimi-k2.5": "kimi-for-coding",
    k2p6: "kimi-for-coding",
    "kimi-k2-thinking": "kimi-for-coding",
  },
  mistral: {
    "mistral-medium-3.5": "mistral-medium-latest",
    "devstral-2512": "mistral-medium-latest",
    "devstral-small-2507": "mistral-medium-latest",
  },
  cerebras: {
    "qwen-3-235b-a22b-instruct-2507": "gpt-oss-120b",
    "qwen-3-32b": "gpt-oss-120b",
    "llama3.1-8b": "gemma-4-31b",
  },
};

const warnedModelAliases = new Set<string>();

function resolveLegacyModelAlias(provider: SupportedProvider, modelId: string): string {
  const replacement = LEGACY_MODEL_ALIASES[provider]?.[modelId];
  if (!replacement) return modelId;

  const warningKey = `${provider}:${modelId}`;
  if (!warnedModelAliases.has(warningKey)) {
    warnedModelAliases.add(warningKey);
    log.warn(
      `Configured model ${provider}/${modelId} is deprecated or unsupported; using ${replacement}`
    );
  }

  return replacement;
}

export function getProviderModel(provider: SupportedProvider, modelId: string): Model<Api> {
  modelId = resolveLegacyModelAlias(provider, modelId);
  assertModelAvailable(provider, modelId);

  const cacheKey = `${provider}:${modelId}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const meta = getProviderMetadata(provider);

  if (meta.piAiProvider === "grok-build") {
    const supportedModelIds = ["grok-4.6", "grok-4.5"];
    if (!supportedModelIds.includes(modelId)) {
      throw new Error(`Grok Build model "${modelId}" is not supported`);
    }
    const grokBuildModel = createGrokBuildModel(modelId);
    modelCache.set(cacheKey, grokBuildModel);
    return grokBuildModel;
  }

  if (meta.piAiProvider === "gocoon") {
    const model = GOCOON_MODELS[modelId];
    if (model) {
      modelCache.set(cacheKey, model);
      return model;
    }
    throw new Error(`Model "${modelId}" is not served by the configured gocoon endpoint`);
  }

  if (meta.piAiProvider === "local") {
    const model = LOCAL_MODELS[modelId];
    if (model) {
      modelCache.set(cacheKey, model);
      return model;
    }
    throw new Error(`Model "${modelId}" is not served by the configured local endpoint`);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- getModel requires literal provider+model types; dynamic strings need casts
    const model = getModel(meta.piAiProvider as any, modelId as any) ?? ADDITIONAL_MODELS[cacheKey];
    if (!model) {
      throw new Error(`getModel returned undefined for ${provider}/${modelId}`);
    }
    modelCache.set(cacheKey, model);
    return model;
  } catch (error) {
    throw new Error(`Could not resolve configured model ${provider}/${modelId}`, { cause: error });
  }
}

export function getUtilityModel(provider: SupportedProvider, overrideModel?: string): Model<Api> {
  const meta = getProviderMetadata(provider);
  const modelId = overrideModel || meta.utilityModel;
  return getProviderModel(provider, modelId);
}
