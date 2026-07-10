import type Database from "better-sqlite3";
import type { TonSDK } from "./ton.js";
import type { TelegramSDK } from "./telegram.js";
import type { PluginLogger } from "./common.js";

// ─── Secrets Types ──────────────────────────────────────────────

/** Manifest secret declaration */
export interface SecretDeclaration {
  /** Whether this secret is required for the plugin to function */
  required: boolean;
  /** Human-readable description shown when prompting admin */
  description: string;
  /** Namespaced override (must start with TELETON_PLUGIN_PLUGIN_NAME_) */
  env?: string;
}

/**
 * Secure access to plugin secrets (API keys, tokens, credentials).
 *
 * Resolution order:
 * 1. Declared environment variable override, or TELETON_PLUGIN_PLUGINNAME_KEY
 * 2. Secrets store (set via /plugin set command)
 * 3. pluginConfig from config.yaml
 *
 * @example
 * ```typescript
 * const apiKey = sdk.secrets.get("api_key");
 * if (!apiKey) {
 *   return { success: false, error: "API key not configured" };
 * }
 * ```
 */
export interface SecretsSDK {
  /**
   * Get a secret value by key.
   *
   * @param key — Secret key name (e.g. "api_key", "bearer_token")
   * @returns Secret value, or undefined if not configured.
   */
  get(key: string): string | undefined;

  /**
   * Get a secret value, throwing if not found.
   *
   * @param key — Secret key name
   * @throws {PluginSDKError} SECRET_NOT_FOUND
   */
  require(key: string): string;

  /**
   * Check if a secret is configured.
   *
   * @param key — Secret key name
   */
  has(key: string): boolean;
}

// ─── Storage Types ──────────────────────────────────────────────

/**
 * Simple key-value storage for plugins.
 *
 * Alternative to raw SQL for simple persistence needs.
 * Uses an auto-created `_kv` table in the plugin's isolated DB.
 * No `migrate()` export required — table is created automatically.
 *
 * Values are JSON-serialized. Optional TTL for auto-expiration.
 *
 * @example
 * ```typescript
 * // Simple counter
 * const count = sdk.storage.get<number>("visits") ?? 0;
 * sdk.storage.set("visits", count + 1);
 *
 * // Cache with 5-minute TTL
 * sdk.storage.set("api_result", data, { ttl: 300_000 });
 * ```
 */
export interface StorageSDK {
  /** Get a value by key. Returns undefined if not found or expired. */
  get<T>(key: string): T | undefined;
  /** Set a value. Optional TTL in milliseconds for auto-expiration. */
  set<T>(key: string, value: T, opts?: { ttl?: number }): void;
  /** Delete a key. Returns true if the key existed. */
  delete(key: string): boolean;
  /** Check if a key exists (and is not expired). */
  has(key: string): boolean;
  /** Delete all keys in this plugin's storage. */
  clear(): void;
}

// ─── Hook Event Types ────────────────────────────────────────────

/** Event for tool:before hook — mutable params, block, blockReason */
export interface BeforeToolCallEvent {
  readonly toolName: string;
  params: Record<string, unknown>;
  readonly chatId: string;
  readonly isGroup: boolean;
  block: boolean;
  blockReason: string;
}

/** Event for tool:after hook — all readonly */
export interface AfterToolCallEvent {
  readonly toolName: string;
  readonly params: Record<string, unknown>;
  readonly result: { success: boolean; data?: unknown; error?: string };
  readonly durationMs: number;
  readonly chatId: string;
  readonly isGroup: boolean;
  /** True if tool was blocked by tool:before hook */
  readonly blocked?: boolean;
  /** Reason the tool was blocked (if blocked) */
  readonly blockReason?: string;
}

/** Event for prompt:before hook — mutable additionalContext */
export interface BeforePromptBuildEvent {
  readonly chatId: string;
  readonly sessionId: string;
  readonly isGroup: boolean;
  additionalContext: string;
}

/** Event for session:start hook */
export interface SessionStartEvent {
  readonly sessionId: string;
  readonly chatId: string;
  readonly isResume: boolean;
}

/** Event for session:end hook */
export interface SessionEndEvent {
  readonly sessionId: string;
  readonly chatId: string;
  readonly messageCount: number;
}

