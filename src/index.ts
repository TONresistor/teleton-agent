import { Api } from "telegram";
import { loadConfig, getDefaultConfigPath } from "./config/index.js";
import { loadSoul } from "./soul/index.js";
import { AgentRuntime } from "./agent/runtime.js";
import { TelegramBridge, type TelegramMessage } from "./telegram/bridge.js";
import { MessageHandler } from "./telegram/handlers.js";
import { AdminHandler } from "./telegram/admin.js";
import { MessageDebouncer } from "./telegram/debounce.js";
import { getDatabase, closeDatabase, initializeMemory, type MemorySystem } from "./memory/index.js";
import { getWalletAddress } from "./ton/wallet-service.js";
import { setTonapiKey } from "./constants/api-endpoints.js";
import { TELETON_ROOT } from "./workspace/paths.js";
import { TELEGRAM_CONNECTION_RETRIES, TELEGRAM_FLOOD_SLEEP_THRESHOLD } from "./constants/limits.js";
import { join } from "path";
import { ToolRegistry } from "./agent/tools/registry.js";
import { registerAllTools } from "./agent/tools/register-all.js";
import { loadEnhancedPlugins, type PluginModuleWithHooks } from "./agent/tools/plugin-loader.js";
import type { SDKDependencies } from "./sdk/index.js";
import { getProviderMetadata, type SupportedProvider } from "./config/providers.js";
import { readRawConfig, setNestedValue, writeRawConfig } from "./config/configurable-keys.js";
import { loadModules } from "./agent/tools/module-loader.js";
import { ModulePermissions } from "./agent/tools/module-permissions.js";
import { SHUTDOWN_TIMEOUT_MS } from "./constants/timeouts.js";
import type { PluginModule, PluginContext } from "./agent/tools/types.js";
import { PluginWatcher } from "./agent/tools/plugin-watcher.js";
import {
  loadMcpServers,
  registerMcpTools,
  closeMcpServers,
  type McpConnection,
} from "./agent/tools/mcp-loader.js";
import { getErrorMessage } from "./utils/errors.js";
import { createLogger, initLoggerFromConfig } from "./utils/logger.js";
import { AgentLifecycle } from "./agent/lifecycle.js";

const log = createLogger("App");

export class TeletonApp {
  private config;
  private agent: AgentRuntime;
  private bridge: TelegramBridge;
  private messageHandler: MessageHandler;
  private adminHandler: AdminHandler;
  private debouncer: MessageDebouncer | null = null;
  private toolCount: number = 0;
  private toolRegistry: ToolRegistry;
  private dependencyResolver: any; // TaskDependencyResolver, imported lazily
  private modules: PluginModule[] = [];
  private memory: MemorySystem;
  private sdkDeps: SDKDependencies;
  private webuiServer: any = null; // WebUIServer, imported lazily
  private pluginWatcher: PluginWatcher | null = null;
  private mcpConnections: McpConnection[] = [];
  private callbackHandlerRegistered = false;
  private lifecycle = new AgentLifecycle();

  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? getDefaultConfigPath();
    this.config = loadConfig(this.configPath);

    // Wire YAML logging config to pino (H2 fix)
    initLoggerFromConfig(this.config.logging);

    if (this.config.tonapi_key) {
      setTonapiKey(this.config.tonapi_key);
    }

    const soul = loadSoul();

    this.toolRegistry = new ToolRegistry();
    registerAllTools(this.toolRegistry);

    this.agent = new AgentRuntime(this.config, soul, this.toolRegistry);

    this.bridge = new TelegramBridge({
      apiId: this.config.telegram.api_id,
      apiHash: this.config.telegram.api_hash,
      phone: this.config.telegram.phone,
      sessionPath: join(TELETON_ROOT, "telegram_session.txt"),
      connectionRetries: TELEGRAM_CONNECTION_RETRIES,
      autoReconnect: true,
      floodSleepThreshold: TELEGRAM_FLOOD_SLEEP_THRESHOLD,
    });

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

    const db = getDatabase().getDb();

    this.sdkDeps = { bridge: this.bridge };

