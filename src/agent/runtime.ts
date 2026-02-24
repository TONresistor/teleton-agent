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
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import {
  chatWithContext,
  loadContextFromTranscript,
  getProviderModel,
  getEffectiveApiKey,
  type ChatResponse,
} from "./client.js";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { buildSystemPrompt } from "../soul/loader.js";
import { getDatabase } from "../memory/index.js";
import { sanitizeForContext } from "../utils/sanitize.js";
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
  Tool as PiAiTool,
  UserMessage,
  ToolResultMessage,
  TextContent,
  ToolCall,
} from "@mariozechner/pi-ai";
import { CompactionManager, DEFAULT_COMPACTION_CONFIG } from "../memory/compaction.js";
import { maskOldToolResults } from "../memory/observation-masking.js";
import { ContextBuilder } from "../memory/search/context.js";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolContext } from "./tools/types.js";
import { appendToDailyLog, writeSessionEndSummary } from "../memory/daily-logs.js";
import { saveSessionMemory } from "../session/memory-hook.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Agent");

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

function isTrivialMessage(text: string): boolean {
  const stripped = text.trim();
  if (stripped.length > 0 && !/[a-zA-Z0-9а-яА-ЯёЁ]/.test(stripped)) return true;
  const trivial =
    /^(ok|okay|k|oui|non|yes|no|yep|nope|sure|thanks|merci|thx|ty|lol|haha|cool|nice|wow|bravo|top|parfait|d'accord|alright|fine|got it|np|gg)\.?!?$/i;
  return trivial.test(stripped);
}

function extractContextSummary(context: Context, maxMessages: number = 10): string {
  const recentMessages = context.messages.slice(-maxMessages);
  const summaryParts: string[] = [];

  summaryParts.push("### Session Summary (Auto-saved before overflow reset)\n");

  for (const msg of recentMessages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "[complex]";
      const bodyMatch = content.match(/\] (.+)/s);
      const body = bodyMatch ? bodyMatch[1] : content;
      summaryParts.push(`- **User**: ${body.substring(0, 150)}${body.length > 150 ? "..." : ""}`);
    } else if (msg.role === "assistant") {
      const textBlocks = msg.content.filter((b): b is TextContent => b.type === "text");
      const toolBlocks = msg.content.filter((b): b is ToolCall => b.type === "toolCall");

      if (textBlocks.length > 0) {
        const text = textBlocks[0].text || "";
        summaryParts.push(
          `- **Agent**: ${text.substring(0, 150)}${text.length > 150 ? "..." : ""}`
        );
      }

      if (toolBlocks.length > 0) {
        const toolNames = toolBlocks.map((b) => b.name).join(", ");
        summaryParts.push(`  - *Tools used: ${toolNames}*`);
      }
    } else if (msg.role === "toolResult") {
      const status = msg.isError ? "ERROR" : "OK";
      summaryParts.push(`  - *Tool result: ${msg.toolName} → ${status}*`);
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
  private embedder: EmbeddingProvider | null = null;

  constructor(config: Config, soul?: string, toolRegistry?: ToolRegistry) {
    this.config = config;
    this.soul = soul ?? "";
    this.toolRegistry = toolRegistry ?? null;

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
      this.compactionManager = new CompactionManager(DEFAULT_COMPACTION_CONFIG);
    }
  }

  initializeContextBuilder(embedder: EmbeddingProvider, vectorEnabled: boolean): void {
    this.embedder = embedder;
    const db = getDatabase().getDb();
    this.contextBuilder = new ContextBuilder(db, embedder, vectorEnabled);
  }

  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

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
    messageId?: number,
    replyContext?: { senderName?: string; text: string; isAgent?: boolean }
  ): Promise<AgentResponse> {
    try {
      let session = getOrCreateSession(chatId);
      const now = timestamp ?? Date.now();

      const resetPolicy = this.config.agent.session_reset_policy;
      if (shouldResetSession(session, resetPolicy)) {
        log.info(`🔄 Auto-resetting session based on policy`);

        if (transcriptExists(session.sessionId)) {
          try {
            log.info(`💾 Saving memory before daily reset...`);
            const oldContext = loadContextFromTranscript(session.sessionId);

            await saveSessionMemory({
              oldSessionId: session.sessionId,
              newSessionId: "pending",
              context: oldContext,
              chatId,
              apiKey: getEffectiveApiKey(this.config.agent.provider, this.config.agent.api_key),
              provider: this.config.agent.provider as SupportedProvider,
              utilityModel: this.config.agent.utility_model,
            });

            log.info(`✅ Memory saved before reset`);
          } catch (error) {
            log.warn({ err: error }, `⚠️ Failed to save memory before reset`);
          }
        }

        session = resetSessionWithPolicy(chatId, resetPolicy);
      }

      let context: Context = loadContextFromTranscript(session.sessionId);
      if (context.messages.length > 0) {
        log.info(`📖 Loading existing session: ${session.sessionId}`);
      } else {
        log.info(`🆕 Starting new session: ${session.sessionId}`);
      }

      const previousTimestamp = session.updatedAt;

      let formattedMessage = formatMessageEnvelope({
        channel: "Telegram",
        senderId: toolContext?.senderId ? String(toolContext.senderId) : chatId,
        senderName: userName,
        senderUsername: senderUsername,
        timestamp: now,
        previousTimestamp,
        body: userMessage,
        isGroup: isGroup ?? false,
        hasMedia,
        mediaType,
        messageId,
        replyContext,
      });

      if (pendingContext) {
        formattedMessage = `${pendingContext}\n\n${formattedMessage}`;
        log.debug(`📋 Including ${pendingContext.split("\n").length - 1} pending messages`);
      }

      log.debug(`📨 Formatted message: ${formattedMessage.substring(0, 100)}...`);

      const preview = formattedMessage.slice(0, 50).replace(/\n/g, " ");
      const who = senderUsername ? `@${senderUsername}` : userName;
      const msgType = isGroup ? `Group ${chatId} ${who}` : `DM ${who}`;
      log.info(`📨 ${msgType}: "${preview}${formattedMessage.length > 50 ? "..." : ""}"`);

      let relevantContext = "";
      if (this.contextBuilder && !isTrivialMessage(userMessage)) {
        try {
          const dbContext = await this.contextBuilder.buildContext({
            query: userMessage,
            chatId,
            includeAgentMemory: true,
            includeFeedHistory: true,
            searchAllChats: !isGroup,
            maxRecentMessages: CONTEXT_MAX_RECENT_MESSAGES,
            maxRelevantChunks: CONTEXT_MAX_RELEVANT_CHUNKS,
          });

          const contextParts: string[] = [];

          if (dbContext.relevantKnowledge.length > 0) {
            const sanitizedKnowledge = dbContext.relevantKnowledge.map((chunk) =>
              sanitizeForContext(chunk)
            );
            contextParts.push(
              `[Relevant knowledge from memory]\n${sanitizedKnowledge.join("\n---\n")}`
            );
          }

          if (dbContext.relevantFeed.length > 0) {
            const sanitizedFeed = dbContext.relevantFeed.map((msg) => sanitizeForContext(msg));
            contextParts.push(
              `[Relevant messages from Telegram feed]\n${sanitizedFeed.join("\n")}`
            );
          }

          if (contextParts.length > 0) {
            relevantContext = contextParts.join("\n\n");
            log.debug(
              `🔍 Found ${dbContext.relevantKnowledge.length} knowledge chunks, ${dbContext.relevantFeed.length} feed messages`
            );
          }
        } catch (error) {
          log.warn({ err: error }, "Context building failed");
        }
      }

      const memoryStats = this.getMemoryStats();
      const statsContext = `[Memory Status: ${memoryStats.totalMessages} messages across ${memoryStats.totalChats} chats, ${memoryStats.knowledgeChunks} knowledge chunks]`;

      const additionalContext = relevantContext
        ? `You are in a Telegram conversation with chat ID: ${chatId}. Maintain conversation continuity.\n\n${statsContext}\n\n${relevantContext}`
        : `You are in a Telegram conversation with chat ID: ${chatId}. Maintain conversation continuity.\n\n${statsContext}`;

      const compactionConfig = this.compactionManager.getConfig();
      const needsMemoryFlush =
        compactionConfig.enabled &&
        compactionConfig.memoryFlushEnabled &&
        context.messages.length > Math.floor((compactionConfig.maxMessages ?? 200) * 0.75);

      const systemPrompt = buildSystemPrompt({
        soul: this.soul,
        userName,
        senderUsername,
        senderId: toolContext?.senderId,
        ownerName: this.config.telegram.owner_name,
        ownerUsername: this.config.telegram.owner_username,
        context: additionalContext,
        includeMemory: !isGroup,
        includeStrategy: !isGroup,
        memoryFlushWarning: needsMemoryFlush,
      });

      const userMsg: UserMessage = {
        role: "user",
        content: formattedMessage,
        timestamp: now,
      };

      context.messages.push(userMsg);

      const preemptiveCompaction = await this.compactionManager.checkAndCompact(
        session.sessionId,
        context,
        this.config.agent.api_key,
        chatId,
        this.config.agent.provider as SupportedProvider,
        this.config.agent.utility_model
      );
      if (preemptiveCompaction) {
        log.info(`🗜️  Preemptive compaction triggered, reloading session...`);
        session = getSession(chatId)!;
        context = loadContextFromTranscript(session.sessionId);
        context.messages.push(userMsg);
      }

      appendToTranscript(session.sessionId, userMsg);

      const provider = (this.config.agent.provider || "anthropic") as SupportedProvider;
      const providerMeta = getProviderMetadata(provider);
      const isAdmin =
        toolContext?.config?.telegram.admin_ids.includes(toolContext.senderId) ?? false;

      let tools: PiAiTool[] | undefined;
      {
        const toolIndex = this.toolRegistry?.getToolIndex();
        const useRAG =
          toolIndex?.isIndexed &&
          this.config.tool_rag?.enabled !== false &&
          !isTrivialMessage(userMessage) &&
          !(
            providerMeta.toolLimit === null &&
            this.config.tool_rag?.skip_unlimited_providers !== false
          );

        if (useRAG && this.toolRegistry && this.embedder) {
          const queryEmbedding = await this.embedder.embedQuery(userMessage);
          tools = await this.toolRegistry.getForContextWithRAG(
            userMessage,
            queryEmbedding,
            isGroup ?? false,
            providerMeta.toolLimit,
            chatId,
            isAdmin
          );
          log.info(`🔍 Tool RAG: ${tools.length}/${this.toolRegistry.count} tools selected`);
        } else {
          tools = this.toolRegistry?.getForContext(
            isGroup ?? false,
            providerMeta.toolLimit,
            chatId,
            isAdmin
          );
        }
      }

      const maxIterations = this.config.agent.max_agentic_iterations || 5;
      let iteration = 0;
      let overflowResets = 0;
      let rateLimitRetries = 0;
      let finalResponse: ChatResponse | null = null;
      const totalToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
      const accumulatedTexts: string[] = [];
      const accumulatedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0 };

      while (iteration < maxIterations) {
        iteration++;
        log.debug(`🔄 Agentic iteration ${iteration}/${maxIterations}`);

        const maskedMessages = maskOldToolResults(
          context.messages,
          undefined,
          this.toolRegistry ?? undefined
        );
        const maskedContext: Context = { ...context, messages: maskedMessages };

        const response: ChatResponse = await chatWithContext(this.config.agent, {
          systemPrompt,
          context: maskedContext,
          sessionId: session.sessionId,
          persistTranscript: true,
          tools,
        });

        const assistantMsg = response.message;
        if (assistantMsg.stopReason === "error") {
          const errorMsg = assistantMsg.errorMessage || "";

          if (isContextOverflowError(errorMsg)) {
            overflowResets++;
            if (overflowResets > 1) {
              throw new Error(
                "Context overflow persists after session reset. Message may be too large for the model's context window."
              );
            }
            log.error(`🚨 Context overflow detected: ${errorMsg}`);

            log.info(`💾 Saving session memory before reset...`);
            const summary = extractContextSummary(context, CONTEXT_OVERFLOW_SUMMARY_MESSAGES);
            appendToDailyLog(summary);
            log.info(`✅ Memory saved to daily log`);

            const archived = archiveTranscript(session.sessionId);
            if (!archived) {
              log.error(
                `⚠️  Failed to archive transcript ${session.sessionId}, proceeding with reset anyway`
              );
            }

            log.info(`🔄 Resetting session due to context overflow...`);
            session = resetSession(chatId);

            context = { messages: [userMsg] };

            appendToTranscript(session.sessionId, userMsg);

            log.info(`🔄 Retrying with fresh context...`);
            continue;
          } else if (errorMsg.toLowerCase().includes("rate") || errorMsg.includes("429")) {
            rateLimitRetries++;
            if (rateLimitRetries <= RATE_LIMIT_MAX_RETRIES) {
              const delay = 1000 * Math.pow(2, rateLimitRetries - 1);
              log.warn(
                `🚫 Rate limited, retrying in ${delay}ms (attempt ${rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES})...`
              );
              await new Promise((r) => setTimeout(r, delay));
              iteration--;
              continue;
            }
            log.error(`🚫 Rate limited after ${RATE_LIMIT_MAX_RETRIES} retries: ${errorMsg}`);
            throw new Error(
              `API rate limited after ${RATE_LIMIT_MAX_RETRIES} retries. Please try again later.`
            );
          } else {
            log.error(`🚨 API error: ${errorMsg}`);
            throw new Error(`API error: ${errorMsg || "Unknown error"}`);
          }
        }

        // Accumulate usage across all iterations
        const iterUsage = response.message.usage;
        if (iterUsage) {
          accumulatedUsage.input += iterUsage.input;
          accumulatedUsage.output += iterUsage.output;
          accumulatedUsage.cacheRead += iterUsage.cacheRead ?? 0;
          accumulatedUsage.cacheWrite += iterUsage.cacheWrite ?? 0;
          accumulatedUsage.totalCost += iterUsage.cost?.total ?? 0;
        }

        if (response.text) {
          accumulatedTexts.push(response.text);
        }

        const toolCalls = response.message.content.filter((block) => block.type === "toolCall");

        if (toolCalls.length === 0) {
          log.info(`🔄 ${iteration}/${maxIterations} → done`);
          finalResponse = response;
          break;
        }

        if (!this.toolRegistry || !toolContext) {
          log.error("⚠️ Cannot execute tools: registry or context missing");
          break;
        }

        log.debug(`🔧 Executing ${toolCalls.length} tool call(s)`);

        context.messages.push(response.message);

        const iterationToolNames: string[] = [];

        for (const block of toolCalls) {
          if (block.type !== "toolCall") continue;

          const fullContext: ToolContext = {
            ...toolContext,
            chatId,
            isGroup: isGroup ?? false,
          };

          const result = await this.toolRegistry.execute(block, fullContext);

          log.debug(`${block.name}: ${result.success ? "✓" : "✗"} ${result.error || ""}`);
          iterationToolNames.push(`${block.name} ${result.success ? "✓" : "✗"}`);

          totalToolCalls.push({
            name: block.name,
            input: block.arguments,
          });

          let resultText = JSON.stringify(result, null, 2);
          if (resultText.length > MAX_TOOL_RESULT_SIZE) {
            log.warn(`⚠️ Tool result too large (${resultText.length} chars), truncating...`);
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

          if (provider === "cocoon") {
            // Cocoon/Qwen3: tool results as <tool_response> in a user message
            const { wrapToolResult } = await import("../cocoon/tool-adapter.js");
            const cocoonResultMsg: UserMessage = {
              role: "user",
              content: [
                {
                  type: "text",
                  text: wrapToolResult(resultText),
                },
              ],
              timestamp: Date.now(),
            };
            context.messages.push(cocoonResultMsg);
            appendToTranscript(session.sessionId, cocoonResultMsg);
          } else {
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
            appendToTranscript(session.sessionId, toolResultMsg);
          }
        }

        log.info(`🔄 ${iteration}/${maxIterations} → ${iterationToolNames.join(", ")}`);

        if (iteration === maxIterations) {
          log.info(`⚠️ Max iterations reached (${maxIterations})`);
          finalResponse = response;
        }
      }

      if (!finalResponse) {
        log.error("⚠️ Agentic loop exited early without final response");
        return {
          content: "Internal error: Agent loop failed to produce a response.",
          toolCalls: [],
        };
      }

      const response = finalResponse;

      const lastMsg = context.messages[context.messages.length - 1];
      if (lastMsg?.role !== "assistant") {
        context.messages.push(response.message);
      }

      const newSessionId = await this.compactionManager.checkAndCompact(
        session.sessionId,
        context,
        this.config.agent.api_key,
        chatId,
        this.config.agent.provider as SupportedProvider,
        this.config.agent.utility_model
      );
      if (newSessionId) {
        updateSession(chatId, {
          sessionId: newSessionId,
          updatedAt: Date.now(),
          messageCount: session.messageCount + 1,
          model: this.config.agent.model,
          provider: this.config.agent.provider,
        });
      } else {
        updateSession(chatId, {
          updatedAt: Date.now(),
          messageCount: session.messageCount + 1,
          model: this.config.agent.model,
          provider: this.config.agent.provider,
        });
      }

      if (accumulatedUsage.input > 0 || accumulatedUsage.output > 0) {
        const u = accumulatedUsage;
        const totalInput = u.input + u.cacheRead + u.cacheWrite;
        const inK = (totalInput / 1000).toFixed(1);
        const cacheParts: string[] = [];
        if (u.cacheRead) cacheParts.push(`${(u.cacheRead / 1000).toFixed(1)}K cached`);
        if (u.cacheWrite) cacheParts.push(`${(u.cacheWrite / 1000).toFixed(1)}K new`);
        const cacheInfo = cacheParts.length > 0 ? ` (${cacheParts.join(", ")})` : "";
        log.info(`💰 ${inK}K in${cacheInfo}, ${u.output} out | $${u.totalCost.toFixed(3)}`);
      }

      let content = accumulatedTexts.join("\n").trim() || response.text;

      const usedTelegramSendTool = totalToolCalls.some((tc) => TELEGRAM_SEND_TOOLS.has(tc.name));

      if (!content && totalToolCalls.length > 0 && !usedTelegramSendTool) {
        log.warn("⚠️ Empty response after tool calls - generating fallback");
        content =
          "I executed the requested action but couldn't generate a response. Please try again.";
      } else if (!content && usedTelegramSendTool) {
        log.info("✅ Response sent via Telegram tool - no additional text needed");
        content = "";
      } else if (!content && accumulatedUsage.input === 0 && accumulatedUsage.output === 0) {
        log.warn("⚠️ Empty response with zero tokens - possible API issue");
        content = "I couldn't process your request. Please try again.";
      }

      return {
        content,
        toolCalls: totalToolCalls,
      };
    } catch (error) {
      log.error({ err: error }, "Agent error");
      throw error;
    }
  }

  clearHistory(chatId: string): void {
    const db = getDatabase().getDb();

    db.prepare(
      `DELETE FROM tg_messages_vec WHERE id IN (
        SELECT id FROM tg_messages WHERE chat_id = ?
      )`
    ).run(chatId);

    db.prepare(`DELETE FROM tg_messages WHERE chat_id = ?`).run(chatId);

    resetSession(chatId);

    log.info(`🗑️  Cleared history for chat ${chatId}`);
  }

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

  setSoul(soul: string): void {
    this.soul = soul;
  }

  configureCompaction(config: {
    enabled?: boolean;
    maxMessages?: number;
    maxTokens?: number;
  }): void {
    this.compactionManager.updateConfig(config);
    log.info({ config: this.compactionManager.getConfig() }, `🗜️  Compaction config updated`);
  }

  getCompactionConfig() {
    return this.compactionManager.getConfig();
  }

  private _memoryStatsCache: {
    data: { totalMessages: number; totalChats: number; knowledgeChunks: number };
    expiry: number;
  } | null = null;

  getMemoryStats(): { totalMessages: number; totalChats: number; knowledgeChunks: number } {
    const now = Date.now();
    if (this._memoryStatsCache && now < this._memoryStatsCache.expiry) {
      return this._memoryStatsCache.data;
    }

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

    const data = {
      totalMessages: msgCount.count,
      totalChats: chatCount.count,
      knowledgeChunks: knowledgeCount.count,
    };

    this._memoryStatsCache = { data, expiry: now + 5 * 60 * 1000 };
    return data;
  }
}