// ─── New Hook Event Types (v1.1) ────────────────────────────────

/** Event for message:receive hook — mutable text, block, additionalContext */
export interface MessageReceiveEvent {
  readonly chatId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly isGroup: boolean;
  readonly isReply: boolean;
  readonly replyToMessageId?: number;
  readonly messageId: number;
  readonly timestamp: number;
  /** Mutable — modify the message text before LLM processing */
  text: string;
  /** Mutable — set to true to silently drop the message */
  block: boolean;
  /** Mutable — reason for blocking (logged, not sent to user) */
  blockReason: string;
  /** Mutable — injected into the prompt (sanitized via sanitizeForContext) */
  additionalContext: string;
}

/** Event for response:before hook — mutable text, block */
export interface ResponseBeforeEvent {
  readonly chatId: string;
  readonly sessionId: string;
  readonly isGroup: boolean;
  /** Original text from the LLM (immutable, for reference) */
  readonly originalText: string;
  /** Mutable — the text that will be sent */
  text: string;
  /** Mutable — set to true to suppress sending */
  block: boolean;
  /** Mutable — reason for blocking */
  blockReason: string;
  /** Mutable — passed through to response:after */
  metadata: Record<string, unknown>;
}

/** Event for response:after hook — all readonly */
export interface ResponseAfterEvent {
  readonly chatId: string;
  readonly sessionId: string;
  readonly isGroup: boolean;
  /** Final text that was sent */
  readonly text: string;
  /** Total processing duration in ms */
  readonly durationMs: number;
  /** List of tool names called during this response */
  readonly toolsUsed: string[];
  /** Token usage for this response */
  readonly tokenUsage?: {
    input: number;
    output: number;
  };
  /** Metadata passed from response:before */
  readonly metadata: Record<string, unknown>;
}

/** Event for response:error hook — all readonly */
export interface ResponseErrorEvent {
  readonly chatId: string;
  readonly sessionId: string;
  readonly isGroup: boolean;
  readonly error: string;
  readonly errorCode?: string;
  readonly provider: string;
  readonly model: string;
  readonly retryCount: number;
  readonly durationMs: number;
}

/** Event for tool:error hook — all readonly */
export interface ToolErrorEvent {
  readonly toolName: string;
  readonly params: Record<string, unknown>;
  readonly error: string;
  readonly stack?: string;
  readonly chatId: string;
  readonly isGroup: boolean;
  readonly durationMs: number;
}

/** Event for prompt:after hook — all readonly */
export interface PromptAfterEvent {
  readonly chatId: string;
  readonly sessionId: string;
  readonly isGroup: boolean;
  /** Prompt length in characters */
  readonly promptLength: number;
  /** Number of sections in the prompt */
  readonly sectionCount: number;
  /** Length of RAG context injected */
  readonly ragContextLength: number;
  /** Length of hook context injected via prompt:before */
  readonly hookContextLength: number;
}

/** Event for agent:start hook — all readonly */
export interface AgentStartEvent {
  readonly version: string;
  readonly provider: string;
  readonly model: string;
  readonly pluginCount: number;
  readonly toolCount: number;
  readonly timestamp: number;
}

/** Event for agent:stop hook — all readonly */
export interface AgentStopEvent {
  readonly reason: "manual" | "signal" | "error";
  readonly uptimeMs: number;
  readonly messagesProcessed: number;
  readonly timestamp: number;
}

/** Hook names supported by the Teleton plugin runtime. */
export const PLUGIN_HOOK_NAMES = [
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
] as const;

/** Available hook names. */
export type HookName = (typeof PLUGIN_HOOK_NAMES)[number];

