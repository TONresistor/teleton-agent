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
