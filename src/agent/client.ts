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
import { extractText } from "../utils/pi-message.js";
import {
  assertModelRequestAllowed,
  createModelRequestBoundary,
  raceModelPromise,
  performTrackedModelRequest,
  trackModelWork,
} from "./attempt-usage.js";
import { isSilentReply } from "../constants/tokens.js";

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
  turnId?: string;
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

  const text = extractText(response);

  if (
    options.persistTranscript &&
    options.sessionId &&
    (response.stopReason === "error" ||
      response.stopReason === "aborted" ||
      response.stopReason === "length")
  ) {
    appendToTranscript(
      options.sessionId,
      Object.assign(
        {
          role: "user" as const,
          timestamp: Date.now(),
          content: `[Incomplete model generation diagnostic]\n${JSON.stringify(response)}`,
        },
        { _diagnosticOnly: true, _turnId: options.turnId }
      )
    );
  } else if (
    options.persistTranscript &&
    options.sessionId &&
    response.stopReason !== "error" &&
    response.stopReason !== "aborted" &&
    !isSilentReply(text)
  ) {
    appendToTranscript(
      options.sessionId,
      Object.assign(
        { ...response },
        {
          _generationOnly:
            !!options.turnId && !response.content.some((block) => block.type === "toolCall"),
          _turnId: options.turnId,
        }
      )
    );
  }

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

  assertModelRequestAllowed(request.options.signal);
  log.warn(`${request.provider} token rejected (401), refreshing credentials and retrying...`);
  const refreshBoundary = createModelRequestBoundary(request.options);
  let refreshedKey: string | null;
  try {
    refreshedKey = await raceModelPromise(trackModelWork(refresh()), refreshBoundary);
  } finally {
    refreshBoundary.dispose();
  }
  assertModelRequestAllowed(request.options.signal);
  if (!refreshedKey) return response;

  request.options.apiKey = refreshedKey;
  return performAttempt(request);
}

async function performAttempt(request: PreparedModelRequest): Promise<AssistantMessage> {
  assertModelRequestAllowed(request.options.signal);
  return performTrackedModelRequest(
    request.model,
    "agent",
    (boundary) =>
      complete(request.model, request.context, {
        ...request.options,
        signal: boundary.signal,
        timeoutMs: boundary.timeoutMs,
      }),
    request.options,
    request.finalizeUsage
  );
}

export async function chatWithContext(
  config: AgentConfig,
  options: ChatOptions
): Promise<ChatResponse> {
  const request = prepareModelRequest(config, options);
  const initialResponse = await performAttempt(request);
  const response = await retryAfterCredentialRefresh(request, initialResponse);
  return finalizeResponse(response, request.context, options);
}

export interface StreamResult {
  textStream: AsyncIterable<string>;
  result: Promise<ChatResponse>;
}

export function streamWithContext(config: AgentConfig, options: ChatOptions): StreamResult {
  const request = prepareModelRequest(config, options);
  assertModelRequestAllowed(request.options.signal);
  let eventStream: ReturnType<typeof stream> | undefined;
  let activeSignal = request.options.signal;
  const initialResult = performTrackedModelRequest(
    request.model,
    "agent",
    (boundary) => {
      activeSignal = boundary.signal;
      eventStream = stream(request.model, request.context, {
        ...request.options,
        signal: boundary.signal,
        timeoutMs: boundary.timeoutMs,
      });
      return eventStream.result();
    },
    request.options,
    request.finalizeUsage
  );

  // Transform event stream into a simple text delta async iterable
  async function* textDeltas(): AsyncIterable<string> {
    if (!eventStream) return;
    const iterator = eventStream[Symbol.asyncIterator]();
    const boundary = createModelRequestBoundary({
      signal: activeSignal,
      timeoutMs: request.options.timeoutMs,
    });
    try {
      while (true) {
        const next = await raceModelPromise(iterator.next(), boundary);
        if (next.done) return;
        const event = next.value;
        if (event.type === "text_delta" && event.delta) {
          yield event.delta;
        }
        // Stop yielding text when tool calls start — the response needs full processing
        if (event.type === "toolcall_start") return;
      }
    } finally {
      boundary.dispose();
    }
  }

  // Result promise records actual provider settlement even after local interruption.
  const resultPromise = (async (): Promise<ChatResponse> => {
    const initialResponse = await initialResult;
    const response = await retryAfterCredentialRefresh(request, initialResponse);
    return finalizeResponse(response, request.context, options);
  })();

  void resultPromise.catch(() => {});
  return { textStream: textDeltas(), result: resultPromise };
}

export function loadContextFromTranscript(
  sessionId: string,
  systemPrompt?: string,
  resolveDelivery?: (turnId: string) => { state: string; content?: string }
): Context {
  const messages = readTranscript(sessionId) as Message[];
  const projected = messages.flatMap((message): Message[] => {
    const stored = message as Message & {
      _diagnosticOnly?: boolean;
      _generationOnly?: boolean;
      _turnId?: string;
    };
    if (stored._diagnosticOnly) return [];
    if (!stored._generationOnly || !stored._turnId || !resolveDelivery) return [message];
    const delivered = resolveDelivery(stored._turnId);
    if (delivered.state === "suppressed") return [];
    if (delivered.state === "delivered" && message.role === "assistant") {
      return delivered.content
        ? [{ ...message, content: [{ type: "text", text: delivered.content }] }]
        : [];
    }
    return [
      {
        role: "user",
        timestamp: message.timestamp,
        content: `[Delivery state for turn ${stored._turnId}: ${delivered.state}. The generated response was not confirmed received. Do not assume the user has seen it.]`,
      },
    ];
  });

  // Deduplicate toolResult messages by toolCallId (prevents API 400 on corrupted transcripts)
  const seenToolCallIds = new Set<string>();
  const deduped = projected.filter((msg) => {
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