/** Maps hook names to their handler signatures. */
export interface HookHandlerMap {
  "tool:before": (event: BeforeToolCallEvent) => void | Promise<void>;
  "tool:after": (event: AfterToolCallEvent) => void | Promise<void>;
  "tool:error": (event: ToolErrorEvent) => void | Promise<void>;
  "prompt:before": (event: BeforePromptBuildEvent) => void | Promise<void>;
  "prompt:after": (event: PromptAfterEvent) => void | Promise<void>;
  "session:start": (event: SessionStartEvent) => void | Promise<void>;
  "session:end": (event: SessionEndEvent) => void | Promise<void>;
  "message:receive": (event: MessageReceiveEvent) => void | Promise<void>;
  "response:before": (event: ResponseBeforeEvent) => void | Promise<void>;
  "response:after": (event: ResponseAfterEvent) => void | Promise<void>;
  "response:error": (event: ResponseErrorEvent) => void | Promise<void>;
  "agent:start": (event: AgentStartEvent) => void | Promise<void>;
  "agent:stop": (event: AgentStopEvent) => void | Promise<void>;
}

// ─── Plugin Event Types ─────────────────────────────────────────

/** Event passed to plugin onMessage hooks */
export interface PluginMessageEvent {
  /** Telegram chat ID */
  chatId: string;
  /** Telegram user ID of the sender */
  senderId: number;
  /** Sender's @username (without @) */
  senderUsername?: string;
  /** Message text */
  text: string;
  /** Whether this is a group chat */
  isGroup: boolean;
  /** Whether the message contains media */
  hasMedia: boolean;
  /** Message ID */
  messageId: number;
  /** Message timestamp */
  timestamp: Date;
}

/** Event passed to plugin onCallbackQuery hooks */
export interface PluginCallbackEvent {
  /** Raw callback data string */
  data: string;
  /** First segment of data split by ":" */
  action: string;
  /** Remaining segments after action */
  params: string[];
  /** Chat ID where the button was pressed */
  chatId: string;
  /** Message ID the button belongs to */
  messageId: number;
  /** User ID who pressed the button */
  userId: number;
  /** Answer the callback query (shows toast or alert to user) */
  answer: (text?: string, alert?: boolean) => Promise<void>;
}

// ─── Plugin Definition Types ────────────────────────────────────

/** Tool visibility scopes supported by the runtime. */
export const TOOL_SCOPES = [
  "open",
  "always",
  "dm-only",
  "group-only",
  "admin-only",
  "allowlist",
  "disabled",
] as const;

/** Tool visibility scope for context-based filtering. */
export type ToolScope = (typeof TOOL_SCOPES)[number];

/** Tool categories supported by the runtime. */
export const TOOL_CATEGORIES = ["data-bearing", "action"] as const;

/** Tool category for observation masking behavior. */
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/**
 * Context passed to plugin tool executors at runtime.
 * Contains information about the current chat, sender, and services.
 */
export interface PluginToolContext {
  /** Telegram chat ID where the tool was invoked */
  chatId: string;
  /** Telegram user ID of the sender */
  senderId: number;
  /** Whether this is a group chat (vs DM) */
  isGroup: boolean;
  /** Plugin's isolated SQLite database. */
  db: Database.Database | null;
  /** Sanitized bot config (no API keys) */
  config?: Record<string, unknown>;
}

/** Result returned by a tool execution */
export interface ToolResult {
  /** Whether the execution was successful */
  success: boolean;
  /** Result data (serialized to JSON for the LLM) */
  data?: unknown;
  /** Error message if failed */
  error?: string;
}

/**
 * Simplified tool definition for plugins.
 *
 * This is the format plugins use to define their tools.
 * The core platform converts these into full Tool definitions.
 */
export interface SimpleToolDef<TParams extends Record<string, unknown> = Record<string, unknown>> {
  /** Unique tool name (e.g. "casino_spin") */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema for parameters (defaults to empty object) */
  parameters?: Record<string, unknown>;
  /** Tool executor function */
  execute: (params: TParams, context: PluginToolContext) => Promise<ToolResult>;
  /** Visibility scope (default: "always") */
  scope?: ToolScope;
  /** Tool category for masking behavior */
  category?: ToolCategory;
  /** Require an authenticated owner approval before execution. */
  requiresApproval?: boolean;
}

// ─── Bot SDK ─────────────────────────────────────────────────────

/** Button style for colored inline keyboards (GramJS Layer 222) */
export type ButtonStyle = "success" | "danger" | "primary";

