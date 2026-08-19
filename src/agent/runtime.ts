import { randomUUID } from "crypto";
import type { Config } from "../config/schema.js";
import {
  COMPACTION_MAX_MESSAGES,
  COMPACTION_KEEP_RECENT,
  COMPACTION_MAX_TOKENS_RATIO,
  COMPACTION_SOFT_THRESHOLD_RATIO,
  CONTEXT_MAX_RECENT_MESSAGES,
  CONTEXT_MAX_RELEVANT_CHUNKS,
} from "../constants/limits.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import { loadContextFromTranscript, getProviderModel, getEffectiveApiKey } from "./client.js";
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
import { transcriptExists, appendToTranscript } from "../session/transcript.js";
import type { Context, UserMessage } from "@earendil-works/pi-ai";
import { CompactionManager, DEFAULT_COMPACTION_CONFIG } from "../memory/compaction.js";
import { ContextBuilder } from "../memory/search/context.js";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import type { ToolRegistry } from "./tools/registry.js";
import { saveSessionMemory } from "../session/memory-hook.js";
import { createLogger } from "../utils/logger.js";
import type { createHookRunner } from "../sdk/hooks/runner.js";
import type { UserHookEvaluator } from "./hooks/user-hook-evaluator.js";
import type {
  BeforePromptBuildEvent,
  MessageReceiveEvent,
  PromptAfterEvent,
} from "../sdk/hooks/types.js";
import { isTrivialMessage } from "./runtime-utils.js";
import { computeRagEmbedding, selectTools } from "./tool-selector.js";
import { AgentTurnTraceRecorder } from "./turn-trace.js";
import { TurnCoordinator } from "./turn-coordinator.js";
import type { AgentResponse, ProcessMessageOptions, TurnContextResult } from "./turn-types.js";
import { finalizeAgentResponse } from "./response-finalizer.js";
import { resolveModelTarget } from "./model-target.js";
import { executeAgentLoop } from "./loop/executor.js";

export type { AgentResponse, ProcessMessageOptions } from "./turn-types.js";

export { isContextOverflowError, isTrivialMessage } from "./runtime-utils.js";
export { getTokenUsage } from "./token-usage.js";

const log = createLogger("Agent");

export class AgentRuntime {
  private config: Config;
  private soul: string;
  private compactionManager: CompactionManager;
  private contextBuilder: ContextBuilder | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private embedder: EmbeddingProvider | null = null;
  private hookRunner?: ReturnType<typeof createHookRunner>;
  private userHookEvaluator?: UserHookEvaluator;
  private readonly turnCoordinator = new TurnCoordinator({
    maxConcurrent: 10,
    maxPending: 100,
    maxQueueWaitMs: 60_000,
  });

