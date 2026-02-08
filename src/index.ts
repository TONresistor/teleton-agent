import { loadConfig } from "./config/index.js";
import { loadSoul } from "./soul/index.js";
import { AgentRuntime } from "./agent/runtime.js";
import { TelegramBridge, type TelegramMessage } from "./telegram/bridge.js";
import { MessageHandler } from "./telegram/handlers.js";
import { AdminHandler } from "./telegram/admin.js";
import { MessageDebouncer } from "./telegram/debounce.js";
import { getDatabase, initializeMemory } from "./memory/index.js";
import { MarketPriceService } from "./market/price-service.js";
import { getWalletAddress } from "./ton/wallet-service.js";
import { setTonapiKey } from "./constants/api-endpoints.js";
import { TELETON_ROOT } from "./workspace/paths.js";
import { TELEGRAM_CONNECTION_RETRIES, TELEGRAM_FLOOD_SLEEP_THRESHOLD } from "./constants/limits.js";
import { join } from "path";
import { ToolRegistry } from "./agent/tools/registry.js";
import { registerAllTools } from "./agent/tools/register-all.js";
import { loadPlugins } from "./agent/tools/plugin-loader.js";
import { getProviderMetadata, type SupportedProvider } from "./config/providers.js";
import { DealBot, VerificationPoller } from "./bot/index.js";
import { initCasinoConfig } from "./casino/config.js";
import { initDealsConfig, DEALS_CONFIG } from "./deals/config.js";

/**
 * Main Tonnet application
 */
export class TonnetApp {
  private config;
  private agent: AgentRuntime;
  private bridge: TelegramBridge;
  private messageHandler: MessageHandler;
  private adminHandler: AdminHandler;
  private marketService: MarketPriceService | null = null;
  private debouncer: MessageDebouncer | null = null;
  private toolCount: number = 0;
  private toolRegistry: ToolRegistry;
  private dependencyResolver: any; // TaskDependencyResolver, imported lazily
  private dealBot: DealBot | null = null;
  private verificationPoller: VerificationPoller | null = null;
  private expiryInterval: ReturnType<typeof setInterval> | null = null;

