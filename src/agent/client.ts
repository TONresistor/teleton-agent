import {
  complete,
  getModel,
  type Model,
  type Api,
  type Context,
  type UserMessage,
  type AssistantMessage,
  type Message,
  type Tool,
  type ProviderStreamOptions,
  type KnownProvider,
} from "@mariozechner/pi-ai";
import type { AgentConfig } from "../config/schema.js";
import { appendToTranscript, readTranscript } from "../session/transcript.js";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { sanitizeToolsForGemini } from "./schema-sanitizer.js";
import { createLogger } from "../utils/logger.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import {
  getClaudeCodeApiKey,
  refreshClaudeCodeApiKey,
} from "../providers/claude-code-credentials.js";

const log = createLogger("LLM");

export function isOAuthToken(apiKey: string, provider?: string): boolean {
  if (provider && provider !== "anthropic" && provider !== "claude-code") return false;
  return apiKey.startsWith("sk-ant-oat01-");
}

/** Resolve the effective API key for a provider (local/cocoon need no real key) */
export function getEffectiveApiKey(provider: string, rawKey: string): string {
  if (provider === "local") return "local";
  if (provider === "cocoon") return "";
  if (provider === "claude-code") return getClaudeCodeApiKey(rawKey);
  return rawKey;
}

const modelCache = new Map<string, Model<Api>>();

const COCOON_MODELS: Record<string, Model<"openai-completions">> = {};