  constructor(config: Config, soul?: string, toolRegistry?: ToolRegistry) {
    this.config = config;
    this.soul = soul ?? "";
    this.toolRegistry = toolRegistry ?? null;

    if (this.toolRegistry && config.telegram?.allow_from?.length) {
      this.toolRegistry.setAllowFrom(config.telegram.allow_from);
    }
    this.toolRegistry?.setAdminIds(config.telegram.admin_ids);

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

  setHookRunner(runner: ReturnType<typeof createHookRunner> | undefined): void {
    this.hookRunner = runner;
  }

  updateConfig(config: Config): void {
    this.config = config;
    this.toolRegistry?.setAllowFrom(config.telegram.allow_from ?? []);
    this.toolRegistry?.setAdminIds(config.telegram.admin_ids);

    const provider = (config.agent.provider || "anthropic") as SupportedProvider;
    try {
      const contextWindow = getProviderModel(provider, config.agent.model).contextWindow;
      this.compactionManager.updateConfig({
        maxTokens: Math.floor(contextWindow * COMPACTION_MAX_TOKENS_RATIO),
        softThresholdTokens: Math.floor(contextWindow * COMPACTION_SOFT_THRESHOLD_RATIO),
      });
    } catch {
      this.compactionManager.updateConfig(DEFAULT_COMPACTION_CONFIG);
    }
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
    registry.setAllowFrom(this.config.telegram.allow_from ?? []);
    registry.setAdminIds(this.config.telegram.admin_ids);
    if (this.embedder) registry.setEmbedder(this.embedder);
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
    return this.turnCoordinator.run(opts.sessionKey ?? opts.chatId, () =>
      this.processCoordinatedMessage(opts)
    );
  }

  private async processCoordinatedMessage(opts: ProcessMessageOptions): Promise<AgentResponse> {
    const processStartTime = Date.now();
    const turnId =
      opts.turnId ??
      (opts.messageId !== undefined
        ? `telegram:${opts.chatId}:${opts.messageId}`
        : `turn:${randomUUID()}`);
    let trace: AgentTurnTraceRecorder | undefined;
    try {
      const built = await this.buildTurnContext({ ...opts, turnId }, processStartTime);
      if (built.kind === "early") return built.response;

      trace = new AgentTurnTraceRecorder(getDatabase().getDb(), turnId);
      trace.start({
        sessionId: built.turn.session.sessionId,
        chatId: built.turn.chatId,
        startedAt: processStartTime,
        provider: built.turn.provider,
        model: built.turn.resolvedModel,
        requestedModel: built.turn.requestedModel,
        endpointFingerprint: built.turn.endpointFingerprint,
        selectedTools: built.turn.tools?.map((tool) => tool.name) ?? [],
      });

      const loop = await executeAgentLoop(built.turn, opts, trace, {
        config: this.config,
        toolRegistry: this.toolRegistry,
        hookRunner: this.hookRunner,
      });
      if (!loop.finalResponse) {
        log.error("Agentic loop exited early without final response");
        trace.finish({
          status: "error",
          calls: loop.totalToolCalls,
          iterations: loop.iterations,
          usage: loop.accumulatedUsage,
          stopReason: loop.stopReason,
          provider: loop.activeProvider,
          model: loop.activeModel,
          errorMessage: "Agent loop failed to produce a response",
        });
        return {
          content: "Internal error: Agent loop failed to produce a response.",
          toolCalls: [],
        };
      }

      const response = await finalizeAgentResponse(
        built.turn,
        loop,
        loop.finalResponse,
        opts,
        this.hookRunner
      );
      trace.finish({
        status: loop.stopReason.endsWith("budget") ? "budget_exhausted" : "completed",
        calls: loop.totalToolCalls,
        iterations: loop.iterations,
        usage: loop.accumulatedUsage,
        stopReason: loop.stopReason,
        provider: loop.activeProvider,
        model: loop.activeModel,
      });
      return response;
    } catch (error) {
      log.error({ err: error }, "Agent error");
      trace?.fail(error);
      throw error;
    }
  }

  async drainTurns(): Promise<void> {
    await this.turnCoordinator.drain();
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
        const content = msgEvent.blockReason.startsWith("Hook enforcement failed")
          ? "Request blocked because an enforcement hook failed. Check the agent logs."
          : "";
        return { kind: "early", response: { content, toolCalls: [] } };
      }
      effectiveMessage = sanitizeForContext(msgEvent.text);
      if (msgEvent.additionalContext) {
        hookMessageContext = sanitizeForContext(msgEvent.additionalContext);
      }
    }

    const sessionKey = opts.sessionKey ?? chatId;
    let session = getOrCreateSession(sessionKey);
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

      session = resetSessionWithPolicy(sessionKey);
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

    log.info(
      {
        chatId,
        isGroup,
        messageLength: formattedMessage.length,
        hasMedia: opts.hasMedia ?? false,
      },
      "Telegram message received"
    );

    let relevantContext = "";
    const isNonTrivial = !isTrivialMessage(effectiveMessage);
    const isAdmin =
      toolContext?.senderId !== undefined &&
      this.config.telegram.admin_ids.includes(toolContext.senderId);

    // Start embedding computation concurrently with session:start hook
    const embeddingPromise = computeRagEmbedding(this.embedder, effectiveMessage, context);

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
              searchAllChats: true,
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
      includeMemory: true,
      includeStrategy: true,
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
      updateSession(sessionKey, { sessionId: preemptiveCompaction });
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- session guaranteed to exist after compaction
      session = getSession(sessionKey)!;
      context = loadContextFromTranscript(session.sessionId);
      context.messages.push(userMsg);
      captureMemorySnapshot(); // Refresh snapshot for the new compacted session
    }

    appendToTranscript(session.sessionId, userMsg);

    const provider = (this.config.agent.provider || "anthropic") as SupportedProvider;
    const providerMeta = getProviderMetadata(provider);
    const requestedModel = this.config.agent.model;
    const target = resolveModelTarget(provider, requestedModel);
    let tools = await selectTools(
      this.config,
      this.toolRegistry,
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
        turnId: opts.turnId ?? `turn:${randomUUID()}`,
        chatId,
        effectiveIsGroup,
        processStartTime,
        session,
        context,
        systemPrompt,
        tools,
        userMsg,
        provider,
        requestedModel,
        resolvedModel: target.resolvedModel,
        endpointFingerprint: target.endpointFingerprint,
        sessionKey,
      },
    };
  }

  clearHistory(chatId: string): void {
    const db = getDatabase().getDb();

    db.prepare(
      `DELETE FROM tg_messages_vec WHERE id IN (
        SELECT chat_id || char(31) || id FROM tg_messages WHERE chat_id = ?
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
