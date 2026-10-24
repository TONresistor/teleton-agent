import { randomUUID } from "crypto";
import type { Config } from "../config/schema.js";
import {
  COMPACTION_MAX_MESSAGES,
  COMPACTION_KEEP_RECENT,
  COMPACTION_MAX_TOKENS_RATIO,
  COMPACTION_SOFT_THRESHOLD_RATIO,
} from "../constants/limits.js";
import { getProviderModel } from "./client.js";
import type { SupportedProvider } from "../config/providers.js";
import { getDatabase } from "../memory/index.js";
import { resetSession } from "../session/store.js";
import { CompactionManager, DEFAULT_COMPACTION_CONFIG } from "../memory/compaction.js";
import type { ContextBuilder } from "../memory/search/context.js";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import type { ToolRegistry } from "./tools/registry.js";
import { createLogger } from "../utils/logger.js";
import type { createHookRunner } from "../sdk/hooks/runner.js";
import type { UserHookEvaluator } from "./hooks/user-hook-evaluator.js";
import { AgentTurnTraceRecorder } from "./turn-trace.js";
import { TurnCoordinator } from "./turn-coordinator.js";
import type { AgentResponse, ProcessMessageOptions } from "./turn-types.js";
import { finalizeAgentResponse } from "./response-finalizer.js";
import { executeAgentLoop } from "./loop/executor.js";
import { prepareTurn } from "./turn-preparation.js";
import { authorizeTurn } from "./turn-authorization.js";
import { outcomeForStopReason } from "./execution-types.js";
import {
  createUsageCollector,
  runWithUsageCollector,
  
  type UsageCollector,
} from "./attempt-usage.js";
import { addUsage, type UsageAccumulator } from "./runtime-utils.js";
import { accumulateTokenUsage } from "./token-usage.js";
import { persistModelAttempts } from "../memory/model-attempts.js";
import { completeTurnIngress, reserveTurnIngress } from "../memory/turn-ingress.js";
import {
  clearDeliveryDraft,
  deliverAgentResponse,
  tryReserveDraft,
  type DeliveryTarget,
} from "./delivery.js";
import { assertTurnBudget, TurnBudgetError } from "./turn-budget.js";
import { ContextBudgetError } from "./context-budget.js";
import { getSession, updateSession } from "../session/store.js";

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

  initializeContextBuilder(embedder: EmbeddingProvider, contextBuilder: ContextBuilder): void {
    this.embedder = embedder;
    this.toolRegistry?.setEmbedder(embedder);
    this.contextBuilder = contextBuilder;
  }

  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  getActiveTurnCount(): number {
    return this.turnCoordinator.stats.active;
  }

  async processMessage(opts: ProcessMessageOptions): Promise<AgentResponse> {
    const delivery: DeliveryTarget | undefined =
      opts.delivery ??
      (opts.streamToChat
        ? {
            kind: "telegram",
            bridge: opts.streamToChat.bridge,
            chatId: opts.streamToChat.chatId,
            isGroup: opts.isGroup,
          }
        : undefined);
    const actor = authorizeTurn(this.config, opts);
    const accountId = opts.toolContext?.bridge.getOwnUserId?.()?.toString() ?? "local";
    const turnId =
      opts.turnId ??
      (opts.messageId !== undefined
        ? `telegram:${accountId}:${opts.chatId}:${opts.messageId}`
        : `turn:${randomUUID()}`);
    if (!actor.allowed)
      return {
        turnId,
        content: "This request requires an authorized sender.",
        toolCalls: [],
        outcome: { status: "blocked", reason: "permission_denied" },
        delivery: { state: "not_requested" },
      };
    const admission = opts.admission ?? {
      receivedAt: Date.now(),
      queueDeadline: Date.now() + 60_000,
    };
    return this.turnCoordinator.run(
      opts.sessionKey ?? opts.chatId,
      async () => {
        // Recheck revocations after waiting, using live configuration.
        if (!authorizeTurn(this.config, opts).allowed)
          return {
            turnId,
            content: "This request requires an authorized sender.",
            toolCalls: [],
            outcome: { status: "blocked" as const, reason: "permission_denied" },
            delivery: { state: "not_requested" as const },
          };
        const db = getDatabase().getDb();
        const ingressKey = opts.ingressKey ?? turnId;
        const reservation = reserveTurnIngress(db, {
          key: ingressKey,
          turnId,
          hash: opts.ingressHash,
          chatId: opts.chatId,
          messageId: opts.messageId,
          senderId: opts.toolContext?.senderId,
          text: opts.userMessage,
          receivedAt: admission.receivedAt,
        });
        if (reservation.kind === "conflict" || reservation.kind === "busy")
          return {
            turnId: reservation.turnId,
            content:
              reservation.kind === "conflict"
                ? "This event identity conflicts with an earlier request."
                : "This request is already running or requires review after an interrupted execution.",
            toolCalls: [],
            outcome: { status: "unknown" as const, reason: "ingress_unsettled" },
            delivery: { state: "unknown" as const, reason: "ingress_unsettled" },
          };
        const executionDeadline =
          admission.executionDeadline ?? Date.now() + this.config.agent.max_turn_duration_ms;
        const runOptions = {
          ...opts,
          delivery,
          turnId: reservation.turnId,
          admission: { ...admission, executionDeadline },
        };
        let release: (() => void) | undefined;
        try {
          if (delivery) release = tryReserveDraft(delivery);
          if (delivery && !release) runOptions.streamToChat = undefined;
          let response: AgentResponse;
          if (reservation.kind === "resume" && reservation.response)
            response = reservation.response;
          else {
            const collector = Object.assign(createUsageCollector(), {
              deadlineAt: executionDeadline,
              signal: admission.signal,
            });
            response = await runWithUsageCollector(collector, () =>
              this.processCoordinatedMessage(runOptions, collector));
            // Generation is durable before any final response is published.
            completeTurnIngress(db, ingressKey, response);
          }
          if (delivery) {
            try {
              response = await deliverAgentResponse(db, response, delivery, {
                isHeartbeat: opts.isHeartbeat,
                reservationHeld: !!release,
                signal: admission.signal,
              });
            } catch (error) {
              log.error({ err: error }, "Delivery could not be confirmed");
              response.delivery = { state: "unknown", reason: "delivery_persistence_failed" };
            }
            try {
              completeTurnIngress(db, ingressKey, response);
            } catch (error) {
              // Confirmed outbox receipts remain authoritative if this projection fails.
              log.error({ err: error }, "Unable to update ingress delivery projection");
            }
          }
          return response;
        } finally {
          if (release && delivery) await clearDeliveryDraft(delivery);
          release?.();
        }
      },
    );
  }

  private async processCoordinatedMessage(
    opts: ProcessMessageOptions,
    collector: UsageCollector
  ): Promise<AgentResponse> {
    const processStartTime = opts.admission?.executionDeadline
      ? opts.admission.executionDeadline - this.config.agent.max_turn_duration_ms
      : Date.now();
    const turnId =
      opts.turnId ??
      (opts.messageId !== undefined
        ? `telegram:${opts.chatId}:${opts.messageId}`
        : `turn:${randomUUID()}`);
    let trace: AgentTurnTraceRecorder | undefined;
    let usage: UsageAccumulator = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalCost: 0,
    };
    let appliedSessionUsage: UsageAccumulator = { ...usage };
    const collectUsage = (): UsageAccumulator => {
      if (!collector.attempts.length) return usage;
      const total: UsageAccumulator = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalCost: 0,
      };
      for (const attempt of collector.attempts) {
        if (attempt.usage) addUsage(total, attempt.usage);
        if (attempt.incomplete) total.costIncomplete = true;
      }
      return total;
    };
    try {
      assertTurnBudget(opts.admission?.executionDeadline, opts.admission?.signal);
      const built = await prepareTurn({ ...opts, turnId }, processStartTime, {
        config: this.config,
        soul: this.soul,
        compactionManager: this.compactionManager,
        contextBuilder: this.contextBuilder,
        embedder: this.embedder,
        toolRegistry: this.toolRegistry,
        hookRunner: this.hookRunner,
        userHookEvaluator: this.userHookEvaluator,
        getMemoryStats: () => this.getMemoryStats(),
      });
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
      usage = loop.accumulatedUsage;
      loop.accumulatedUsage = collectUsage();

      const response = await finalizeAgentResponse(
        built.turn,
        loop,
        loop.finalResponse,
        opts,
        this.hookRunner
      );
      appliedSessionUsage = { ...loop.accumulatedUsage };
      trace.finish({
        status: loop.stopReason.endsWith("budget")
          ? "budget_exhausted"
          : outcomeForStopReason(loop.stopReason).status === "completed"
            ? "completed"
            : "error",
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
      usage = collectUsage();
      trace?.usage(usage);
      trace?.fail(error);
      const reason =
        error instanceof ContextBudgetError
          ? "context_budget"
          : error instanceof TurnBudgetError
            ? "time_budget"
            : "provider_error";
      const sessionKey = opts.sessionKey ?? opts.chatId;
      const session = getSession(sessionKey);
      if (session)
        updateSession(sessionKey, {
          inputTokens:
            (session.inputTokens ?? 0) + usage.input + usage.cacheRead + usage.cacheWrite,
          outputTokens: (session.outputTokens ?? 0) + usage.output,
        });
      appliedSessionUsage = { ...usage };
      // A later hook/provider error cannot prove that a reserved external effect failed.
      let uncertainEffect = false;
      try {
        uncertainEffect = !!getDatabase()
          .getDb()
          .prepare(
            "SELECT 1 FROM action_executions WHERE turn_id=? AND status IN ('running','unknown') LIMIT 1"
          )
          .get(turnId);
      } catch {
        /* Preserve the original error when diagnostics are unavailable. */
      }
      return {
        turnId,
        content:
          "I could not finish this request. Any uncertain action must be reviewed before it is retried.",
        toolCalls: [],
        outcome: uncertainEffect
          ? { status: "unknown", reason: "effect_unknown" }
          : reason === "provider_error"
            ? { status: "failed", reason }
            : outcomeForStopReason(reason),
        delivery: { state: "not_requested" },
      };
    } finally {
      const total = collectUsage();
      if (
        (total.input ||
          total.output ||
          total.cacheRead ||
          total.cacheWrite ||
          total.totalCost ||
          total.costIncomplete)
      )
        accumulateTokenUsage(total);
      const extraInput =
        total.input +
        total.cacheRead +
        total.cacheWrite -
        appliedSessionUsage.input -
        appliedSessionUsage.cacheRead -
        appliedSessionUsage.cacheWrite;
      const extraOutput = total.output - appliedSessionUsage.output;
      if (extraInput || extraOutput) {
        const key = opts.sessionKey ?? opts.chatId;
        const current = getSession(key);
        if (current)
          updateSession(key, {
            inputTokens: (current.inputTokens ?? 0) + extraInput,
            outputTokens: (current.outputTokens ?? 0) + extraOutput,
          });
      }
      if (collector.attempts.length) {
        try {
          persistModelAttempts(getDatabase().getDb(), turnId, collector.attempts);
        } catch (error) {
          log.error({ err: error }, "Unable to persist model attempt usage");
        }
      }
    }
  }

  async drainTurns(): Promise<void> {
    await this.turnCoordinator.drain();
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
