import type { Config } from "../config/schema.js";
import {
  MAX_TOOL_RESULT_SIZE,
  COMPACTION_MAX_MESSAGES,
  COMPACTION_KEEP_RECENT,
  COMPACTION_MAX_TOKENS_RATIO,
  COMPACTION_SOFT_THRESHOLD_RATIO,
  CONTEXT_MAX_RECENT_MESSAGES,
  CONTEXT_MAX_RELEVANT_CHUNKS,
  CONTEXT_OVERFLOW_SUMMARY_MESSAGES,
  RATE_LIMIT_MAX_RETRIES,
} from "../constants/limits.js";
import {
  chatWithContext,
  loadContextFromTranscript,
  getProviderModel,
  type ChatResponse,
} from "./client.js";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { buildSystemPrompt } from "../soul/loader.js";
import { getDatabase } from "../memory/index.js";
import { formatMessageEnvelope } from "../memory/envelope.js";
import {
  getOrCreateSession,
  updateSession,
  getSession,
  resetSession,
  shouldResetSession,
  resetSessionWithPolicy,
} from "../session/store.js";
import {
  readTranscript,
  transcriptExists,
  deleteTranscript,
  archiveTranscript,
  appendToTranscript,
} from "../session/transcript.js";
import type {
  Context,
  Message as PiMessage,
  UserMessage,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import {
  CompactionManager,
  DEFAULT_COMPACTION_CONFIG,
  shouldFlushMemory,
} from "../memory/compaction.js";
import { maskOldToolResults } from "../memory/observation-masking.js";
import { ContextBuilder } from "../memory/search/context.js";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolContext } from "./tools/types.js";
import { appendToDailyLog, writeSessionEndSummary } from "../memory/daily-logs.js";
import { saveSessionMemory } from "../session/memory-hook.js";

/**
 * Check if an error message indicates context overflow
 */
function isContextOverflowError(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes("prompt is too long") ||
    lower.includes("context length exceeded") ||
    lower.includes("maximum context length") ||
    lower.includes("too many tokens") ||
    lower.includes("request_too_large") ||
    (lower.includes("exceeds") && lower.includes("maximum")) ||
    (lower.includes("context") && lower.includes("limit"))
  );
}

/**
 * Extract a summary from context messages for memory preservation
 */
function extractContextSummary(context: Context, maxMessages: number = 10): string {
  const recentMessages = context.messages.slice(-maxMessages);
  const summaryParts: string[] = [];

  summaryParts.push("### Session Summary (Auto-saved before overflow reset)\n");

  for (const msg of recentMessages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "[complex]";
      // Extract just the message body, skip envelope metadata
      const bodyMatch = content.match(/\] (.+)/s);
      const body = bodyMatch ? bodyMatch[1] : content;
      summaryParts.push(`- **User**: ${body.substring(0, 150)}${body.length > 150 ? "..." : ""}`);
    } else if (msg.role === "assistant") {
      const textBlocks = (msg.content as any[]).filter((b: any) => b.type === "text");
      const toolBlocks = (msg.content as any[]).filter((b: any) => b.type === "toolCall");

      if (textBlocks.length > 0) {
        const text = textBlocks[0].text || "";
        summaryParts.push(
          `- **Agent**: ${text.substring(0, 150)}${text.length > 150 ? "..." : ""}`
        );
      }

      // Add tool calls summary
      if (toolBlocks.length > 0) {
        const toolNames = toolBlocks.map((b: any) => b.name).join(", ");
        summaryParts.push(`  - *Tools used: ${toolNames}*`);
      }
    } else if (msg.role === "toolResult") {
      // Add tool results summary
      const toolMsg = msg as any;
      const status = toolMsg.isError ? "ERROR" : "OK";
      summaryParts.push(`  - *Tool result: ${toolMsg.toolName} → ${status}*`);
    }
  }

  return summaryParts.join("\n");
}

export interface AgentResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
  }>;
}

