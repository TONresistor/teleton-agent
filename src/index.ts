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
import { ToolRegistry } from "./agent/tools/registry.js";
import { registerAllTools } from "./agent/tools/register-all.js";
import type { HookName, AgentStartEvent, AgentStopEvent } from "./sdk/hooks/types.js";
import { createHookRunner } from "./sdk/hooks/runner.js";
import type { HookRegistry } from "./sdk/hooks/registry.js";
import type { SDKDependencies } from "./sdk/index.js";
import type { SupportedProvider } from "./config/providers.js";
import { loadModules } from "./agent/tools/module-loader.js";
import { ModulePermissions } from "./agent/tools/module-permissions.js";
import { SHUTDOWN_TIMEOUT_MS } from "./constants/timeouts.js";

import type { PluginModule, PluginContext } from "./agent/tools/types.js";
import { PluginWatcher } from "./agent/tools/plugin-watcher.js";
import { loadMcpServers, closeMcpServers, type McpConnection } from "./agent/tools/mcp-loader.js";
import { getErrorMessage } from "./utils/errors.js";
import { UserHookEvaluator } from "./agent/hooks/user-hook-evaluator.js";
import { createLogger, initLoggerFromConfig } from "./utils/logger.js";
import { AgentLifecycle } from "./agent/lifecycle.js";
import { InlineRouter } from "./bot/inline-router.js";
import { PluginRateLimiter } from "./bot/rate-limiter.js";
import type { WebUIServer } from "./webui/server.js";
import type { ApiServer } from "./api/server.js";
import { HeartbeatRunner } from "./heartbeat.js";
import { StartupMaintenance } from "./startup-maintenance.js";
import { ScheduledTaskHandler } from "./scheduled-tasks.js";
import { PluginOrchestrator } from "./plugin-orchestrator.js";
import { PACKAGE_VERSION } from "./utils/package-info.js";
import { ProviderRuntime } from "./app/provider-runtime.js";
import {
  countPluginEventHooks,
  createUserPluginCallbackHandler,
  dispatchPluginCallback,
  dispatchPluginMessage,
} from "./app/plugin-events.js";
import { createServerDeps } from "./app/server-deps.js";
import { startPluginModules, stopPluginModules } from "./app/plugin-lifecycle.js";
import { resolveOwnerInfo } from "./app/owner-info.js";

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
  private providerRuntime: ProviderRuntime;
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
  private inlineRouter = new InlineRouter();
  private pluginRateLimiter = new PluginRateLimiter();
  private inlineMiddlewareBridge: ITelegramBridge | null = null;

  private configPath: string;

  private buildServerDeps() {
    return createServerDeps({
      agent: this.agent,
      bridge: this.bridge,
      memory: this.memory,
      toolRegistry: this.toolRegistry,
      modules: this.modules,
      mcpConnections: this.mcpConnections,
      config: this.config,
      configPath: this.configPath,
      lifecycle: this.lifecycle,
      sdkDeps: this.sdkDeps,
      userHookEvaluator: this.userHookEvaluator,
      rewireHooks: () => this.wirePluginEventHooks(),
      stopGocoonRunner: () => this.stopGocoonRunner(),
    });
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
    this.providerRuntime.updateConfig(this.config);

    if (modeChanged) {
      log.info(`Mode changed to "${this.config.telegram.mode}", recreating bridge & registry`);
      this.recreateForModeChange();
    }

    // Truncate stale external plugins from previous run (keep builtins only)
    this.modules.length = this.builtinModuleCount;
    this.preparePluginBotRuntime();

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
    await this.providerRuntime.initialize();

    // Connect to Telegram
    await this.bridge.connect();
    if (!this.bridge.isAvailable()) {
      throw new Error("Failed to connect to Telegram");
    }
    await resolveOwnerInfo(this.config, this.bridge, this.configPath);
    const ownUserId = this.bridge.getOwnUserId();
    if (ownUserId) {
      this.messageHandler.setOwnUserId(ownUserId.toString());
    }

    const username = await this.bridge.getUsername();
    const walletAddress = getWalletAddress();

    // Start module background jobs (after bridge connect)
    const pluginContext = await this.startModules();

    // Register every middleware and dynamic plugin hook before polling starts.
    const firstStart = !this.messageHandlersRegistered;
    this.installMessagePipeline();
    if (hookRegistry.hasAnyHooks()) this.installHookRunner(hookRegistry);
    this.wirePluginEventHooks();

    // Wire mode-specific handlers and start polling last.
    if (isBotBridge(this.bridge)) {
      this.wireBotMode(firstStart);
    } else {
      this.wireUserMode(firstStart);
    }

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
    const agentStartEvent: AgentStartEvent = {
      version: PACKAGE_VERSION,
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
    this.inlineMiddlewareBridge = null;
  }

  // ─── Mode-specific wiring ──────────────────────────────────────────────

  /**
   * Wire bot-mode SDK deps, callback handler, and Grammy polling.
   */
  private wireBotMode(firstStart: boolean): void {
    log.info("Bot mode: using main Grammy bridge");

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
      }
      // The middleware tree survives a WebUI stop/start, but long-polling does
      // not. Restart polling on every successful agent start.
      this.bridge.startPolling();
      void this.bridge.syncCommands();
    }
  }

  /**
   * Wire user-mode handlers. Registers the service message handler on first
   * start. (User mode has no Grammy bot, so the plugin bot SDK stays inactive.)
   */
  private wireUserMode(firstStart: boolean): void {
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
   * Start module background jobs with timeout.
   */
  private async startModules(): Promise<PluginContext> {
    const pluginContext: PluginContext = {
      bridge: this.bridge,
      db: getDatabase().getDb(),
      config: this.config,
    };
    await startPluginModules(this.modules, pluginContext);
    return pluginContext;
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
    this.messageHandler.setPluginMessageHooks([
      (event) => dispatchPluginMessage(this.modules, event),
    ]);

    const hookCount = countPluginEventHooks(this.modules, "onMessage");
    if (hookCount > 0) {
      log.info(`${hookCount} plugin onMessage hook(s) registered`);
    }

    if (!this.callbackHandlerRegistered && isUserBridge(this.bridge)) {
      const userBridge = this.bridge;
      userBridge
        .getClient()
        .addCallbackQueryHandler(
          createUserPluginCallbackHandler(userBridge, (event) =>
            dispatchPluginCallback(this.modules, event)
          )
        );
      this.callbackHandlerRegistered = true;

      const cbCount = countPluginEventHooks(this.modules, "onCallbackQuery");
      if (cbCount > 0) {
        log.info(`${cbCount} plugin onCallbackQuery hook(s) registered`);
      }
    } else if (!this.callbackHandlerRegistered && isBotBridge(this.bridge)) {
      this.inlineRouter.setCallbackObserver((event) => dispatchPluginCallback(this.modules, event));
      this.callbackHandlerRegistered = true;

      const cbCount = countPluginEventHooks(this.modules, "onCallbackQuery");
      if (cbCount > 0) {
        log.info(`${cbCount} plugin onCallbackQuery hook(s) registered`);
      }
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

    // Stop supervised provider resources (Gocoon runner/proxy when active).
    this.providerRuntime.stopGocoon();

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

    await stopPluginModules(this.modules);

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
