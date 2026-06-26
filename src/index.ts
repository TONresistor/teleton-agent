import type { Api } from "telegram";
import type { PluginMessageEvent, PluginCallbackEvent } from "@teleton-agent/sdk";
import { loadConfig, getDefaultConfigPath, type Config } from "./config/index.js";
import { loadSoul } from "./soul/index.js";
import { AgentRuntime } from "./agent/runtime.js";
import type { TelegramMessage } from "./telegram/bridge.js";
import type { ITelegramBridge } from "./telegram/bridge-interface.js";
import { isBotBridge, isUserBridge } from "./telegram/bridge-guards.js";
import { createBridge } from "./telegram/factory.js";
import { MessageHandler } from "./telegram/handlers.js";
import { AdminHandler } from "./telegram/admin.js";
import { MessageDebouncer } from "./telegram/debounce.js";
import { getDatabase, closeDatabase, initializeMemory, type MemorySystem } from "./memory/index.js";
import { setKnowledgeIndexer } from "./memory/agent/knowledge.js";
import { getWalletAddress } from "./ton/wallet-service.js";
import { setTonapiKey } from "./constants/api-endpoints.js";
import { setToncenterApiKey } from "./ton/endpoint.js";
import { TELETON_ROOT } from "./workspace/paths.js";
import { join } from "path";
import { existsSync } from "fs";
import type { GocoonSupervisor, GocoonSseProxy } from "./gocoon/index.js";
import { ToolRegistry } from "./agent/tools/registry.js";
import { registerAllTools } from "./agent/tools/register-all.js";
import { type PluginModuleWithHooks } from "./agent/tools/plugin-loader.js";
import type { HookName, AgentStartEvent, AgentStopEvent } from "./sdk/hooks/types.js";
import { createHookRunner } from "./sdk/hooks/runner.js";
import type { HookRegistry } from "./sdk/hooks/registry.js";
import type { SDKDependencies } from "./sdk/index.js";
import type { SupportedProvider } from "./config/providers.js";
import { readRawConfig, setNestedValue, writeRawConfig } from "./config/configurable-keys.js";
import { loadModules } from "./agent/tools/module-loader.js";
import { ModulePermissions } from "./agent/tools/module-permissions.js";
import { SHUTDOWN_TIMEOUT_MS } from "./constants/timeouts.js";

const PLUGIN_START_TIMEOUT_MS = 30_000;
const PLUGIN_STOP_TIMEOUT_MS = 30_000;
import type { PluginModule, PluginContext } from "./agent/tools/types.js";
import { PluginWatcher } from "./agent/tools/plugin-watcher.js";
import { loadMcpServers, closeMcpServers, type McpConnection } from "./agent/tools/mcp-loader.js";
import { getErrorMessage } from "./utils/errors.js";
import { UserHookEvaluator } from "./agent/hooks/user-hook-evaluator.js";
import { createLogger, initLoggerFromConfig } from "./utils/logger.js";
import { AgentLifecycle } from "./agent/lifecycle.js";
import { InlineRouter } from "./bot/inline-router.js";
import { PluginRateLimiter } from "./bot/rate-limiter.js";
import { setBotPreMiddleware, getDealBot } from "./deals/module.js";
import type { WebUIServer } from "./webui/server.js";
import type { ApiServer } from "./api/server.js";
import { HeartbeatRunner } from "./heartbeat.js";
import { StartupMaintenance } from "./startup-maintenance.js";
import { ScheduledTaskHandler } from "./scheduled-tasks.js";
import { PluginOrchestrator } from "./plugin-orchestrator.js";

const log = createLogger("App");

export class TeletonApp {
  private config: Config;
  private agent: AgentRuntime;
  private bridge: ITelegramBridge;
  private messageHandler: MessageHandler;
  private adminHandler: AdminHandler;
  private debouncer: MessageDebouncer | null = null;
  private toolCount: number = 0;
  private toolRegistry: ToolRegistry;
  private modules: PluginModule[] = [];
  private builtinModuleCount: number = 0;
  private memory: MemorySystem;
  private sdkDeps: SDKDependencies;
  private webuiServer: WebUIServer | null = null;
  private apiServer: ApiServer | null = null;
  private pluginWatcher: PluginWatcher | null = null;
  private gocoonSupervisor: GocoonSupervisor | null = null;
  private gocoonProxy: GocoonSseProxy | null = null;
  private mcpConnections: McpConnection[] = [];
  private callbackHandlerRegistered = false;
  private messageHandlersRegistered = false;
  private lifecycle = new AgentLifecycle();
  private hookRunner?: ReturnType<typeof createHookRunner>;
  private userHookEvaluator: UserHookEvaluator | null = null;
  private startTime: number = 0;
  private messagesProcessed: number = 0;
  private heartbeatRunner: HeartbeatRunner;
  private scheduledTaskHandler: ScheduledTaskHandler;

