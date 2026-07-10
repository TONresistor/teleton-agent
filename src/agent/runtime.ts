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
import {
  detectToolStall,
  executeToolBatch,
  injectDiscoveredTools,
  recordToolResults,
} from "./loop/tool-batch.js";
import { recoverLlmError, runModelIteration } from "./loop/llm-iteration.js";
import { computeRagEmbedding, selectTools } from "./tool-selector.js";

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

      const iterationResult = await runModelIteration(
        this.config.agent,
        opts.streamToChat,
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
        const recovered = await recoverLlmError(
          this.config.agent,
          this.hookRunner,
          assistantMsg,
          retry,
          {
            session,
            context,
            chatId,
            effectiveIsGroup,
            provider,
            processStartTime,
            userMsg,
          }
        );
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
      const { toolPlans, execResults } = await executeToolBatch(
        this.toolRegistry,
        this.hookRunner,
        toolCalls,
        fullContext,
        chatId,
        effectiveIsGroup
      );

      // Phase 3: record results + observing hooks; push the returned messages in order.
      const resultMessages = await recordToolResults(this.hookRunner, toolPlans, execResults, {
        totalToolCalls,
        iterationToolNames,
        sessionId: session.sessionId,
        chatId,
        effectiveIsGroup,
      });
      for (const resultMsg of resultMessages) {
        context.messages.push(resultMsg);
      }

      // Mid-loop tool injection: when tool_search returns discoveries, inject schemas
      // into the live tools[] so the LLM can call them in the next iteration (D4).
      // Runs whenever tools exist (ToolSearch mode AND the RAG hybrid escape hatch);
      // it's a no-op unless a tool_search call actually returned results.
      if (tools) {
        const injected = injectDiscoveredTools(toolPlans, execResults, tools);
        if (injected > 0) {
          log.info(`ToolSearch: injected ${injected} tool(s) mid-loop (total: ${tools.length})`);
        }
      }

      log.info(`${iteration}/${maxIterations} → ${iterationToolNames.join(", ")}`);

      // Stall detection: break only after 2 *consecutive* iterations where every tool
      // call (name + sorted args) was already seen — a single fully-repeated batch can
      // be a legitimate step (e.g. re-checking), so give the model a chance to recover.
      const allDuplicates = detectToolStall(toolPlans, seenToolSignatures);

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
