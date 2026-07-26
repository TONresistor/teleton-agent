import { createHash, randomUUID } from "crypto";
import type { Config } from "../config/schema.js";
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import {
  COMPACTION_MAX_MESSAGES,
  COMPACTION_KEEP_RECENT,
  COMPACTION_MAX_TOKENS_RATIO,
  COMPACTION_SOFT_THRESHOLD_RATIO,
  CONTEXT_MAX_RECENT_MESSAGES,
  CONTEXT_MAX_RELEVANT_CHUNKS,
} from "../constants/limits.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import {
  deliveredTelegramText,
  sentSuccessfullyToChat,
  type CompletedToolCall,
} from "./telegram-send-state.js";
import {
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
import { transcriptExists, appendToTranscript } from "../session/transcript.js";
import type { Context, Tool as PiAiTool, UserMessage } from "@earendil-works/pi-ai";
import { CompactionManager, DEFAULT_COMPACTION_CONFIG } from "../memory/compaction.js";
import { maskOldToolResults } from "../memory/observation-masking.js";
import { ContextBuilder } from "../memory/search/context.js";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolContext } from "./tools/types.js";
import { saveSessionMemory } from "../session/memory-hook.js";
import { createLogger } from "../utils/logger.js";
import type { createHookRunner } from "../sdk/hooks/runner.js";
import type { UserHookEvaluator } from "./hooks/user-hook-evaluator.js";
import type {
  BeforePromptBuildEvent,
  MessageReceiveEvent,
  ResponseBeforeEvent,
  ResponseAfterEvent,
  PromptAfterEvent,
} from "../sdk/hooks/types.js";
import { isTrivialMessage, addUsage } from "./runtime-utils.js";
import type { UsageAccumulator } from "./runtime-utils.js";
import { isBotBridge } from "../telegram/bridge-guards.js";
import { accumulateTokenUsage } from "./token-usage.js";
import { executeToolBatch, injectDiscoveredTools, recordToolResults } from "./loop/tool-batch.js";
import { recoverLlmError, runModelIteration } from "./loop/llm-iteration.js";
import { computeRagEmbedding, enforceProviderToolLimit, selectTools } from "./tool-selector.js";
import { resolveProviderFallback } from "./provider-fallback.js";
import { AgentTurnTraceRecorder } from "./turn-trace.js";
import { TurnCoordinator } from "./turn-coordinator.js";

export { isContextOverflowError, isTrivialMessage } from "./runtime-utils.js";
export { getTokenUsage } from "./token-usage.js";

const log = createLogger("Agent");

function resolveModelTarget(
  provider: SupportedProvider,
  requestedModel: string
): {
  resolvedModel: string;
  endpointFingerprint: string;
} {
  const model = getProviderModel(provider, requestedModel);
  return {
    resolvedModel: model.id,
    endpointFingerprint: createHash("sha256")
      .update(model.baseUrl ?? `${model.provider}:${model.api}`)
      .digest("hex")
      .slice(0, 16),
  };
}

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
  /** Stable inbound-event identifier used for idempotent action execution. */
  turnId?: string;
  /** Optional conversation-state key when delivery chat and session identity differ. */
  sessionKey?: string;
}

export interface AgentResponse {
  content: string;
  toolCalls?: CompletedToolCall[];
  streamed?: boolean;
}

interface TurnContext {
  turnId: string;
  chatId: string;
  effectiveIsGroup: boolean;
  processStartTime: number;
  session: ReturnType<typeof getOrCreateSession>;
  context: Context;
  systemPrompt: string;
  tools: PiAiTool[] | undefined;
  userMsg: UserMessage;
  provider: SupportedProvider;
  requestedModel: string;
  resolvedModel: string;
  endpointFingerprint: string;
  sessionKey: string;
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
  iterations: number;
  stopReason: string;
  activeProvider: SupportedProvider;
  activeModel: string;
  forcedContent?: string;
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

      const loop = await this.runAgenticLoop(built.turn, opts, trace);
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

      const response = await this.finalizeResponse(built.turn, loop, loop.finalResponse, opts);
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

