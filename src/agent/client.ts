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

/**
 * Determines if an API key is an OAuth/setup token (Anthropic only)
 */
export function isOAuthToken(apiKey: string, provider?: string): boolean {
  if (provider && provider !== "anthropic") return false;
  return apiKey.startsWith("sk-ant-oat01-");
}

// Cache model instances keyed by "provider:modelId"
const modelCache = new Map<string, Model<Api>>();

/**
 * Get a model from any supported provider via pi-ai
 */
export function getProviderModel(provider: SupportedProvider, modelId: string): Model<Api> {
  const cacheKey = `${provider}:${modelId}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const meta = getProviderMetadata(provider);

  try {
    const model = getModel(meta.piAiProvider as any, modelId as any);
    modelCache.set(cacheKey, model);
    return model;
  } catch (e) {
    // Fallback to provider's default model
    console.warn(
      `Model ${modelId} not found for ${provider}, falling back to ${meta.defaultModel}`
    );
    const fallbackKey = `${provider}:${meta.defaultModel}`;
    const fallbackCached = modelCache.get(fallbackKey);
    if (fallbackCached) return fallbackCached;

    try {
      const model = getModel(meta.piAiProvider as any, meta.defaultModel as any);
      modelCache.set(fallbackKey, model);
      return model;
    } catch {
      throw new Error(
        `Could not find model ${modelId} or fallback ${meta.defaultModel} for ${provider}`
      );
    }
  }
}

/**
 * Get the utility model (cheap, fast) for summarization and slug generation
 */
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

/**
 * Send a message to LLM using pi-ai Context system with optional transcript persistence.
 * Supports any provider configured in the agent config.
 */
export async function chatWithContext(
  config: AgentConfig,
  options: ChatOptions
): Promise<ChatResponse> {
  const provider = (config.provider || "anthropic") as SupportedProvider;
  const model = getProviderModel(provider, config.model);

  // Use the provided context directly
  const context: Context = {
    ...options.context,
    systemPrompt: options.systemPrompt || options.context.systemPrompt,
    tools: options.tools, // Pass tools to context
  };

  // Get response from LLM
  const response = await complete(model, context, {
    apiKey: config.api_key,
    maxTokens: options.maxTokens ?? config.max_tokens,
    temperature: options.temperature ?? config.temperature,
    sessionId: options.sessionId,
  });

  // Persist to transcript if requested
  // NOTE: Only persist the assistant response here.
  // User messages and tool results are persisted separately in runtime.ts
  // to avoid duplicates during the agentic loop.
  if (options.persistTranscript && options.sessionId) {
    // Append assistant response only
    appendToTranscript(options.sessionId, response);
  }

  // Extract text from response
  const textContent = response.content.find((block) => block.type === "text");
  const text = textContent?.type === "text" ? textContent.text : "";

  // Return updated context
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

/**
 * Load context from transcript (for session resumption)
 */
export function loadContextFromTranscript(sessionId: string, systemPrompt?: string): Context {
  const messages = readTranscript(sessionId) as Message[];

  return {
    systemPrompt,
    messages,
  };
}

// Legacy exports for compatibility
export function createClient(_config: AgentConfig): null {
  // No longer needed with pi-ai
  return null;
}