/** Inline keyboard button definition */
export interface ButtonDef {
  /** Button label text */
  text: string;
  /** Callback data (auto-prefixed with plugin name) */
  callback?: string;
  /** URL to open */
  url?: string;
  /** Text to copy on click (native copy-to-clipboard) */
  copy?: string;
  /** Button color style (GramJS only, graceful fallback on Bot API) */
  style?: ButtonStyle;
}

/** Content for an inline query result */
export type InlineResultContent =
  | { text: string; parseMode?: "HTML" | "Markdown" }
  | { photoUrl: string; thumbUrl?: string; caption?: string }
  | { gifUrl: string; thumbUrl?: string; caption?: string };

/** A single inline query result returned by a plugin */
export interface InlineResult {
  /** Unique result ID */
  id: string;
  /** Result type */
  type: "article" | "photo" | "gif";
  /** Result title */
  title: string;
  /** Short description */
  description?: string;
  /** Thumbnail URL */
  thumbUrl?: string;
  /** Message content to send */
  content: InlineResultContent;
  /** Inline keyboard rows */
  keyboard?: ButtonDef[][];
}

/** Context passed to inline query handlers */
export interface InlineQueryContext {
  /** The query text (prefix already stripped) */
  query: string;
  /** Telegram query ID */
  queryId: string;
  /** User who triggered the query */
  userId: number;
  /** Pagination offset */
  offset: string;
}

/** Context passed to callback query handlers */
export interface CallbackContext {
  /** Raw callback data (prefix already stripped) */
  data: string;
  /** Regex match groups (if pattern was used) */
  match: string[];
  /** User who clicked */
  userId: number;
  /** Username of the user */
  username?: string;
  /** Inline message ID (if from inline message) */
  inlineMessageId?: string;
  /** Chat ID (if from regular message) */
  chatId?: string;
  /** Message ID (if from regular message) */
  messageId?: number;
  /** Answer the callback query (toast/alert) */
  answer(text?: string, alert?: boolean): Promise<void>;
  /** Edit the message that contains the button */
  editMessage(text: string, opts?: { keyboard?: ButtonDef[][]; parseMode?: string }): Promise<void>;
}

/** Context passed to chosen inline result handlers */
export interface ChosenResultContext {
  /** The result ID that was chosen */
  resultId: string;
  /** Inline message ID (available if bot has inline feedback enabled) */
  inlineMessageId?: string;
  /** The query that was used */
  query: string;
}

/** Bot manifest declaring plugin bot capabilities */
export interface BotManifest {
  /** Enable inline query handling */
  inline?: boolean;
  /** Enable callback query handling */
  callbacks?: boolean;
  /** Rate limits */
  rateLimits?: {
    /** Max inline answers per minute (default: 30) */
    inlinePerMinute?: number;
    /** Max callback answers per minute (default: 60) */
    callbackPerMinute?: number;
  };
}

/** Keyboard object returned by sdk.bot.keyboard() */
export interface BotKeyboard {
  /** Get Grammy InlineKeyboard (Bot API, no colors) */
  toGrammy(): unknown;
  /** Get GramJS TL ReplyInlineMarkup (MTProto, with colors) */
  toTL(): unknown;
  /** Raw button definitions (with prefixed callbacks) */
  rows: ButtonDef[][];
}

/** Bot SDK — inline mode interface for plugins */
export interface BotSDK {
  /** Whether the bot is available */
  readonly isAvailable: boolean;
  /** Bot username */
  readonly username: string;
  /** Register an inline query handler */
  onInlineQuery(handler: (ctx: InlineQueryContext) => Promise<InlineResult[]>): void;
  /** Register a callback query handler */
  onCallback(pattern: string, handler: (ctx: CallbackContext) => Promise<void>): void;
  /** Register a chosen inline result handler */
  onChosenResult(handler: (ctx: ChosenResultContext) => Promise<void>): void;
  /** Edit an inline message */
  editInlineMessage(
    inlineMessageId: string,
    text: string,
    opts?: { keyboard?: ButtonDef[][]; parseMode?: string }
  ): Promise<void>;
  /** Build a keyboard with auto-prefixed callback data */
  keyboard(rows: ButtonDef[][]): BotKeyboard;
}

/**
 * Plugin manifest — optional metadata for plugin registration.
 *
 * Declares the plugin's identity, version, dependencies, and default config.
 */
