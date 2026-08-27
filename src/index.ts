import { loadConfig, getDefaultConfigPath, type Config } from "./config/index.js";
import { loadSoul } from "./soul/index.js";
import { AgentRuntime } from "./agent/runtime.js";
import type { ITelegramBridge } from "./telegram/bridge-interface.js";
import { isBotBridge } from "./telegram/bridge-guards.js";
import { createBridge } from "./telegram/factory.js";
import { MessageHandler } from "./telegram/handlers.js";
import { AdminHandler } from "./telegram/admin.js";
import { getDatabase, closeDatabase, initializeMemory, type MemorySystem } from "./memory/index.js";
import { setKnowledgeIndexer } from "./memory/agent/knowledge.js";
import { setTonapiKey } from "./constants/api-endpoints.js";
import { setToncenterApiKey } from "./ton/endpoint.js";
import { TELETON_ROOT } from "./workspace/paths.js";
import { join } from "path";
import { ToolRegistry } from "./agent/tools/registry.js";
import { registerAllTools } from "./agent/tools/register-all.js";
import type { SDKDependencies } from "./sdk/index.js";
import { loadModules } from "./agent/tools/module-loader.js";
import { ModulePermissions } from "./agent/tools/module-permissions.js";
import { SHUTDOWN_TIMEOUT_MS } from "./constants/timeouts.js";

import type { PluginModule } from "./agent/tools/types.js";
import { getErrorMessage } from "./utils/errors.js";
import { UserHookEvaluator } from "./agent/hooks/user-hook-evaluator.js";
import { createLogger, initLoggerFromConfig } from "./utils/logger.js";
import { AgentLifecycle } from "./agent/lifecycle.js";
import { InlineRouter } from "./bot/inline-router.js";
import { PluginRateLimiter } from "./bot/rate-limiter.js";
import type { WebUIServer } from "./webui/server.js";
import type { ApiServer } from "./api/server.js";
import { HeartbeatRunner } from "./heartbeat.js";
import { ScheduledTaskHandler } from "./scheduled-tasks.js";
import { ProviderRuntime } from "./app/provider-runtime.js";
import { createServerDeps } from "./app/server-deps.js";
import { MessagePipeline } from "./app/message-pipeline.js";
import { AgentLifecycleController } from "./app/agent-lifecycle-controller.js";
import { deleteNestedValue, setNestedValue } from "./config/configurable-keys.js";

const log = createLogger("App");

export class TeletonApp {
  private config: Config;
  private agent: AgentRuntime;
  private bridge: ITelegramBridge;
  private messageHandler: MessageHandler;
  private adminHandler: AdminHandler;
  private toolRegistry: ToolRegistry;
  private modules: PluginModule[] = [];
  private memory: MemorySystem;
  private sdkDeps: SDKDependencies;
  private webuiServer: WebUIServer | null = null;
  private apiServer: ApiServer | null = null;
  private providerRuntime: ProviderRuntime;
  private lifecycle = new AgentLifecycle();
  private userHookEvaluator: UserHookEvaluator | null = null;
  private heartbeatRunner: HeartbeatRunner;
  private scheduledTaskHandler: ScheduledTaskHandler;
  private inlineRouter = new InlineRouter();
  private pluginRateLimiter = new PluginRateLimiter();
  private inlineMiddlewareBridge: ITelegramBridge | null = null;
  private messagePipeline: MessagePipeline;
  private agentLifecycleController = new AgentLifecycleController();

  private configPath: string;

  private buildServerDeps() {
    return createServerDeps({
      agent: this.agent,
      bridge: this.bridge,
      memory: this.memory,
      toolRegistry: this.toolRegistry,
      modules: this.modules,
      mcpConnections: this.agentLifecycleController.getMcpConnections(),
      config: this.config,
      configPath: this.configPath,
      lifecycle: this.lifecycle,
      sdkDeps: this.sdkDeps,
      userHookEvaluator: this.userHookEvaluator,
      rewireHooks: () => this.messagePipeline.wirePluginEventHooks(),
      stopGocoonRunner: () => this.stopGocoonRunner(),
      reloadConfig: () => loadConfig(this.configPath),
      applyConfigKey: (key, value) => this.applyHotConfigKey(key, value),
      getHookRegistry: () => this.agentLifecycleController.getHookRegistry(),
    });
  }

