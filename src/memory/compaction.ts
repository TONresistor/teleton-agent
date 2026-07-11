import type { Context, Message, TextContent } from "@earendil-works/pi-ai";
import { truncate } from "../utils/pi-message.js";
import { appendToTranscript, readTranscript } from "../session/transcript.js";
import { randomUUID } from "crypto";
import { writeSummaryToDailyLog } from "./daily-logs.js";
import { summarizeWithFallback } from "./ai-summarization.js";
import { saveSessionMemory } from "../session/memory-hook.js";

import type { SupportedProvider } from "../config/providers.js";
import { createLogger } from "../utils/logger.js";
import {
  COMPACTION_MAX_MESSAGES,
  COMPACTION_KEEP_RECENT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_SOFT_THRESHOLD_TOKENS,
  FALLBACK_SOFT_THRESHOLD_TOKENS,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_SUMMARY_TOKENS,
  MEMORY_FLUSH_RECENT_MESSAGES,
  CHARS_PER_TOKEN_ESTIMATE,
} from "../constants/limits.js";

const COMPACTION_PREFIX = "[Auto-compacted";

export interface CompactionConfig {
  enabled: boolean;
  maxMessages?: number; // Trigger compaction after N messages
  maxTokens?: number; // Trigger compaction after N tokens (estimated)
  keepRecentMessages?: number; // Number of recent messages to preserve
  memoryFlushEnabled?: boolean; // Write memory to daily log before compaction
  softThresholdTokens?: number; // Token count to trigger pre-compaction flush
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  maxMessages: COMPACTION_MAX_MESSAGES,
  maxTokens: DEFAULT_MAX_TOKENS,
  keepRecentMessages: COMPACTION_KEEP_RECENT,
  memoryFlushEnabled: true,
  softThresholdTokens: DEFAULT_SOFT_THRESHOLD_TOKENS,
};

const log = createLogger("Memory");

function estimateContextTokens(context: Context): number {
  let charCount = 0;

  if (context.systemPrompt) {
    charCount += context.systemPrompt.length;
  }

  for (const message of context.messages) {
    if (message.role === "user") {
      if (typeof message.content === "string") {
        charCount += message.content.length;
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === "text") charCount += block.text.length;
        }
      }
    } else if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "text") {
          charCount += block.text.length;
        }
      }
    }
  }

  return Math.ceil(charCount / CHARS_PER_TOKEN_ESTIMATE);
}

export function shouldFlushMemory(
  context: Context,
  config: CompactionConfig,
  tokenCount?: number
): boolean {
  if (!config.enabled || !config.memoryFlushEnabled) {
    return false;
  }

  const tokens = tokenCount ?? estimateContextTokens(context);
  const softThreshold = config.softThresholdTokens ?? FALLBACK_SOFT_THRESHOLD_TOKENS;

  if (tokens >= softThreshold) {
    log.info(`Memory flush needed: ~${tokens} tokens (soft threshold: ${softThreshold})`);
    return true;
  }

  return false;
}

function flushMemoryToDailyLog(context: Context): void {
  const recentMessages = context.messages.slice(-MEMORY_FLUSH_RECENT_MESSAGES);
  const summary: string[] = [];

  summary.push("**Recent Context:**\n");

  for (const msg of recentMessages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "[complex content]";
      summary.push(`- User: ${truncate(content, 100)}`);
    } else if (msg.role === "assistant") {
      const textBlocks = msg.content.filter((b): b is TextContent => b.type === "text");
      if (textBlocks.length > 0) {
        const text = textBlocks[0].text || "";
        summary.push(`- Assistant: ${truncate(text, 100)}`);
      }
    }
  }

  writeSummaryToDailyLog(summary.join("\n"));
  log.info(`Memory flushed to daily log`);
}

export function shouldCompact(
  context: Context,
  config: CompactionConfig,
  tokenCount?: number
): boolean {
  if (!config.enabled) {
    return false;
  }

  const messageCount = context.messages.length;

  if (config.maxMessages && messageCount >= config.maxMessages) {
    log.info(`Compaction needed: ${messageCount} messages (max: ${config.maxMessages})`);
    return true;
  }

  if (config.maxTokens) {
    const tokens = tokenCount ?? estimateContextTokens(context);
    if (tokens >= config.maxTokens) {
      log.info(`Compaction needed: ~${tokens} tokens (max: ${config.maxTokens})`);
      return true;
    }
  }

  return false;
}

/**
 * Compact context by AI-summarizing old messages.
 * Preserves recent messages and replaces old ones with a summary.
 */
