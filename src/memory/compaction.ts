import type { Context, Message } from "@mariozechner/pi-ai";
import { appendToTranscript, readTranscript } from "../session/transcript.js";
import { randomUUID } from "crypto";
import { writeSummaryToDailyLog } from "./daily-logs.js";
import { summarizeWithFallback } from "./ai-summarization.js";
import { saveSessionMemory } from "../session/memory-hook.js";
import { encodingForModel } from "js-tiktoken";
import type { SupportedProvider } from "../config/providers.js";
import { COMPACTION_MAX_MESSAGES, COMPACTION_KEEP_RECENT } from "../constants/limits.js";

/**
 * Configuration for auto-compaction
 */
export interface CompactionConfig {
  enabled: boolean;
  maxMessages?: number; // Trigger compaction after N messages
  maxTokens?: number; // Trigger compaction after N tokens (estimated)
  keepRecentMessages?: number; // Number of recent messages to preserve
  memoryFlushEnabled?: boolean; // Write memory to daily log before compaction
  softThresholdTokens?: number; // Token count to trigger pre-compaction flush
}

/**
 * Default compaction configuration (conservative fallback)
 * Runtime dynamically computes from model.contextWindow (see runtime.ts constructor)
 * These defaults are only used if dynamic resolution fails
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  maxMessages: COMPACTION_MAX_MESSAGES,
  maxTokens: 96_000, // Conservative: fits 128K context with buffer
  keepRecentMessages: COMPACTION_KEEP_RECENT,
  memoryFlushEnabled: true,
  softThresholdTokens: 64_000, // ~50% of 128K (smallest supported context)
};

// Cache tokenizer instance (Claude uses cl100k_base encoding)
let tokenizer: ReturnType<typeof encodingForModel> | null = null;

function getTokenizer() {
  if (!tokenizer) {
    // Claude models use cl100k_base encoding (same as GPT-4)
    tokenizer = encodingForModel("gpt-4");
  }
  return tokenizer;
}

/**
 * Accurate token count using tiktoken
 * Claude Opus/Sonnet use cl100k_base encoding
 */
function estimateTokens(content: string): number {
  try {
    const enc = getTokenizer();
    return enc.encode(content).length;
  } catch (error) {
    // Fallback to rough estimate if tiktoken fails
    console.warn("Token encoding failed, using fallback:", error);
    return Math.ceil(content.length / 4);
  }
}

/**
 * Calculate total tokens in context
 */
function calculateContextTokens(context: Context): number {
  let total = 0;

  // System prompt
  if (context.systemPrompt) {
    total += estimateTokens(context.systemPrompt);
  }

  // Messages
  for (const message of context.messages) {
    if (message.role === "user") {
      // User content is always a string
      total += estimateTokens(message.content as string);
    } else if (message.role === "assistant") {
      // Assistant content is an array of blocks
      const content = message.content as Array<{ type: string; text?: string }>;
      for (const block of content) {
        if (block.type === "text" && block.text) {
          total += estimateTokens(block.text);
        }
      }
    }
  }

  return total;
}

/**
 * Check if memory flush is needed (soft threshold)
 */
export function shouldFlushMemory(context: Context, config: CompactionConfig): boolean {
  if (!config.enabled || !config.memoryFlushEnabled) {
    return false;
  }

  const tokenCount = calculateContextTokens(context);
  const softThreshold = config.softThresholdTokens ?? 6000;

  if (tokenCount >= softThreshold) {
    console.log(`💾 Memory flush needed: ~${tokenCount} tokens (soft threshold: ${softThreshold})`);
    return true;
  }

  return false;
}

/**
 * Flush memory to daily log before compaction
 */
