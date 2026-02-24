import { z } from "zod";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../constants/limits.js";

export const DMPolicy = z.enum(["pairing", "allowlist", "open", "disabled"]);
export const GroupPolicy = z.enum(["open", "allowlist", "disabled"]);

export const SessionResetPolicySchema = z.object({
  daily_reset_enabled: z.boolean().default(true).describe("Enable daily session reset"),
  daily_reset_hour: z
    .number()
    .min(0)
    .max(23)
    .default(4)
    .describe("Hour of day (0-23) to reset sessions"),
  idle_expiry_enabled: z.boolean().default(true).describe("Enable session reset after idle period"),
  idle_expiry_minutes: z
    .number()
    .default(1440)
    .describe("Minutes of inactivity before session reset (default: 24h)"),
});

export const AgentConfigSchema = z.object({
  provider: z
    .enum([
      "anthropic",
      "claude-code",
      "openai",
      "google",
      "xai",
      "groq",
      "openrouter",
      "moonshot",
      "mistral",
      "cocoon",
      "local",
    ])
    .default("anthropic"),
  api_key: z.string().default(""),
  base_url: z
    .string()
    .url()
    .optional()
    .describe("Base URL for local LLM server (e.g. http://localhost:11434/v1)"),
  model: z.string().default("claude-opus-4-6"),
  utility_model: z
    .string()
    .optional()
    .describe("Cheap model for summarization (auto-detected if omitted)"),
  max_tokens: z.number().default(4096),
  temperature: z.number().default(0.7),
  system_prompt: z.string().nullable().default(null),
  max_agentic_iterations: z
    .number()
    .default(5)
    .describe("Maximum number of agentic loop iterations (tool call → result → tool call cycles)"),
  session_reset_policy: SessionResetPolicySchema.default(SessionResetPolicySchema.parse({})),
});

export const TelegramConfigSchema = z.object({
  api_id: z.number(),
  api_hash: z.string(),
  phone: z.string(),
  session_name: z.string().default("teleton_session"),
  session_path: z.string().default("~/.teleton"),
  dm_policy: DMPolicy.default("pairing"),
  allow_from: z.array(z.number()).default([]),
  group_policy: GroupPolicy.default("open"),
  group_allow_from: z.array(z.number()).default([]),
  require_mention: z.boolean().default(true),
  max_message_length: z.number().default(TELEGRAM_MAX_MESSAGE_LENGTH),
  typing_simulation: z.boolean().default(true),
  rate_limit_messages_per_second: z.number().default(1.0),
  rate_limit_groups_per_minute: z.number().default(20),
  admin_ids: z.array(z.number()).default([]),
  agent_channel: z.string().nullable().default(null),
  owner_name: z.string().optional().describe("Owner's first name (e.g., 'Alex')"),
  owner_username: z.string().optional().describe("Owner's Telegram username (without @)"),
  owner_id: z.number().optional().describe("Owner's Telegram user ID"),
  debounce_ms: z
    .number()
    .default(1500)
    .describe("Debounce delay in milliseconds for group messages (0 = disabled)"),
  bot_token: z
    .string()
    .optional()
    .describe("Telegram Bot token from @BotFather for inline deal buttons"),
  bot_username: z
    .string()
    .optional()
    .describe("Bot username without @ (e.g., 'teleton_deals_bot')"),
});

export const StorageConfigSchema = z.object({
  sessions_file: z.string().default("~/.teleton/sessions.json"),
  pairing_file: z.string().default("~/.teleton/pairing.json"),
  memory_file: z.string().default("~/.teleton/memory.json"),
  history_limit: z.number().default(100),
});

export const MetaConfigSchema = z.object({
  version: z.string().default("1.0.0"),
  created_at: z.string().optional(),
  last_modified_at: z.string().optional(),
  onboard_command: z.string().default("teleton setup"),
});

const _DealsObject = z.object({
  enabled: z.boolean().default(true),
  expiry_seconds: z.number().default(120),
  buy_max_floor_percent: z.number().default(100),
  sell_min_floor_percent: z.number().default(105),
  poll_interval_ms: z.number().default(5000),
  max_verification_retries: z.number().default(12),
  expiry_check_interval_ms: z.number().default(60000),
});
export const DealsConfigSchema = _DealsObject.default(_DealsObject.parse({}));

const _WebUIObject = z.object({
  enabled: z.boolean().default(false).describe("Enable WebUI server"),
  port: z.number().default(7777).describe("HTTP server port"),
  host: z.string().default("127.0.0.1").describe("Bind address (localhost only for security)"),
  auth_token: z
    .string()
    .optional()
    .describe("Bearer token for API auth (auto-generated if omitted)"),
  cors_origins: z
    .array(z.string())
    .default(["http://localhost:5173", "http://localhost:7777"])
    .describe("Allowed CORS origins for development"),
  log_requests: z.boolean().default(false).describe("Log all HTTP requests"),
});
export const WebUIConfigSchema = _WebUIObject.default(_WebUIObject.parse({}));