    this.modules = loadModules(this.toolRegistry, this.config, db);

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
        // Build MCP server info getter for WebUI (live status, not a snapshot)
        const mcpServers = () =>
          Object.entries(this.config.mcp.servers).map(([name, serverConfig]) => {
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

        const builtinNames = this.modules.map((m) => m.name);
        const pluginContext: PluginContext = {
          bridge: this.bridge,
          db: getDatabase().getDb(),
          config: this.config,
        };

        this.webuiServer = new WebUIServer({
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
        });
        await this.webuiServer.start();
      } catch (error) {
        log.error({ err: error }, "❌ Failed to start WebUI server");
        log.warn("⚠️ Continuing without WebUI...");
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
    // Load modules
    const moduleNames = this.modules
      .filter((m) => m.tools(this.config).length > 0)
      .map((m) => m.name);

    // Load enhanced plugins from ~/.teleton/plugins/
    const builtinNames = this.modules.map((m) => m.name);
    const externalModules = await loadEnhancedPlugins(this.config, builtinNames, this.sdkDeps);
    let pluginToolCount = 0;
    const pluginNames: string[] = [];
    for (const mod of externalModules) {
      try {
        mod.configure?.(this.config);
        mod.migrate?.(getDatabase().getDb());
        const tools = mod.tools(this.config);
        if (tools.length > 0) {
          pluginToolCount += this.toolRegistry.registerPluginTools(mod.name, tools);
          pluginNames.push(mod.name);
        }
        this.modules.push(mod);
      } catch (error) {
        log.error(
          `❌ Plugin "${mod.name}" failed to load: ${error instanceof Error ? error.message : error}`
        );
      }
    }
    if (pluginToolCount > 0) {
      this.toolCount = this.toolRegistry.count;
    }

    // Load MCP servers
    const mcpServerNames: string[] = [];
    if (Object.keys(this.config.mcp.servers).length > 0) {
      this.mcpConnections = await loadMcpServers(this.config.mcp);
      if (this.mcpConnections.length > 0) {
        const mcp = await registerMcpTools(this.mcpConnections, this.toolRegistry);
        if (mcp.count > 0) {
          this.toolCount = this.toolRegistry.count;
          mcpServerNames.push(...mcp.names);
          log.info(
            `🔌 MCP: ${mcp.count} tools from ${mcp.names.length} server(s) (${mcp.names.join(", ")})`
          );
        }
      }
    }

    // Initialize tool config from database
    this.toolRegistry.loadConfigFromDB(getDatabase().getDb());

    // Initialize Tool RAG index
    if (this.config.tool_rag.enabled) {
      const { ToolIndex } = await import("./agent/tools/tool-index.js");
      const toolIndex = new ToolIndex(
        getDatabase().getDb(),
        this.memory.embedder,
        getDatabase().isVectorSearchReady(),
        {
          topK: this.config.tool_rag.top_k,
          alwaysInclude: this.config.tool_rag.always_include,
          skipUnlimitedProviders: this.config.tool_rag.skip_unlimited_providers,
        }
      );
      toolIndex.ensureSchema();
      this.toolRegistry.setToolIndex(toolIndex);

      // Re-index callback for hot-reload plugins
      this.toolRegistry.onToolsChanged(async (removed, added) => {
        await toolIndex.reindexTools(removed, added);
      });
    }

    // Provider info and tool limit check
    const provider = (this.config.agent.provider || "anthropic") as SupportedProvider;
    const providerMeta = getProviderMetadata(provider);
    const allNames = [...moduleNames, ...pluginNames, ...mcpServerNames];
    log.info(
      `🔌 ${this.toolCount} tools loaded (${allNames.join(", ")})${pluginToolCount > 0 ? ` — ${pluginToolCount} from plugins` : ""}`
    );
    if (providerMeta.toolLimit !== null && this.toolCount > providerMeta.toolLimit) {
      log.warn(
        `⚠️ Tool count (${this.toolCount}) exceeds ${providerMeta.displayName} limit (${providerMeta.toolLimit})`
      );
    }

    // Migrate sessions from JSON to SQLite (one-time)
    const { migrateSessionsToDb } = await import("./session/migrate.js");
    migrateSessionsToDb();

    // Cleanup old transcript files (>30 days)
    const { cleanupOldTranscripts } = await import("./session/transcript.js");
    cleanupOldTranscripts(30);

    // Warmup embedding model (pre-download at startup, not on first message)
    if (this.memory.embedder.warmup) {
      await this.memory.embedder.warmup();
    }

    // Index knowledge base (MEMORY.md, memory/*.md)
    const indexResult = await this.memory.knowledge.indexAll();

    // Rebuild FTS indexes to ensure search works
    const db = getDatabase();
    const ftsResult = db.rebuildFtsIndexes();

    // Index tools for Tool RAG
    const toolIndex = this.toolRegistry.getToolIndex();
    if (toolIndex) {
      const t0 = Date.now();
      const indexedCount = await toolIndex.indexAll(this.toolRegistry.getAll());
      log.info(`🔍 Tool RAG: ${indexedCount} tools indexed (${Date.now() - t0}ms)`);
    }

    // Initialize context builder for RAG search in agent
    this.agent.initializeContextBuilder(this.memory.embedder, db.isVectorSearchReady());

    // Cocoon Network — register models from external cocoon-cli proxy
    if (this.config.agent.provider === "cocoon") {
      try {
        const { registerCocoonModels } = await import("./agent/client.js");
        const port = this.config.cocoon?.port ?? 10000;
        const models = await registerCocoonModels(port);
        if (models.length === 0) {
          throw new Error(`No models found on port ${port}`);
        }
        log.info(`Cocoon Network ready — ${models.length} model(s) on port ${port}`);
      } catch (err) {
        log.error(
          `Cocoon Network unavailable on port ${this.config.cocoon?.port ?? 10000}: ${getErrorMessage(err)}`
        );
        log.error("Start the Cocoon client first: cocoon start");
        throw new Error(`Cocoon Network unavailable: ${getErrorMessage(err)}`);
      }
    }

    // Local LLM — register models from OpenAI-compatible server
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
      } catch (err) {
        log.error(
          `Local LLM server unavailable at ${this.config.agent.base_url}: ${getErrorMessage(err)}`
        );
        log.error("Start the LLM server first (e.g. ollama serve)");
        throw new Error(`Local LLM server unavailable: ${getErrorMessage(err)}`);
      }
    }

