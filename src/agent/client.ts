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
} from "@mariozechner/pi-ai";
import type { AgentConfig } from "../config/schema.js";
import { appendToTranscript, readTranscript } from "../session/transcript.js";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { sanitizeToolsForGemini } from "./schema-sanitizer.js";

export function isOAuthToken(apiKey: string, provider?: string): boolean {
  if (provider && provider !== "anthropic") return false;
  return apiKey.startsWith("sk-ant-oat01-");
}

const modelCache = new Map<string, Model<Api>>();

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

  if (meta.piAiProvider === "moonshot") {
    const model = MOONSHOT_MODELS[modelId] ?? MOONSHOT_MODELS[meta.defaultModel];
    if (model) {
      modelCache.set(cacheKey, model);
      return model;
    }
  }

  try {
    const model = getModel(meta.piAiProvider as any, modelId as any);
    if (!model) {
      throw new Error(`getModel returned undefined for ${provider}/${modelId}`);
    }
    modelCache.set(cacheKey, model);
    return model;
  } catch (e) {
    console.warn(
      `Model ${modelId} not found for ${provider}, falling back to ${meta.defaultModel}`
    );
    const fallbackKey = `${provider}:${meta.defaultModel}`;
    const fallbackCached = modelCache.get(fallbackKey);
    if (fallbackCached) return fallbackCached;

    try {
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

  const tools =
    provider === "google" && options.tools ? sanitizeToolsForGemini(options.tools) : options.tools;

  const context: Context = {
    ...options.context,
    systemPrompt: options.systemPrompt || options.context.systemPrompt,
    tools,
  };

  const response = await complete(model, context, {
    apiKey: config.api_key,
    maxTokens: options.maxTokens ?? config.max_tokens,
    temperature: options.temperature ?? config.temperature,
    sessionId: options.sessionId,
  });

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