export class AgentRuntime {
  private config: Config;
  private soul: string;
  private compactionManager: CompactionManager;
  private contextBuilder: ContextBuilder | null = null;
  private toolRegistry: ToolRegistry | null = null;

  constructor(config: Config, soul?: string, toolRegistry?: ToolRegistry) {
    this.config = config;
    this.soul = soul ?? "";
    this.toolRegistry = toolRegistry ?? null;

    // Build dynamic compaction config based on provider's context window
    const provider = (config.agent.provider || "anthropic") as SupportedProvider;
    try {
      const model = getProviderModel(provider, config.agent.model);
      const ctx = model.contextWindow;
      this.compactionManager = new CompactionManager({
        enabled: true,
        maxMessages: COMPACTION_MAX_MESSAGES,
        maxTokens: Math.floor(ctx * COMPACTION_MAX_TOKENS_RATIO),
        keepRecentMessages: COMPACTION_KEEP_RECENT,
        memoryFlushEnabled: true,
        softThresholdTokens: Math.floor(ctx * COMPACTION_SOFT_THRESHOLD_RATIO),
      });
    } catch {
      // Fallback to defaults if model resolution fails at init
      this.compactionManager = new CompactionManager(DEFAULT_COMPACTION_CONFIG);
    }
  }

  /**
   * Initialize context builder for RAG search (call after database is ready)
   */
  initializeContextBuilder(embedder: EmbeddingProvider, vectorEnabled: boolean): void {
    const db = getDatabase().getDb();
    this.contextBuilder = new ContextBuilder(db, embedder, vectorEnabled);
  }