    // Connect to Telegram
    await this.bridge.connect();

    if (!this.bridge.isAvailable()) {
      throw new Error("Failed to connect to Telegram");
    }

    // Resolve owner name/username from Telegram if not already set
    await this.resolveOwnerInfo();

    // Set own user ID in handler after connection
    const ownUserId = this.bridge.getOwnUserId();
    if (ownUserId) {
      this.messageHandler.setOwnUserId(ownUserId.toString());
    }

    const username = await this.bridge.getUsername();
    const walletAddress = getWalletAddress();

    // Start module background jobs (after bridge connect — deals needs bridge)
    const moduleDb = getDatabase().getDb();
    const pluginContext: PluginContext = {
      bridge: this.bridge,
      db: moduleDb,
      config: this.config,
    };
    const startedModules: typeof this.modules = [];
    try {
      for (const mod of this.modules) {
        await mod.start?.(pluginContext);
        startedModules.push(mod);
      }
    } catch (error) {
      log.error({ err: error }, "❌ Module start failed, cleaning up started modules");
      for (const mod of startedModules.reverse()) {
        try {
          await mod.stop?.();
        } catch (e) {
          log.error({ err: e }, `⚠️ Module "${mod.name}" cleanup failed`);
        }
      }
      throw error;
    }

    // Collect plugin event hooks and wire them up
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
    log.info(`✅ SOUL.md loaded`);
    log.info(`✅ Knowledge: ${indexResult.indexed} files, ${ftsResult.knowledge} chunks indexed`);
    log.info(`✅ Telegram: @${username} connected`);
    log.info(`✅ TON Blockchain: connected`);
    if (this.config.tonapi_key) {
      log.info(`🔑 TonAPI key configured`);
    }
    log.info(`✅ DEXs: STON.fi, DeDust connected`);
    log.info(`✅ Wallet: ${walletAddress || "not configured"}`);
    log.info(`✅ Model: ${provider}/${this.config.agent.model}`);
    log.info(`✅ Admins: ${this.config.telegram.admin_ids.join(", ")}`);
    log.info(
      `✅ Policy: DM ${this.config.telegram.dm_policy}, Groups ${this.config.telegram.group_policy}, Debounce ${this.config.telegram.debounce_ms}ms\n`
    );

    log.info("Teleton Agent is running! Press Ctrl+C to stop.");

    // Initialize message debouncer with bypass logic
    this.debouncer = new MessageDebouncer(
      {
        debounceMs: this.config.telegram.debounce_ms,
      },
      (msg) => {
        // Bypass debounce for DMs (only debounce groups)
        if (!msg.isGroup) return false;

        // Bypass debounce for admin commands (priority processing)
        if (msg.text.startsWith("/")) {
          const adminCmd = this.adminHandler.parseCommand(msg.text);
          if (adminCmd && this.adminHandler.isAdmin(msg.senderId)) {
            return false;
          }
        }

        return true;
      },
      async (messages) => {
        // Process each message one by one (preserves full context for each)
        for (const message of messages) {
          await this.handleSingleMessage(message);
        }
      },
      (error, messages) => {
        log.error({ err: error }, `Error processing batch of ${messages.length} messages`);
      }
    );

