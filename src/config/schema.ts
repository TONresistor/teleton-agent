import { z } from "zod";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../constants/limits.js";
import { SUPPORTED_PROVIDER_IDS } from "./providers.js";
import { getModelAvailability } from "./model-catalog.js";

export const DMPolicy = z.enum(["allowlist", "open", "admin-only", "disabled"]);
export const GroupPolicy = z.enum(["open", "allowlist", "admin-only", "disabled"]);

// Exec enums exported so the UI whitelist (configurable-keys.ts) reuses them
// instead of re-listing the literals.
export const ExecMode = z.enum(["off", "yolo"]);
export const ExecScope = z.enum(["admin-only", "allowlist", "all"]);

export const DEFAULT_TOOL_RAG_ALWAYS_INCLUDE = ["journal_*", "workspace_*", "web_*"] as const;

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

export const AgentConfigSchema = z
  .object({
    provider: z.enum(SUPPORTED_PROVIDER_IDS).default("anthropic"),
    api_key: z.string().default(""),
    base_url: z
      .string()
      .url()
      .optional()
      .describe("Base URL for local LLM server (e.g. http://localhost:11434/v1)"),
    model: z.string().default("claude-haiku-4-5-20251001"),
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
      .describe(
        "Maximum number of agentic loop iterations (tool call → result → tool call cycles)"
      ),
    session_reset_policy: SessionResetPolicySchema.default(SessionResetPolicySchema.parse({})),
  })
  .superRefine((agent, context) => {
    for (const field of ["model", "utility_model"] as const) {
      const modelId = agent[field];
      if (!modelId) continue;
      const availability = getModelAvailability(agent.provider, modelId);
      if (availability.available) continue;
      context.addIssue({
        code: "custom",
        path: [field],
        message: availability.message ?? `${modelId} is not currently available`,
      });
    }
  });

export const TelegramConfigSchema = z
  .object({
    mode: z.enum(["user", "bot"]).default("user"),
    api_id: z.number().optional(),
    api_hash: z.string().optional(),
    phone: z.string().optional(),
    session_name: z.string().default("teleton_session"),
    session_path: z.string().default("~/.teleton"),
    dm_policy: DMPolicy.default("allowlist"),
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
      .describe("Telegram Bot token from @BotFather for inline bot features"),
    bot_username: z.string().optional().describe("Bot username without @ (e.g., 'my_agent_bot')"),
    stream_mode: z
      .enum(["all", "replace", "off"])
      .default("replace")
      .describe(
        "Bot streaming mode: replace=each iteration replaces draft (default), all=concatenate all iterations, off=no streaming"
      ),
    guest_mode: z
      .boolean()
      .default(false)
      .describe("Allow the bot to answer guest queries in chats it is not a member of"),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "user") {
      if (!data.api_id)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "api_id is required in user mode",
          path: ["api_id"],
        });
      if (!data.api_hash)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "api_hash is required in user mode",
          path: ["api_hash"],
        });
      if (!data.phone)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "phone is required in user mode",
          path: ["phone"],
        });
    }
    if (data.mode === "bot") {
      if (!data.bot_token)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bot_token is required in bot mode",
          path: ["bot_token"],
        });
      if (!data.owner_id)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "owner_id is required in bot mode",
          path: ["owner_id"],
        });
    }
  });

export const StorageConfigSchema = z.object({
  sessions_file: z.string().default("~/.teleton/sessions.json"),
  memory_file: z.string().default("~/.teleton/memory.json"),
  history_limit: z.number().default(100),
});

export const MetaConfigSchema = z.object({
  version: z.string().default("1.0.0"),
  created_at: z.string().optional(),
  last_modified_at: z.string().optional(),
  onboard_command: z.string().default("teleton setup"),
});

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

const _TonProxyObject = z.object({
  enabled: z
    .boolean()
    .default(false)
    .describe("Enable TON Proxy (Tonutils-Proxy) for .ton site access"),
  port: z.number().min(1).max(65535).default(8080).describe("HTTP proxy port (default: 8080)"),
  binary_path: z
    .string()
    .optional()
    .describe("Custom path to tonutils-proxy-cli binary (auto-downloaded if omitted)"),
});
export const TonProxyConfigSchema = _TonProxyObject.default(_TonProxyObject.parse({}));

const _DevObject = z.object({
  hot_reload: z
    .boolean()
    .default(false)
    .describe("Enable plugin hot-reload (watches ~/.teleton/plugins/ for changes)"),
});
export const DevConfigSchema = _DevObject.default(_DevObject.parse({}));

const _ApiObject = z.object({
  enabled: z.boolean().default(false).describe("Enable HTTPS Management API server"),
  port: z.number().min(1).max(65535).default(7778).describe("HTTPS server port"),
  key_hash: z
    .string()
    .default("")
    .describe("SHA-256 hash of the API key (auto-generated if empty)"),
  allowed_ips: z
    .array(z.string())
    .default([])
    .describe("IP whitelist (empty = allow all authenticated requests)"),
});
export const ApiConfigSchema = _ApiObject.default(_ApiObject.parse({}));

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
      .enum(["always", "dm-only", "group-only", "admin-only", "open", "allowlist", "disabled"])
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

