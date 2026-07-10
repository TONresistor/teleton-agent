import type { TSchema } from "@sinclair/typebox";
import type { ITelegramBridge } from "../../telegram/bridge-interface.js";
import type Database from "better-sqlite3";
import type { Config } from "../../config/schema.js";

/**
 * Context provided to tool executors
 */
export interface ToolContext {
  /** Telegram bridge for sending messages, reactions, etc. */
  bridge: ITelegramBridge;
  /** Database instance for storage */
  db: Database.Database;
  /** Current chat ID where the tool is being executed */
  chatId: string;
  /** Current user/sender ID */
  senderId: number;
  /** Whether this is a group chat */
  isGroup: boolean;
  /** Full config for accessing API key, model, etc. (optional) */
  config?: Config;
}

/**
 * Result returned by a tool execution
 */
export interface ToolResult {
  /** Whether the execution was successful */
  success: boolean;
  /** Result data (will be serialized to JSON for the LLM) */
  data?: unknown;
  /** Error message if failed */
  error?: string;
}

/**
 * Tool category for masking behavior
 */
export type ToolCategory = "data-bearing" | "action";

/** Runtime authority required to expose and execute a tool. */
export type ToolAccessLevel = "all" | "allowlist" | "admin" | "off";

/**
 * Tool scope for context-based filtering.
 * - "open": included in both DMs and groups (default, canonical form)
 * - "always": legacy alias for "open" (backward compat)
 * - "dm-only": excluded from group chats (financial, private tools)
 * - "group-only": excluded from DMs (moderation tools)
 * - "admin-only": restricted to admin users only
 * - "allowlist": restricted to allow_from user IDs (admins bypass)
 * - "disabled": tool completely hidden from all contexts
 */
export type ToolScope =
  | "open"
  | "always"
  | "dm-only"
  | "group-only"
  | "admin-only"
  | "allowlist"
  | "disabled";

/**
 * Telegram execution mode a tool supports.
 * - "user": userbot only — relies on an MTProto capability the Bot API lacks
 * - "bot": Bot API only — relies on a capability exclusive to bots
 * - "both": works identically in either mode
 *
 * Mandatory on every built-in tool: the compiler refuses an undeclared tool.
 */
export type ToolMode = "user" | "bot" | "both";

/**
 * The two runtime bridge modes a registry can operate in. A tool's "both" is a
 * declaration, not a runtime mode — the registry itself is always user or bot.
 */
export type RuntimeMode = Exclude<ToolMode, "both">;

/**
 * Tool definition compatible with pi-ai
 */
export interface Tool<TParameters extends TSchema = TSchema> {
  /** Unique tool name (e.g., "telegram_send_message") */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** TypeBox schema for parameter validation */
  parameters: TParameters;
  /** Tool category (affects masking behavior) */
  category?: ToolCategory;
}

/**
 * Tool executor function
 */
export type ToolExecutor<TParams = unknown> = (
  params: TParams,
  context: ToolContext
) => Promise<ToolResult>;

/**
 * Registered tool with executor
 */
export interface RegisteredTool {
  tool: Tool;
  executor: ToolExecutor;
  /** Declared non-trivial scope (undefined for the default always/open). */
  scope?: ToolScope;
  /** Hard authority floor. Runtime configuration may only make access stricter. */
  minimumAccess: ToolAccessLevel;
  /** Optional per-tool allowlist. When present, it replaces telegram.allow_from. */
  allowFrom?: ReadonlySet<number>;
  /** Whether execution requires a separate, human-authenticated approval step. */
  requiresApproval: boolean;
  /** Telegram mode this tool runs in. */
  mode: ToolMode;
  /** Module this tool belongs to (name prefix for built-ins, plugin name otherwise). */
  module: string;
  /** Toolset tags (e.g. "core", "finance"). */
  tags?: string[];
}

/**
 * Tool entry for category-level registration.
 * Each category index.ts exports a `tools: ToolEntry[]` array.
 */
export interface ToolEntry {
  tool: Tool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool executors accept varied param shapes
  executor: ToolExecutor<any>;
  scope?: ToolScope;
  /** Hard authority floor, independent from the DM/group channel scope. */
  minimumAccess?: ToolAccessLevel;
  /** Optional per-tool allowlist. When present, it replaces telegram.allow_from. */
  allowFrom?: readonly number[];
  /** Require a separate owner command before executing this tool. */
  requiresApproval?: boolean;
  /** Telegram mode(s) this tool runs in. Mandatory — every tool must declare it. */
  mode: ToolMode;
  /** Toolset tags for profile-based filtering (e.g. "core", "finance", "social") */
  tags?: string[];
}

/**
 * Built-in plugin module interface.
 * Modules are self-contained feature packs (ton-proxy, exec, etc.)
 * that register their own tools, config, and migrations.
 */
export interface PluginModule {
  name: string;
  version: string;
  /** Called ALWAYS (even if disabled) to merge YAML config into runtime defaults */
  configure?(config: Config): void;
  /** Called ALWAYS — must be idempotent (IF NOT EXISTS) */
  migrate?(db: Database.Database): void;
  /** Returns tools to register. Returns [] if the module is disabled. */
  tools(config: Config): Array<{
    tool: Tool;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool executors accept varied param shapes
    executor: ToolExecutor<any>;
    scope?: ToolScope;
    /** Optional per-tool allowlist. When present, it replaces telegram.allow_from. */
    allowFrom?: readonly number[];
    /** Telegram mode(s) this module tool runs in. Defaults to "both" when omitted. */
    mode?: ToolMode;
    /** Require an authenticated owner approval before execution. */
    requiresApproval?: boolean;
  }>;
  /** Start background jobs (polling, timers, etc.) */
  start?(context: PluginContext): Promise<void>;
  /** Stop background jobs */
  stop?(): Promise<void>;
}

/**
 * Context provided to plugin modules during start()
 */
export interface PluginContext {
  bridge: ITelegramBridge;
  db: Database.Database;
  config: Config;
  /** Plugin-specific config from config.yaml plugins section (external plugins only) */
  pluginConfig?: Record<string, unknown>;
  /** Prefixed logger for the plugin (external plugins only) */
  log?: (...args: unknown[]) => void;
}