    // Register event handler for new messages (with debouncing)
    this.bridge.onNewMessage(async (message) => {
      try {
        await this.debouncer!.enqueue(message);
      } catch (error) {
        log.error({ err: error }, "Error enqueueing message");
      }
    });
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
        log.info(`👤 Owner resolved: ${displayName}${displayUsername}`);
      }
    } catch (error) {
      log.warn(
        `⚠️ Could not resolve owner info: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Handle a single message (extracted for debouncer callback)
   */
  private async handleSingleMessage(message: TelegramMessage): Promise<void> {
    try {
      // Check if this is a scheduled task (from self)
      const ownUserId = this.bridge.getOwnUserId();
      if (
        ownUserId &&
        message.senderId === Number(ownUserId) &&
        message.text.startsWith("[TASK:")
      ) {
        await this.handleScheduledTask(message);
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
   * Handle scheduled task message
   */
  private async handleScheduledTask(message: TelegramMessage): Promise<void> {
    // Hoist all dynamic imports to top of function
    const { getTaskStore } = await import("./memory/agent/tasks.js");
    const { executeScheduledTask } = await import("./telegram/task-executor.js");
    const { TaskDependencyResolver } = await import("./telegram/task-dependency-resolver.js");
    const { getDatabase } = await import("./memory/index.js");

    const db = getDatabase().getDb();
    const taskStore = getTaskStore(db);

    // Extract task ID from format: [TASK:uuid] description
    const match = message.text.match(/^\[TASK:([^\]]+)\]/);
    if (!match) {
      log.warn(`Invalid task format: ${message.text}`);
      return;
    }

    const taskId = match[1];

    try {
      const task = taskStore.getTask(taskId);

      if (!task) {
        log.warn(`Task ${taskId} not found in database`);
        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: `⚠️ Task ${taskId} not found. It may have been deleted.`,
          replyToId: message.id,
        });
        return;
      }

      // Skip cancelled tasks (e.g. cancelled via WebUI or admin)
      if (task.status === "cancelled" || task.status === "done" || task.status === "failed") {
        log.info(`⏭️ Task ${taskId} already ${task.status}, skipping`);
        return;
      }

      // Check if all dependencies are satisfied
      if (!taskStore.canExecute(taskId)) {
        log.warn(`Task ${taskId} cannot execute yet - dependencies not satisfied`);
        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: `⏳ Task "${task.description}" is waiting for parent tasks to complete.`,
          replyToId: message.id,
        });
        return;
      }

      // Mark task as in_progress
      taskStore.startTask(taskId);

      // Get parent task results for context
      const parentResults = taskStore.getParentResults(taskId);

      // Build tool context
      const toolContext = {
        bridge: this.bridge,
        db,
        chatId: message.chatId,
        isGroup: message.isGroup,
        senderId: message.senderId,
        config: this.config,
      };

      // Get tool registry from agent runtime
      const toolRegistry = this.agent.getToolRegistry();

      // Execute task and get prompt for agent (with parent context)
      const agentPrompt = await executeScheduledTask(
        task,
        this.agent,
        toolContext,
        toolRegistry,
        parentResults
      );

      // Feed prompt to agent (agent loop with full context)
      const response = await this.agent.processMessage(
        message.chatId,
        agentPrompt,
        "self-scheduled-task",
        message.timestamp.getTime(),
        false, // not group
        null, // no pending context
        toolContext,
        undefined,
        false,
        undefined,
        message.id
      );

      // Send agent response
      if (response.content && response.content.trim().length > 0) {
        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: response.content,
          replyToId: message.id,
        });
      }

      // Mark task as done if agent responded successfully
      taskStore.completeTask(taskId, response.content);

      log.info(`✅ Executed scheduled task ${taskId}: ${task.description}`);

      // Initialize dependency resolver if needed
      if (!this.dependencyResolver) {
        this.dependencyResolver = new TaskDependencyResolver(taskStore, this.bridge);
      }

      // Trigger any dependent tasks
      await this.dependencyResolver.onTaskComplete(taskId);
    } catch (error) {
      log.error({ err: error }, "Error handling scheduled task");

      // Try to mark task as failed and cascade to dependents
      try {
        taskStore.failTask(taskId, getErrorMessage(error));

        // Initialize resolver if needed
        if (!this.dependencyResolver) {
          this.dependencyResolver = new TaskDependencyResolver(taskStore, this.bridge);
        }

        // Cascade failure to dependents
        await this.dependencyResolver.onTaskFail(taskId);
      } catch (e) {
        // Ignore if we can't update task
      }
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
      async (event: import("@teleton-agent/sdk").PluginMessageEvent) => {
        for (const mod of this.modules) {
          const withHooks = mod as PluginModuleWithHooks;
          if (withHooks.onMessage) {
            try {
              await withHooks.onMessage(event);
            } catch (err) {
              log.error(
                `❌ [${mod.name}] onMessage error: ${err instanceof Error ? err.message : err}`
              );
            }
          }
        }
      },
    ]);

    const hookCount = this.modules.filter((m) => (m as PluginModuleWithHooks).onMessage).length;
    if (hookCount > 0) {
      log.info(`🔗 ${hookCount} plugin onMessage hook(s) registered`);
    }

    // Callback query handler: register ONCE, dispatch dynamically
    if (!this.callbackHandlerRegistered) {
      this.bridge.getClient().addCallbackQueryHandler(async (update: any) => {
        const queryId = update.queryId;
        const data = update.data?.toString() || "";
        const parts = data.split(":");
        const action = parts[0];
        const params = parts.slice(1);

        const chatId =
          update.peer?.channelId?.toString() ??
          update.peer?.chatId?.toString() ??
          update.peer?.userId?.toString() ??
          "";
        const messageId = update.msgId || 0;
        const userId = Number(update.userId);

        const answer = async (text?: string, alert = false): Promise<void> => {
          try {
            await this.bridge.getClient().answerCallbackQuery(queryId, { message: text, alert });
          } catch (err) {
            log.error(
              `❌ Failed to answer callback query: ${err instanceof Error ? err.message : err}`
            );
          }
        };

        const event: import("@teleton-agent/sdk").PluginCallbackEvent = {
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
            } catch (err) {
              log.error(
                `❌ [${mod.name}] onCallbackQuery error: ${err instanceof Error ? err.message : err}`
              );
            }
          }
        }
      });
      this.callbackHandlerRegistered = true;

      const cbCount = this.modules.filter(
        (m) => (m as PluginModuleWithHooks).onCallbackQuery
      ).length;
      if (cbCount > 0) {
        log.info(`🔗 ${cbCount} plugin onCallbackQuery hook(s) registered`);
      }
    }
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    log.info("👋 Stopping Teleton AI...");

    // Stop agent subsystems via lifecycle
    await this.lifecycle.stop(() => this.stopAgent());

    // Stop WebUI server (if running)
    if (this.webuiServer) {
      try {
        await this.webuiServer.stop();
      } catch (e) {
        log.error({ err: e }, "⚠️ WebUI stop failed");
      }
    }

    // Close database last (shared with WebUI)
    try {
      closeDatabase();
    } catch (e) {
      log.error({ err: e }, "⚠️ Database close failed");
    }
  }

  /**
   * Stop agent subsystems (watcher, MCP, debouncer, handler, modules, bridge).
   * Called by lifecycle.stop() — do NOT call directly.
   */
  private async stopAgent(): Promise<void> {
    // Stop plugin watcher first
    if (this.pluginWatcher) {
      try {
        await this.pluginWatcher.stop();
      } catch (e) {
        log.error({ err: e }, "⚠️ Plugin watcher stop failed");
      }
    }

    // Close MCP connections
    if (this.mcpConnections.length > 0) {
      try {
        await closeMcpServers(this.mcpConnections);
      } catch (e) {
        log.error({ err: e }, "⚠️ MCP close failed");
      }
    }

    // Each step is isolated so a failure in one doesn't skip the rest
    if (this.debouncer) {
      try {
        await this.debouncer.flushAll();
      } catch (e) {
        log.error({ err: e }, "⚠️ Debouncer flush failed");
      }
    }

    // Drain in-flight message processing before disconnecting
    try {
      await this.messageHandler.drain();
    } catch (e) {
      log.error({ err: e }, "⚠️ Message queue drain failed");
    }

    for (const mod of this.modules) {
      try {
        await mod.stop?.();
      } catch (e) {
        log.error({ err: e }, `⚠️ Module "${mod.name}" stop failed`);
      }
    }

    try {
      await this.bridge.disconnect();
    } catch (e) {
      log.error({ err: e }, "⚠️ Bridge disconnect failed");
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
    log.error(`Failed to initialize: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Handle uncaught errors - log and keep running
  process.on("unhandledRejection", (reason) => {
    log.error({ err: reason }, "⚠️ Unhandled promise rejection");
  });

  process.on("uncaughtException", (error) => {
    log.error({ err: error }, "💥 Uncaught exception");
    // Exit on uncaught exceptions - state may be corrupted
    process.exit(1);
  });

  // Handle graceful shutdown with timeout safety net
  let shutdownInProgress = false;
  const gracefulShutdown = async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    const forceExit = setTimeout(() => {
      log.error("⚠️ Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    await app.stop();
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on("SIGINT", gracefulShutdown);
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
