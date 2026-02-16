import { loadConfig } from "./config/index.js";
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
import { loadModules } from "./agent/tools/module-loader.js";
import { ModulePermissions } from "./agent/tools/module-permissions.js";
import { SHUTDOWN_TIMEOUT_MS } from "./constants/timeouts.js";
import type { PluginModule, PluginContext } from "./agent/tools/types.js";
import { PluginWatcher } from "./agent/tools/plugin-watcher.js";

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

  constructor(configPath?: string) {
    this.config = loadConfig(configPath);

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
   * Start the agent
   */
  async start(): Promise<void> {
    // ASCII banner (blue color)
    const blue = "\x1b[34m";
    const reset = "\x1b[0m";
    console.log(`
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
        console.error(
          `❌ Plugin "${mod.name}" failed to load:`,
          error instanceof Error ? error.message : error
        );
      }
    }
    if (pluginToolCount > 0) {
      this.toolCount = this.toolRegistry.count;
    }

    // Initialize tool config from database
    this.toolRegistry.loadConfigFromDB(getDatabase().getDb());

    // Provider info and tool limit check
    const provider = (this.config.agent.provider || "anthropic") as SupportedProvider;
    const providerMeta = getProviderMetadata(provider);
    const allNames = [...moduleNames, ...pluginNames];
    console.log(
      `🔌 ${this.toolCount} tools loaded (${allNames.join(", ")})${pluginToolCount > 0 ? ` — ${pluginToolCount} from plugins` : ""}`
    );
    if (providerMeta.toolLimit !== null && this.toolCount > providerMeta.toolLimit) {
      console.warn(
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

    // Initialize context builder for RAG search in agent
    this.agent.initializeContextBuilder(this.memory.embedder, db.isVectorSearchReady());

    // Connect to Telegram
    await this.bridge.connect();

    if (!this.bridge.isAvailable()) {
      console.error("❌ Failed to connect to Telegram");
      process.exit(1);
    }

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
      console.error("❌ Module start failed, cleaning up started modules:", error);
      for (const mod of startedModules.reverse()) {
        try {
          await mod.stop?.();
        } catch (e) {
          console.error(`⚠️ Module "${mod.name}" cleanup failed:`, e);
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
    console.log(`✅ SOUL.md loaded`);
    console.log(
      `✅ Knowledge: ${indexResult.indexed} files, ${ftsResult.knowledge} chunks indexed`
    );
    console.log(`✅ Telegram: @${username} connected`);
    console.log(`✅ TON Blockchain: connected`);
    if (this.config.tonapi_key) {
      console.log(`🔑 TonAPI key configured`);
    }
    console.log(`✅ DEXs: STON.fi, DeDust connected`);
    console.log(`✅ Wallet: ${walletAddress || "not configured"}`);
    console.log(`✅ Model: ${provider}/${this.config.agent.model}`);
    console.log(`✅ Admins: ${this.config.telegram.admin_ids.join(", ")}`);
    console.log(
      `✅ Policy: DM ${this.config.telegram.dm_policy}, Groups ${this.config.telegram.group_policy}, Debounce ${this.config.telegram.debounce_ms}ms\n`
    );

    console.log("Teleton Agent is running! Press Ctrl+C to stop.\n");

    // Start WebUI server if enabled
    if (this.config.webui.enabled) {
      try {
        const { WebUIServer } = await import("./webui/server.js");
        this.webuiServer = new WebUIServer({
          agent: this.agent,
          bridge: this.bridge,
          memory: this.memory,
          toolRegistry: this.toolRegistry,
          plugins: this.modules
            .filter((m) => this.toolRegistry.isPluginModule(m.name))
            .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" })),
          config: this.config.webui,
        });
        await this.webuiServer.start();
      } catch (error) {
        console.error("❌ Failed to start WebUI server:", error);
        console.warn("⚠️ Continuing without WebUI...");
      }
    }

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
        console.error(`Error processing batch of ${messages.length} messages:`, error);
      }
    );

    // Register event handler for new messages (with debouncing)
    this.bridge.onNewMessage(async (message) => {
      try {
        await this.debouncer!.enqueue(message);
      } catch (error) {
        console.error("Error enqueueing message:", error);
      }
    });

    // Keep process alive
    await new Promise(() => {});
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
      console.error("Error handling message:", error);
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
      console.warn("Invalid task format:", message.text);
      return;
    }

    const taskId = match[1];

    try {
      const task = taskStore.getTask(taskId);

      if (!task) {
        console.warn(`Task ${taskId} not found in database`);
        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: `⚠️ Task ${taskId} not found. It may have been deleted.`,
          replyToId: message.id,
        });
        return;
      }

      // Skip cancelled tasks (e.g. cancelled via WebUI or admin)
      if (task.status === "cancelled" || task.status === "done" || task.status === "failed") {
        console.log(`⏭️ Task ${taskId} already ${task.status}, skipping`);
        return;
      }

      // Check if all dependencies are satisfied
      if (!taskStore.canExecute(taskId)) {
        console.warn(`Task ${taskId} cannot execute yet - dependencies not satisfied`);
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

      console.log(`✅ Executed scheduled task ${taskId}: ${task.description}`);

      // Initialize dependency resolver if needed
      if (!this.dependencyResolver) {
        this.dependencyResolver = new TaskDependencyResolver(taskStore, this.bridge);
      }

      // Trigger any dependent tasks
      await this.dependencyResolver.onTaskComplete(taskId);
    } catch (error) {
      console.error("Error handling scheduled task:", error);

      // Try to mark task as failed and cascade to dependents
      try {
        taskStore.failTask(taskId, error instanceof Error ? error.message : String(error));

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
   * Collect plugin onMessage/onCallbackQuery hooks and register them
   */
  private wirePluginEventHooks(): void {
    const messageHooks: Array<
      (e: import("@teleton-agent/sdk").PluginMessageEvent) => Promise<void>
    > = [];
    const callbackHooks: Array<{
      pluginName: string;
      hook: (e: import("@teleton-agent/sdk").PluginCallbackEvent) => Promise<void>;
    }> = [];

    for (const mod of this.modules) {
      const withHooks = mod as PluginModuleWithHooks;
      if (withHooks.onMessage) {
        messageHooks.push(withHooks.onMessage);
      }
      if (withHooks.onCallbackQuery) {
        callbackHooks.push({ pluginName: mod.name, hook: withHooks.onCallbackQuery });
      }
    }

    // Pass message hooks to the handler
    if (messageHooks.length > 0) {
      this.messageHandler.setPluginMessageHooks(messageHooks);
      console.log(`🔗 ${messageHooks.length} plugin onMessage hook(s) registered`);
    }

    // Register callback query handler if any plugins have onCallbackQuery
    if (callbackHooks.length > 0) {
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
            console.error(
              "❌ Failed to answer callback query:",
              err instanceof Error ? err.message : err
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

        for (const { pluginName, hook } of callbackHooks) {
          try {
            await hook(event);
          } catch (err) {
            console.error(
              `❌ [${pluginName}] onCallbackQuery error:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      });
      console.log(`🔗 ${callbackHooks.length} plugin onCallbackQuery hook(s) registered`);
    }
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    console.log("\n👋 Stopping Teleton AI...");

    // Stop WebUI server first (if running)
    if (this.webuiServer) {
      try {
        await this.webuiServer.stop();
      } catch (e) {
        console.error("⚠️ WebUI stop failed:", e);
      }
    }

    // Stop plugin watcher first
    if (this.pluginWatcher) {
      try {
        await this.pluginWatcher.stop();
      } catch (e) {
        console.error("⚠️ Plugin watcher stop failed:", e);
      }
    }

    // Each step is isolated so a failure in one doesn't skip the rest
    if (this.debouncer) {
      try {
        await this.debouncer.flushAll();
      } catch (e) {
        console.error("⚠️ Debouncer flush failed:", e);
      }
    }

    // Drain in-flight message processing before disconnecting
    try {
      await this.messageHandler.drain();
    } catch (e) {
      console.error("⚠️ Message queue drain failed:", e);
    }

    for (const mod of this.modules) {
      try {
        await mod.stop?.();
      } catch (e) {
        console.error(`⚠️ Module "${mod.name}" stop failed:`, e);
      }
    }

    try {
      await this.bridge.disconnect();
    } catch (e) {
      console.error("⚠️ Bridge disconnect failed:", e);
    }

    try {
      closeDatabase();
    } catch (e) {
      console.error("⚠️ Database close failed:", e);
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
    console.error("Failed to initialize:", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Handle uncaught errors - log and keep running
  process.on("unhandledRejection", (reason) => {
    console.error("⚠️ Unhandled promise rejection:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("💥 Uncaught exception:", error);
    // Exit on uncaught exceptions - state may be corrupted
    process.exit(1);
  });

  // Handle graceful shutdown with timeout safety net
  let shutdownInProgress = false;
  const gracefulShutdown = async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    const forceExit = setTimeout(() => {
      console.error("⚠️ Shutdown timed out, forcing exit");
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
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