  private applyHotConfigKey(key: string, value: unknown): void {
    const runtimeConfig = this.config as unknown as Record<string, unknown>;
    if (value === undefined) deleteNestedValue(runtimeConfig, key);
    else setNestedValue(runtimeConfig, key, value);

    this.providerRuntime.updateConfig(this.config);
    this.agent.updateConfig(this.config);
    this.toolRegistry.setAllowFrom(this.config.telegram.allow_from ?? []);
    this.toolRegistry.setAdminIds(this.config.telegram.admin_ids);
    this.messageHandler.updateConfig(this.config);
    this.adminHandler.updateConfig(this.config.telegram);
    this.scheduledTaskHandler.updateConfig(this.config);
    this.heartbeatRunner.updateConfig(this.config);
    if (key === "telegram.debounce_ms") {
      this.messagePipeline.updateDebounceMs(this.config.telegram.debounce_ms);
    }
    initLoggerFromConfig(this.config.logging);

    if (key === "heartbeat.enabled" || key === "telegram.admin_ids") {
      this.heartbeatRunner.stop();
      const adminChatId = this.config.telegram.admin_ids[0];
      if (this.config.heartbeat.enabled && adminChatId) {
        this.heartbeatRunner.start(adminChatId, this.config.heartbeat.interval_ms);
      }
    }
  }

  /**
   * Stop the supervised gocoon runner + SSE proxy. A withdraw refuses to run
   * while the runner is active, so the Gocoon page calls this first. The agent
   * stays up; gocoon inference is unavailable until the next restart.
   */
  stopGocoonRunner(): boolean {
    return this.providerRuntime.stopGocoon();
  }

  constructor(configPath?: string) {
    this.configPath = configPath ?? getDefaultConfigPath();
    this.config = loadConfig(this.configPath);
    this.providerRuntime = new ProviderRuntime(this.config);

    // Wire YAML logging config to pino (H2 fix)
    initLoggerFromConfig(this.config.logging);

    if (this.config.tonapi_key) {
      setTonapiKey(this.config.tonapi_key);
    }
    if (this.config.toncenter_api_key) {
      setToncenterApiKey(this.config.toncenter_api_key);
    }

    const soul = loadSoul();

    this.toolRegistry = new ToolRegistry(this.config.telegram.mode);
    registerAllTools(this.toolRegistry);

    this.agent = new AgentRuntime(this.config, soul, this.toolRegistry);

    this.bridge = createBridge(this.config);
    this.heartbeatRunner = new HeartbeatRunner(this.agent, this.bridge, this.config);
    this.scheduledTaskHandler = new ScheduledTaskHandler(this.agent, this.bridge, this.config);

    const embeddingProvider = this.config.embedding.provider;
    this.memory = initializeMemory({
      database: {
        path: join(TELETON_ROOT, "memory.db"),
        enableVectorSearch: embeddingProvider !== "none",
        vectorDimensions: 384,
      },
      embeddings: {
        provider: embeddingProvider,
        model: this.config.embedding.model,
        apiKey: embeddingProvider === "anthropic" ? this.config.agent.api_key : undefined,
      },
      workspaceDir: join(TELETON_ROOT),
    });

    setKnowledgeIndexer(this.memory.knowledge);

    const db = getDatabase().getDb();

    this.userHookEvaluator = new UserHookEvaluator(db);
    this.agent.setUserHookEvaluator(this.userHookEvaluator);

    this.sdkDeps = { bridge: this.bridge };

    this.modules = loadModules(this.toolRegistry, this.config, db);

    const modulePermissions = new ModulePermissions(db);
    this.toolRegistry.setPermissions(modulePermissions);

    this.messageHandler = new MessageHandler(
      this.bridge,
      this.config.telegram,
      this.agent,
      db,
      this.memory.embedder,
      getDatabase().isVectorSearchReady(),
      this.config,
      this.memory.messages
    );

    this.adminHandler = new AdminHandler(
      this.bridge,
      this.config.telegram,
      this.agent,
      this.configPath,
      modulePermissions,
      this.toolRegistry
    );
    this.messagePipeline = new MessagePipeline(this.getMessagePipelineDependencies());
  }

