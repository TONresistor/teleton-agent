import { complete, type Context, type Message } from "@earendil-works/pi-ai/compat";
import { extractText, stripEnvelopePrefix, truncate } from "../utils/pi-message.js";
import { getUtilityModel, getOutputTokenBudget } from "../providers/model-resolver.js";
import type { SupportedProvider } from "../config/providers.js";
import {
  CHARS_PER_TOKEN_ESTIMATE,
  TOKEN_ESTIMATE_SAFETY_MARGIN,
  OVERSIZED_MESSAGE_RATIO,
  ADAPTIVE_CHUNK_RATIO_BASE,
  ADAPTIVE_CHUNK_RATIO_MIN,
  ADAPTIVE_CHUNK_RATIO_TRIGGER,
  DEFAULT_SUMMARY_FALLBACK_TOKENS,
} from "../constants/limits.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Memory");

export interface SummarizationResult {
  summary: string;
  tokensUsed: number;
  chunksProcessed: number;
}

/**
 * Estimate token count using ~4 chars/token with 20% safety margin.
 */
export function estimateMessageTokens(content: string): number {
  return Math.ceil((content.length / CHARS_PER_TOKEN_ESTIMATE) * TOKEN_ESTIMATE_SAFETY_MARGIN);
}

/**
 * Split messages into chunks respecting token limits.
 */