  /**
   * Get the tool registry
   */
  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  /**
   * Process a message from a user and generate a response
   */
  async processMessage(
    chatId: string,
    userMessage: string,
    userName?: string,
    timestamp?: number,
    isGroup?: boolean,
    pendingContext?: string | null,
    toolContext?: Omit<ToolContext, "chatId" | "isGroup">,
    senderUsername?: string,
    hasMedia?: boolean,
    mediaType?: string,
    messageId?: number
  ): Promise<AgentResponse> {
    try {
      // Get or create session
      let session = getOrCreateSession(chatId);
      const now = timestamp ?? Date.now();

      // Check if session should be reset based on policy
      const resetPolicy = this.config.agent.session_reset_policy;
      if (shouldResetSession(session, resetPolicy)) {
        console.log(`🔄 Auto-resetting session based on policy`);

        // PRESERVE MEMORY: Save session before daily reset (OpenClaw-style)
        if (transcriptExists(session.sessionId)) {
          try {
            console.log(`💾 Saving memory before daily reset...`);
            const oldContext = loadContextFromTranscript(session.sessionId);

            // Save detailed session memory to dated file
            await saveSessionMemory({
              oldSessionId: session.sessionId,
              newSessionId: "pending", // Will be generated after reset
              context: oldContext,
              chatId,
              apiKey: this.config.agent.api_key,
              provider: this.config.agent.provider as SupportedProvider,
              utilityModel: this.config.agent.utility_model,
            });

            console.log(`✅ Memory saved before reset`);
          } catch (error) {
            console.warn(`⚠️ Failed to save memory before reset:`, error);
            // Don't block reset on memory save failure
          }
        }

        session = resetSessionWithPolicy(chatId, resetPolicy);
      }

      // Load previous session if transcript exists
      let context: Context;
      if (transcriptExists(session.sessionId)) {
        console.log(`📖 Loading existing session: ${session.sessionId}`);
        context = loadContextFromTranscript(session.sessionId);
      } else {
        console.log(`🆕 Starting new session: ${session.sessionId}`);
        context = {
          messages: [],
        };
      }

      // Get previous timestamp for elapsed time calculation
      const previousTimestamp = session.updatedAt;

      // Format user message with envelope
      let formattedMessage = formatMessageEnvelope({
        channel: "Telegram",
        senderId: chatId,
        senderName: userName,
        senderUsername: senderUsername,
        timestamp: now,
        previousTimestamp,
        body: userMessage,
        isGroup: isGroup ?? false,
        hasMedia,
        mediaType,
        messageId,
      });

      // Prepend pending context if available (group messages since last reply)
      if (pendingContext) {
        formattedMessage = `${pendingContext}\n\n${formattedMessage}`;
        console.log(`📋 Including ${pendingContext.split("\n").length - 1} pending messages`);
      }

      console.log(`📨 Formatted message: ${formattedMessage.substring(0, 100)}...`);

      // Fetch relevant context from database (RAG)
      let relevantContext = "";
      if (this.contextBuilder) {
        try {
          const dbContext = await this.contextBuilder.buildContext({
            query: userMessage,
            chatId,
            includeAgentMemory: true,
            includeFeedHistory: true,
            searchAllChats: true, // Search across all groups/DMs
            maxRecentMessages: CONTEXT_MAX_RECENT_MESSAGES,
            maxRelevantChunks: CONTEXT_MAX_RELEVANT_CHUNKS,
          });

          // Build relevant context string
          const contextParts: string[] = [];

          if (dbContext.relevantKnowledge.length > 0) {
            contextParts.push(
              `[Relevant knowledge from memory]\n${dbContext.relevantKnowledge.join("\n---\n")}`
            );
          }

          if (dbContext.relevantFeed.length > 0) {
            contextParts.push(
              `[Relevant messages from Telegram feed]\n${dbContext.relevantFeed.join("\n")}`
            );
          }

          if (contextParts.length > 0) {
            relevantContext = contextParts.join("\n\n");
            console.log(
              `🔍 Found ${dbContext.relevantKnowledge.length} knowledge chunks, ${dbContext.relevantFeed.length} feed messages`
            );
          }
        } catch (error) {
          console.warn("Context building failed:", error);
        }
      }

      // Get memory statistics for agent awareness
      const memoryStats = this.getMemoryStats();
      const statsContext = `[Memory Status: ${memoryStats.totalMessages} messages across ${memoryStats.totalChats} chats, ${memoryStats.knowledgeChunks} knowledge chunks]`;

      // Build system prompt with context
      const additionalContext = relevantContext
        ? `You are in a Telegram conversation with chat ID: ${chatId}. Maintain conversation continuity.\n\n${statsContext}\n\n${relevantContext}`
        : `You are in a Telegram conversation with chat ID: ${chatId}. Maintain conversation continuity.\n\n${statsContext}`;

      // Check if context is near compaction threshold (Option C: memory flush warning)
      const needsMemoryFlush = shouldFlushMemory(context, this.compactionManager.getConfig());

      const systemPrompt = buildSystemPrompt({
        soul: this.soul,
        userName,
        senderUsername,
        ownerName: this.config.telegram.owner_name,
        ownerUsername: this.config.telegram.owner_username,
        context: additionalContext,
        includeMemory: !isGroup, // Only load memory in private chats (privacy)
        includeStrategy: !isGroup, // Hide trading rules from groups (competitive intelligence)
        memoryFlushWarning: needsMemoryFlush, // Show warning when near threshold
      });

      // Create user message for pi-ai
      const userMsg: UserMessage = {
        role: "user",
        content: formattedMessage,
        timestamp: now,
      };

      // Add to context
      context.messages.push(userMsg);

      // PREEMPTIVE COMPACTION: Check if we should compact BEFORE calling API
      // This prevents context overflow errors by proactively reducing context size
      const preemptiveCompaction = await this.compactionManager.checkAndCompact(
        session.sessionId,
        context,
        this.config.agent.api_key,
        chatId,
        this.config.agent.provider as SupportedProvider,
        this.config.agent.utility_model
      );
      if (preemptiveCompaction) {
        console.log(`🗜️  Preemptive compaction triggered, reloading session...`);
        // Update to new compacted session
        session = getSession(chatId)!;
        // Reload compacted context from transcript
        context = loadContextFromTranscript(session.sessionId);
        // Re-add current user message to compacted context
        context.messages.push(userMsg);
      }

      // Persist user message to transcript (before agentic loop)
      // This ensures user messages are saved even if the agent crashes mid-loop
      appendToTranscript(session.sessionId, userMsg);

      // Get tools from registry, respecting provider tool limits
      const providerMeta = getProviderMetadata(
        (this.config.agent.provider || "anthropic") as SupportedProvider
      );
      const tools = this.toolRegistry?.getForProvider(providerMeta.toolLimit);

      // AGENTIC LOOP: Keep calling LLM until it returns text without tools
      const maxIterations = this.config.agent.max_agentic_iterations || 5;
      let iteration = 0;
      let overflowResets = 0; // Guard against infinite overflow→reset→overflow loops
      let rateLimitRetries = 0; // Track rate limit retry attempts
      let finalResponse: ChatResponse | null = null;
      const totalToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

      while (iteration < maxIterations) {
        iteration++;
        console.log(`\n🔄 Agentic iteration ${iteration}/${maxIterations}`);

        // Apply observation masking to reduce context size before API call
        // This replaces old tool results with compact summaries (~90% reduction)
        // NEVER masks data-bearing tools (balances, holdings, etc.)
        const maskedMessages = maskOldToolResults(
          context.messages,
          undefined,
          this.toolRegistry ?? undefined
        );
        const maskedContext: Context = { ...context, messages: maskedMessages };

        // Call LLM with masked context (full context preserved for transcript)
        const response: ChatResponse = await chatWithContext(this.config.agent, {
          systemPrompt,
          context: maskedContext,
          sessionId: session.sessionId,
          persistTranscript: true,
          tools,
        });

        // Check for API errors
        const assistantMsg = response.message as any;
        if (assistantMsg.stopReason === "error") {
          const errorMsg = assistantMsg.errorMessage || "";

          if (isContextOverflowError(errorMsg)) {
            overflowResets++;
            if (overflowResets > 1) {
              throw new Error(
                "Context overflow persists after session reset. Message may be too large for the model's context window."
              );
            }
            console.error(`🚨 Context overflow detected: ${errorMsg}`);

            // PRESERVE MEMORY: Save session summary to daily log before reset
            console.log(`💾 Saving session memory before reset...`);
            const summary = extractContextSummary(context, CONTEXT_OVERFLOW_SUMMARY_MESSAGES);
            appendToDailyLog(summary);
            console.log(`✅ Memory saved to daily log`);

            // Archive the old transcript (don't delete completely)
            const archived = archiveTranscript(session.sessionId);
            if (!archived) {
              console.error(
                `⚠️  Failed to archive transcript ${session.sessionId}, proceeding with reset anyway`
              );
            }

            // Reset session
            console.log(`🔄 Resetting session due to context overflow...`);
            session = resetSession(chatId);

            // Create fresh context with just the current message
            context = { messages: [userMsg] };

            // Persist user message to NEW session transcript
            appendToTranscript(session.sessionId, userMsg);

            // Retry with fresh context
            console.log(`🔄 Retrying with fresh context...`);
            continue;
          } else if (errorMsg.toLowerCase().includes("rate") || errorMsg.includes("429")) {
            // Rate limit - retry with exponential backoff
            rateLimitRetries++;
            if (rateLimitRetries <= RATE_LIMIT_MAX_RETRIES) {
              const delay = 1000 * Math.pow(2, rateLimitRetries - 1); // 1s, 2s, 4s
              console.warn(
                `🚫 Rate limited, retrying in ${delay}ms (attempt ${rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES})...`
              );
              await new Promise((r) => setTimeout(r, delay));
              iteration--; // Don't count this as an agentic iteration
              continue;
            }
            console.error(`🚫 Rate limited after ${RATE_LIMIT_MAX_RETRIES} retries: ${errorMsg}`);
            throw new Error(
              `API rate limited after ${RATE_LIMIT_MAX_RETRIES} retries. Please try again later.`
            );
          } else {
            // Other API error
            console.error(`🚨 API error: ${errorMsg}`);
            throw new Error(`API error: ${errorMsg || "Unknown error"}`);
          }
        }

        // Extract tool calls from response
        const toolCalls = response.message.content.filter((block) => block.type === "toolCall");

        // If no tool calls, we're done - LLM returned final text
        if (toolCalls.length === 0) {
          console.log(`✅ Agent finished (no more tool calls)`);
          finalResponse = response;
          break;
        }

        // Execute tool calls and collect results
        if (!this.toolRegistry || !toolContext) {
          console.error("⚠️ Cannot execute tools: registry or context missing");
          break;
        }

        console.log(`🔧 Executing ${toolCalls.length} tool call(s)`);

        // Add assistant message BEFORE tool results (correct order for pi-ai)
        context.messages.push(response.message);

        for (const block of toolCalls) {
          if (block.type !== "toolCall") continue;

          const fullContext: ToolContext = {
            ...toolContext,
            chatId,
            isGroup: isGroup ?? false,
          };

          // Execute the tool
          const result = await this.toolRegistry.execute(block, fullContext);

          console.log(`  ${block.name}: ${result.success ? "✓" : "✗"} ${result.error || ""}`);

          // Track tool calls for return value
          totalToolCalls.push({
            name: block.name,
            input: block.arguments,
          });

          // Serialize result with size limit to prevent context overflow
          let resultText = JSON.stringify(result, null, 2);
          if (resultText.length > MAX_TOOL_RESULT_SIZE) {
            console.warn(`⚠️ Tool result too large (${resultText.length} chars), truncating...`);
            // Try to preserve summary or message if it exists
            const data = result.data as Record<string, unknown> | undefined;
            if (data?.summary || data?.message) {
              resultText = JSON.stringify(
                {
                  success: result.success,
                  data: {
                    summary: data.summary || data.message,
                    _truncated: true,
                    _originalSize: resultText.length,
                    _message: "Full data truncated. Use limit parameter for smaller results.",
                  },
                },
                null,
                2
              );
            } else {
              resultText = resultText.slice(0, MAX_TOOL_RESULT_SIZE) + "\n...[TRUNCATED]";
            }
          }

          // Create ToolResultMessage and add to context
          const toolResultMsg: ToolResultMessage = {
            role: "toolResult",
            toolCallId: block.id,
            toolName: block.name,
            content: [
              {
                type: "text",
                text: resultText,
              },
            ],
            isError: !result.success,
            timestamp: Date.now(),
          };

          context.messages.push(toolResultMsg);

          // Persist tool result to transcript (ensures consistency)
          appendToTranscript(session.sessionId, toolResultMsg);
        }

        // If this was the last iteration, use this response
        if (iteration === maxIterations) {
          console.log(`⚠️ Max iterations reached (${maxIterations})`);
          finalResponse = response;
        }
      }

      // Use the final response
      const response = finalResponse!;

      // Check if auto-compaction is needed (using updated context from response)
      const newSessionId = await this.compactionManager.checkAndCompact(
        session.sessionId,
        response.context,
        this.config.agent.api_key,
        chatId,
        this.config.agent.provider as SupportedProvider,
        this.config.agent.utility_model
      );
      if (newSessionId) {
        // Update session to use new compacted session ID
        updateSession(chatId, {
          sessionId: newSessionId,
          updatedAt: Date.now(),
          messageCount: session.messageCount + 1,
          model: this.config.agent.model,
          provider: this.config.agent.provider,
        });
      } else {
        // Update session metadata normally
        updateSession(chatId, {
          updatedAt: Date.now(),
          messageCount: session.messageCount + 1,
          model: this.config.agent.model,
          provider: this.config.agent.provider,
        });
      }

      // Log usage if available
      const usage = response.message.usage;
      if (usage) {
        console.log(
          `💰 Usage: ${usage.input} in, ${usage.output} out, ${usage.cacheRead} cache read | Cost: $${usage.cost.total.toFixed(4)}`
        );
      }

      // Handle empty response
      let content = response.text;

      // Tools that send content to Telegram - no text response needed
      const telegramSendTools = [
        "telegram_send_message",
        "telegram_send_gif",
        "telegram_send_voice",
        "telegram_send_sticker",
        "telegram_send_document",
        "telegram_send_photo",
        "telegram_send_video",
        "telegram_send_poll",
        "telegram_forward_message",
        "telegram_reply_message",
        "deal_propose",
      ];

      // Check if any Telegram send tool was used
      const usedTelegramSendTool = totalToolCalls.some((tc) => telegramSendTools.includes(tc.name));

      if (!content && totalToolCalls.length > 0 && !usedTelegramSendTool) {
        // Only generate fallback if tools were used but NO Telegram send tool
        console.warn("⚠️ Empty response after tool calls - generating fallback");
        content =
          "I executed the requested action but couldn't generate a response. Please try again.";
      } else if (!content && usedTelegramSendTool) {
        // Agent already sent via tool - no additional response needed
        console.log("✅ Response sent via Telegram tool - no additional text needed");
        content = ""; // Empty is fine, handler will check for this
      } else if (!content && (!usage || (usage.input === 0 && usage.output === 0))) {
        // Only warn about zero tokens when response is ALSO empty - indicates real API issue
        console.warn("⚠️ Empty response with zero tokens - possible API issue");
        content = "I couldn't process your request. Please try again.";
      }

      return {
        content,
        toolCalls: totalToolCalls,
      };
    } catch (error) {
      console.error("Agent error:", error);
      throw error;
    }
  }