export async function compactContext(
  context: Context,
  config: CompactionConfig,
  apiKey: string,
  provider?: SupportedProvider,
  utilityModel?: string,
  previousSummary?: string | null
): Promise<Context> {
  const keepCount = config.keepRecentMessages ?? 10;

  if (context.messages.length <= keepCount) {
    return context;
  }

  let cutIndex = context.messages.length - keepCount;
  const collectToolUseIds = (msgs: Message[]): Set<string> => {
    const ids = new Set<string>();
    for (const msg of msgs) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "toolCall") {
            if (block.id) ids.add(block.id);
          }
        }
      }
    }
    return ids;
  };

  const hasOrphanedToolResults = (msgs: Message[]): boolean => {
    const toolUseIds = collectToolUseIds(msgs);
    for (const msg of msgs) {
      if (msg.role === "toolResult") {
        if (msg.toolCallId && !toolUseIds.has(msg.toolCallId)) {
          return true;
        }
      }
    }
    return false;
  };

  let iterations = 0;
  while (cutIndex > 0 && iterations < 50) {
    const keptMessages = context.messages.slice(cutIndex);
    if (!hasOrphanedToolResults(keptMessages)) {
      break;
    }
    cutIndex--;
    iterations++;
  }

  if (hasOrphanedToolResults(context.messages.slice(cutIndex))) {
    log.warn(`Compaction: couldn't find clean cut point, keeping all messages`);
    return context;
  }

  const recentMessages = context.messages.slice(cutIndex);
  const oldMessages = context.messages.slice(0, cutIndex);

  log.info(
    `Compacting ${oldMessages.length} old messages, keeping ${recentMessages.length} recent (cut at clean boundary)`
  );

  try {
    const iterativePreamble = previousSummary
      ? `You are updating an existing conversation summary. This is compaction round N — information compounds, never disappears.

<previous_summary>
${previousSummary}
</previous_summary>

Rules for iterative update:
- Every fact in <previous_summary> MUST appear in your output unless the new messages explicitly contradict it.
- When a fact is updated (e.g. balance changed, task completed), keep both the old and new state: "Balance: 50 TON → 42 TON (sent 8 TON to EQ...)".
- Move completed items from Open Items to Actions Taken — don't delete them.
- If the user's intent evolved, show the progression: "Initially X, now pivoted to Y because Z."

`
      : "";

    const result = await summarizeWithFallback({
      messages: oldMessages,
      apiKey,
      contextWindow: config.maxTokens ?? DEFAULT_CONTEXT_WINDOW,
      maxSummaryTokens: DEFAULT_MAX_SUMMARY_TOKENS,
      customInstructions: `${iterativePreamble}You are summarizing an AI agent's Telegram conversation for context continuity.
The agent operates on TON blockchain (wallets, swaps, NFTs) and Telegram (messages, groups, channels).

Output ONLY these sections. Skip a section entirely if it has zero content — no placeholders, no "None."

## Goal
What the user wants accomplished. 1-2 sentences max. Include the specific asset, address, or entity if named.

## Decisions & Commitments
Bullet list. Each bullet = one decision. Include WHO decided, WHAT was decided, and any constraints.
Priority: financial commitments > technical choices > preferences.

## State
Active values the agent needs to continue work. Be exact:
- Addresses, balances, transaction hashes, prices
- Chat IDs, user IDs, group names involved
- File paths, API endpoints, config values
- Error states or rate limits hit

## Done
What was completed. Each bullet: tool used + result. Keep specific values.
"Sent 8 TON to EQ...abc (tx: ...def)" not "Sent some TON."

## Open
Unfinished work, blocked tasks, questions waiting for user response. Most urgent first.`,
      provider,
      utilityModel,
    });

    log.info(`AI Summary: ${result.tokensUsed} tokens, ${result.chunksProcessed} chunks processed`);

    const summaryText = `${COMPACTION_PREFIX} ${oldMessages.length} messages]\n\n${result.summary}`;

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
    log.error({ err: error }, "AI summarization failed, using fallback");

    const summaryText = `${COMPACTION_PREFIX}: ${oldMessages.length} earlier messages from this conversation]`;

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

export async function compactAndSaveTranscript(
  sessionId: string,
  context: Context,
  config: CompactionConfig,
  apiKey: string,
  chatId?: string,
  provider?: SupportedProvider,
  utilityModel?: string,
  previousSummary?: string | null
): Promise<string> {
  const newSessionId = randomUUID();

  log.info(`Creating compacted transcript: ${sessionId} → ${newSessionId}`);

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

  const compactedContext = await compactContext(
    context,
    config,
    apiKey,
    provider,
    utilityModel,
    previousSummary
  );

  for (const message of compactedContext.messages) {
    appendToTranscript(newSessionId, message);
  }

  return newSessionId;
}

export class CompactionManager {
  private config: CompactionConfig;
  /** Previous compaction summary — injected into the next summarization
   *  prompt so that information accumulates instead of being lost. */
  private previousSummary: string | null = null;

  constructor(config: CompactionConfig = DEFAULT_COMPACTION_CONFIG) {
    this.config = config;
  }

  async checkAndCompact(
    sessionId: string,
    context: Context,
    apiKey: string,
    chatId?: string,
    provider?: SupportedProvider,
    utilityModel?: string
  ): Promise<string | null> {
    const tokenCount = estimateContextTokens(context);

    let flushed = false;
    if (shouldFlushMemory(context, this.config, tokenCount)) {
      flushMemoryToDailyLog(context);
      flushed = true;
    }

    if (!shouldCompact(context, this.config, tokenCount)) {
      return null;
    }

    if (!flushed && this.config.memoryFlushEnabled) {
      flushMemoryToDailyLog(context);
    }

    log.info(`Auto-compacting session ${sessionId}`);
    const newSessionId = await compactAndSaveTranscript(
      sessionId,
      context,
      this.config,
      apiKey,
      chatId,
      provider,
      utilityModel,
      this.previousSummary
    );
    log.info(`Compaction complete: ${newSessionId}`);

    // Extract the summary text from the compacted context for iterative reuse.
    // The first message after compaction is the summary message.
    const compacted = readTranscript(newSessionId);
    if (compacted.length > 0) {
      const firstMsg = compacted[0];
      const text = typeof firstMsg.content === "string" ? firstMsg.content : null;
      if (text?.startsWith(COMPACTION_PREFIX)) {
        this.previousSummary = text;
      }
    }

    return newSessionId;
  }

  updateConfig(config: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CompactionConfig {
    return { ...this.config };
  }
}