export interface PluginManifest {
  /** Plugin name (lowercase alphanumeric + hyphens, 1-64 chars) */
  name: string;
  /** Semver version string (e.g. "1.0.0") */
  version: string;
  /** Plugin author */
  author?: string;
  /** Short description (max 256 chars) */
  description?: string;
  /** Required built-in modules (e.g. ["deals", "market"]) */
  dependencies?: string[];
  /** Default plugin config (merged with config.yaml plugins section) */
  defaultConfig?: Record<string, unknown>;
  /** Required SDK version range (e.g. ">=2.0.0", "^2.0.0") */
  sdkVersion?: string;
  /**
   * Secrets required by this plugin (API keys, tokens, etc.)
   *
   * When declared, the agent warns admin via Telegram if secrets are missing.
   * Admin can set them with: /plugin set <plugin-name> <key> <value>
   *
   * @example
   * ```typescript
   * secrets: {
   *   api_key: { required: true, description: "SwiftGifts API key" },
   *   webhook_url: { required: false, description: "Webhook for notifications" },
   * }
   * ```
   */
  secrets?: Record<string, SecretDeclaration>;
  /** Bot capabilities (inline mode, callbacks) */
  bot?: BotManifest;
  /** Agent lifecycle hooks this plugin is allowed to register. */
  hooks?: PluginHookDeclaration[];
}

/** Hook declaration in a plugin manifest. */
export interface PluginHookDeclaration {
  /** Hook name supported by the current SDK. */
  name: HookName;
  /** Per-hook execution priority, restricted to -1000..1000. */
  priority?: number;
  /** Human-readable purpose of the hook. */
  description?: string;
}

// ─── Root SDK ────────────────────────────────────────────────────

/**
 * The complete Plugin SDK passed to plugins via `tools(sdk)`.
 *
 * Provides namespaced access to TON blockchain, Telegram messaging,
 * and plugin infrastructure (DB, config, logging).
 *
 * @example
 * ```typescript
 * import type { PluginSDK, SimpleToolDef } from "@teleton-agent/sdk";
 *
 * export const tools = (sdk: PluginSDK): SimpleToolDef[] => [{
 *   name: "my_tool",
 *   description: "Does something cool",
 *   async execute(params, context) {
 *     const balance = await sdk.ton.getBalance();
 *     await sdk.telegram.sendMessage(context.chatId, `Balance: ${balance?.balance}`);
 *     return { success: true };
 *   }
 * }];
 * ```
 */
export interface PluginSDK {
  /** SDK version (semver, e.g. "2.0.0") */
  readonly version: string;

  /** TON blockchain operations */
  readonly ton: TonSDK;

  /** Telegram messaging and user operations */
  readonly telegram: TelegramSDK;

  /** Plugin's isolated SQLite database (null only if DB initialization failed). */
  readonly db: Database.Database | null;

  /** Sanitized application config (no API keys or secrets) */
  readonly config: Record<string, unknown>;

  /** Plugin-specific config from config.yaml plugins section */
  readonly pluginConfig: Record<string, unknown>;

  /** Secure access to plugin secrets (API keys, tokens) */
  readonly secrets: SecretsSDK;

  /** Simple key-value storage (null only if DB initialization failed). */
  readonly storage: StorageSDK | null;

  /** Prefixed logger */
  readonly log: PluginLogger;

  /** Bot inline mode SDK (null if bot not available or plugin has no bot manifest) */
  readonly bot: BotSDK | null;

  /** Register a typed hook handler for agent lifecycle events. */
  on<K extends HookName>(
    hookName: K,
    handler: HookHandlerMap[K],
    opts?: { priority?: number }
  ): void;
}

/** Context passed to a plugin's start() lifecycle hook. */
export interface StartContext {
  /** The same capability-scoped SDK exposed to tools(sdk). */
  sdk: PluginSDK;
  /** Plugin's isolated SQLite database (null only if initialization failed). */
  db: Database.Database | null;
  /** Sanitized application config (no credentials). */
  config: Record<string, unknown>;
  /** Plugin-specific config merged with manifest defaults. */
  pluginConfig: Record<string, unknown>;
  /** Prefixed plugin logger. */
  log: PluginLogger;
}