  /**
   * Clear conversation history for a chat (reset session)
   */
  clearHistory(chatId: string): void {
    const db = getDatabase().getDb();

    // Delete messages from main table
    db.prepare(`DELETE FROM tg_messages WHERE chat_id = ?`).run(chatId);

    // Delete from vector table
    db.prepare(
      `
      DELETE FROM tg_messages_vec
      WHERE id IN (
        SELECT id FROM tg_messages WHERE chat_id = ?
      )
    `
    ).run(chatId);

    // Delete from FTS
    db.prepare(
      `
      DELETE FROM tg_messages_fts
      WHERE rowid IN (
        SELECT rowid FROM tg_messages WHERE chat_id = ?
      )
    `
    ).run(chatId);

    // Reset session (creates new sessionId, deletes old transcript)
    resetSession(chatId);

    console.log(`🗑️  Cleared history for chat ${chatId}`);
  }

  /**
   * Get all active chat IDs
   */
  getConfig(): Config {
    return this.config;
  }

  getActiveChatIds(): string[] {
    const db = getDatabase().getDb();

    const rows = db
      .prepare(
        `
      SELECT DISTINCT chat_id
      FROM tg_messages
      ORDER BY timestamp DESC
    `
      )
      .all() as Array<{ chat_id: string }>;

    return rows.map((r) => r.chat_id);
  }