const _EmbeddingObject = z.object({
  provider: z
    .enum(["local", "anthropic", "none"])
    .default("local")
    .describe("Embedding provider: local (ONNX), anthropic (API), or none (FTS5-only)"),
  model: z
    .string()
    .optional()
    .describe("Model override (default: Xenova/all-MiniLM-L6-v2 for local)"),
});
export const EmbeddingConfigSchema = _EmbeddingObject.default(_EmbeddingObject.parse({}));

const _LoggingObject = z.object({
  level: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info")
    .describe("Log level (trace/debug/info/warn/error/fatal)"),
  pretty: z
    .boolean()
    .default(true)
    .describe("Enable pino-pretty formatting (human-readable, colored output)"),
});
export const LoggingConfigSchema = _LoggingObject.default(_LoggingObject.parse({}));

const _DevObject = z.object({
  hot_reload: z
    .boolean()
    .default(false)
    .describe("Enable plugin hot-reload (watches ~/.teleton/plugins/ for changes)"),
});
export const DevConfigSchema = _DevObject.default(_DevObject.parse({}));

const McpServerSchema = z
  .object({
    command: z
      .string()
      .optional()
      .describe("Stdio command (e.g. 'npx @modelcontextprotocol/server-filesystem /tmp')"),
    args: z
      .array(z.string())
      .optional()
      .describe("Explicit args array (overrides command splitting)"),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe("Environment variables for stdio server"),
    url: z.string().url().optional().describe("SSE/HTTP endpoint URL (alternative to command)"),
    scope: z
      .enum(["always", "dm-only", "group-only", "admin-only"])
      .default("always")
      .describe("Tool scope"),
    enabled: z.boolean().default(true).describe("Enable/disable this server"),
  })
  .refine((s) => s.command || s.url, {
    message: "Each MCP server needs either 'command' (stdio) or 'url' (SSE/HTTP)",
  });

const _McpObject = z.object({
  servers: z.record(z.string(), McpServerSchema).default({}),
});
export const McpConfigSchema = _McpObject.default(_McpObject.parse({}));

const _ToolRagObject = z.object({
  enabled: z.boolean().default(false).describe("Enable semantic tool retrieval (Tool RAG)"),
  top_k: z.number().default(25).describe("Max tools to retrieve per LLM call"),
  always_include: z
    .array(z.string())
    .default([
      "telegram_send_message",
      "telegram_reply_message",
      "telegram_send_photo",
      "telegram_send_document",
      "journal_*",
      "workspace_*",
      "web_*",
    ])
    .describe("Tool name patterns always included (prefix glob with *)"),
  skip_unlimited_providers: z
    .boolean()
    .default(false)
    .describe("Skip Tool RAG for providers with no tool limit (e.g. Anthropic)"),
});
export const ToolRagConfigSchema = _ToolRagObject.default(_ToolRagObject.parse({}));

export const ConfigSchema = z.object({
  meta: MetaConfigSchema.default(MetaConfigSchema.parse({})),
  agent: AgentConfigSchema,
  telegram: TelegramConfigSchema,
  storage: StorageConfigSchema.default(StorageConfigSchema.parse({})),
  embedding: EmbeddingConfigSchema,
  deals: DealsConfigSchema,
  webui: WebUIConfigSchema,
  logging: LoggingConfigSchema,
  dev: DevConfigSchema,
  tool_rag: ToolRagConfigSchema,
  mcp: McpConfigSchema,
  plugins: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Per-plugin config (key = plugin name with underscores)"),
  cocoon: z
    .object({
      port: z
        .number()
        .min(1)
        .max(65535)
        .default(10000)
        .describe("HTTP port of the cocoon-cli proxy"),
    })
    .optional()
    .describe("Cocoon Network — expects external cocoon-cli running on this port"),
  tonapi_key: z
    .string()
    .optional()
    .describe("TonAPI key for higher rate limits (from @tonapi_bot)"),
  tavily_api_key: z
    .string()
    .optional()
    .describe("Tavily API key for web search & extract (free at https://tavily.com)"),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type SessionResetPolicy = z.infer<typeof SessionResetPolicySchema>;
export type DealsConfig = z.infer<typeof DealsConfigSchema>;
export type WebUIConfig = z.infer<typeof WebUIConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type DevConfig = z.infer<typeof DevConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type ToolRagConfig = z.infer<typeof ToolRagConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerSchema>;
