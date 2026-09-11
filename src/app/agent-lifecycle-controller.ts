import type { AgentRuntime } from "../agent/runtime.js";
import type { PluginContext, PluginModule } from "../agent/tools/types.js";
import { PluginWatcher } from "../agent/tools/plugin-watcher.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import { closeMcpServers, loadMcpServers, type McpConnection } from "../agent/tools/mcp-loader.js";
import type { Config } from "../config/index.js";
import { getDatabase } from "../memory/index.js";
import type { MemorySystem } from "../memory/index.js";
import type { SDKDependencies } from "../sdk/index.js";
import { createHookRunner } from "../sdk/hooks/runner.js";
import { HookRegistry } from "../sdk/hooks/registry.js";
import type { AgentStartEvent, AgentStopEvent, HookName } from "../sdk/hooks/types.js";
import { flushAllTranscripts } from "../session/transcript.js";
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import type { MessageHandler } from "../telegram/handlers.js";
import { getWalletAddress } from "../ton/wallet-service.js";
import type { HeartbeatRunner } from "../heartbeat.js";
import { StartupMaintenance } from "../startup-maintenance.js";
import { PluginOrchestrator } from "../plugin-orchestrator.js";
import { PACKAGE_VERSION } from "../utils/package-info.js";
import { createLogger } from "../utils/logger.js";
import { resolveOwnerInfo } from "./owner-info.js";
import { startPluginModules, stopPluginModules } from "./plugin-lifecycle.js";
import type { MessagePipeline } from "./message-pipeline.js";
import type { ProviderRuntime } from "./provider-runtime.js";

const log = createLogger("App");

export interface AgentLifecycleDependencies {
  config: Config;
  configPath: string;
  agent: AgentRuntime;
  bridge: ITelegramBridge;
  messageHandler: MessageHandler;
  messagePipeline: MessagePipeline;
  toolRegistry: ToolRegistry;
  modules: PluginModule[];
  memory: MemorySystem;
  sdkDeps: SDKDependencies;
  providerRuntime: ProviderRuntime;
  heartbeatRunner: HeartbeatRunner;
}

/** Owns the resources created for one running agent generation. */
export class AgentLifecycleController {
  private deps: AgentLifecycleDependencies | null = null;
  private readonly mcpConnections: McpConnection[] = [];
  private pluginWatcher: PluginWatcher | null = null;
  private hookRunner?: ReturnType<typeof createHookRunner>;
  private hookRegistry = new HookRegistry();
  private disposeToolIndexSubscription: (() => void) | null = null;
  private startTime = 0;

  getMcpConnections(): McpConnection[] {
    return this.mcpConnections;
  }

  getHookRegistry(): HookRegistry {
    return this.hookRegistry;
  }

  async start(deps: AgentLifecycleDependencies): Promise<void> {
    this.deps = deps;

    const builtinNames = deps.modules.map((module) => module.name);
    const moduleNames = deps.modules
      .filter((module) => module.tools(deps.config).length > 0)
      .map((module) => module.name);

    const nextMcpConnections =
      Object.keys(deps.config.mcp.servers).length > 0 ? await loadMcpServers(deps.config.mcp) : [];
    this.mcpConnections.splice(0, this.mcpConnections.length, ...nextMcpConnections);

    const orchestrator = new PluginOrchestrator(
      deps.toolRegistry,
      deps.config,
      deps.sdkDeps,
      deps.memory.embedder,
      deps.memory.vectorSearch
    );
    const { pluginNames, hookRegistry, externalModules, toolCount, dispose } =
      await orchestrator.loadAll(builtinNames, moduleNames, this.mcpConnections);
    this.disposeToolIndexSubscription = dispose;
    this.hookRegistry = hookRegistry;
    for (const module of externalModules) deps.modules.push(module);

    const maintenance = new StartupMaintenance(
      getDatabase().getDb(),
      deps.config,
      deps.configPath,
      {
        embedder: deps.memory.embedder,
        knowledge: deps.memory.knowledge,
        messages: deps.memory.messages,
      }
    );
    const { indexResult, ftsResult } = await maintenance.run();

    const toolIndex = deps.toolRegistry.getToolIndex();
    if (toolIndex) {
      const startedAt = Date.now();
      const indexedCount = await toolIndex.indexAll(deps.toolRegistry.getAll());
      log.info(`Tool RAG: ${indexedCount} tools indexed (${Date.now() - startedAt}ms)`);
    }

    deps.agent.initializeContextBuilder(deps.memory.embedder, deps.memory.context);
    await deps.providerRuntime.initialize();

    await deps.bridge.connect();
    if (!deps.bridge.isAvailable()) throw new Error("Failed to connect to Telegram");

    await resolveOwnerInfo(deps.config, deps.bridge, deps.configPath);
    const ownUserId = deps.bridge.getOwnUserId();
    if (ownUserId) deps.messageHandler.setOwnUserId(ownUserId.toString());

    const username = await deps.bridge.getUsername();
    const pluginContext: PluginContext = {
      bridge: deps.bridge,
      db: getDatabase().getDb(),
      config: deps.config,
    };
    await startPluginModules(deps.modules, pluginContext);

    const firstStart = deps.messagePipeline.install();
    this.installHookRunner(deps.agent, hookRegistry);
    deps.messagePipeline.wirePluginEventHooks();
    deps.messagePipeline.setAcceptingMessages(true);
    deps.messagePipeline.wireMode(firstStart);

    if (deps.config.dev.hot_reload) {
      this.pluginWatcher = new PluginWatcher({
        config: deps.config,
        registry: deps.toolRegistry,
        sdkDeps: deps.sdkDeps,
        modules: deps.modules,
        pluginContext,
        loadedModuleNames: builtinNames,
        hookRegistry,
      });
      this.pluginWatcher.start();
    }

    this.logStartupSummary(deps, username, indexResult.indexed, ftsResult.knowledge);

    this.startTime = Date.now();
    deps.messagePipeline.resetMetrics();
    await this.emitAgentStartHook(deps, pluginNames.length, toolCount);

    const adminChatId = deps.config.telegram.admin_ids[0];
    if (deps.config.heartbeat.enabled && (adminChatId || deps.config.heartbeat.proactive_enabled)) {
      deps.heartbeatRunner.start(adminChatId ?? 0, deps.config.heartbeat.interval_ms);
    }

    void deps.memory.messages.startPendingEmbeddingBackfill();
  }