  /**
   * Update soul/personality
   */
  setSoul(soul: string): void {
    this.soul = soul;
  }

  /**
   * Configure auto-compaction settings
   */
  configureCompaction(config: {
    enabled?: boolean;
    maxMessages?: number;
    maxTokens?: number;
  }): void {
    this.compactionManager.updateConfig(config);
    console.log(`🗜️  Compaction config updated:`, this.compactionManager.getConfig());
  }

  /**
   * Get current compaction configuration
   */
  getCompactionConfig() {
    return this.compactionManager.getConfig();
  }

  /**
   * Get memory statistics (for agent awareness)
   */
  getMemoryStats(): { totalMessages: number; totalChats: number; knowledgeChunks: number } {
    const db = getDatabase().getDb();

    const msgCount = db.prepare(`SELECT COUNT(*) as count FROM tg_messages`).get() as {
      count: number;
    };
    const chatCount = db
      .prepare(`SELECT COUNT(DISTINCT chat_id) as count FROM tg_messages`)
      .get() as {
      count: number;
    };
    const knowledgeCount = db.prepare(`SELECT COUNT(*) as count FROM knowledge`).get() as {
      count: number;
    };

    return {
      totalMessages: msgCount.count,
      totalChats: chatCount.count,
      knowledgeChunks: knowledgeCount.count,
    };
  }
}