  private configPath: string;

  private getMcpServerInfo() {
    return Object.entries(this.config.mcp.servers).map(([name, serverConfig]) => {
      const type = serverConfig.command
        ? ("stdio" as const)
        : serverConfig.url
          ? ("streamable-http" as const)
          : ("sse" as const);
      const target = serverConfig.command ?? serverConfig.url ?? "";
      const connected = this.mcpConnections.some((c) => c.serverName === name);
      const moduleName = `mcp_${name}`;
      const moduleTools = this.toolRegistry.getModuleTools(moduleName);
      return {
        name,
        type,
        target,
        scope: serverConfig.scope ?? "always",
        enabled: serverConfig.enabled ?? true,
        connected,
        toolCount: moduleTools.length,
        tools: moduleTools.map((t) => t.name),
        envKeys: Object.keys(serverConfig.env ?? {}),
      };
    });
  }

  private buildServerDeps() {
    const mcpServers = () => this.getMcpServerInfo();
    const builtinNames = this.modules.map((m) => m.name);
    const pluginContext: PluginContext = {
      bridge: this.bridge,
      db: getDatabase().getDb(),
      config: this.config,
    };
    return {
      agent: this.agent,
      bridge: this.bridge,
      memory: this.memory,
      toolRegistry: this.toolRegistry,
      plugins: this.modules
        .filter((m) => this.toolRegistry.isPluginModule(m.name))
        .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" })),
      mcpServers,
      config: this.config.webui,
      configPath: this.configPath,
      lifecycle: this.lifecycle,
      marketplace: {
        modules: this.modules,
        config: this.config,
        sdkDeps: this.sdkDeps,
        pluginContext,
        loadedModuleNames: builtinNames,
        rewireHooks: () => this.wirePluginEventHooks(),
      },
      userHookEvaluator: this.userHookEvaluator,
      gocoonControl: {
        stopRunner: () => this.stopGocoonRunner(),
      },
    };
  }

  /**
   * Stop the supervised gocoon runner + SSE proxy. A withdraw refuses to run
   * while the runner is active, so the Gocoon page calls this first. The agent
   * stays up; gocoon inference is unavailable until the next restart.
   */
  stopGocoonRunner(): boolean {
    let stopped = false;
    if (this.gocoonProxy) {
      try {
        this.gocoonProxy.stop();
      } catch (error: unknown) {
        log.error({ err: error }, "gocoon sse-proxy stop failed");
      }
      this.gocoonProxy = null;
      stopped = true;
    }
    if (this.gocoonSupervisor) {
      try {
        this.gocoonSupervisor.stop();
      } catch (error: unknown) {
        log.error({ err: error }, "gocoon supervisor stop failed");
      }
      this.gocoonSupervisor = null;
      stopped = true;
    }
    return stopped;
  }

