import type { TSchema } from "@sinclair/typebox";
import type { TelegramBridge } from "../../telegram/bridge.js";
import type Database from "better-sqlite3";
import type { MarketPriceService } from "../../market/price-service.js";
import type { Config } from "../../config/schema.js";

/**
 * Context provided to tool executors
 */
export interface ToolContext {
  /** Telegram bridge for sending messages, reactions, etc. */
  bridge: TelegramBridge;
  /** Database instance for storage */
  db: Database.Database;
  /** Current chat ID where the tool is being executed */
  chatId: string;
  /** Current user/sender ID */
  senderId: number;
  /** Whether this is a group chat */
  isGroup: boolean;
  /** Market price service for gift floor prices (optional) */
  marketService?: MarketPriceService;
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
}