  constructor(configPath?: string) {
    // Load configuration
    this.config = loadConfig(configPath);

    // Initialize subsystem configs from YAML
    initCasinoConfig(this.config.casino);
    initDealsConfig(this.config.deals);

    // Set TonAPI key if configured
    if (this.config.tonapi_key) {
      setTonapiKey(this.config.tonapi_key);
      console.log("🔑 TonAPI key configured");
    }

    // Load soul/personality
    const soul = loadSoul();

    // Create tool registry and register all tools
    this.toolRegistry = new ToolRegistry();
    registerAllTools(this.toolRegistry, this.config);

    // Initialize agent with tools
    this.toolCount = this.toolRegistry.count;
    this.agent = new AgentRuntime(this.config, soul, this.toolRegistry);

    // Initialize Telegram bridge with config
    this.bridge = new TelegramBridge({
      apiId: this.config.telegram.api_id,
      apiHash: this.config.telegram.api_hash,
      phone: this.config.telegram.phone,
      sessionPath: join(TELETON_ROOT, "telegram_session.txt"),
      connectionRetries: TELEGRAM_CONNECTION_RETRIES,
      autoReconnect: true,
      floodSleepThreshold: TELEGRAM_FLOOD_SLEEP_THRESHOLD,
    });

    // Get memory components (vector search disabled - requires Voyage API key)
    const VECTOR_DIMENSIONS = 512;
    const memory = initializeMemory({
      database: {
        path: join(TELETON_ROOT, "memory.db"),
        enableVectorSearch: false,
        vectorDimensions: VECTOR_DIMENSIONS,
      },
      embeddings: {
        provider: "none",
        apiKey: "",
        model: "",
      },
      workspaceDir: join(TELETON_ROOT),
    });

    const db = getDatabase().getDb();

    // Initialize market price service (if enabled, or required by deals)
    if (this.config.market.enabled || this.config.deals.enabled) {
      this.marketService = new MarketPriceService(this.config.market);
    }

    // Initialize handlers with memory stores
    this.messageHandler = new MessageHandler(
      this.bridge,
      this.config.telegram,
      this.agent,
      db,
      memory.embedder,
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vec'").get()
        ? true
        : false,
      this.marketService,
      this.config // Pass full config for vision tool API key access
    );

    this.adminHandler = new AdminHandler(this.bridge, this.config.telegram, this.agent);
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

    // Load plugins from ~/.teleton/plugins/
    const pluginCount = await loadPlugins(this.toolRegistry);
    if (pluginCount > 0) {
      this.toolCount = this.toolRegistry.count;
    }

    // Provider info and tool limit check
    const provider = (this.config.agent.provider || "anthropic") as SupportedProvider;
    const providerMeta = getProviderMetadata(provider);
    console.log(
      `✅ ${this.toolCount} tools loaded${pluginCount > 0 ? ` (${pluginCount} from plugins)` : ""}`
    );
    if (providerMeta.toolLimit !== null && this.toolCount > providerMeta.toolLimit) {
      console.warn(
        `⚠️ Tool count (${this.toolCount}) exceeds ${providerMeta.displayName} limit (${providerMeta.toolLimit})`
      );
    }

    // Migrate sessions from JSON to SQLite (one-time)
    const { migrateSessionsToDb } = await import("./session/migrate.js");
    migrateSessionsToDb();

    // Index knowledge base (MEMORY.md, memory/*.md)
    const memory = initializeMemory({
      database: {
        path: join(TELETON_ROOT, "memory.db"),
        enableVectorSearch: false,
        vectorDimensions: 512,
      },
      embeddings: {
        provider: "none",
        apiKey: "",
        model: "",
      },
      workspaceDir: join(TELETON_ROOT),
    });

    const indexResult = await memory.knowledge.indexAll();

    // Rebuild FTS indexes to ensure search works
    const db = getDatabase();
    const ftsResult = db.rebuildFtsIndexes();

    // Initialize context builder for RAG search in agent
    const vectorEnabled = db
      .getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vec'")
      .get()
      ? true
      : false;
    this.agent.initializeContextBuilder(memory.embedder, vectorEnabled);

    // Start market price service
    if (this.marketService) {
      await this.marketService.start();
    }

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

    // Start Deal Bot (inline buttons for deal confirmations)
    if (this.config.deals.enabled) {
      const botToken = this.config.telegram.bot_token;
      const botUsername = this.config.telegram.bot_username;
      if (botToken && botToken !== "YOUR_BOT_TOKEN_FROM_BOTFATHER") {
        try {
          this.dealBot = new DealBot(
            {
              token: botToken,
              username: botUsername || "deals_bot",
              apiId: this.config.telegram.api_id,
              apiHash: this.config.telegram.api_hash,
            },
            db.getDb()
          );
          await this.dealBot.start();

          // Start verification poller
          this.verificationPoller = new VerificationPoller(db.getDb(), this.bridge, this.dealBot, {
            pollIntervalMs: DEALS_CONFIG.verification.pollIntervalMs,
          });
          this.verificationPoller.start();

          console.log(`✅ Deal Bot: @${botUsername} connected`);
        } catch (botError) {
          console.warn(`⚠️ Deal Bot failed to start: ${botError}`);
        }
      } else {
        console.log(`⚠️ Deal Bot: not configured (set bot_token in config)`);
      }

      // Expire stale deals
      this.expiryInterval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        const r = db
          .getDb()
          .prepare(
            `UPDATE deals SET status = 'expired' WHERE status IN ('proposed', 'accepted') AND expires_at < ?`
          )
          .run(now);
        if (r.changes > 0) console.log(`⏰ Expired ${r.changes} stale deal(s)`);
      }, DEALS_CONFIG.expiryCheckIntervalMs);
    }

    // Display startup summary
    console.log(`✅ SOUL.md loaded`);
    console.log(
      `✅ Knowledge: ${indexResult.indexed} files, ${ftsResult.knowledge} chunks indexed`
    );
    if (this.marketService) {
      const marketStats = this.marketService.getStats();
      console.log(
        `✅ Gifts Market: ${marketStats.collections} collections, ${marketStats.models} models`
      );
    } else {
      console.log(`⏭️  Gifts Market: disabled`);
    }
    console.log(`✅ Telegram: @${username} connected`);
    console.log(`✅ TON Blockchain: connected`);
    console.log(`✅ DEXs: STON.fi, DeDust connected`);
    console.log(`✅ Wallet: ${walletAddress || "not configured"}`);
    console.log(`✅ Model: ${provider}/${this.config.agent.model}`);
    console.log(`✅ Admins: ${this.config.telegram.admin_ids.join(", ")}`);
    console.log(
      `✅ Policy: DM ${this.config.telegram.dm_policy}, Groups ${this.config.telegram.group_policy}, Debounce ${this.config.telegram.debounce_ms}ms\n`
    );

    console.log("Teleton Agent is running! Press Ctrl+C to stop.\n");

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
        const response = await this.adminHandler.handleCommand(
          adminCmd,
          message.chatId,
          message.senderId
        );

        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: response,
          replyToId: message.id,
        });

        return;
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
    try {
      // Extract task ID from format: [TASK:uuid] description
      const match = message.text.match(/^\[TASK:([^\]]+)\]/);
      if (!match) {
        console.warn("Invalid task format:", message.text);
        return;
      }

      const taskId = match[1];

      // Import TaskStore and task executor
      const { getTaskStore } = await import("./memory/agent/tasks.js");
      const { executeScheduledTask } = await import("./telegram/task-executor.js");
      const { getDatabase } = await import("./memory/index.js");

      const db = getDatabase().getDb();
      const taskStore = getTaskStore(db);
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
        marketService: this.marketService ?? undefined,
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
        const { TaskDependencyResolver } = await import("./telegram/task-dependency-resolver.js");
        this.dependencyResolver = new TaskDependencyResolver(taskStore, this.bridge);
      }

      // Trigger any dependent tasks
      await this.dependencyResolver.onTaskComplete(taskId);
    } catch (error) {
      console.error("Error handling scheduled task:", error);

      // Try to mark task as failed and cascade to dependents
      try {
        const { getTaskStore } = await import("./memory/agent/tasks.js");
        const { TaskDependencyResolver } = await import("./telegram/task-dependency-resolver.js");
        const { getDatabase } = await import("./memory/index.js");
        const db = getDatabase().getDb();
        const taskStore = getTaskStore(db);
        const match = message.text.match(/^\[TASK:([^\]]+)\]/);
        if (match) {
          const failedTaskId = match[1];
          taskStore.failTask(failedTaskId, error instanceof Error ? error.message : String(error));

          // Initialize resolver if needed
          if (!this.dependencyResolver) {
            this.dependencyResolver = new TaskDependencyResolver(taskStore, this.bridge);
          }

          // Cascade failure to dependents
          await this.dependencyResolver.onTaskFail(failedTaskId);
        }
      } catch (e) {
        // Ignore if we can't update task
      }
    }
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    console.log("\n👋 Stopping Tonnet AI...");

    // Flush any pending debounced messages
    if (this.debouncer) {
      await this.debouncer.flushAll();
    }

    // Stop verification poller
    if (this.verificationPoller) {
      this.verificationPoller.stop();
    }

    // Stop deal bot
    if (this.dealBot) {
      await this.dealBot.stop();
    }

    // Stop deal expiry interval
    if (this.expiryInterval) {
      clearInterval(this.expiryInterval);
    }

    // Stop market price service
    if (this.marketService) {
      this.marketService.stop();
    }

    await this.bridge.disconnect();
  }
}

/**
 * Start the application
 */
export async function main(configPath?: string): Promise<void> {
  const app = new TonnetApp(configPath);

  // Handle uncaught errors - log and keep running
  process.on("unhandledRejection", (reason) => {
    console.error("⚠️ Unhandled promise rejection:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("💥 Uncaught exception:", error);
    // Exit on uncaught exceptions - state may be corrupted
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    await app.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await app.stop();
    process.exit(0);
  });

  await app.start();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
