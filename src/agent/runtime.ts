import type { Config } from "../config/schema.js";
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
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
  SERVER_ERROR_MAX_RETRIES,
  TOOL_CONCURRENCY_LIMIT,
  EMBEDDING_QUERY_MAX_CHARS,
} from "../constants/limits.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import {
  deliveredTelegramText,
  sentSuccessfullyToChat,
  type CompletedToolCall,
} from "./telegram-send-state.js";
import {
  chatWithContext,
  streamWithContext,
  loadContextFromTranscript,
  getProviderModel,
  getEffectiveApiKey,
  type ChatResponse,
} from "./client.js";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { buildSystemPrompt, captureMemorySnapshot, clearMemorySnapshot } from "../soul/loader.js";
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
import { transcriptExists, archiveTranscript, appendToTranscript } from "../session/transcript.js";
import type {
  Context,
  Tool as PiAiTool,
  UserMessage,
  ToolCall,
  AssistantMessage,
  Message,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { CompactionManager, DEFAULT_COMPACTION_CONFIG } from "../memory/compaction.js";
import { maskOldToolResults } from "../memory/observation-masking.js";
import { ContextBuilder } from "../memory/search/context.js";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolContext } from "./tools/types.js";
import { appendToDailyLog } from "../memory/daily-logs.js";
import { saveSessionMemory } from "../session/memory-hook.js";
import { createLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/errors.js";
import type { createHookRunner } from "../sdk/hooks/runner.js";
import type { UserHookEvaluator } from "./hooks/user-hook-evaluator.js";
import type {
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforePromptBuildEvent,
  MessageReceiveEvent,
  ResponseBeforeEvent,
  ResponseAfterEvent,
  ResponseErrorEvent,
  ToolErrorEvent,
  PromptAfterEvent,
} from "../sdk/hooks/types.js";
import {
  isTrivialMessage,
  extractContextSummary,
  parseRetryAfterMs,
  summarizeToolParams,
  enrichRAGQuery,
  classifyLlmError,
  addUsage,
} from "./runtime-utils.js";
import type { UsageAccumulator } from "./runtime-utils.js";
import { isBotBridge } from "../telegram/bridge-guards.js";
import { truncateToolResult } from "./tool-result-truncator.js";
import { accumulateTokenUsage } from "./token-usage.js";

export { isContextOverflowError, isTrivialMessage } from "./runtime-utils.js";
export { getTokenUsage } from "./token-usage.js";

const log = createLogger("Agent");

export interface ProcessMessageOptions {
  chatId: string;
  userMessage: string;
  userName?: string;
  timestamp?: number;
  isGroup?: boolean;
  pendingContext?: string | null;
  toolContext?: Omit<ToolContext, "chatId" | "isGroup">;
  senderUsername?: string;
  senderRank?: string;
  hasMedia?: boolean;
  mediaType?: string;
  messageId?: number;
  replyContext?: { senderName?: string; text: string; isAgent?: boolean };
  isHeartbeat?: boolean;
  isGuest?: boolean;
  streamToChat?: { chatId: string; bridge: ITelegramBridge; mode: "all" | "replace" | "off" };
}

export interface AgentResponse {
  content: string;
  toolCalls?: CompletedToolCall[];
  streamed?: boolean;
}

interface TurnContext {
  chatId: string;
  effectiveIsGroup: boolean;
  processStartTime: number;
  session: ReturnType<typeof getOrCreateSession>;
  context: Context;
  systemPrompt: string;
  tools: PiAiTool[] | undefined;
  userMsg: UserMessage;
  provider: SupportedProvider;
}

type TurnContextResult =
  | { kind: "ready"; turn: TurnContext }
  | { kind: "early"; response: AgentResponse };

interface LoopResult {
  finalResponse: ChatResponse | null;
  session: ReturnType<typeof getOrCreateSession>;
  context: Context;
  totalToolCalls: CompletedToolCall[];
  accumulatedTexts: string[];
  accumulatedUsage: UsageAccumulator;
  wasStreamed: boolean;
}

interface ToolPlan {
  block: ToolCall;
  blocked: boolean;
  blockReason: string;
  params: Record<string, unknown>;
}

interface ToolExecResult {
  result: { success: boolean; data?: unknown; error?: string };
  durationMs: number;
  execError?: { message: string; stack?: string };
}

export class AgentRuntime {
  private config: Config;
  private soul: string;
  private compactionManager: CompactionManager;
  private contextBuilder: ContextBuilder | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private embedder: EmbeddingProvider | null = null;
  private hookRunner?: ReturnType<typeof createHookRunner>;
  private userHookEvaluator?: UserHookEvaluator;

  constructor(config: Config, soul?: string, toolRegistry?: ToolRegistry) {
    this.config = config;
    this.soul = soul ?? "";
    this.toolRegistry = toolRegistry ?? null;

    if (this.toolRegistry && config.telegram?.allow_from?.length) {
      this.toolRegistry.setAllowFrom(config.telegram.allow_from);
    }

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

  setHookRunner(runner: ReturnType<typeof createHookRunner>): void {
    this.hookRunner = runner;
  }

  setUserHookEvaluator(evaluator: UserHookEvaluator): void {
    this.userHookEvaluator = evaluator;
  }

  initializeContextBuilder(embedder: EmbeddingProvider, vectorEnabled: boolean): void {
    this.embedder = embedder;
    this.toolRegistry?.setEmbedder(embedder);
    const db = getDatabase().getDb();
    this.contextBuilder = new ContextBuilder(db, embedder, vectorEnabled);
  }

  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  async processMessage(opts: ProcessMessageOptions): Promise<AgentResponse> {
    const processStartTime = Date.now();
    try {
      const built = await this.buildTurnContext(opts, processStartTime);
      if (built.kind === "early") return built.response;

      const loop = await this.runAgenticLoop(built.turn, opts);
      if (!loop.finalResponse) {
        log.error("Agentic loop exited early without final response");
        return {
          content: "Internal error: Agent loop failed to produce a response.",
          toolCalls: [],
        };
      }

      return await this.finalizeResponse(built.turn, loop, loop.finalResponse, opts);
    } catch (error) {
      log.error({ err: error }, "Agent error");
      throw error;
    }
  }

  /**
   * Compute the RAG query embedding for the turn, concurrently with other prep work.
   * Returns a pending embedding promise, or `undefined` when embedding is disabled or
   * the message is trivial — preserving the caller's concurrent Promise.all wiring.
   */
  private computeRagEmbedding(
    effectiveMessage: string,
    context: Context
  ): Promise<number[]> | undefined {
    const isNonTrivial = !isTrivialMessage(effectiveMessage);
    if (!this.embedder || !isNonTrivial) return undefined;

    return (async () => {
      let searchQuery = effectiveMessage;
      const recentUserMsgs = context.messages
        .filter((m) => m.role === "user" && typeof m.content === "string")
        .slice(-3)
        .map((m) => {
          const text = m.content as string;
          const bodyMatch = text.match(/\] (.+)/s);
          return (bodyMatch ? bodyMatch[1] : text).trim();
        })
        .filter((t) => t.length > 0);
      if (recentUserMsgs.length > 0) {
        searchQuery = recentUserMsgs.join(" ") + " " + effectiveMessage;
      }
      const enrichedQuery = enrichRAGQuery(searchQuery);
      if (enrichedQuery !== searchQuery) {
        log.debug({ original: searchQuery, enriched: enrichedQuery }, "RAG query enriched");
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded above
      return this.embedder!.embedQuery(enrichedQuery.slice(0, EMBEDDING_QUERY_MAX_CHARS));
    })();
  }

  /**
   * Select the tool set for the turn: ToolSearch core-only, RAG pre-selection (+ the
   * tool_search escape hatch), or the plain context-filtered set. The guest-mode filter
   * is applied by the caller, not here.
   */
  private async selectTools(
    effectiveMessage: string,
    effectiveIsGroup: boolean,
    chatId: string,
    isAdmin: boolean,
    senderId: number | undefined,
    toolLimit: number | null,
    queryEmbedding: number[] | undefined
  ): Promise<PiAiTool[] | undefined> {
    const toolIndex = this.toolRegistry?.getToolIndex();
    const useRAG =
      toolIndex?.isIndexed &&
      this.config.tool_rag?.enabled !== false &&
      !isTrivialMessage(effectiveMessage) &&
      !(toolLimit === null && this.config.tool_rag?.skip_unlimited_providers !== false);

    if (this.config.tool_search?.enabled && this.toolRegistry) {
      // ToolSearch mode: always start with core tools only.
      // The LLM discovers additional tools on demand via the tool_search meta-tool.
      const tools = this.toolRegistry.getCoreTools(effectiveIsGroup, chatId, isAdmin, senderId);
      log.info(
        `ToolSearch: ${tools.length} core tools (${this.toolRegistry.count} total available)`
      );
      return tools;
    } else if (useRAG && this.toolRegistry && queryEmbedding) {
      const tools = await this.toolRegistry.getForContextWithRAG(
        effectiveMessage,
        queryEmbedding,
        effectiveIsGroup,
        toolLimit,
        chatId,
        isAdmin,
        senderId
      );
      // Hybrid: always offer the tool_search escape hatch so the agent can discover
      // tools the RAG pre-selection missed (the mid-loop injection handles results).
      const searchTool = this.toolRegistry.getAll().find((t) => t.name === "tool_search");
      if (searchTool && !tools.some((t) => t.name === "tool_search")) {
        tools.push(searchTool);
      }
      log.info(`Tool RAG: ${tools.length}/${this.toolRegistry.count} tools selected`);
      log.debug(`Tool RAG selected: ${tools.map((t) => t.name).join(", ")}`);
      return tools;
    } else {
      return this.toolRegistry?.getForContext(
        effectiveIsGroup,
        toolLimit,
        chatId,
        isAdmin,
        senderId
      );
    }
  }

  private async buildTurnContext(
    opts: ProcessMessageOptions,
    processStartTime: number
  ): Promise<TurnContextResult> {
    const {
      chatId,
      userMessage,
      userName,
      timestamp,
      isGroup,
      pendingContext,
      toolContext,
      senderUsername,
      senderRank,
      hasMedia,
      mediaType,
      messageId,
      replyContext,
      isHeartbeat,
    } = opts;

    const effectiveIsGroup = isGroup ?? false;

    // User hooks: keyword blocklist + context injection (hot-reloadable, no restart)
    let userHookContext = "";
    if (this.userHookEvaluator) {
      const hookResult = this.userHookEvaluator.evaluate(userMessage);
      if (hookResult.blocked) {
        log.info("Message blocked by keyword filter");
        return {
          kind: "early",
          response: { content: hookResult.blockMessage ?? "", toolCalls: [] },
        };
      }
      if (hookResult.additionalContext) {
        userHookContext = sanitizeForContext(hookResult.additionalContext);
      }
    }

    // Hook: message:receive — plugins can block, mutate text, inject context
    let effectiveMessage = userMessage;
    let hookMessageContext = "";
    if (this.hookRunner) {
      const msgEvent: MessageReceiveEvent = {
        chatId,
        senderId: toolContext?.senderId ? String(toolContext.senderId) : chatId,
        senderName: userName ?? "",
        isGroup: effectiveIsGroup,
        isReply: !!replyContext,
        replyToMessageId: replyContext ? messageId : undefined,
        messageId: messageId ?? 0,
        timestamp: timestamp ?? Date.now(),
        text: userMessage,
        block: false,
        blockReason: "",
        additionalContext: "",
      };
      await this.hookRunner.runModifyingHook("message:receive", msgEvent);
      if (msgEvent.block) {
        log.info(`Message blocked by hook: ${msgEvent.blockReason || "no reason"}`);
        return { kind: "early", response: { content: "", toolCalls: [] } };
      }
      effectiveMessage = sanitizeForContext(msgEvent.text);
      if (msgEvent.additionalContext) {
        hookMessageContext = sanitizeForContext(msgEvent.additionalContext);
      }
    }

    let session = getOrCreateSession(chatId);
    const now = timestamp ?? Date.now();

    const resetPolicy = this.config.agent.session_reset_policy;
    if (shouldResetSession(session, resetPolicy)) {
      log.info(`Auto-resetting session based on policy`);

      // Hook: session:end (before reset)
      if (this.hookRunner) {
        await this.hookRunner.runObservingHook("session:end", {
          sessionId: session.sessionId,
          chatId,
          messageCount: session.messageCount,
        });
      }

      if (transcriptExists(session.sessionId)) {
        try {
          log.info(`Saving memory before daily reset...`);
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

          log.info(`Memory saved before reset`);
        } catch (error) {
          log.warn({ err: error }, `Failed to save memory before reset`);
        }
      }

      session = resetSessionWithPolicy(chatId);
      clearMemorySnapshot(); // New session will capture a fresh snapshot
    }

    let context: Context = loadContextFromTranscript(session.sessionId);
    const isNewSession = context.messages.length === 0;
    if (!isNewSession) {
      log.info(`Loading existing session: ${session.sessionId}`);
    } else {
      log.info(`Starting new session: ${session.sessionId}`);
      // Capture a frozen memory snapshot for this session's lifetime.
      // Subsequent writes update the disk file but NOT the system prompt,
      // preserving the Anthropic prefix cache across all turns.
      captureMemorySnapshot();
    }

    // Hook: session:start — fire concurrently with message formatting + embedding
    const sessionStartPromise = this.hookRunner
      ? this.hookRunner
          .runObservingHook("session:start", {
            sessionId: session.sessionId,
            chatId,
            isResume: !isNewSession,
          })
          .catch((err) => log.warn({ err }, "session:start hook failed"))
      : undefined;

    const previousTimestamp = session.updatedAt;

    let formattedMessage = formatMessageEnvelope({
      channel: "Telegram",
      senderId: toolContext?.senderId ? String(toolContext.senderId) : chatId,
      senderName: userName,
      senderUsername: senderUsername,
      senderRank,
      timestamp: now,
      previousTimestamp,
      body: effectiveMessage,
      isGroup: effectiveIsGroup,
      hasMedia,
      mediaType,
      messageId,
      replyContext,
    });

    if (pendingContext) {
      formattedMessage = `${pendingContext}\n\n${formattedMessage}`;
      log.debug(`Including ${pendingContext.split("\n").length - 1} pending messages`);
    }

    log.debug(`Formatted message: ${formattedMessage.substring(0, 100)}...`);

    const preview = formattedMessage.slice(0, 50).replace(/\n/g, " ");
    const who = senderUsername ? `@${senderUsername}` : userName;
    const msgType = isGroup ? `Group ${chatId} ${who}` : `DM ${who}`;
    log.info(`${msgType}: "${preview}${formattedMessage.length > 50 ? "..." : ""}"`);

    let relevantContext = "";
    const isNonTrivial = !isTrivialMessage(effectiveMessage);

    // Start embedding computation concurrently with session:start hook
    const embeddingPromise = this.computeRagEmbedding(effectiveMessage, context);

    // Await both session:start and embedding in parallel
    const [, embeddingResult] = await Promise.all([
      sessionStartPromise,
      embeddingPromise?.catch((error) => {
        log.warn({ err: error }, "Embedding computation failed");
        return undefined;
      }),
    ]);
    const queryEmbedding = embeddingResult ?? undefined;

    // Run buildContext and prompt:before hook in parallel (they are independent)
    const contextPromise =
      this.contextBuilder && isNonTrivial
        ? this.contextBuilder
            .buildContext({
              query: effectiveMessage,
              chatId,
              includeAgentMemory: true,
              includeFeedHistory: true,
              searchAllChats: !isGroup,
              maxRecentMessages: CONTEXT_MAX_RECENT_MESSAGES,
              maxRelevantChunks: CONTEXT_MAX_RELEVANT_CHUNKS,
              queryEmbedding,
            })
            .catch((error) => {
              log.warn({ err: error }, "Context building failed");
              return null;
            })
        : Promise.resolve(null);

    const promptBeforePromise = this.hookRunner
      ? (async () => {
          const promptEvent: BeforePromptBuildEvent = {
            chatId,
            sessionId: session.sessionId,
            isGroup: effectiveIsGroup,
            additionalContext: "",
          };
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by ternary
          await this.hookRunner!.runModifyingHook("prompt:before", promptEvent);
          return sanitizeForContext(promptEvent.additionalContext);
        })()
      : Promise.resolve("");

    const [dbContext, hookAdditionalContext] = await Promise.all([
      contextPromise,
      promptBeforePromise,
    ]);

    if (dbContext) {
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
        contextParts.push(`[Relevant messages from Telegram feed]\n${sanitizedFeed.join("\n")}`);
      }

      if (contextParts.length > 0) {
        relevantContext = contextParts.join("\n\n");
        log.debug(
          `🔍 Found ${dbContext.relevantKnowledge.length} knowledge chunks, ${dbContext.relevantFeed.length} feed messages`
        );
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

    const allHookContext = [userHookContext, hookAdditionalContext, hookMessageContext]
      .filter(Boolean)
      .join("\n\n");
    const finalContext = additionalContext + (allHookContext ? `\n\n${allHookContext}` : "");

    const systemPrompt = buildSystemPrompt({
      soul: this.soul,
      userName,
      senderUsername,
      senderId: toolContext?.senderId,
      ownerName: this.config.telegram.owner_name,
      ownerUsername: this.config.telegram.owner_username,
      context: finalContext,
      includeMemory: !effectiveIsGroup,
      includeStrategy: !effectiveIsGroup,
      memoryFlushWarning: needsMemoryFlush,
      isHeartbeat,
      agentModel: this.config.agent.model,
      telegramMode: this.config.telegram.mode,
    });

    // Hook: prompt:after — observing, analytics on prompt size
    if (this.hookRunner) {
      const promptAfterEvent: PromptAfterEvent = {
        chatId,
        sessionId: session.sessionId,
        isGroup: effectiveIsGroup,
        promptLength: systemPrompt.length,
        sectionCount: (systemPrompt.match(/^#{1,3} /gm) || []).length,
        ragContextLength: relevantContext.length,
        hookContextLength: allHookContext.length,
      };
      await this.hookRunner.runObservingHook("prompt:after", promptAfterEvent);
    }

    const userMsg: UserMessage = {
      role: "user",
      content: formattedMessage,
      timestamp: now,
    };

    context.messages.push(userMsg);

    const preemptiveCompaction = await this.compactionManager.checkAndCompact(
      session.sessionId,
      context,
      getEffectiveApiKey(this.config.agent.provider, this.config.agent.api_key),
      chatId,
      this.config.agent.provider as SupportedProvider,
      this.config.agent.utility_model
    );
    if (preemptiveCompaction) {
      log.info(`Preemptive compaction triggered, reloading session...`);
      updateSession(chatId, { sessionId: preemptiveCompaction });
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- session guaranteed to exist after compaction
      session = getSession(chatId)!;
      context = loadContextFromTranscript(session.sessionId);
      context.messages.push(userMsg);
      captureMemorySnapshot(); // Refresh snapshot for the new compacted session
    }

    appendToTranscript(session.sessionId, userMsg);

    const provider = (this.config.agent.provider || "anthropic") as SupportedProvider;
    const providerMeta = getProviderMetadata(provider);
    const isAdmin = toolContext?.config?.telegram.admin_ids.includes(toolContext.senderId) ?? false;

    let tools = await this.selectTools(
      effectiveMessage,
      effectiveIsGroup,
      chatId,
      isAdmin,
      toolContext?.senderId,
      providerMeta.toolLimit,
      queryEmbedding
    );

    if (opts.isGuest && tools) {
      tools = tools.filter((t) => !TELEGRAM_SEND_TOOLS.has(t.name));
    }

    return {
      kind: "ready",
      turn: {
        chatId,
        effectiveIsGroup,
        processStartTime,
        session,
        context,
        systemPrompt,
        tools,
        userMsg,
        provider,
      },
    };
  }

  /**
   * Run a single LLM iteration, streaming the draft to a bot bridge when enabled.
   * Encapsulates the reset/stream/clear-draft + "all"-mode prefix bookkeeping.
   * `streamAccumulatedText` is threaded in and out so the loop keeps cross-iteration
   * text for "all" mode. Returns whether the response was produced via the stream path.
   */
  private async streamIteration(
    opts: ProcessMessageOptions,
    maskedContext: Context,
    systemPrompt: string,
    sessionId: string,
    tools: PiAiTool[] | undefined,
    streamAccumulatedText: string
  ): Promise<{ response: ChatResponse; streamed: boolean; streamAccumulatedText: string }> {
    const streamMode = opts.streamToChat?.mode;
    const shouldStream =
      opts.streamToChat?.bridge.streamResponse && streamMode !== undefined && streamMode !== "off";

    if (!shouldStream) {
      const response = await chatWithContext(this.config.agent, {
        systemPrompt,
        context: maskedContext,
        sessionId,
        persistTranscript: true,
        tools,
      });
      return { response, streamed: false, streamAccumulatedText };
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by shouldStream check
    const bridge = opts.streamToChat!.bridge;
    if (!isBotBridge(bridge)) {
      const response = await chatWithContext(this.config.agent, {
        systemPrompt,
        context: maskedContext,
        sessionId,
        persistTranscript: true,
        tools,
      });
      return { response, streamed: true, streamAccumulatedText };
    }

    if (streamMode === "replace") {
      // Reset draft for each iteration (new draft bubble)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by shouldStream
      bridge.resetDraft(opts.streamToChat!.chatId);
      streamAccumulatedText = "";
    }

    const { textStream, result } = streamWithContext(this.config.agent, {
      systemPrompt,
      context: maskedContext,
      sessionId,
      persistTranscript: true,
      tools,
    });

    // "all" mode: prepend accumulated text from previous iterations
    const prefix = streamMode === "all" ? streamAccumulatedText : "";
    async function* prefixedStream(): AsyncIterable<string> {
      let first = true;
      for await (const chunk of textStream) {
        if (first && prefix) {
          yield prefix + chunk;
          first = false;
        } else {
          yield chunk;
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by shouldStream check
    const draftText = await bridge.streamDraft(opts.streamToChat!.chatId, prefixedStream());
    if (streamMode === "all") {
      if (draftText.length === 0 && streamAccumulatedText.length > 0) {
        // LLM produced only tool calls — clear the stale draft bubble
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by shouldStream
        await bridge.clearDraft(opts.streamToChat!.chatId);
      }
      streamAccumulatedText = draftText + "\n\n";
    }

    const response = await result;
    return { response, streamed: true, streamAccumulatedText };
  }

  /**
   * Handle an LLM error response: fire the response:error hook, then classify and
   * recover. Context-overflow resets the session (returning the fresh session/context);
   * rate-limit and server errors back off. Mutates the `retry` counters. Throws on the
   * terminal cases (persistent overflow, retries exhausted, unknown error). When it
   * returns, the caller must `iteration--; continue` — every non-throw path is a retry.
   */
  private async handleLlmError(
    assistantMsg: AssistantMessage,
    retry: { overflowResets: number; rateLimitRetries: number; serverErrorRetries: number },
    ctx: {
      session: ReturnType<typeof getOrCreateSession>;
      context: Context;
      chatId: string;
      effectiveIsGroup: boolean;
      provider: SupportedProvider;
      processStartTime: number;
      userMsg: UserMessage;
    }
  ): Promise<{ session: ReturnType<typeof getOrCreateSession>; context: Context }> {
    let session = ctx.session;
    let context = ctx.context;
    const errorMsg = assistantMsg.errorMessage || "";
    const errorClass = classifyLlmError(errorMsg);

    // Hook: response:error — fire on all LLM errors
    if (this.hookRunner) {
      const errorCode = errorClass.code;
      const responseErrorEvent: ResponseErrorEvent = {
        chatId: ctx.chatId,
        sessionId: session.sessionId,
        isGroup: ctx.effectiveIsGroup,
        error: errorMsg,
        errorCode,
        provider: ctx.provider,
        model: this.config.agent.model,
        retryCount: retry.rateLimitRetries + retry.serverErrorRetries,
        durationMs: Date.now() - ctx.processStartTime,
      };
      await this.hookRunner.runObservingHook("response:error", responseErrorEvent);
    }

    if (errorClass.kind === "context_overflow") {
      retry.overflowResets++;
      if (retry.overflowResets > 1) {
        throw new Error(
          "Context overflow persists after session reset. Message may be too large for the model's context window."
        );
      }
      log.error(`Context overflow detected: ${errorMsg}`);

      log.info(`Saving session memory before reset...`);
      const summary = extractContextSummary(context, CONTEXT_OVERFLOW_SUMMARY_MESSAGES);
      appendToDailyLog(summary);
      log.info(`Memory saved to daily log`);

      const archived = archiveTranscript(session.sessionId);
      if (!archived) {
        log.error(
          `Failed to archive transcript ${session.sessionId}, proceeding with reset anyway`
        );
      }

      log.info(`Resetting session due to context overflow...`);
      session = resetSession(ctx.chatId);

      context = { messages: [ctx.userMsg] };

      appendToTranscript(session.sessionId, ctx.userMsg);

      log.info(`Retrying with fresh context...`);
      return { session, context };
    } else if (errorClass.kind === "rate_limit") {
      retry.rateLimitRetries++;
      if (retry.rateLimitRetries <= RATE_LIMIT_MAX_RETRIES) {
        // Respect server Retry-After as a floor; else exponential backoff. Positive jitter de-syncs retries.
        const base = parseRetryAfterMs(errorMsg) ?? 1000 * Math.pow(2, retry.rateLimitRetries - 1);
        const delay = base + Math.floor(Math.random() * 500);
        log.warn(
          `Rate limited, retrying in ${delay}ms (attempt ${retry.rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES})...`
        );
        await new Promise((r) => setTimeout(r, delay));
        return { session, context };
      }
      log.error(`Rate limited after ${RATE_LIMIT_MAX_RETRIES} retries: ${errorMsg}`);
      throw new Error(
        `API rate limited after ${RATE_LIMIT_MAX_RETRIES} retries. Please try again later.`
      );
    } else if (errorClass.kind === "server_error") {
      retry.serverErrorRetries++;
      if (retry.serverErrorRetries <= SERVER_ERROR_MAX_RETRIES) {
        const delay =
          2000 * Math.pow(2, retry.serverErrorRetries - 1) + Math.floor(Math.random() * 500);
        log.warn(
          `Server error, retrying in ${delay}ms (attempt ${retry.serverErrorRetries}/${SERVER_ERROR_MAX_RETRIES})...`
        );
        await new Promise((r) => setTimeout(r, delay));
        return { session, context };
      }
      log.error(`Server error after ${SERVER_ERROR_MAX_RETRIES} retries: ${errorMsg}`);
      throw new Error(
        `API server error after ${SERVER_ERROR_MAX_RETRIES} retries. The provider may be experiencing issues.`
      );
    } else {
      log.error(`API error: ${errorMsg}`);
      throw new Error(`API error: ${errorMsg || "Unknown error"}`);
    }
  }

  /**
   * Phases 1-2 of a tool batch: run tool:before hooks sequentially to build the plans,
   * then execute the (non-blocked) tools with a bounded concurrency pool. Returns the
   * plans and their results in original order.
   */
  private async executeToolBatch(
    toolCalls: ToolCall[],
    fullContext: ToolContext,
    chatId: string,
    effectiveIsGroup: boolean
  ): Promise<{ toolPlans: ToolPlan[]; execResults: ToolExecResult[] }> {
    // Phase 1: Run tool:before hooks sequentially (hooks may cross-reference)
    const toolPlans: ToolPlan[] = [];

    for (const block of toolCalls) {
      if (block.type !== "toolCall") continue;

      let toolParams = (block.arguments ?? {}) as Record<string, unknown>;
      let blocked = false;
      let blockReason = "";

      if (this.hookRunner) {
        const beforeEvent: BeforeToolCallEvent = {
          toolName: block.name,
          params: structuredClone(toolParams),
          chatId,
          isGroup: effectiveIsGroup,
          block: false,
          blockReason: "",
        };
        await this.hookRunner.runModifyingHook("tool:before", beforeEvent);
        if (beforeEvent.block) {
          blocked = true;
          blockReason = beforeEvent.blockReason || "Blocked by plugin hook";
        } else {
          toolParams = structuredClone(beforeEvent.params) as Record<string, unknown>;
        }
      }

      toolPlans.push({ block, blocked, blockReason, params: toolParams });
    }

    // Phase 2: Execute tools with concurrency limit (blocked tools resolve instantly)
    const execResults: ToolExecResult[] = new Array(toolPlans.length);
    {
      let cursor = 0;
      const runWorker = async (): Promise<void> => {
        while (cursor < toolPlans.length) {
          const idx = cursor++;
          const plan = toolPlans[idx];

          if (plan.blocked) {
            execResults[idx] = {
              result: { success: false, error: plan.blockReason },
              durationMs: 0,
            };
            continue;
          }

          const startTime = Date.now();
          try {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- registry checked by caller
            const result = await this.toolRegistry!.execute(
              { ...plan.block, arguments: plan.params },
              fullContext
            );
            execResults[idx] = { result, durationMs: Date.now() - startTime };
          } catch (execErr) {
            const errMsg = getErrorMessage(execErr);
            const errStack = execErr instanceof Error ? execErr.stack : undefined;
            execResults[idx] = {
              result: { success: false, error: errMsg },
              durationMs: Date.now() - startTime,
              execError: { message: errMsg, stack: errStack },
            };
          }
        }
      };
      const workers = Math.min(TOOL_CONCURRENCY_LIMIT, toolPlans.length);
      await Promise.all(Array.from({ length: workers }, () => runWorker()));
    }

    return { toolPlans, execResults };
  }

  /**
   * Phase 3 of a tool batch: fire tool:error/tool:after observing hooks, log + record
   * each call, and build the tool-result messages (appending them to the transcript).
   * Mutates the passed `totalToolCalls`/`iterationToolNames` sinks and returns the
   * ordered result messages for the caller to push onto the live context.
   */
  private async recordToolResults(
    toolPlans: ToolPlan[],
    execResults: ToolExecResult[],
    sink: {
      totalToolCalls: CompletedToolCall[];
      iterationToolNames: string[];
      sessionId: string;
      chatId: string;
      effectiveIsGroup: boolean;
      provider: SupportedProvider;
    }
  ): Promise<Message[]> {
    const resultMessages: Message[] = [];
    const observingHookPromises: Promise<void>[] = [];

    for (let i = 0; i < toolPlans.length; i++) {
      const plan = toolPlans[i];
      const { block } = plan;
      const exec = execResults[i];

      // Hook: tool:error (if execution threw) — fire-and-forget (observing)
      if (exec.execError && this.hookRunner) {
        const errorEvent: ToolErrorEvent = {
          toolName: block.name,
          params: structuredClone(plan.params),
          error: exec.execError.message,
          stack: exec.execError.stack,
          chatId: sink.chatId,
          isGroup: sink.effectiveIsGroup,
          durationMs: exec.durationMs,
        };
        observingHookPromises.push(this.hookRunner.runObservingHook("tool:error", errorEvent));
      }

      // Hook: tool:after (fires for all cases including blocks) — fire-and-forget (observing)
      if (this.hookRunner) {
        const afterEvent: AfterToolCallEvent = {
          toolName: block.name,
          params: structuredClone(plan.params),
          result: {
            success: exec.result.success,
            data: exec.result.data,
            error: exec.result.error,
          },
          durationMs: exec.durationMs,
          chatId: sink.chatId,
          isGroup: sink.effectiveIsGroup,
          ...(plan.blocked ? { blocked: true, blockReason: plan.blockReason } : {}),
        };
        observingHookPromises.push(this.hookRunner.runObservingHook("tool:after", afterEvent));
      }

      const toolHint = summarizeToolParams(block.name, plan.params);
      log.debug(`${block.name}: ${exec.result.success ? "✓" : "✗"} ${exec.result.error || ""}`);
      sink.iterationToolNames.push(`${block.name}${toolHint} ${exec.result.success ? "✓" : "✗"}`);

      sink.totalToolCalls.push({
        name: block.name,
        input: plan.params,
        result: {
          success: exec.result.success,
          data: exec.result.data,
          error: exec.result.error,
        },
      });

      const resultText = truncateToolResult(exec.result, MAX_TOOL_RESULT_SIZE);
      if (resultText.includes('"_truncated":true')) {
        log.warn(`Tool result too large, truncated to ${resultText.length} chars`);
      }

      const resultMsg: ToolResultMessage = {
        role: "toolResult",
        toolCallId: block.id,
        toolName: block.name,
        content: [{ type: "text", text: resultText }],
        isError: !exec.result.success,
        timestamp: Date.now(),
      };
      resultMessages.push(resultMsg);
      appendToTranscript(sink.sessionId, resultMsg);
    }

    // Await all observing hooks from Phase 3 (non-blocking during result processing)
    if (observingHookPromises.length > 0) {
      await Promise.allSettled(observingHookPromises);
    }

    return resultMessages;
  }

  /**
   * Whether this iteration's tool batch was fully seen before (every name+sorted-args
   * signature already in `seen`). Records the new signatures into `seen`. The caller
   * tracks how many consecutive stalls have occurred.
   */
  private detectStall(toolPlans: ToolPlan[], seen: Set<string>): boolean {
    const iterSignatures = toolPlans.map(
      (p) => `${p.block.name}:${JSON.stringify(p.params, Object.keys(p.params).sort())}`
    );
    const allDuplicates = iterSignatures.length > 0 && iterSignatures.every((sig) => seen.has(sig));
    for (const sig of iterSignatures) seen.add(sig);
    return allDuplicates;
  }

  private async runAgenticLoop(
    turn: TurnContext,
    opts: ProcessMessageOptions
  ): Promise<LoopResult> {
    const { chatId, effectiveIsGroup, processStartTime, systemPrompt, tools, userMsg, provider } =
      turn;
    const { toolContext } = opts;
    let session = turn.session;
    let context = turn.context;

    const maxIterations = Math.max(1, this.config.agent.max_agentic_iterations || 5);
    let iteration = 0;
    const retry = { overflowResets: 0, rateLimitRetries: 0, serverErrorRetries: 0 };
    let finalResponse: ChatResponse | null = null;
    const totalToolCalls: CompletedToolCall[] = [];
    const accumulatedTexts: string[] = [];
    const accumulatedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0 };
    const seenToolSignatures = new Set<string>();
    let consecutiveStalls = 0;
    let wasStreamed = false;
    let streamAccumulatedText = ""; // For "all" mode: concatenate text across iterations

    while (iteration < maxIterations) {
      iteration++;
      log.debug(`Agentic iteration ${iteration}/${maxIterations}`);

      // Track where current iteration starts so masking won't truncate its results
      const iterationStartIndex = context.messages.length;

      const maskedMessages = maskOldToolResults(context.messages, {
        toolRegistry: this.toolRegistry ?? undefined,
        currentIterationStartIndex: iterationStartIndex,
      });
      const maskedContext: Context = { ...context, messages: maskedMessages };

      const iterationResult = await this.streamIteration(
        opts,
        maskedContext,
        systemPrompt,
        session.sessionId,
        tools,
        streamAccumulatedText
      );
      const response = iterationResult.response;
      const streamed = iterationResult.streamed;
      streamAccumulatedText = iterationResult.streamAccumulatedText;

      const assistantMsg = response.message;

      // Accumulate usage across all iterations — including errored responses that
      // get retried, so cost metrics capture tokens spent on failed attempts too.
      const iterUsage = response.message.usage;
      if (iterUsage) {
        addUsage(accumulatedUsage, iterUsage);
      }

      if (assistantMsg.stopReason === "error") {
        // Recover from LLM errors (overflow reset / rate-limit / server backoff) or throw
        // on terminal cases. When it returns, this is a retry that must not consume budget.
        const recovered = await this.handleLlmError(assistantMsg, retry, {
          session,
          context,
          chatId,
          effectiveIsGroup,
          provider,
          processStartTime,
          userMsg,
        });
        session = recovered.session;
        context = recovered.context;
        iteration--; // recovery retry, not a productive iteration — don't consume the budget
        continue;
      }

      if (response.text) {
        accumulatedTexts.push(response.text);
      }

      const toolCalls = response.message.content.filter((block) => block.type === "toolCall");

      if (toolCalls.length === 0) {
        log.info(`${iteration}/${maxIterations} → done`);
        finalResponse = response;
        wasStreamed = streamed;
        break;
      }

      if (!this.toolRegistry || !toolContext) {
        log.error("Cannot execute tools: registry or context missing");
        break;
      }

      log.debug(`Executing ${toolCalls.length} tool call(s)`);

      context.messages.push(response.message);

      const iterationToolNames: string[] = [];

      const fullContext: ToolContext = {
        ...toolContext,
        chatId,
        isGroup: effectiveIsGroup,
      };

      // Phases 1-2: build the tool plans (tool:before hooks) and execute them.
      const { toolPlans, execResults } = await this.executeToolBatch(
        toolCalls,
        fullContext,
        chatId,
        effectiveIsGroup
      );

      // Phase 3: record results + observing hooks; push the returned messages in order.
      const resultMessages = await this.recordToolResults(toolPlans, execResults, {
        totalToolCalls,
        iterationToolNames,
        sessionId: session.sessionId,
        chatId,
        effectiveIsGroup,
        provider,
      });
      for (const resultMsg of resultMessages) {
        context.messages.push(resultMsg);
      }

      // Mid-loop tool injection: when tool_search returns discoveries, inject schemas
      // into the live tools[] so the LLM can call them in the next iteration (D4).
      // Runs whenever tools exist (ToolSearch mode AND the RAG hybrid escape hatch);
      // it's a no-op unless a tool_search call actually returned results.
      if (tools) {
        let injected = 0;
        for (let i = 0; i < toolPlans.length; i++) {
          const plan = toolPlans[i];
          const exec = execResults[i];
          if (
            plan.block.name === "tool_search" &&
            exec.result.success &&
            exec.result.data &&
            typeof exec.result.data === "object" &&
            "tools" in exec.result.data
          ) {
            const discovered = (exec.result.data as { tools: PiAiTool[] }).tools;
            if (Array.isArray(discovered)) {
              for (const t of discovered) {
                if (t?.name && !tools.some((existing) => existing.name === t.name)) {
                  tools.push(t);
                  injected++;
                }
              }
            }
          }
        }
        if (injected > 0) {
          log.info(`ToolSearch: injected ${injected} tool(s) mid-loop (total: ${tools.length})`);
        }
      }

      log.info(`${iteration}/${maxIterations} → ${iterationToolNames.join(", ")}`);

      // Stall detection: break only after 2 *consecutive* iterations where every tool
      // call (name + sorted args) was already seen — a single fully-repeated batch can
      // be a legitimate step (e.g. re-checking), so give the model a chance to recover.
      const allDuplicates = this.detectStall(toolPlans, seenToolSignatures);

      consecutiveStalls = allDuplicates ? consecutiveStalls + 1 : 0;
      if (consecutiveStalls >= 2) {
        log.warn(
          `Loop stall detected: ${consecutiveStalls} consecutive fully-repeated iterations — breaking early`
        );
        finalResponse = response;
        break;
      }

      if (iteration === maxIterations) {
        log.info(`Max iterations reached (${maxIterations})`);
        finalResponse = response;
      }
    }

    if (finalResponse) {
      const lastMsg = context.messages[context.messages.length - 1];
      if (lastMsg?.role !== "assistant") {
        context.messages.push(finalResponse.message);
      }
    }

    return {
      finalResponse,
      session,
      context,
      totalToolCalls,
      accumulatedTexts,
      accumulatedUsage,
      wasStreamed,
    };
  }

  private async finalizeResponse(
    turn: TurnContext,
    loop: LoopResult,
    finalResponse: ChatResponse,
    opts: ProcessMessageOptions
  ): Promise<AgentResponse> {
    const { chatId, effectiveIsGroup, processStartTime } = turn;
    const { session, totalToolCalls, accumulatedTexts, accumulatedUsage, wasStreamed } = loop;

    // Post-loop compaction deferred: the pre-loop check at the start of the next
    // processMessage() will handle it, avoiding AI summarization latency on response delivery.

    const sessionUpdate: Parameters<typeof updateSession>[1] = {
      updatedAt: Date.now(),
      messageCount: session.messageCount + 1,
      model: this.config.agent.model,
      provider: this.config.agent.provider,
      inputTokens:
        (session.inputTokens ?? 0) +
        accumulatedUsage.input +
        accumulatedUsage.cacheRead +
        accumulatedUsage.cacheWrite,
      outputTokens: (session.outputTokens ?? 0) + accumulatedUsage.output,
    };
    updateSession(chatId, sessionUpdate);

    if (accumulatedUsage.input > 0 || accumulatedUsage.output > 0) {
      const u = accumulatedUsage;
      const totalInput = u.input + u.cacheRead + u.cacheWrite;
      const inK = (totalInput / 1000).toFixed(1);
      const cacheParts: string[] = [];
      if (u.cacheRead) cacheParts.push(`${(u.cacheRead / 1000).toFixed(1)}K cached`);
      if (u.cacheWrite) cacheParts.push(`${(u.cacheWrite / 1000).toFixed(1)}K new`);
      const cacheInfo = cacheParts.length > 0 ? ` (${cacheParts.join(", ")})` : "";
      log.info(`${inK}K in${cacheInfo}, ${u.output} out | $${u.totalCost.toFixed(3)}`);

      accumulateTokenUsage(u);
    }

    let content = accumulatedTexts.join("\n").trim() || finalResponse.text;

    const sentToCurrentChat = totalToolCalls.some((call) => sentSuccessfullyToChat(call, chatId));

    if (!content && totalToolCalls.length > 0 && !sentToCurrentChat) {
      log.warn("Empty response after tool calls - generating fallback");
      content =
        "I executed the requested action but couldn't generate a response. Please try again.";
    } else if (!content && sentToCurrentChat) {
      log.info("Response sent via Telegram tool - no additional text needed");
      content = "";
    } else if (!content && accumulatedUsage.input === 0 && accumulatedUsage.output === 0) {
      log.warn("Empty response with zero tokens - possible API issue");
      content = "I couldn't process your request. Please try again.";
    }

    // Hook: response:before — plugins can mutate or block the response text
    let responseMetadata: Record<string, unknown> = {};
    if (this.hookRunner) {
      const responseBeforeEvent: ResponseBeforeEvent = {
        chatId,
        sessionId: session.sessionId,
        isGroup: effectiveIsGroup,
        originalText: content,
        text: content,
        block: false,
        blockReason: "",
        metadata: {},
      };
      await this.hookRunner.runModifyingHook("response:before", responseBeforeEvent);
      if (responseBeforeEvent.block) {
        log.info(`🚫 Response blocked by hook: ${responseBeforeEvent.blockReason || "no reason"}`);
        content = "";
      } else {
        content = responseBeforeEvent.text;
      }
      responseMetadata = responseBeforeEvent.metadata;
    }

    // Hook: response:after — analytics, billing, feedback
    if (this.hookRunner) {
      const responseAfterEvent: ResponseAfterEvent = {
        chatId,
        sessionId: session.sessionId,
        isGroup: effectiveIsGroup,
        text: content,
        durationMs: Date.now() - processStartTime,
        toolsUsed: totalToolCalls.map((tc) => tc.name),
        tokenUsage:
          accumulatedUsage.input > 0 || accumulatedUsage.output > 0
            ? { input: accumulatedUsage.input, output: accumulatedUsage.output }
            : undefined,
        metadata: responseMetadata,
      };
      await this.hookRunner.runObservingHook("response:after", responseAfterEvent);
    }

    // Finalize streaming draft — clear bubble, send final message only if no send tool was used
    if (wasStreamed && opts.streamToChat) {
      const bridge = opts.streamToChat.bridge;
      if (isBotBridge(bridge)) {
        if (
          (!content && sentToCurrentChat) ||
          deliveredTelegramText(totalToolCalls, chatId, content)
        ) {
          // Agent already sent via tool — just clear the draft bubble
          await bridge.clearDraft(opts.streamToChat.chatId);
        } else {
          await bridge.finalizeDraft(opts.streamToChat.chatId, content);
        }
      }
    }

    return {
      content,
      toolCalls: totalToolCalls,
      streamed: wasStreamed,
    };
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

    log.info(`Cleared history for chat ${chatId}`);
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