export function splitMessagesByTokens(messages: Message[], maxChunkTokens: number): Message[][] {
  if (messages.length === 0) {
    return [];
  }

  const chunks: Message[][] = [];
  let currentChunk: Message[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const content = extractMessageContent(message);
    const messageTokens = estimateMessageTokens(content);

    if (currentChunk.length > 0 && currentTokens + messageTokens > maxChunkTokens) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(message);
    currentTokens += messageTokens;

    if (messageTokens > maxChunkTokens && currentChunk.length === 1) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

const SUMMARY_MESSAGE_MAX_CHARS = 16_000;

function boundedSummaryText(text: string, maxChars = SUMMARY_MESSAGE_MAX_CHARS): string {
  return truncate(
    text
      .replace(/data:[^\s";]+;base64,[A-Za-z0-9+/=_-]+/g, "[binary omitted]")
      .replace(/[A-Za-z0-9+/_-]{256,}={0,2}/g, "[encoded data omitted]"),
    maxChars
  );
}

function serializeSummaryValue(value: unknown): string {
  return (
    JSON.stringify(value, (key, entry) =>
      /base64|binary/i.test(key) ||
      entry?.type === "image" ||
      (entry?.type === "Buffer" && Array.isArray(entry.data))
        ? "[binary omitted]"
        : entry
    ) ?? "{}"
  );
}

function extractMessageContent(message: Message): string {
  if (message.role === "user") {
    return `User: ${boundedSummaryText(stripEnvelopePrefix(extractText(message)), Infinity)}`;
  }
  if (message.role === "assistant") {
    const parts = [boundedSummaryText(extractText(message), Infinity)].filter(Boolean);
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const args = serializeSummaryValue(block.arguments);
      parts.push(
        `[Tool call: ${block.name}; id=${block.id}; arguments=${boundedSummaryText(args ?? "{}", 2048)}]`
      );
    }
    return parts.join("\n");
  }
  if (message.role === "toolResult") {
    let text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    let reference = "";
    try {
      const parsed: unknown = JSON.parse(text);
      const artifact = (parsed as { data?: { _artifact?: { id?: unknown } } })?.data?._artifact;
      text = serializeSummaryValue(parsed);
      if (artifact?.id) reference = `; artifact=${String(artifact.id)}; read_with=tool_result_read`;
    } catch {
      /* Plain text results need no artifact lookup. */
    }
    return `[Tool result: ${message.toolName}; id=${message.toolCallId}; isError=${message.isError}${reference}]\n${boundedSummaryText(text)}`;
  }
  return "";
}

export function formatMessagesForSummary(messages: Message[]): string {
  return messages.map(extractMessageContent).filter(Boolean).join("\n\n");
}

/**
 * Check if a message is too large to summarize (>50% of context window).
 */
export function isOversizedForSummary(message: Message, contextWindow: number): boolean {
  const content = extractMessageContent(message);
  const tokens = estimateMessageTokens(content);
  return tokens > contextWindow * OVERSIZED_MESSAGE_RATIO;
}

/**
 * Compute adaptive chunk ratio based on average message size.
 * Reduces chunk size when messages are large.
 */
export function computeAdaptiveChunkRatio(messages: Message[], contextWindow: number): number {
  const BASE_CHUNK_RATIO = ADAPTIVE_CHUNK_RATIO_BASE;
  const MIN_CHUNK_RATIO = ADAPTIVE_CHUNK_RATIO_MIN;

  if (messages.length === 0) {
    return BASE_CHUNK_RATIO;
  }

  let totalTokens = 0;
  for (const msg of messages) {
    const content = extractMessageContent(msg);
    totalTokens += estimateMessageTokens(content);
  }

  const avgTokens = totalTokens / messages.length;
  const avgRatio = avgTokens / contextWindow;

  if (avgRatio > ADAPTIVE_CHUNK_RATIO_TRIGGER) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}

/**
 * Summarize messages using the utility model via pi-ai.
 */
export async function summarizeViaClaude(params: {
  messages: Message[];
  apiKey: string;
  maxSummaryTokens?: number;
  customInstructions?: string;
  provider?: SupportedProvider;
  utilityModel?: string;
  baseUrl?: string;
}): Promise<string> {
  const provider = params.provider || "anthropic";
  const model = getUtilityModel(provider, params.utilityModel, params.baseUrl);
  const maxTokens = params.maxSummaryTokens ?? DEFAULT_SUMMARY_FALLBACK_TOKENS;
  const formatted = formatMessagesForSummary(params.messages);

  if (!formatted.trim()) {
    return "No conversation content to summarize.";
  }

  const defaultInstructions = `Summarize this conversation concisely. Focus on:
- Key decisions made
- Action items and TODOs
- Open questions
- Important context and constraints
- Technical details that matter

Be specific but concise. Preserve critical information.`;

  const instructions = params.customInstructions
    ? `${defaultInstructions}\n\nAdditional focus:\n${params.customInstructions}`
    : defaultInstructions;

  try {
    const context: Context = {
      messages: [
        {
          role: "user",
          content: `${instructions}\n\nConversation:\n${formatted}`,
          timestamp: Date.now(),
        },
      ],
    };

    if (!getOutputTokenBudget(model, context, maxTokens, params.apiKey))
      throw new Error("Context length exceeded during summarization");
    const response = await complete(model, context, {
      apiKey: params.apiKey,
      maxTokens: getOutputTokenBudget(model, context, maxTokens, params.apiKey),
    });

    if (
      response.stopReason === "error" ||
      response.stopReason === "aborted" ||
      response.stopReason === "length"
    ) {
      throw new Error(response.errorMessage || `Summary response ${response.stopReason}`);
    }
    const summary = extractText(response);
    if (!summary.trim()) throw new Error("Model returned an empty summary");
    return summary.trim();
  } catch (error) {
    log.error({ err: error }, "Summarization error");
    throw new Error(`Summarization failed: ${getErrorMessage(error)}`);
  }
}

/**
 * Summarize messages with intelligent chunking.
 * Splits large conversations, summarizes each chunk, then merges results.
 */
export async function summarizeInChunks(params: {
  messages: Message[];
  apiKey: string;
  maxChunkTokens: number;
  maxSummaryTokens?: number;
  customInstructions?: string;
  provider?: SupportedProvider;
  utilityModel?: string;
  baseUrl?: string;
}): Promise<SummarizationResult> {
  if (params.messages.length === 0) {
    return {
      summary: "No messages to summarize.",
      tokensUsed: 0,
      chunksProcessed: 0,
    };
  }

  const chunks = splitMessagesByTokens(params.messages, params.maxChunkTokens);

  log.info(`Splitting into ${chunks.length} chunks for summarization`);

  if (chunks.length === 1) {
    const summary = await summarizeViaClaude({
      messages: chunks[0],
      apiKey: params.apiKey,
      maxSummaryTokens: params.maxSummaryTokens,
      customInstructions: params.customInstructions,
      provider: params.provider,
      utilityModel: params.utilityModel,
      baseUrl: params.baseUrl,
    });

    return {
      summary,
      tokensUsed: estimateMessageTokens(summary),
      chunksProcessed: 1,
    };
  }

  const partialSummaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    log.info(`Summarizing chunk ${i + 1}/${chunks.length} (${chunks[i].length} messages)`);

    const partial = await summarizeViaClaude({
      messages: chunks[i],
      apiKey: params.apiKey,
      maxSummaryTokens: Math.floor(
        (params.maxSummaryTokens ?? DEFAULT_SUMMARY_FALLBACK_TOKENS) / 2
      ),
      customInstructions: params.customInstructions,
      provider: params.provider,
      utilityModel: params.utilityModel,
      baseUrl: params.baseUrl,
    });

    partialSummaries.push(partial);
  }

  log.info(`Merging ${partialSummaries.length} partial summaries`);

  const provider = params.provider || "anthropic";
  const model = getUtilityModel(provider, params.utilityModel, params.baseUrl);
  const mergeContext: Context = {
    messages: [
      {
        role: "user",
        content: `Merge these partial conversation summaries into one cohesive summary.
Preserve all key decisions, action items, open questions, and important context.
Do not add new information - only synthesize what's provided.

Partial summaries:

${partialSummaries.map((s, i) => `Part ${i + 1}:\n${s}`).join("\n\n---\n\n")}`,
        timestamp: Date.now(),
      },
    ],
  };

  if (
    !getOutputTokenBudget(
      model,
      mergeContext,
      params.maxSummaryTokens ?? DEFAULT_SUMMARY_FALLBACK_TOKENS,
      params.apiKey
    )
  )
    throw new Error("Context length exceeded during summary merge");
  const mergeResponse = await complete(model, mergeContext, {
    apiKey: params.apiKey,
    maxTokens: getOutputTokenBudget(
      model,
      mergeContext,
      params.maxSummaryTokens ?? DEFAULT_SUMMARY_FALLBACK_TOKENS,
      params.apiKey
    ),
  });

  if (
    mergeResponse.stopReason === "error" ||
    mergeResponse.stopReason === "aborted" ||
    mergeResponse.stopReason === "length"
  ) {
    throw new Error(mergeResponse.errorMessage || `Summary merge ${mergeResponse.stopReason}`);
  }
  const merged = extractText(mergeResponse);
  if (!merged.trim()) throw new Error("Model returned an empty merged summary");

  return {
    summary: merged.trim(),
    tokensUsed: estimateMessageTokens(merged),
    chunksProcessed: chunks.length,
  };
}

/**
 * Summarize with progressive fallback for robustness.
 * Handles oversized messages and API failures gracefully.
 */
export async function summarizeWithFallback(params: {
  messages: Message[];
  apiKey: string;
  contextWindow: number;
  maxSummaryTokens?: number;
  customInstructions?: string;
  provider?: SupportedProvider;
  utilityModel?: string;
  baseUrl?: string;
}): Promise<SummarizationResult> {
  if (params.messages.length === 0) {
    return {
      summary: "No messages to summarize.",
      tokensUsed: 0,
      chunksProcessed: 0,
    };
  }

  const chunkRatio = computeAdaptiveChunkRatio(params.messages, params.contextWindow);
  const maxChunkTokens = Math.floor(params.contextWindow * chunkRatio);

  log.info(
    `AI Summarization: ${params.messages.length} messages, chunk ratio: ${(chunkRatio * 100).toFixed(0)}%`
  );

  try {
    return await summarizeInChunks({
      messages: params.messages,
      apiKey: params.apiKey,
      maxChunkTokens,
      maxSummaryTokens: params.maxSummaryTokens,
      customInstructions: params.customInstructions,
      provider: params.provider,
      utilityModel: params.utilityModel,
      baseUrl: params.baseUrl,
    });
  } catch (fullError) {
    log.warn(`Full summarization failed: ${getErrorMessage(fullError)}`);
  }

  const smallMessages: Message[] = [];
  const oversizedNotes: string[] = [];

  for (const msg of params.messages) {
    if (isOversizedForSummary(msg, params.contextWindow)) {
      const content = extractMessageContent(msg);
      const tokens = estimateMessageTokens(content);
      oversizedNotes.push(
        `[Large ${msg.role} message (~${Math.round(tokens / 1000)}K tokens) omitted from summary]`
      );
    } else {
      smallMessages.push(msg);
    }
  }

  log.info(
    `Fallback: Processing ${smallMessages.length} messages, skipping ${oversizedNotes.length} oversized`
  );

  if (smallMessages.length > 0) {
    try {
      const result = await summarizeInChunks({
        messages: smallMessages,
        apiKey: params.apiKey,
        maxChunkTokens,
        maxSummaryTokens: params.maxSummaryTokens,
        customInstructions: params.customInstructions,
        provider: params.provider,
        utilityModel: params.utilityModel,
        baseUrl: params.baseUrl,
      });

      const notes = oversizedNotes.length > 0 ? `\n\n${oversizedNotes.join("\n")}` : "";
      return {
        summary: result.summary + notes,
        tokensUsed: result.tokensUsed,
        chunksProcessed: result.chunksProcessed,
      };
    } catch (partialError) {
      log.warn(`Partial summarization also failed: ${getErrorMessage(partialError)}`);
    }
  }

  throw new Error("AI summarization failed for all fallback attempts");
}