  private async runAgenticLoop(
    turn: TurnContext,
    opts: ProcessMessageOptions,
    trace: AgentTurnTraceRecorder
  ): Promise<LoopResult> {
    const { chatId, effectiveIsGroup, processStartTime, systemPrompt, userMsg, sessionKey } = turn;
    const { toolContext } = opts;
    let session = turn.session;
    let context = turn.context;
    let activeProvider = turn.provider;
    let activeAgentConfig = this.config.agent;
    let activeTools = turn.tools ? [...turn.tools] : undefined;
    let fallbackIndex = 0;

    const maxIterations = Math.max(1, this.config.agent.max_agentic_iterations || 5);
    const maxDurationMs = Math.max(10_000, this.config.agent.max_turn_duration_ms);
    const providerSignal = AbortSignal.timeout(
      Math.max(1, maxDurationMs - (Date.now() - processStartTime))
    );
    let iteration = 0;
    const retry = { overflowResets: 0, rateLimitRetries: 0, serverErrorRetries: 0 };
    let finalResponse: ChatResponse | null = null;
    let lastResponse: ChatResponse | null = null;
    let stopReason = "completed";
    let forcedContent: string | undefined;
    const totalToolCalls: CompletedToolCall[] = [];
    const accumulatedTexts: string[] = [];
    const accumulatedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0 };
    let wasStreamed = false;
    let streamAccumulatedText = ""; // For "all" mode: concatenate text across iterations

    while (iteration < maxIterations) {
      if (Date.now() - processStartTime >= maxDurationMs) {
        if (!lastResponse) {
          throw new Error("Agent turn time budget exhausted before the first model response");
        }
        stopReason = "time_budget";
        forcedContent =
          "I stopped at a safe boundary because this turn reached its time budget. " +
          "Send a follow-up to continue.";
        finalResponse = lastResponse;
        break;
      }

      iteration++;
      log.debug(`Agentic iteration ${iteration}/${maxIterations}`);

      // Track where current iteration starts so masking won't truncate its results
      const iterationStartIndex = context.messages.length;

      const maskedMessages = maskOldToolResults(context.messages, {
        toolRegistry: this.toolRegistry ?? undefined,
        currentIterationStartIndex: iterationStartIndex,
      });
      const maskedContext: Context = { ...context, messages: maskedMessages };

      const iterationResult = await runModelIteration(
        activeAgentConfig,
        opts.streamToChat,
        maskedContext,
        systemPrompt,
        session.sessionId,
        activeTools,
        streamAccumulatedText,
        providerSignal,
        Math.max(1, maxDurationMs - (Date.now() - processStartTime))
      );
      const response = iterationResult.response;
      lastResponse = response;
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
        try {
          const recovered = await recoverLlmError(
            activeAgentConfig,
            this.hookRunner,
            assistantMsg,
            retry,
            {
              session,
              context,
              chatId,
              sessionKey,
              effectiveIsGroup,
              provider: activeProvider,
              processStartTime,
              userMsg,
            }
          );
          session = recovered.session;
          context = recovered.context;
          iteration--; // recovery retry, not a productive iteration — don't consume the budget
          continue;
        } catch (error) {
          const actionAlreadyAttempted = totalToolCalls.some(
            (call) =>
              call.attempted !== false &&
              this.toolRegistry?.getToolCategory(call.name) !== "data-bearing"
          );
          const previousProvider = activeProvider;
          const previousModel = activeAgentConfig.model;
          const fallback = resolveProviderFallback(
            this.config.agent,
            fallbackIndex,
            assistantMsg.errorMessage || "",
            actionAlreadyAttempted
          );
          if (!fallback) throw error;

          fallbackIndex = fallback.nextIndex;
          activeProvider = fallback.provider;
          activeAgentConfig = fallback.config;
          const fallbackTarget = resolveModelTarget(activeProvider, activeAgentConfig.model);
          trace.updateTarget(
            activeProvider,
            fallbackTarget.resolvedModel,
            fallbackTarget.endpointFingerprint
          );
          retry.overflowResets = 0;
          retry.rateLimitRetries = 0;
          retry.serverErrorRetries = 0;
          const fallbackLimit = getProviderMetadata(activeProvider).toolLimit;
          if (activeTools) {
            activeTools = enforceProviderToolLimit(activeTools, fallbackLimit);
          }
          streamAccumulatedText = "";
          if (opts.streamToChat && isBotBridge(opts.streamToChat.bridge)) {
            await opts.streamToChat.bridge.clearDraft(opts.streamToChat.chatId);
          }
          log.warn(
            `Provider fallback: ${previousProvider}/${previousModel} → ` +
              `${activeProvider}/${activeAgentConfig.model}`
          );
          iteration--;
          continue;
        }
      }

