import {
  complete,
  stream,
  type Context,
  type AssistantMessage,
  type Message,
  type Tool,
  type ProviderStreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { AgentConfig } from "../config/schema.js";
import { appendToTranscript, readTranscript } from "../session/transcript.js";
import type { SupportedProvider } from "../config/providers.js";
import { sanitizeToolsForGemini } from "./schema-sanitizer.js";
import { createLogger } from "../utils/logger.js";
import { getCodexApiKey, refreshCodexApiKey } from "../providers/codex-credentials.js";
import { getGrokBuildApiKey, refreshGrokBuildApiKey } from "../providers/grok-build-credentials.js";
import { getProviderModel } from "../providers/model-resolver.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";

// Model resolution + provider model registration live in the neutral providers/
// layer so non-agent consumers (e.g. memory) can resolve models without importing
// from agent/. Re-exported here for backward compatibility with existing importers.
export {
  registerGocoonModels,
  registerLocalModels,
  getProviderModel,
  getUtilityModel,
} from "../providers/model-resolver.js";

const log = createLogger("LLM");

/** 401/Unauthorized detection for the one-shot credential-refresh retry. */
function isUnauthorizedError(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  return errorMessage.includes("401") || errorMessage.toLowerCase().includes("unauthorized");
}

/** Providers whose credentials can be refreshed once on a 401, then the call retried. */
const RETRY_401_PROVIDERS: { provider: string; refresh: () => Promise<string | null> }[] = [
  { provider: "codex", refresh: refreshCodexApiKey },
  { provider: "grok-build", refresh: refreshGrokBuildApiKey },
];

/** Resolve the effective API key for a provider (local/gocoon need no real key) */
export function getEffectiveApiKey(provider: string, rawKey: string): string {
  if (provider === "local") return "local";
  if (provider === "gocoon") return "gocoon";
  if (provider === "codex") return getCodexApiKey(rawKey);
  if (provider === "grok-build") return getGrokBuildApiKey();
  return rawKey;
}

function providerSupportsTemperature(provider: string): boolean {
  return provider !== "codex" && provider !== "grok-build";
}

function getCacheRetention(provider: string): "none" | "long" {
  return provider === "grok-build" ? "none" : "long";
}

function prepareToolsForProvider(tools: Tool[] | undefined): Tool[] | undefined {
  if (!tools) return tools;

  return tools.map((tool) =>
    TELEGRAM_SEND_TOOLS.has(tool.name)
      ? {
          ...tool,
          description:
            `${tool.description} This action sends immediately. ` +
            "Do not use this tool to reply to the current inbound message or for progress updates; " +
            "return normal assistant text instead, which Teleton delivers automatically. " +
            "Use it for intentional separate Telegram messages.",
        }
      : tool
  );
}

function getProviderPayloadOptions(provider: SupportedProvider): Record<string, unknown> {
  if (provider !== "grok-build") return {};

  return {
    onPayload: (payload: unknown) => ({
      ...(payload && typeof payload === "object" ? payload : {}),
      parallel_tool_calls: false,
    }),
  };
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

const THINK_RE = /<think>[\s\S]*?<\/think>/g;

/**
 * Shared post-processing for both complete() and stream() responses: strip
 * <think> blocks (Mistral, local models, etc.), persist the transcript, extract the
 * text content, and append the response to the context.
 */
function finalizeResponse(
  response: AssistantMessage,
  context: Context,
  options: ChatOptions
): ChatResponse {
  for (const block of response.content) {
    if (block.type === "text" && block.text.includes("<think>")) {
      block.text = block.text.replace(THINK_RE, "").trim();
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

  return { message: response, text, context: updatedContext };
}

export async function chatWithContext(
  config: AgentConfig,
  options: ChatOptions
): Promise<ChatResponse> {
  const provider = (config.provider || "anthropic") as SupportedProvider;
  const model = getProviderModel(provider, config.model);
  const preparedTools = prepareToolsForProvider(options.tools);
  const tools =
    provider === "google" && preparedTools ? sanitizeToolsForGemini(preparedTools) : preparedTools;

  const systemPrompt = options.systemPrompt || options.context.systemPrompt || "";

  const context: Context = {
    ...options.context,
    systemPrompt,
    tools,
  };

  const temperature = options.temperature ?? config.temperature;

  const completeOptions: Record<string, unknown> = {
    apiKey: getEffectiveApiKey(provider, config.api_key),
    maxTokens: options.maxTokens ?? config.max_tokens,
    ...(providerSupportsTemperature(provider) && { temperature }),
    sessionId: options.sessionId,
    cacheRetention: getCacheRetention(provider),
    ...getProviderPayloadOptions(provider),
  };

  let response = await complete(model, context, completeOptions as ProviderStreamOptions);

  // Refreshable providers: retry once on 401/Unauthorized by refreshing credentials
  const retry401 = RETRY_401_PROVIDERS.find((e) => e.provider === provider);
  if (retry401 && response.stopReason === "error" && isUnauthorizedError(response.errorMessage)) {
    log.warn(`${provider} token rejected (401), refreshing credentials and retrying...`);
    const refreshedKey = await retry401.refresh();
    if (refreshedKey) {
      completeOptions.apiKey = refreshedKey;
      response = await complete(model, context, completeOptions as ProviderStreamOptions);
    }
  }

  return finalizeResponse(response, context, options);
}

export interface StreamResult {
  textStream: AsyncIterable<string>;
  result: Promise<ChatResponse>;
}

export function streamWithContext(config: AgentConfig, options: ChatOptions): StreamResult {
  const provider = (config.provider || "anthropic") as SupportedProvider;
  const model = getProviderModel(provider, config.model);
  const preparedTools = prepareToolsForProvider(options.tools);

  const tools =
    provider === "google" && preparedTools ? sanitizeToolsForGemini(preparedTools) : preparedTools;

  const systemPrompt = options.systemPrompt || options.context.systemPrompt || "";

  const context: Context = {
    ...options.context,
    systemPrompt,
    tools,
  };

  const temperature = options.temperature ?? config.temperature;

  const streamOptions: Record<string, unknown> = {
    apiKey: getEffectiveApiKey(provider, config.api_key),
    maxTokens: options.maxTokens ?? config.max_tokens,
    ...(providerSupportsTemperature(provider) && { temperature }),
    sessionId: options.sessionId,
    cacheRetention: getCacheRetention(provider),
    ...getProviderPayloadOptions(provider),
  };

  const eventStream = stream(model, context, streamOptions as ProviderStreamOptions);

  // Transform event stream into a simple text delta async iterable
  async function* textDeltas(): AsyncIterable<string> {
    for await (const event of eventStream) {
      if (event.type === "text_delta" && event.delta) {
        yield event.delta;
      }
      // Stop yielding text when tool calls start — the response needs full processing
      if (event.type === "toolcall_start") {
        return;
      }
    }
  }

  // Result promise: wait for the stream to complete and build ChatResponse
  const resultPromise = (async (): Promise<ChatResponse> => {
    let response = await eventStream.result();

    // A streaming auth failure happens before text is emitted. Refresh the CLI
    // credential and finish this turn through the one-shot path.
    const retry401 = RETRY_401_PROVIDERS.find((e) => e.provider === provider);
    if (retry401 && response.stopReason === "error" && isUnauthorizedError(response.errorMessage)) {
      log.warn(`${provider} token rejected (401), refreshing credentials and retrying...`);
      const refreshedKey = await retry401.refresh();
      if (refreshedKey) {
        streamOptions.apiKey = refreshedKey;
        response = await complete(model, context, streamOptions as ProviderStreamOptions);
      }
    }
    return finalizeResponse(response, context, options);
  })();

  return { textStream: textDeltas(), result: resultPromise };
}

export function loadContextFromTranscript(sessionId: string, systemPrompt?: string): Context {
  const messages = readTranscript(sessionId) as Message[];

  // Deduplicate toolResult messages by toolCallId (prevents API 400 on corrupted transcripts)
  const seenToolCallIds = new Set<string>();
  const deduped = messages.filter((msg) => {
    if (msg.role !== "toolResult") return true;
    const id = (msg as { toolCallId: string }).toolCallId;
    if (seenToolCallIds.has(id)) return false;
    seenToolCallIds.add(id);
    return true;
  });

  return {
    systemPrompt,
    messages: deduped,
  };
}