  private getMessagePipelineDependencies() {
    return {
      config: this.config,
      bridge: this.bridge,
      agent: this.agent,
      messageHandler: this.messageHandler,
      adminHandler: this.adminHandler,
      scheduledTaskHandler: this.scheduledTaskHandler,
      modules: this.modules,
      inlineRouter: this.inlineRouter,
    };
  }

  /**
   * Get the lifecycle state machine for WebUI integration
   */
  getLifecycle(): AgentLifecycle {
    return this.lifecycle;
  }

  // --- Public accessors for API-only bootstrap mode ---

  getAgent(): AgentRuntime {
    return this.agent;
  }

  getBridge(): ITelegramBridge {
    return this.bridge;
  }

  getMemory(): MemorySystem {
    return this.memory;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getPlugins(): { name: string; version: string }[] {
    return this.modules
      .filter((m) => this.toolRegistry.isPluginModule(m.name))
      .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" }));
  }

  getWebuiConfig() {
    return this.config.webui;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  /** Start agent subsystems without WebUI/API servers. For bootstrap mode. */
  async startAgentSubsystems(): Promise<void> {
    this.lifecycle.registerCallbacks(
      () => this.startAgent(),
      () => this.stopAgent()
    );
    await this.lifecycle.start();
  }

  /** Stop agent subsystems and close database. For bootstrap mode. */
  async stopAgentSubsystems(): Promise<void> {
    await this.lifecycle.stop();
    await this.memory.dispose();
    try {
      closeDatabase();
    } catch (error: unknown) {
      log.error({ err: error }, "Database close failed");
    }
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    // ASCII banner (blue color)
    const blue = "\x1b[34m";
    const reset = "\x1b[0m";
    log.info(`
${blue}  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                       │
  │       ______________    ________________  _   __   ___   _____________   ________     │
  │      /_  __/ ____/ /   / ____/_  __/ __ \\/ | / /  /   | / ____/ ____/ | / /_  __/     │
  │       / / / __/ / /   / __/   / / / / / /  |/ /  / /| |/ / __/ __/ /  |/ / / /        │
  │      / / / /___/ /___/ /___  / / / /_/ / /|  /  / ___ / /_/ / /___/ /|  / / /         │
  │     /_/ /_____/_____/_____/ /_/  \\____/_/ |_/  /_/  |_\\____/_____/_/ |_/ /_/          │
  │                                                                                       │
  └────────────────────────────────────────────────────────────────── DEV: ZKPROOF.T.ME ──┘${reset}
`);

    // Register lifecycle callbacks so WebUI routes can call start()/stop() without args
    this.lifecycle.registerCallbacks(
      () => this.startAgent(),
      () => this.stopAgent()
    );

    // Start WebUI server if enabled (before agent — survives agent stop/restart)
    if (this.config.webui.enabled) {
      try {
        const { WebUIServer } = await import("./webui/server.js");
        this.webuiServer = new WebUIServer(this.buildServerDeps());
        await this.webuiServer.start();
      } catch (error) {
        log.error({ err: error }, "Failed to start WebUI server");
        log.warn("Continuing without WebUI...");
      }
    }

    // Start Management API server if enabled (before agent — survives agent stop/restart)
    if (this.config.api?.enabled) {
      try {
        const { ApiServer: ApiServerClass } = await import("./api/server.js");
        this.apiServer = new ApiServerClass(this.buildServerDeps(), this.config.api);
        await this.apiServer.start();

        // Output credentials if requested via --json-credentials flag
        if (process.env.TELETON_JSON_CREDENTIALS === "true") {
          const creds = this.apiServer.getCredentials();
          process.stdout.write(JSON.stringify(creds) + "\n");
        }
      } catch (error) {
        log.error({ err: error }, "Failed to start Management API server");
        log.warn("Continuing without Management API...");
      }
    }

    // Start agent subsystems via lifecycle
    await this.lifecycle.start(() => this.startAgent());

    // Keep process alive
    await new Promise(() => {});
  }

  /**
   * Start agent subsystems (Telegram, plugins, MCP, modules, debouncer, handler).
   * Called by lifecycle.start() — do NOT call directly.
   */
  private async startAgent(): Promise<void> {
    // Reload config from disk (mode switch writes YAML before restart)
    const previousMode = this.config.telegram.mode;
    const previousEmbeddingProvider = this.config.embedding.provider;
    const previousEmbeddingModel = this.config.embedding.model;
    const freshConfig = loadConfig(this.configPath);
    const modeChanged = freshConfig.telegram.mode !== previousMode;
    const embeddingChanged =
      freshConfig.embedding.provider !== previousEmbeddingProvider ||
      freshConfig.embedding.model !== previousEmbeddingModel;
    const stableConfig = this.config as unknown as Record<string, unknown>;
    for (const key of Object.keys(stableConfig)) delete stableConfig[key];
    Object.assign(stableConfig, freshConfig);
    this.providerRuntime.updateConfig(this.config);

    if (modeChanged) {
      log.info(`Mode changed to "${this.config.telegram.mode}", recreating Telegram bridge`);
      this.bridge = createBridge(this.config);
      this.sdkDeps.bridge = this.bridge;
      this.inlineMiddlewareBridge = null;
    }

    if (embeddingChanged) {
      await this.memory.dispose();
      Object.assign(this.memory, this.createMemorySystem());
      if (this.config.embedding.provider !== "none") {
        getDatabase().invalidateTelegramMessageEmbeddings();
      }
      setKnowledgeIndexer(this.memory.knowledge);
    }

    this.rebuildRuntimeGeneration();
    this.preparePluginBotRuntime();
    this.messagePipeline.update(this.getMessagePipelineDependencies());
    await this.agentLifecycleController.start({
      config: this.config,
      configPath: this.configPath,
      agent: this.agent,
      bridge: this.bridge,
      messageHandler: this.messageHandler,
      messagePipeline: this.messagePipeline,
      toolRegistry: this.toolRegistry,
      modules: this.modules,
      memory: this.memory,
      sdkDeps: this.sdkDeps,
      providerRuntime: this.providerRuntime,
      heartbeatRunner: this.heartbeatRunner,
    });
  }

  private createMemorySystem(): MemorySystem {
    const embeddingProvider = this.config.embedding.provider;
    return initializeMemory({
      database: {
        path: join(TELETON_ROOT, "memory.db"),
        enableVectorSearch: embeddingProvider !== "none",
        vectorDimensions: 384,
      },
      embeddings: {
        provider: embeddingProvider,
        model: this.config.embedding.model,
        apiKey: embeddingProvider === "anthropic" ? this.config.agent.api_key : undefined,
      },
      workspaceDir: join(TELETON_ROOT),
    });
  }

  /** Build a complete runtime generation so restarts cannot retain stale tools or handlers. */
  private rebuildRuntimeGeneration(): void {
    const db = getDatabase().getDb();
    const registry = this.toolRegistry;
    registry.reset(this.config.telegram.mode);
    registerAllTools(registry);
    registry.setAllowFrom(this.config.telegram.allow_from ?? []);
    registry.setAdminIds(this.config.telegram.admin_ids);
    const modulePermissions = new ModulePermissions(db);
    registry.setPermissions(modulePermissions);

    const nextModules = loadModules(registry, this.config, db);
    this.modules.splice(0, this.modules.length, ...nextModules);

    this.agent.updateConfig(this.config);
    this.agent.setToolRegistry(registry);
    this.agent.initializeContextBuilder(this.memory.embedder, this.memory.context);

    this.messageHandler = new MessageHandler(
      this.bridge,
      this.config.telegram,
      this.agent,
      db,
      this.memory.embedder,
      getDatabase().isVectorSearchReady(),
      this.config,
      this.memory.messages
    );
    this.adminHandler = new AdminHandler(
      this.bridge,
      this.config.telegram,
      this.agent,
      this.configPath,
      modulePermissions,
      registry
    );
    this.heartbeatRunner = new HeartbeatRunner(this.agent, this.bridge, this.config);
    this.scheduledTaskHandler = new ScheduledTaskHandler(this.agent, this.bridge, this.config);
  }

  private preparePluginBotRuntime(): void {
    this.inlineRouter.clearPlugins();
    this.inlineRouter.setCallbackObserver(null);
    this.pluginRateLimiter = new PluginRateLimiter();

    if (isBotBridge(this.bridge)) {
      this.sdkDeps.inlineRouter = this.inlineRouter;
      this.sdkDeps.gramjsBot = null;
      this.sdkDeps.grammyBot = this.bridge.getBot();
      this.sdkDeps.rateLimiter = this.pluginRateLimiter;

      if (this.inlineMiddlewareBridge !== this.bridge) {
        this.bridge.useMiddleware(this.inlineRouter.middleware());
        this.inlineMiddlewareBridge = this.bridge;
      }
      return;
    }

    this.sdkDeps.inlineRouter = null;
    this.sdkDeps.gramjsBot = null;
    this.sdkDeps.grammyBot = null;
    this.sdkDeps.rateLimiter = null;
  }

  /** Stop the application and all managed resources. */
  async stop(): Promise<void> {
    log.info("Stopping Teleton AI...");

    // Stop agent subsystems via lifecycle
    await this.lifecycle.stop(() => this.stopAgent());

    // Stop WebUI server (if running)
    if (this.webuiServer) {
      try {
        await this.webuiServer.stop();
      } catch (error: unknown) {
        log.error({ err: error }, "WebUI stop failed");
      }
    }

    // Stop Management API server (if running)
    if (this.apiServer) {
      try {
        await this.apiServer.stop();
      } catch (error: unknown) {
        log.error({ err: error }, "Management API stop failed");
      }
    }

    // Close database last (shared with WebUI)
    await this.memory.dispose();
    try {
      closeDatabase();
    } catch (error: unknown) {
      log.error({ err: error }, "Database close failed");
    }
  }

  /**
   * Stop agent subsystems (watcher, MCP, debouncer, handler, modules, bridge).
   * Called by lifecycle.stop() — do NOT call directly.
   */
  private async stopAgent(): Promise<void> {
    await this.agentLifecycleController.stop();
  }
}

/**
 * Start the application
 */
export async function main(configPath?: string): Promise<void> {
  let app: TeletonApp;
  try {
    app = new TeletonApp(configPath);
  } catch (error) {
    log.error(`Failed to initialize: ${getErrorMessage(error)}`);
    process.exit(1);
  }

  // Handle uncaught errors - log and keep running
  process.on("unhandledRejection", (reason) => {
    log.error({ err: reason }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (error) => {
    log.error({ err: error }, "Uncaught exception");
    // Exit on uncaught exceptions - state may be corrupted
    process.exit(1);
  });

  // Handle graceful shutdown with timeout safety net
  let shutdownInProgress = false;
  const gracefulShutdown = async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    const forceExit = setTimeout(() => {
      log.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    await app.stop();
    clearTimeout(forceExit);
    process.exit(0);
  };

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- signal handler is fire-and-forget
  process.on("SIGINT", gracefulShutdown);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- signal handler is fire-and-forget
  process.on("SIGTERM", gracefulShutdown);

  await app.start();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log.fatal({ err: error }, "Fatal error");
    process.exit(1);
  });
}
