import {
  complete,
  type Context,
  type Message,
  type TextContent,
} from "@earendil-works/pi-ai/compat";
import { extractText, extractToolNames, stripEnvelopePrefix } from "../utils/pi-message.js";
import { getUtilityModel } from "../providers/model-resolver.js";
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

function extractMessageContent(message: Message): string {
  if (message.role === "user") {
    return typeof message.content === "string" ? message.content : "[complex content]";
  } else if (message.role === "assistant") {
    return extractText(message);
  }
  return "";
}

export function formatMessagesForSummary(messages: Message[]): string {
  const formatted: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "[complex]";
      const body = stripEnvelopePrefix(content);
      formatted.push(`User: ${body}`);
    } else if (msg.role === "assistant") {
      const textBlocks = msg.content.filter((b): b is TextContent => b.type === "text");
      if (textBlocks.length > 0) {
        formatted.push(`Assistant: ${extractText(msg)}`);
      }
      const toolNames = extractToolNames(msg);
      if (toolNames.length > 0) {
        formatted.push(`[Used tools: ${toolNames.join(", ")}]`);
      }
    } else if (msg.role === "toolResult") {
      formatted.push(`[Tool result: ${msg.toolName}]`);
    }
  }

  return formatted.join("\n\n");
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
}): Promise<string> {
  const provider = params.provider || "anthropic";
  const model = getUtilityModel(provider, params.utilityModel);
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

    const response = await complete(model, context, {
      apiKey: params.apiKey,
      maxTokens,
    });

    const textContent = response.content.find((block) => block.type === "text");
    const summary = textContent?.type === "text" ? textContent.text : "";
    return summary.trim() || "Unable to generate summary.";
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
    });

    partialSummaries.push(partial);
  }

  log.info(`Merging ${partialSummaries.length} partial summaries`);

  const provider = params.provider || "anthropic";
  const model = getUtilityModel(provider, params.utilityModel);
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

  const mergeResponse = await complete(model, mergeContext, {
    apiKey: params.apiKey,
    maxTokens: params.maxSummaryTokens ?? DEFAULT_SUMMARY_FALLBACK_TOKENS,
  });

  const textContent = mergeResponse.content.find((block) => block.type === "text");
  const merged = textContent?.type === "text" ? textContent.text : "";

  return {
    summary: merged.trim() || "Unable to merge summaries.",
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

  const note =
    `Context contained ${params.messages.length} messages ` +
    `(${oversizedNotes.length} were oversized). ` +
    `AI summarization unavailable due to size constraints. ` +
    `Recent conversation history was preserved.`;

  return {
    summary: note,
    tokensUsed: estimateMessageTokens(note),
    chunksProcessed: 0,
  };
}