      if (response.text) {
        accumulatedTexts.push(response.text);
      }

      const toolCalls = response.message.content.filter((block) => block.type === "toolCall");

      if (toolCalls.length === 0) {
        log.info(`${iteration}/${maxIterations} → done`);
        finalResponse = response;
        wasStreamed = streamed;
        stopReason = fallbackIndex > 0 ? "completed_with_fallback" : "completed";
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
        isGuest: opts.isGuest,
        turnId: turn.turnId,
        sessionId: session.sessionId,
      };

      // Phases 1-2: build the tool plans (tool:before hooks) and execute them.
      const { toolPlans, execResults } = await executeToolBatch(
        this.toolRegistry,
        this.hookRunner,
        toolCalls,
        fullContext,
        chatId,
        effectiveIsGroup
      );

      // Mid-loop tool injection: when tool_search returns discoveries, inject schemas
      // before recording the result. The result is pruned to tools that are actually
      // available, so the model is never told to call a schema rejected by the
      // provider limit or current context.
      if (activeTools) {
        const injected = injectDiscoveredTools(
          toolPlans,
          execResults,
          activeTools,
          getProviderMetadata(activeProvider).toolLimit,
          opts.isGuest ? TELEGRAM_SEND_TOOLS : undefined
        );
        if (injected > 0) {
          log.info(
            `ToolSearch: injected ${injected} tool(s) mid-loop (total: ${activeTools.length})`
          );
        }
      }

      // Phase 3: record results + observing hooks; push the returned messages in order.
      const resultMessages = await recordToolResults(this.hookRunner, toolPlans, execResults, {
        totalToolCalls,
        iterationToolNames,
        sessionId: session.sessionId,
        chatId,
        effectiveIsGroup,
        db: fullContext.db,
      });
      for (const resultMsg of resultMessages) {
        context.messages.push(resultMsg);
      }

      trace.progress(totalToolCalls, iteration, accumulatedUsage);

      log.info(`${iteration}/${maxIterations} → ${iterationToolNames.join(", ")}`);

      if (Date.now() - processStartTime >= maxDurationMs) {
        stopReason = "time_budget";
        forcedContent =
          "I stopped at a safe boundary because this turn reached its time budget. " +
          "Send a follow-up to continue.";
        finalResponse = response;
        break;
      }
      if (iteration === maxIterations) {
        log.info(`Max iterations reached (${maxIterations})`);
        finalResponse = response;
        stopReason = "iteration_budget";
        forcedContent =
          "I stopped at a safe boundary because this turn reached its iteration budget. " +
          "Send a follow-up to continue.";
      }
    }

    if (finalResponse && !context.messages.includes(finalResponse.message)) {
      context.messages.push(finalResponse.message);
    }

    return {
      finalResponse,
      session,
      context,
      totalToolCalls,
      accumulatedTexts,
      accumulatedUsage,
      wasStreamed,
      iterations: iteration,
      stopReason,
      activeProvider,
      activeModel: lastResponse?.message.model ?? activeAgentConfig.model,
      forcedContent,
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
      model: loop.activeModel,
      provider: loop.activeProvider,
      inputTokens:
        (session.inputTokens ?? 0) +
        accumulatedUsage.input +
        accumulatedUsage.cacheRead +
        accumulatedUsage.cacheWrite,
      outputTokens: (session.outputTokens ?? 0) + accumulatedUsage.output,
    };
    updateSession(opts.sessionKey ?? chatId, sessionUpdate);

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

    let content = loop.forcedContent ?? (accumulatedTexts.join("\n").trim() || finalResponse.text);

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
        content = responseBeforeEvent.blockReason.startsWith("Hook enforcement failed")
          ? "Response withheld because an enforcement hook failed. Check the agent logs."
          : "";
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