/** Register models discovered from a running Cocoon client */
export async function registerCocoonModels(httpPort: number): Promise<string[]> {
  try {
    const res = await fetch(`http://localhost:${httpPort}/v1/models`);
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
      COCOON_MODELS[id] = {
        id,
        name: id,
        api: "openai-completions",
        provider: "cocoon",
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
        },
      };
      ids.push(id);
    }
    return ids;
  } catch {
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

const MOONSHOT_MODELS: Record<string, Model<"openai-completions">> = {
  "kimi-k2.5": {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    api: "openai-completions",
    provider: "moonshot",
    baseUrl: "https://api.moonshot.ai/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 8192,
  },
  "kimi-k2-thinking": {
    id: "kimi-k2-thinking",
    name: "Kimi K2 Thinking",
    api: "openai-completions",
    provider: "moonshot",
    baseUrl: "https://api.moonshot.ai/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 8192,
  },
};

export function getProviderModel(provider: SupportedProvider, modelId: string): Model<Api> {
  const cacheKey = `${provider}:${modelId}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const meta = getProviderMetadata(provider);

  if (meta.piAiProvider === "cocoon") {
    let model = COCOON_MODELS[modelId];
    if (!model) {
      model = Object.values(COCOON_MODELS)[0];
      if (model) log.warn(`Cocoon model "${modelId}" not found, using "${model.id}"`);
    }
    if (model) {
      modelCache.set(cacheKey, model);
      return model;
    }
    throw new Error("No Cocoon models available. Is the cocoon client running?");
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

  if (meta.piAiProvider === "moonshot") {
    const model = MOONSHOT_MODELS[modelId] ?? MOONSHOT_MODELS[meta.defaultModel];
    if (model) {
      modelCache.set(cacheKey, model);
      return model;
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- getModel requires literal provider+model types; dynamic strings need casts
    const model = getModel(meta.piAiProvider as any, modelId as any);
    if (!model) {
      throw new Error(`getModel returned undefined for ${provider}/${modelId}`);
    }
    modelCache.set(cacheKey, model);
    return model;
  } catch (e) {
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

export interface ChatOptions {
  systemPrompt?: string;
  context: Context;
  sessionId?: string;
  maxTokens?: number;
  temperature?: number;
  persistTranscript?: boolean;
  tools?: Tool[];
}

export interface ChatResponse {
  message: AssistantMessage;
  text: string;
  context: Context;
}

export async function chatWithContext(
  config: AgentConfig,
  options: ChatOptions
): Promise<ChatResponse> {
  const provider = (config.provider || "anthropic") as SupportedProvider;
  const model = getProviderModel(provider, config.model);
  const isCocoon = provider === "cocoon";

  let tools =
    provider === "google" && options.tools ? sanitizeToolsForGemini(options.tools) : options.tools;

  // Cocoon: disable thinking mode + inject tools into system prompt
  let systemPrompt = options.systemPrompt || options.context.systemPrompt || "";
  let cocoonAllowedTools: Set<string> | undefined;
  if (isCocoon) {
    systemPrompt = "/no_think\n" + systemPrompt;
    if (tools && tools.length > 0) {
      cocoonAllowedTools = new Set(tools.map((t) => t.name));
      const { injectToolsIntoSystemPrompt } = await import("../cocoon/tool-adapter.js");
      systemPrompt = injectToolsIntoSystemPrompt(systemPrompt, tools);
      tools = undefined; // Don't send via API
    }
  }

  const context: Context = {
    ...options.context,
    systemPrompt,
    tools,
  };

  // Cocoon: strip unsupported fields from the request body
  // Moonshot Kimi K2.5 only accepts temperature=1
  const temperature = provider === "moonshot" ? 1 : (options.temperature ?? config.temperature);

  const completeOptions: Record<string, unknown> = {
    apiKey: getEffectiveApiKey(provider, config.api_key),
    maxTokens: options.maxTokens ?? config.max_tokens,
    temperature,
    sessionId: options.sessionId,
  };
  if (isCocoon) {
    const { stripCocoonPayload } = await import("../cocoon/tool-adapter.js");
    completeOptions.onPayload = stripCocoonPayload;
  }

  let response = await complete(model, context, completeOptions as ProviderStreamOptions);

  // Claude Code provider: retry once on 401/Unauthorized by refreshing credentials
  if (
    provider === "claude-code" &&
    response.stopReason === "error" &&
    response.errorMessage &&
    (response.errorMessage.includes("401") ||
      response.errorMessage.toLowerCase().includes("unauthorized"))
  ) {
    log.warn("Claude Code token rejected (401), refreshing credentials and retrying...");
    const refreshedKey = refreshClaudeCodeApiKey();
    if (refreshedKey) {
      completeOptions.apiKey = refreshedKey;
      response = await complete(model, context, completeOptions as ProviderStreamOptions);
    }
  }

  // Cocoon: parse <tool_call> from text response
  if (isCocoon) {
    const textBlock = response.content.find((b) => b.type === "text");
    if (textBlock?.type === "text" && textBlock.text.includes("<tool_call>")) {
      const { parseToolCallsFromText, extractPlainText } =
        await import("../cocoon/tool-adapter.js");
      const syntheticCalls = parseToolCallsFromText(textBlock.text, cocoonAllowedTools);
      if (syntheticCalls.length > 0) {
        const plainText = extractPlainText(textBlock.text);
        response.content = [
          ...(plainText ? [{ type: "text" as const, text: plainText }] : []),
          ...syntheticCalls,
        ];
        (response as { stopReason: AssistantMessage["stopReason"] }).stopReason = "toolUse";
      }
    }
  }

  // Strip <think> blocks from all providers (Cocoon, Mistral, etc.)
  const thinkRe = /<think>[\s\S]*?<\/think>/g;
  for (const block of response.content) {
    if (block.type === "text" && block.text.includes("<think>")) {
      block.text = block.text.replace(thinkRe, "").trim();
    }
  }

  if (options.persistTranscript && options.sessionId) {
    appendToTranscript(options.sessionId, response);
  }

  const textContent = response.content.find((block) => block.type === "text");
  const text = textContent?.type === "text" ? textContent.text : "";

  const updatedContext: Context = {
    ...context,
    messages: [...context.messages, response],
  };

  return {
    message: response,
    text,
    context: updatedContext,
  };
}

export function loadContextFromTranscript(sessionId: string, systemPrompt?: string): Context {
  const messages = readTranscript(sessionId) as Message[];

  return {
    systemPrompt,
    messages,
  };
}

export function createClient(_config: AgentConfig): null {
  return null;
}