  constructor(configPath?: string) {
    this.configPath = configPath ?? getDefaultConfigPath();
    this.config = loadConfig(this.configPath);

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
    this.builtinModuleCount = this.modules.length;

    const modulePermissions = new ModulePermissions(db);
    this.toolRegistry.setPermissions(modulePermissions);

    this.toolCount = this.toolRegistry.count;
    this.messageHandler = new MessageHandler(
      this.bridge,
      this.config.telegram,
      this.agent,
      db,
      this.memory.embedder,
      getDatabase().isVectorSearchReady(),
      this.config
    );

    this.adminHandler = new AdminHandler(
      this.bridge,
      this.config.telegram,
      this.agent,
      this.configPath,
      modulePermissions,
      this.toolRegistry
    );
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
    const freshConfig = loadConfig(this.configPath);
    const modeChanged = freshConfig.telegram.mode !== this.config.telegram.mode;
    this.config = freshConfig;

    if (modeChanged) {
      log.info(`Mode changed to "${this.config.telegram.mode}", recreating bridge & registry`);
      this.recreateForModeChange();
    }

    // Truncate stale external plugins from previous run (keep builtins only)
    this.modules.length = this.builtinModuleCount;

    const builtinNames = this.modules.map((m) => m.name);
    const moduleNames = this.modules
      .filter((m) => m.tools(this.config).length > 0)
      .map((m) => m.name);

    // Load plugins, MCP servers, and configure tool registry
    this.mcpConnections =
      Object.keys(this.config.mcp.servers).length > 0 ? await loadMcpServers(this.config.mcp) : [];
    const orchestrator = new PluginOrchestrator(
      this.toolRegistry,
      this.config,
      this.sdkDeps,
      this.memory.embedder
    );
    const {
      pluginNames,
      pluginToolCount,
      mcpServerNames: _mcpServerNames,
      hookRegistry,
      externalModules,
      toolCount,
    } = await orchestrator.loadAll(builtinNames, moduleNames, this.mcpConnections);
    for (const mod of externalModules) this.modules.push(mod);
    if (pluginToolCount > 0 || toolCount !== this.toolCount) {
      this.toolCount = toolCount;
    }

    // Startup maintenance (migrations, prune, indexing, warmup)
    const maintenance = new StartupMaintenance(
      getDatabase().getDb(),
      this.config,
      this.configPath,
      { embedder: this.memory.embedder, knowledge: this.memory.knowledge }
    );
    const { indexResult, ftsResult } = await maintenance.run();

    // Index tools for Tool RAG
    const toolIndex = this.toolRegistry.getToolIndex();
    if (toolIndex) {
      const t0 = Date.now();
      const indexedCount = await toolIndex.indexAll(this.toolRegistry.getAll());
      log.info(`Tool RAG: ${indexedCount} tools indexed (${Date.now() - t0}ms)`);
    }

    // Initialize context builder for RAG search in agent
    this.agent.initializeContextBuilder(this.memory.embedder, getDatabase().isVectorSearchReady());

    // Register provider-specific models (gocoon / local LLM)
    await this.initializeProviders();

    // Connect to Telegram
    await this.bridge.connect();
    if (!this.bridge.isAvailable()) {
      throw new Error("Failed to connect to Telegram");
    }
    await this.resolveOwnerInfo();
    const ownUserId = this.bridge.getOwnUserId();
    if (ownUserId) {
      this.messageHandler.setOwnUserId(ownUserId.toString());
    }

    const username = await this.bridge.getUsername();
    const walletAddress = getWalletAddress();

    // Set up inline router and rate limiter
    const inlineRouter = new InlineRouter();
    const rateLimiter = new PluginRateLimiter();

    // User mode: install DealBot middleware before modules start
    if (isUserBridge(this.bridge)) {
      setBotPreMiddleware(inlineRouter.middleware());
    }

    // Start module background jobs (after bridge connect)
    const pluginContext = await this.startModules();

    // Wire mode-specific SDK deps, handlers, and polling
    const firstStart = !this.messageHandlersRegistered;
    if (isBotBridge(this.bridge)) {
      this.wireBotMode(inlineRouter, rateLimiter, firstStart);
    } else {
      this.wireUserMode(inlineRouter, rateLimiter, firstStart);
    }

    // Create hook runner if any plugins registered hooks
    if (hookRegistry.hasAnyHooks()) this.installHookRunner(hookRegistry);

    this.wirePluginEventHooks();

    // Start plugin hot-reload watcher (dev mode)
    if (this.config.dev.hot_reload) {
      this.pluginWatcher = new PluginWatcher({
        config: this.config,
        registry: this.toolRegistry,
        sdkDeps: this.sdkDeps,
        modules: this.modules,
        pluginContext,
        loadedModuleNames: builtinNames,
      });
      this.pluginWatcher.start();
    }

    // Display startup summary
    const provider = (this.config.agent.provider || "anthropic") as SupportedProvider;
    log.info(`SOUL.md loaded`);
    log.info(`Knowledge: ${indexResult.indexed} files, ${ftsResult.knowledge} chunks indexed`);
    log.info(`Telegram: @${username} connected`);
    log.info(`TON Blockchain: connected`);
    if (this.config.tonapi_key) {
      log.info(`TonAPI key configured`);
    }
    log.info(`DEXs: STON.fi, DeDust connected`);
    log.info(`Wallet: ${walletAddress || "not configured"}`);
    log.info(`Model: ${provider}/${this.config.agent.model}`);
    log.info(`Admins: ${this.config.telegram.admin_ids.join(", ")}`);
    log.info(
      `Policy: DM ${this.config.telegram.dm_policy}, Groups ${this.config.telegram.group_policy}, Debounce ${this.config.telegram.debounce_ms}ms\n`
    );
    log.info("Teleton Agent is running! Press Ctrl+C to stop.");

    // Hook: agent:start
    this.startTime = Date.now();
    this.messagesProcessed = 0;
    await this.emitAgentStartHook(provider, pluginNames.length);

    // Start heartbeat timer if enabled
    if (this.config.heartbeat.enabled) {
      const adminChatId = this.config.telegram.admin_ids[0];
      if (adminChatId) {
        this.heartbeatRunner.start(adminChatId, this.config.heartbeat.interval_ms);
      }
    }

    this.installMessagePipeline();
  }

