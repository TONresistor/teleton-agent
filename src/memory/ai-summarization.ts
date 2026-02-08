import { complete, type Context, type Message, type Model, type Api } from "@mariozechner/pi-ai";
import { getUtilityModel } from "../agent/client.js";
import type { SupportedProvider } from "../config/providers.js";

/**
 * Configuration for AI summarization
 */
export interface SummarizationConfig {
  apiKey: string;
  contextWindow: number;
  maxSummaryTokens: number;
  maxChunkTokens: number;
}

/**
 * Result from summarization operation
 */
export interface SummarizationResult {
  summary: string;
  tokensUsed: number;
  chunksProcessed: number;
}

/**
 * Estimate token count for text content
 * Uses ~4 characters per token approximation
 * Includes 20% safety margin for accuracy
 */
export function estimateMessageTokens(content: string): number {
  const CHARS_PER_TOKEN = 4;
  const SAFETY_MARGIN = 1.2;
  return Math.ceil((content.length / CHARS_PER_TOKEN) * SAFETY_MARGIN);
}

/**
 * Split messages into chunks based on token limits
 * Uses adaptive chunking to respect context window constraints
 */
export function splitMessagesByTokens(messages: Message[], maxChunkTokens: number): Message[][] {
  if (messages.length === 0) {
    return [];
  }

  const chunks: Message[][] = [];
  let currentChunk: Message[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    // Extract text content from message
    const content = extractMessageContent(message);
    const messageTokens = estimateMessageTokens(content);

    // Start new chunk if adding this message would exceed limit
    if (currentChunk.length > 0 && currentTokens + messageTokens > maxChunkTokens) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(message);
    currentTokens += messageTokens;

    // Handle oversized single message
    if (messageTokens > maxChunkTokens && currentChunk.length === 1) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
  }

  // Add remaining messages
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Extract text content from a message for token estimation
 */
function extractMessageContent(message: Message): string {
  if (message.role === "user") {
    return typeof message.content === "string" ? message.content : "[complex content]";
  } else if (message.role === "assistant") {
    const content = message.content as Array<{ type: string; text?: string }>;
    return content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

/**
 * Format messages for Claude summarization prompt
 */
export function formatMessagesForSummary(messages: Message[]): string {
  const formatted: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "[complex]";
      // Try to extract just the message body, skip envelope if present
      const bodyMatch = content.match(/\] (.+)/s);
      const body = bodyMatch ? bodyMatch[1] : content;
      formatted.push(`User: ${body}`);
    } else if (msg.role === "assistant") {
      const content = msg.content as Array<{ type: string; text?: string }>;
      const textBlocks = content.filter((b) => b.type === "text" && b.text);
      if (textBlocks.length > 0) {
        const text = textBlocks.map((b) => b.text).join("\n");
        formatted.push(`Assistant: ${text}`);
      }
      // Note tool calls metadata without full details
      const toolCalls = content.filter((b) => b.type === "toolCall");
      if (toolCalls.length > 0) {
        const toolNames = toolCalls.map((b: any) => b.name).join(", ");
        formatted.push(`[Used tools: ${toolNames}]`);
      }
    } else if (msg.role === "toolResult") {
      const toolMsg = msg as any;
      formatted.push(`[Tool result: ${toolMsg.toolName}]`);
    }
  }

  return formatted.join("\n\n");
}

/**
 * Check if a message is too large to summarize safely
 * Messages > 50% of context window cannot be summarized
 */
export function isOversizedForSummary(message: Message, contextWindow: number): boolean {
  const content = extractMessageContent(message);
  const tokens = estimateMessageTokens(content);
  return tokens > contextWindow * 0.5;
}

/**
 * Compute adaptive chunk ratio based on average message size
 * Reduces chunk size when messages are large to avoid exceeding limits
 */
export function computeAdaptiveChunkRatio(messages: Message[], contextWindow: number): number {
  const BASE_CHUNK_RATIO = 0.4;
  const MIN_CHUNK_RATIO = 0.15;

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

  // If average message is > 10% of context, reduce chunk ratio
  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}

/**
 * Summarize messages using LLM API via pi-ai
 * Uses the utility model for cost-effective summarization
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
  const maxTokens = params.maxSummaryTokens ?? 1000;

  // Format messages for summarization
  const formatted = formatMessagesForSummary(params.messages);

  if (!formatted.trim()) {
    return "No conversation content to summarize.";
  }

  // Build summarization prompt
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
    // Create context for pi-ai
    const context: Context = {
      messages: [
        {
          role: "user",
          content: `${instructions}\n\nConversation:\n${formatted}`,
          timestamp: Date.now(),
        },
      ],
    };

    // Call LLM via pi-ai
    const response = await complete(model, context, {
      apiKey: params.apiKey,
      maxTokens,
    });

    // Extract text from response
    const textContent = response.content.find((block) => block.type === "text");
    const summary = textContent?.type === "text" ? textContent.text : "";
    return summary.trim() || "Unable to generate summary.";
  } catch (error) {
    console.error("Summarization error:", error);
    throw new Error(
      `Summarization failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Summarize messages with intelligent chunking
 * Splits large conversations into chunks, summarizes each, then merges
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

  console.log(`📊 Splitting into ${chunks.length} chunks for summarization`);

  // Single chunk - direct summarization
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

  // Multiple chunks - summarize each then merge
  const partialSummaries: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`  📝 Summarizing chunk ${i + 1}/${chunks.length} (${chunks[i].length} messages)`);

    const partial = await summarizeViaClaude({
      messages: chunks[i],
      apiKey: params.apiKey,
      maxSummaryTokens: Math.floor((params.maxSummaryTokens ?? 1000) / 2), // Half tokens per partial
      customInstructions: params.customInstructions,
      provider: params.provider,
      utilityModel: params.utilityModel,
    });

    partialSummaries.push(partial);
  }

  // Merge partial summaries
  console.log(`  🔗 Merging ${partialSummaries.length} partial summaries`);

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
    maxTokens: params.maxSummaryTokens ?? 1000,
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
 * Summarize with progressive fallback for robustness
 * Handles oversized messages and API failures gracefully
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

  // Compute adaptive chunk size based on message sizes
  const chunkRatio = computeAdaptiveChunkRatio(params.messages, params.contextWindow);
  const maxChunkTokens = Math.floor(params.contextWindow * chunkRatio);

  console.log(
    `🧠 AI Summarization: ${params.messages.length} messages, chunk ratio: ${(chunkRatio * 100).toFixed(0)}%`
  );

  // Strategy 1: Try full summarization
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
    console.warn(
      `⚠️  Full summarization failed: ${fullError instanceof Error ? fullError.message : String(fullError)}`
    );
  }

  // Strategy 2: Fallback - Skip oversized messages
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

  console.log(
    `  🔄 Fallback: Processing ${smallMessages.length} messages, skipping ${oversizedNotes.length} oversized`
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
      console.warn(
        `⚠️  Partial summarization also failed: ${partialError instanceof Error ? partialError.message : String(partialError)}`
      );
    }
  }

  // Strategy 3: Final fallback - Descriptive note
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