const _ToolSearchObject = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe("Enable ToolSearch mode: core tools + meta-tool replaces RAG pre-selection"),
});
export const ToolSearchConfigSchema = _ToolSearchObject.default(_ToolSearchObject.parse({}));

const _ToolRagObject = z.object({
  enabled: z.boolean().default(true).describe("Enable semantic tool retrieval (Tool RAG)"),
  top_k: z.number().default(35).describe("Max tools to retrieve per LLM call"),
  always_include: z
    .array(z.string())
    .default([...DEFAULT_TOOL_RAG_ALWAYS_INCLUDE])
    .describe("Tool name patterns always included (prefix glob with *)"),
  skip_unlimited_providers: z
    .boolean()
    .default(false)
    .describe("Skip Tool RAG for providers with no tool limit (e.g. Anthropic)"),
});
export const ToolRagConfigSchema = _ToolRagObject.default(_ToolRagObject.parse({}));

const _ExecLimitsObject = z.object({
  timeout: z.number().min(1).max(3600).default(120).describe("Max seconds per command execution"),
  max_output: z
    .number()
    .min(1000)
    .max(500000)
    .default(50000)
    .describe("Max chars of stdout/stderr captured per command"),
});

const _ExecAuditObject = z.object({
  log_commands: z.boolean().default(true).describe("Log every command to SQLite audit table"),
});

const _ExecObject = z.object({
  mode: ExecMode.default("off").describe("Exec mode: off (disabled) or yolo (full system access)"),
  scope: ExecScope.default("admin-only").describe("Who can trigger exec tools"),
  allowlist: z
    .array(z.number())
    .default([])
    .describe("Telegram user IDs allowed to use exec (when scope = allowlist)"),
  limits: _ExecLimitsObject.default(_ExecLimitsObject.parse({})),
  audit: _ExecAuditObject.default(_ExecAuditObject.parse({})),
});

const _CapabilitiesObject = z.object({
  exec: _ExecObject.default(_ExecObject.parse({})),
});
export const CapabilitiesConfigSchema = _CapabilitiesObject.default(_CapabilitiesObject.parse({}));

const _HeartbeatObject = z.object({
  enabled: z.boolean().default(true).describe("Enable periodic heartbeat timer"),
  interval_ms: z
    .number()
    .min(60_000)
    .default(3_600_000)
    .describe("Heartbeat interval in milliseconds (min 60s, default 60min)"),
  prompt: z
    .string()
    .default("Execute your HEARTBEAT.md checklist now. Work through each item using tool calls.")
    .describe("Prompt sent to agent on each heartbeat tick"),
  self_configurable: z
    .boolean()
    .default(false)
    .describe("Allow agent to modify heartbeat config via config_set"),
});
export const HeartbeatConfigSchema = _HeartbeatObject.default(_HeartbeatObject.parse({}));

export const ConfigSchema = z.object({
  meta: MetaConfigSchema.default(MetaConfigSchema.parse({})),
  agent: AgentConfigSchema,
  telegram: TelegramConfigSchema,
  storage: StorageConfigSchema.default(StorageConfigSchema.parse({})),
  embedding: EmbeddingConfigSchema,
  webui: WebUIConfigSchema,
  logging: LoggingConfigSchema,
  dev: DevConfigSchema,
  tool_rag: ToolRagConfigSchema,
  tool_search: ToolSearchConfigSchema,
  capabilities: CapabilitiesConfigSchema,
  api: ApiConfigSchema.optional(),
  ton_proxy: TonProxyConfigSchema,
  heartbeat: HeartbeatConfigSchema,
  mcp: McpConfigSchema,
  plugins: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Per-plugin config (key = plugin name with underscores)"),
  gocoon: z
    .object({
      port: z
        .number()
        .min(1)
        .max(65535)
        .default(10000)
        .describe("HTTP port of the gocoon-runner OpenAI-compatible API"),
      auto_start: z
        .boolean()
        .optional()
        .describe("Auto-install and supervise the gocoon-runner on start (default: true)"),
    })
    .optional()
    .describe("Gocoon: pure-Go COCOON client (decentralized LLM on TON)"),
  tonapi_key: z
    .string()
    .optional()
    .describe("TonAPI key for higher rate limits (from @tonapi_bot)"),
  toncenter_api_key: z
    .string()
    .optional()
    .describe("TonCenter API key for dedicated RPC endpoint (free at https://toncenter.com)"),
  tavily_api_key: z
    .string()
    .optional()
    .describe("Tavily API key for web search & extract (free at https://tavily.com)"),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type SessionResetPolicy = z.infer<typeof SessionResetPolicySchema>;
export type WebUIConfig = z.infer<typeof WebUIConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerSchema>;
export type TonProxyConfig = z.infer<typeof TonProxyConfigSchema>;
export type ApiConfig = z.infer<typeof _ApiObject>;
export type ExecConfig = z.infer<typeof _ExecObject>;