  /** Create and install the plugin hook runner; log which hooks are active. */
  private installHookRunner(hookRegistry: HookRegistry): void {
    const hookRunner = createHookRunner(hookRegistry, { logger: log });
    this.agent.setHookRunner(hookRunner);
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
    const active = activeHooks.filter((n) => hookRegistry.hasHooks(n));
    log.info(`🪝 Hook runner created (${active.join(", ")})`);
  }

  /** Emit the agent:start observing hook (no-op when no hook runner). */
  private async emitAgentStartHook(
    provider: SupportedProvider,
    pluginCount: number
  ): Promise<void> {
    if (!this.hookRunner) return;
    let version = "0.0.0";
    try {
      const { createRequire } = await import("module");
      const req = createRequire(import.meta.url);
      version = (req("../package.json") as { version: string }).version;
    } catch {
      /* ignore */
    }
    const agentStartEvent: AgentStartEvent = {
      version,
      provider,
      model: this.config.agent.model,
      pluginCount,
      toolCount: this.toolCount,
      timestamp: Date.now(),
    };
    await this.hookRunner.runObservingHook("agent:start", agentStartEvent);
  }

  /**
   * Initialize the message debouncer and register the (one-time) new-message
   * listener that feeds it. Idempotent across agent restarts via the WebUI.
   */
  private installMessagePipeline(): void {
    this.debouncer = new MessageDebouncer(
      { debounceMs: this.config.telegram.debounce_ms },
      (msg) => {
        if (!msg.isGroup) return false;
        if (msg.text.startsWith("/")) {
          const adminCmd = this.adminHandler.parseCommand(msg.text);
          if (adminCmd && this.adminHandler.isAdmin(msg.senderId)) return false;
        }
        return true;
      },
      async (messages) => {
        for (const message of messages) {
          await this.handleSingleMessage(message);
        }
      },
      (error, messages) => {
        log.error({ err: error }, `Error processing batch of ${messages.length} messages`);
      }
    );

    // Register common message handler ONCE (survive agent restart via WebUI)
    if (!this.messageHandlersRegistered) {
      this.bridge.onNewMessage(async (message) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- debouncer always initialized before handlers register
          await this.debouncer!.enqueue(message);
        } catch (error) {
          log.error({ err: error }, "Error enqueueing message");
        }
      });
      this.messageHandlersRegistered = true;
    }
  }

  /**
   * Recreate the bridge, registry mode, and non-hot-swappable handlers after a
   * user/bot mode switch. Caller logs the switch and guards on modeChanged.
   */
  private recreateForModeChange(): void {
    // Recreate bridge for the new mode
    this.bridge = createBridge(this.config);
    this.sdkDeps.bridge = this.bridge;

    // Update tool registry mode (filters tools for user vs bot)
    this.toolRegistry.setMode(this.config.telegram.mode);
    if (this.config.telegram.allow_from?.length) {
      this.toolRegistry.setAllowFrom(this.config.telegram.allow_from);
    }

    // Swap bridge ref in handlers that hold it
    this.messageHandler.setBridge(this.bridge);

    // Recreate handlers that don't support hot-swap
    const db = getDatabase().getDb();
    const modulePermissions = new ModulePermissions(db);
    this.toolRegistry.setPermissions(modulePermissions);
    this.adminHandler = new AdminHandler(
      this.bridge,
      this.config.telegram,
      this.agent,
      this.configPath,
      modulePermissions,
      this.toolRegistry
    );
    this.heartbeatRunner = new HeartbeatRunner(this.agent, this.bridge, this.config);
    this.scheduledTaskHandler = new ScheduledTaskHandler(this.agent, this.bridge, this.config);

    // New bridge = new message listeners needed
    this.messageHandlersRegistered = false;
    this.callbackHandlerRegistered = false;
  }

  // ─── Mode-specific wiring ──────────────────────────────────────────────

  /**
   * Wire bot-mode SDK deps, callback handler, and Grammy polling.
   */
  private wireBotMode(
    inlineRouter: InlineRouter,
    rateLimiter: PluginRateLimiter,
    firstStart: boolean
  ): void {
    this.sdkDeps.inlineRouter = inlineRouter;
    this.sdkDeps.gramjsBot = null;
    this.sdkDeps.rateLimiter = rateLimiter;
    log.info("Bot mode: using main Grammy bridge (no DealBot)");

    if (isBotBridge(this.bridge)) {
      this.bridge.setCallbackHandler((msg) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- debouncer initialized before wireBotMode
        void this.debouncer!.enqueue(msg);
      });
      if (firstStart) {
        this.bridge.onGuestMessage(async (msg) => {
          if (!this.config.telegram.guest_mode) return "";
          if (this.adminHandler.isPaused()) return "";
          const response = await this.agent.processMessage({
            chatId: `telegram:guest:${msg.chatId}`,
            userMessage: msg.text,
            userName: msg.senderFirstName,
            senderUsername: msg.senderUsername,
            isGroup: true,
            isGuest: true,
            timestamp: msg.timestamp.getTime(),
            messageId: msg.id,
            toolContext: {
              bridge: this.bridge,
              db: getDatabase().getDb(),
              senderId: msg.senderId,
              config: this.config,
            },
          });
          return response.content;
        });
        this.bridge.startPolling();
      }
      void this.bridge.syncCommands();
    }
  }

  /**
   * Wire user-mode SDK deps from DealBot and register service message handler.
   */
  private wireUserMode(
    inlineRouter: InlineRouter,
    rateLimiter: PluginRateLimiter,
    firstStart: boolean
  ): void {
    const activeDealBot = getDealBot();
    if (activeDealBot) {
      this.sdkDeps.inlineRouter = inlineRouter;
      this.sdkDeps.gramjsBot = activeDealBot.getGramJSBot();
      this.sdkDeps.grammyBot = activeDealBot.getBot();
      this.sdkDeps.rateLimiter = rateLimiter;
      inlineRouter.setGramJSBot(activeDealBot.getGramJSBot());
      log.info("Bot SDK: inline router installed");
    }

    if (firstStart && isUserBridge(this.bridge)) {
      this.bridge.onServiceMessage(async (message) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- debouncer always initialized before handlers register
          await this.debouncer!.enqueue(message);
        } catch (error) {
          log.error({ err: error }, "Error enqueueing service message");
        }
      });
    }
  }

  /**
   * Register provider-specific models (gocoon / local LLM).
   */
  private async initializeProviders(): Promise<void> {
    if (this.config.agent.provider === "gocoon") {
      const port = this.config.gocoon?.port ?? 10000;
      const autoStart = this.config.gocoon?.auto_start ?? true;
      try {
        if (autoStart) {
          const {
            ensureGocoonBinaries,
            GocoonSupervisor,
            runnerBaseUrl,
            clientConfigPath,
            walletInfo,
          } = await import("./gocoon/index.js");
          if (!existsSync(clientConfigPath())) {
            throw new Error(
              "gocoon is not set up yet; run `teleton gocoon init` (or use the Gocoon page) first"
            );
          }
          await ensureGocoonBinaries();
          // Opening the channel needs free TON on-chain; fail clearly instead of a health timeout.
          const wallet = await walletInfo();
          if (wallet.balanceNano < 2_000_000_000n) {
            throw new Error(
              `COCOON wallet has ${wallet.balanceTon} TON; gocoon needs at least 2 TON free to open the channel. ` +
                `Fund ${wallet.fundAddress} (Gocoon page or \`teleton gocoon init\`), then restart.`
            );
          }
          this.gocoonSupervisor = new GocoonSupervisor({
            configPath: clientConfigPath(),
            healthUrl: `${runnerBaseUrl(port)}/v1/models`,
            startGraceMs: 60_000, // first on-chain channel registration can take ~60s
          });
          await this.gocoonSupervisor.start();
          log.info(`Gocoon runner started on port ${port}`);
        }
        // pi-ai always streams and only parses SSE; the gocoon runner returns a
        // single JSON document. Front the runner with a local proxy that frames
        // its reply as SSE so streaming clients parse it. Keeps gocoon untouched.
        const { GocoonSseProxy } = await import("./gocoon/index.js");
        this.gocoonProxy = new GocoonSseProxy({ runnerPort: port });
        await this.gocoonProxy.start();
        const { registerGocoonModels } = await import("./agent/client.js");
        const models = await registerGocoonModels(this.gocoonProxy.port);
        if (models.length === 0) {
          throw new Error(`No models found on port ${port}`);
        }
        log.info(
          `Gocoon ready: ${models.length} model(s) (runner ${port}, sse-proxy ${this.gocoonProxy.port})`
        );
      } catch (error: unknown) {
        // Non-fatal: keep the agent and WebUI alive so gocoon can be installed and
        // funded from the Gocoon page, then a restart activates it.
        log.warn(`Gocoon not ready: ${getErrorMessage(error)}`);
        log.warn(
          "Agent is up but can't chat until gocoon is funded. Open the Gocoon page (or run `teleton gocoon init`), then restart."
        );
      }
    }

    if (this.config.agent.provider === "local" && !this.config.agent.base_url) {
      throw new Error(
        "Local provider requires base_url in config (e.g. http://localhost:11434/v1)"
      );
    }
    if (this.config.agent.provider === "local" && this.config.agent.base_url) {
      try {
        const { registerLocalModels } = await import("./agent/client.js");
        const models = await registerLocalModels(this.config.agent.base_url);
        if (models.length > 0) {
          log.info(`Discovered ${models.length} local model(s): ${models.join(", ")}`);
          if (!this.config.agent.model || this.config.agent.model === "auto") {
            this.config.agent.model = models[0];
            log.info(`Using local model: ${models[0]}`);
          }
        } else {
          log.warn("No models found on local LLM server — is it running?");
        }
      } catch (error: unknown) {
        log.error(
          `Local LLM server unavailable at ${this.config.agent.base_url}: ${getErrorMessage(error)}`
        );
        log.error("Start the LLM server first (e.g. ollama serve)");
        throw new Error(`Local LLM server unavailable: ${getErrorMessage(error)}`);
      }
    }
  }

  /**
   * Start module background jobs with timeout. Skips deals module in bot mode.
   */
  private async startModules(): Promise<PluginContext> {
    const moduleDb = getDatabase().getDb();
    const pluginContext: PluginContext = {
      bridge: this.bridge,
      db: moduleDb,
      config: this.config,
    };
    const startedModules: typeof this.modules = [];
    try {
      for (const mod of this.modules) {
        if (isBotBridge(this.bridge) && mod.name === "deals") {
          log.info("Bot mode: skipping deals module (uses separate Grammy polling)");
          continue;
        }
        await Promise.race([
          mod.start?.(pluginContext),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Plugin "${mod.name}" start() timed out after 30s`)),
              PLUGIN_START_TIMEOUT_MS
            )
          ),
        ]);
        startedModules.push(mod);
      }
    } catch (error) {
      log.error({ err: error }, "Module start failed, cleaning up started modules");
      for (const mod of startedModules.reverse()) {
        try {
          await Promise.race([
            mod.stop?.(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Plugin "${mod.name}" stop() timed out after 30s`)),
                PLUGIN_STOP_TIMEOUT_MS
              )
            ),
          ]);
        } catch (innerError: unknown) {
          log.error({ err: innerError }, `Module "${mod.name}" cleanup failed`);
        }
      }
      throw error;
    }
    return pluginContext;
  }

  /**
   * Resolve owner name and username from Telegram API if not already configured.
   * Persists resolved values to the config file so this only happens once.
   */
  private async resolveOwnerInfo(): Promise<void> {
    try {
      // Skip if both are already set
      if (this.config.telegram.owner_name && this.config.telegram.owner_username) {
        return;
      }

      // Can't resolve without an owner ID
      if (!this.config.telegram.owner_id) {
        return;
      }

      if (!isUserBridge(this.bridge)) return;
      const entity = await this.bridge.getClient().getEntity(String(this.config.telegram.owner_id));

      // Check that the entity is a User (has firstName)
      if (!entity || !("firstName" in entity)) {
        return;
      }

      const user = entity as Api.User;
      const firstName = user.firstName || "";
      const lastName = user.lastName || "";
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;
      const username = user.username || "";

      let updated = false;

      if (!this.config.telegram.owner_name && fullName) {
        this.config.telegram.owner_name = fullName;
        updated = true;
      }

      if (!this.config.telegram.owner_username && username) {
        this.config.telegram.owner_username = username;
        updated = true;
      }

      if (updated) {
        // Persist to disk
        const raw = readRawConfig(this.configPath);
        if (this.config.telegram.owner_name) {
          setNestedValue(raw, "telegram.owner_name", this.config.telegram.owner_name);
        }
        if (this.config.telegram.owner_username) {
          setNestedValue(raw, "telegram.owner_username", this.config.telegram.owner_username);
        }
        writeRawConfig(raw, this.configPath);

        const displayName = this.config.telegram.owner_name || "Unknown";
        const displayUsername = this.config.telegram.owner_username
          ? ` (@${this.config.telegram.owner_username})`
          : "";
        log.info(`Owner resolved: ${displayName}${displayUsername}`);
      }
    } catch (error) {
      log.warn(`Could not resolve owner info: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Handle a single message (extracted for debouncer callback)
   */
  private async handleSingleMessage(message: TelegramMessage): Promise<void> {
    this.messagesProcessed++;
    try {
      // Check if this is a scheduled task (from self)
      const ownUserId = this.bridge.getOwnUserId();
      if (
        ownUserId &&
        message.senderId === Number(ownUserId) &&
        message.text.startsWith("[TASK:")
      ) {
        await this.scheduledTaskHandler.execute(message);
        return;
      }

      // Check if this is an admin command
      const adminCmd = this.adminHandler.parseCommand(message.text);
      if (adminCmd && this.adminHandler.isAdmin(message.senderId)) {
        // /boot passes through to the agent with bootstrap instructions
        if (adminCmd.command === "boot") {
          const bootstrapContent = this.adminHandler.getBootstrapContent();
          if (bootstrapContent) {
            message.text = bootstrapContent;
            // Fall through to handleMessage below
          } else {
            await this.bridge.sendMessage({
              chatId: message.chatId,
              text: "❌ Bootstrap template not found.",
              replyToId: message.id,
            });
            return;
          }
        } else if (adminCmd.command === "task") {
          // /task passes through to the agent with task creation context
          const taskDescription = adminCmd.args.join(" ");
          if (!taskDescription) {
            await this.bridge.sendMessage({
              chatId: message.chatId,
              text: "❌ Usage: /task <description>",
              replyToId: message.id,
            });
            return;
          }
          message.text =
            `[ADMIN TASK]\n` +
            `Create a scheduled task using the telegram_create_scheduled_task tool.\n\n` +
            `Guidelines:\n` +
            `- If the description mentions a specific time or delay, use it as scheduleDate\n` +
            `- Otherwise, schedule 1 minute from now for immediate execution\n` +
            `- For simple operations (check a price, send a message), use a tool_call payload\n` +
            `- For complex multi-step tasks, use an agent_task payload with detailed instructions\n` +
            `- Always include a reason explaining why this task is being created\n\n` +
            `Task: "${taskDescription}"`;
          // Fall through to handleMessage below
        } else {
          const response = await this.adminHandler.handleCommand(
            adminCmd,
            message.chatId,
            message.senderId,
            message.isGroup
          );

          await this.bridge.sendMessage({
            chatId: message.chatId,
            text: response,
            replyToId: message.id,
          });

          return;
        }
      }

      // Skip if paused (admin commands still work above)
      if (this.adminHandler.isPaused()) return;

      // Handle as regular message
      await this.messageHandler.handleMessage(message);
    } catch (error) {
      log.error({ err: error }, "Error handling message");
    }
  }

  /**
   * Collect plugin onMessage/onCallbackQuery hooks and register them.
   * Uses dynamic dispatch over this.modules so newly installed/uninstalled
   * plugins are picked up without re-registering handlers.
   */
  private wirePluginEventHooks(): void {
    // Message hooks: single dynamic dispatcher that iterates this.modules
    this.messageHandler.setPluginMessageHooks([
      async (event: PluginMessageEvent) => {
        for (const mod of this.modules) {
          const withHooks = mod as PluginModuleWithHooks;
          if (withHooks.onMessage) {
            try {
              await withHooks.onMessage(event);
            } catch (error: unknown) {
              log.error(`❌ [${mod.name}] onMessage error: ${getErrorMessage(error)}`);
            }
          }
        }
      },
    ]);

    const hookCount = this.modules.filter((m) => (m as PluginModuleWithHooks).onMessage).length;
    if (hookCount > 0) {
      log.info(`${hookCount} plugin onMessage hook(s) registered`);
    }

    // Callback query handler: register ONCE, dispatch dynamically
    if (!this.callbackHandlerRegistered && isUserBridge(this.bridge)) {
      const userBridge = this.bridge;
      userBridge.getClient().addCallbackQueryHandler(async (update: unknown) => {
        if (!update || typeof update !== "object") {
          return;
        }
        const callbackUpdate = update as {
          queryId?: unknown;
          data?: { toString(): string } | string;
          peer?: {
            channelId?: { toString(): string };
            chatId?: { toString(): string };
            userId?: { toString(): string };
          };
          msgId?: unknown;
          userId?: unknown;
        };
        const queryId = callbackUpdate.queryId;
        const data =
          typeof callbackUpdate.data === "string"
            ? callbackUpdate.data
            : callbackUpdate.data?.toString() || "";
        const parts = data.split(":");
        const action = parts[0];
        const params = parts.slice(1);

        const chatId =
          callbackUpdate.peer?.channelId?.toString() ??
          callbackUpdate.peer?.chatId?.toString() ??
          callbackUpdate.peer?.userId?.toString() ??
          "";
        const messageId =
          typeof callbackUpdate.msgId === "number"
            ? callbackUpdate.msgId
            : Number(callbackUpdate.msgId || 0);
        const userId = Number(callbackUpdate.userId);

        const answer = async (text?: string, alert = false): Promise<void> => {
          try {
            await userBridge.getClient().answerCallbackQuery(queryId, { message: text, alert });
          } catch (error: unknown) {
            log.error(`❌ Failed to answer callback query: ${getErrorMessage(error)}`);
          }
        };

        const event: PluginCallbackEvent = {
          data,
          action,
          params,
          chatId,
          messageId,
          userId,
          answer,
        };

        for (const mod of this.modules) {
          const withHooks = mod as PluginModuleWithHooks;
          if (withHooks.onCallbackQuery) {
            try {
              await withHooks.onCallbackQuery(event);
            } catch (error: unknown) {
              log.error(`❌ [${mod.name}] onCallbackQuery error: ${getErrorMessage(error)}`);
            }
          }
        }
      });
      this.callbackHandlerRegistered = true;

      const cbCount = this.modules.filter(
        (m) => (m as PluginModuleWithHooks).onCallbackQuery
      ).length;
      if (cbCount > 0) {
        log.info(`${cbCount} plugin onCallbackQuery hook(s) registered`);
      }
    } else if (!this.callbackHandlerRegistered && this.bridge.getMode() === "bot") {
      // In bot mode, callback queries are handled by GrammyBotBridge's callback_query:data handler
      // TODO: dispatch plugin onCallbackQuery hooks from Grammy callback handler
      this.callbackHandlerRegistered = true;
    }
  }

  /**
   * Stop the agent
   */
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
    // Stop heartbeat timer
    this.heartbeatRunner.stop();

    // Hook: agent:stop — fire BEFORE disconnecting anything
    if (this.hookRunner) {
      try {
        const agentStopEvent: AgentStopEvent = {
          reason: "manual",
          uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
          messagesProcessed: this.messagesProcessed,
          timestamp: Date.now(),
        };
        await this.hookRunner.runObservingHook("agent:stop", agentStopEvent);
      } catch (error: unknown) {
        log.error({ err: error }, "agent:stop hook failed");
      }
    }

    // Stop plugin watcher first
    if (this.pluginWatcher) {
      try {
        await this.pluginWatcher.stop();
      } catch (error: unknown) {
        log.error({ err: error }, "Plugin watcher stop failed");
      }
    }

    // Stop the gocoon SSE proxy and runner (when teleton supervises them)
    if (this.gocoonProxy) {
      try {
        this.gocoonProxy.stop();
      } catch (error: unknown) {
        log.error({ err: error }, "gocoon sse-proxy stop failed");
      }
    }
    if (this.gocoonSupervisor) {
      try {
        this.gocoonSupervisor.stop();
      } catch (error: unknown) {
        log.error({ err: error }, "gocoon supervisor stop failed");
      }
    }

    // Close MCP connections
    if (this.mcpConnections.length > 0) {
      try {
        await closeMcpServers(this.mcpConnections);
      } catch (error: unknown) {
        log.error({ err: error }, "MCP close failed");
      }
    }

    // Each step is isolated so a failure in one doesn't skip the rest
    if (this.debouncer) {
      try {
        await this.debouncer.flushAll();
      } catch (error: unknown) {
        log.error({ err: error }, "Debouncer flush failed");
      }
    }

    // Drain in-flight message processing before disconnecting
    try {
      await this.messageHandler.drain();
    } catch (error: unknown) {
      log.error({ err: error }, "Message queue drain failed");
    }

    for (const mod of this.modules) {
      try {
        await Promise.race([
          mod.stop?.(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Plugin "${mod.name}" stop() timed out after 30s`)),
              PLUGIN_STOP_TIMEOUT_MS
            )
          ),
        ]);
      } catch (error: unknown) {
        log.error({ err: error }, `Module "${mod.name}" stop failed`);
      }
    }

    this.callbackHandlerRegistered = false;
    // messageHandlersRegistered stays true — Grammy Bot instance retains its middleware tree
    // across stop/start cycles; re-registering would throw "registering listeners from within listeners"
    try {
      await this.bridge.disconnect();
    } catch (error: unknown) {
      log.error({ err: error }, "Bridge disconnect failed");
    }
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