function flushMemoryToDailyLog(context: Context): void {
  const recentMessages = context.messages.slice(-5); // Last 5 messages
  const summary: string[] = [];

  summary.push("**Recent Context:**\n");

  for (const msg of recentMessages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "[complex content]";
      summary.push(`- User: ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}`);
    } else if (msg.role === "assistant") {
      const textBlocks = msg.content.filter((b: any) => b.type === "text");
      if (textBlocks.length > 0) {
        const text = (textBlocks[0] as any).text || "";
        summary.push(`- Assistant: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);
      }
    }
  }

  writeSummaryToDailyLog(summary.join("\n"));
  console.log(`✅ Memory flushed to daily log`);
}

/**
 * Check if compaction is needed based on config
 */
export function shouldCompact(context: Context, config: CompactionConfig): boolean {
  if (!config.enabled) {
    return false;
  }

  const messageCount = context.messages.length;
  const tokenCount = calculateContextTokens(context);

  // Check message count threshold
  if (config.maxMessages && messageCount >= config.maxMessages) {
    console.log(`⚠️  Compaction needed: ${messageCount} messages (max: ${config.maxMessages})`);
    return true;
  }

  // Check token count threshold
  if (config.maxTokens && tokenCount >= config.maxTokens) {
    console.log(`⚠️  Compaction needed: ~${tokenCount} tokens (max: ${config.maxTokens})`);
    return true;
  }

  return false;
}

/**
 * Compact a context by summarizing old messages using AI
 * Uses Claude API to create intelligent summaries
 */
export async function compactContext(
  context: Context,
  config: CompactionConfig,
  apiKey: string,
  provider?: SupportedProvider,
  utilityModel?: string
): Promise<Context> {
  const keepCount = config.keepRecentMessages ?? 10;

  if (context.messages.length <= keepCount) {
    return context; // Nothing to compact
  }

  // Find a clean cut point that doesn't orphan toolResults
  // Strategy: collect all toolUse IDs in kept portion, ensure all toolResults have matching toolUses
  let cutIndex = context.messages.length - keepCount;

  // Helper to collect toolUse IDs from a slice
  const collectToolUseIds = (msgs: Message[]): Set<string> => {
    const ids = new Set<string>();
    for (const msg of msgs) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content as any[]) {
          if (block.type === "toolCall" || block.type === "tool_use") {
            const id = block.id || block.toolCallId;
            if (id) ids.add(id);
          }
        }
      }
    }
    return ids;
  };

  // Helper to check if all toolResults have matching toolUses
  const hasOrphanedToolResults = (msgs: Message[]): boolean => {
    const toolUseIds = collectToolUseIds(msgs);
    for (const msg of msgs) {
      if (msg.role === "toolResult") {
        const toolCallId = (msg as any).toolCallId;
        if (toolCallId && !toolUseIds.has(toolCallId)) {
          return true;
        }
      }
    }
    return false;
  };

  // Move cut point earlier until we have no orphaned toolResults
  // Max 50 iterations to prevent infinite loop
  let iterations = 0;
  while (cutIndex > 0 && iterations < 50) {
    const keptMessages = context.messages.slice(cutIndex);
    if (!hasOrphanedToolResults(keptMessages)) {
      break;
    }
    cutIndex--;
    iterations++;
  }

  // If still can't find clean cut, just keep everything
  if (hasOrphanedToolResults(context.messages.slice(cutIndex))) {
    console.warn(`⚠️ Compaction: couldn't find clean cut point, keeping all messages`);
    return context;
  }

  // Split messages at the clean cut point
  const recentMessages = context.messages.slice(cutIndex);
  const oldMessages = context.messages.slice(0, cutIndex);

  console.log(
    `🗜️  Compacting ${oldMessages.length} old messages, keeping ${recentMessages.length} recent (cut at clean boundary)`
  );

  // Use AI to create intelligent summary
  try {
    const result = await summarizeWithFallback({
      messages: oldMessages,
      apiKey,
      contextWindow: config.maxTokens ?? 150000,
      maxSummaryTokens: 2000,
      customInstructions:
        "Focus on conversation flow, key decisions, action items, and technical details that matter for continuity.",
      provider,
      utilityModel,
    });

    console.log(
      `  ✅ AI Summary: ${result.tokensUsed} tokens, ${result.chunksProcessed} chunks processed`
    );

    const summaryText = `[Auto-compacted ${oldMessages.length} messages]\n\n${result.summary}`;

    const summaryMessage: Message = {
      role: "user",
      content: summaryText,
      timestamp: oldMessages[0]?.timestamp ?? Date.now(),
    };

    return {
      ...context,
      messages: [summaryMessage, ...recentMessages],
    };
  } catch (error) {
    console.error("AI summarization failed, using fallback:", error);

    // Fallback to simple note if AI summarization fails completely
    const summaryText = `[Auto-compacted: ${oldMessages.length} earlier messages from this conversation]`;

    const summaryMessage: Message = {
      role: "user",
      content: summaryText,
      timestamp: oldMessages[0]?.timestamp ?? Date.now(),
    };

    return {
      ...context,
      messages: [summaryMessage, ...recentMessages],
    };
  }
}

/**
 * Compact and save transcript for a session
 * Creates new session ID and migrates to compacted transcript
 * Saves session memory for audit trail (OpenClaw-style)
 */
export async function compactAndSaveTranscript(
  sessionId: string,
  context: Context,
  config: CompactionConfig,
  apiKey: string,
  chatId?: string,
  provider?: SupportedProvider,
  utilityModel?: string
): Promise<string> {
  // Generate new session ID for compacted transcript
  const newSessionId = randomUUID();

  console.log(`📝 Creating compacted transcript: ${sessionId} → ${newSessionId}`);

  // SAVE SESSION MEMORY FIRST (before compaction)
  // This preserves full context in human-readable markdown format
  if (chatId) {
    await saveSessionMemory({
      oldSessionId: sessionId,
      newSessionId,
      context,
      chatId,
      apiKey,
      provider,
      utilityModel,
    });
  }

  // Compact the context with AI summarization
  const compactedContext = await compactContext(context, config, apiKey, provider, utilityModel);

  // Write compacted messages to new transcript
  for (const message of compactedContext.messages) {
    appendToTranscript(newSessionId, message);
  }

  return newSessionId;
}

/**
 * Auto-compaction manager (to be integrated into runtime)
 */
export class CompactionManager {
  private config: CompactionConfig;

  constructor(config: CompactionConfig = DEFAULT_COMPACTION_CONFIG) {
    this.config = config;
  }

  /**
   * Check and perform compaction if needed
   * Returns new session ID if compacted, null otherwise
   */
  async checkAndCompact(
    sessionId: string,
    context: Context,
    apiKey: string,
    chatId?: string,
    provider?: SupportedProvider,
    utilityModel?: string
  ): Promise<string | null> {
    // Check for soft threshold memory flush BEFORE compaction
    if (shouldFlushMemory(context, this.config)) {
      flushMemoryToDailyLog(context);
    }

    if (!shouldCompact(context, this.config)) {
      return null;
    }

    // Flush memory one last time before compacting
    if (this.config.memoryFlushEnabled) {
      flushMemoryToDailyLog(context);
    }

    console.log(`🗜️  Auto-compacting session ${sessionId}`);
    const newSessionId = await compactAndSaveTranscript(
      sessionId,
      context,
      this.config,
      apiKey,
      chatId,
      provider,
      utilityModel
    );
    console.log(`✅ Compaction complete: ${newSessionId}`);

    return newSessionId;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): CompactionConfig {
    return { ...this.config };
  }
}
