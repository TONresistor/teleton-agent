import {
  complete,
  stream,
  type Context,
  type AssistantMessage,
  type Message,
} from "@earendil-works/pi-ai/compat";
import type { AgentConfig } from "../config/schema.js";
import { appendToTranscript, readTranscript } from "../session/transcript.js";
import type { SupportedProvider } from "../config/providers.js";
import { createLogger } from "../utils/logger.js";
import { refreshCodexApiKey } from "../providers/codex-credentials.js";
import { refreshGrokBuildApiKey } from "../providers/grok-build-credentials.js";
import {
  prepareModelRequest,
  type ModelRequestOptions,
  type PreparedModelRequest,
} from "./model-request.js";

// Model resolution + provider model registration live in the neutral providers/
// layer so non-agent consumers (e.g. memory) can resolve models without importing
// from agent/. Re-exported here for backward compatibility with existing importers.
export {
  registerGocoonModels,
  registerLocalModels,
  getProviderModel,
  getUtilityModel,
} from "../providers/model-resolver.js";
export { getEffectiveApiKey } from "./model-request.js";

const log = createLogger("LLM");

/** 401/Unauthorized detection for the one-shot credential-refresh retry. */
function isUnauthorizedError(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  return errorMessage.includes("401") || errorMessage.toLowerCase().includes("unauthorized");
}

/** Providers whose credentials can be refreshed once on a 401, then the call retried. */
const CREDENTIAL_REFRESHERS: Partial<Record<SupportedProvider, () => Promise<string | null>>> = {
  codex: refreshCodexApiKey,
  "grok-build": refreshGrokBuildApiKey,
};

export interface ChatOptions extends ModelRequestOptions {
  persistTranscript?: boolean;
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

async function retryAfterCredentialRefresh(
  request: PreparedModelRequest,
  response: AssistantMessage
): Promise<AssistantMessage> {
  const refresh = CREDENTIAL_REFRESHERS[request.provider];
  if (!refresh || response.stopReason !== "error" || !isUnauthorizedError(response.errorMessage)) {
    return response;
  }

  log.warn(`${request.provider} token rejected (401), refreshing credentials and retrying...`);
  const refreshedKey = await refresh();
  if (!refreshedKey) return response;

  request.options.apiKey = refreshedKey;
  return complete(request.model, request.context, request.options);
}

export async function chatWithContext(
  config: AgentConfig,
  options: ChatOptions
): Promise<ChatResponse> {
  const request = prepareModelRequest(config, options);
  const initialResponse = await complete(request.model, request.context, request.options);
  const response = await retryAfterCredentialRefresh(request, initialResponse);
  return finalizeResponse(response, request.context, options);
}

export interface StreamResult {
  textStream: AsyncIterable<string>;
  result: Promise<ChatResponse>;
}

export function streamWithContext(config: AgentConfig, options: ChatOptions): StreamResult {
  const request = prepareModelRequest(config, options);
  const eventStream = stream(request.model, request.context, request.options);

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
    const initialResponse = await eventStream.result();
    const response = await retryAfterCredentialRefresh(request, initialResponse);
    return finalizeResponse(response, request.context, options);
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