  async stop(): Promise<void> {
    const deps = this.deps;
    if (!deps) return;

    deps.messagePipeline.setAcceptingMessages(false);
    await deps.heartbeatRunner.stopAndDrain();
    await this.stopPluginWatcher();
    await deps.messagePipeline.flushAndDrain();
    await deps.memory.messages.stopAndDrainPendingEmbeddingBackfill();

    try {
      await deps.agent.drainTurns();
    } catch (error: unknown) {
      log.error({ err: error }, "Agent turn drain failed");
    }

    try {
      await flushAllTranscripts();
    } catch (error: unknown) {
      log.error({ err: error }, "Transcript flush failed");
    }

    await this.emitAgentStopHook(deps);

    deps.providerRuntime.stopGocoon();
    if (this.mcpConnections.length > 0) {
      try {
        await closeMcpServers(this.mcpConnections);
      } catch (error: unknown) {
        log.error({ err: error }, "MCP close failed");
      }
      this.mcpConnections.splice(0, this.mcpConnections.length);
    }

    await stopPluginModules(deps.modules);
    this.disposeToolIndexSubscription?.();
    this.disposeToolIndexSubscription = null;
    this.hookRegistry.clear();
    this.hookRunner = undefined;
    deps.agent.setHookRunner(undefined);

    deps.messagePipeline.resetCallbackRegistration();
    try {
      await deps.bridge.disconnect();
    } catch (error: unknown) {
      log.error({ err: error }, "Bridge disconnect failed");
    }

    this.deps = null;
    this.startTime = 0;
  }

  private installHookRunner(agent: AgentRuntime, hookRegistry: HookRegistry): void {
    const hookRunner = createHookRunner(hookRegistry, { logger: log });
    agent.setHookRunner(hookRunner);
    this.hookRunner = hookRunner;
    const activeHooks: HookName[] = [
      "tool:before",
      "tool:after",
      "tool:error",
      "prompt:before",
      "prompt:after",
      "session:start",
      "session:end",
      "message:receive",
      "response:before",
      "response:after",
      "response:error",
      "agent:start",
      "agent:stop",
    ];
    const active = activeHooks.filter((name) => hookRegistry.hasHooks(name));
    log.info(`🪝 Hook runner created (${active.join(", ")})`);
  }

  private async emitAgentStartHook(
    deps: AgentLifecycleDependencies,
    pluginCount: number,
    toolCount: number
  ): Promise<void> {
    if (!this.hookRunner) return;
    const event: AgentStartEvent = {
      version: PACKAGE_VERSION,
      provider: deps.config.agent.provider || "anthropic",
      model: deps.config.agent.model,
      pluginCount,
      toolCount,
      timestamp: Date.now(),
    };
    await this.hookRunner.runObservingHook("agent:start", event);
  }

  private async emitAgentStopHook(deps: AgentLifecycleDependencies): Promise<void> {
    if (!this.hookRunner) return;
    try {
      const event: AgentStopEvent = {
        reason: "manual",
        uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
        messagesProcessed: deps.messagePipeline.getMessagesProcessed(),
        timestamp: Date.now(),
      };
      await this.hookRunner.runObservingHook("agent:stop", event);
    } catch (error: unknown) {
      log.error({ err: error }, "agent:stop hook failed");
    }
  }

  private async stopPluginWatcher(): Promise<void> {
    if (!this.pluginWatcher) return;
    try {
      await this.pluginWatcher.stop();
    } catch (error: unknown) {
      log.error({ err: error }, "Plugin watcher stop failed");
    }
    this.pluginWatcher = null;
  }

  private logStartupSummary(
    deps: AgentLifecycleDependencies,
    username: string | undefined,
    indexedFiles: number,
    indexedChunks: number
  ): void {
    const provider = deps.config.agent.provider || "anthropic";
    log.info("SOUL.md loaded");
    log.info(`Knowledge: ${indexedFiles} files, ${indexedChunks} chunks indexed`);
    log.info(`Telegram: @${username} connected`);
    log.info("TON Blockchain: connected");
    if (deps.config.tonapi_key) log.info("TonAPI key configured");
    log.info("DEXs: STON.fi, DeDust connected");
    log.info(`Wallet: ${getWalletAddress() || "not configured"}`);
    log.info(`Model: ${provider}/${deps.config.agent.model}`);
    log.info(`Admins: ${deps.config.telegram.admin_ids.join(", ")}`);
    log.info(
      `Policy: DM ${deps.config.telegram.dm_policy}, Groups ${deps.config.telegram.group_policy}, Debounce ${deps.config.telegram.debounce_ms}ms\n`
    );
    log.info("Teleton Agent is running! Press Ctrl+C to stop.");
  }
}
