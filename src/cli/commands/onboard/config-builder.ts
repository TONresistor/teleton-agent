import {
  DEFAULT_TOOL_RAG_ALWAYS_INCLUDE,
  HumanizationConfigSchema,
  type Config,
} from "../../../config/schema.js";
import type { SupportedProvider } from "../../../config/providers.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../constants/limits.js";

export type Policy = "open" | "allowlist" | "admin-only" | "disabled";

/** Variable inputs for {@link buildConfig}; everything else is a centralized default. */
interface BuildConfigInput {
  provider: SupportedProvider;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxAgenticIterations: number;
  telegramMode: "user" | "bot";
  apiId: number;
  apiHash: string;
  phone: string;
  userId: number;
  dmPolicy: Policy;
  groupPolicy: Policy;
  requireMention: boolean;
  execMode: "off" | "yolo";
  botToken?: string;
  botUsername?: string;
  tonapiKey?: string;
  toncenterApiKey?: string;
  tavilyApiKey?: string;
  gocoonPort?: number;
  sessionPath: string;
  workspaceRoot: string;
}

/**
 * Build the full Config object from the variable wizard inputs, centralizing
 * every schema default in one place. Called by both the interactive and the
 * non-interactive flows so they can never silently diverge.
 */
export function buildConfig(input: BuildConfigInput): Config {
  return {
    meta: {
      version: "1.0.0",
      created_at: new Date().toISOString(),
      onboard_command: "teleton setup",
    },
    agent: {
      provider: input.provider,
      api_key: input.apiKey,
      ...(input.baseUrl ? { base_url: input.baseUrl } : {}),
      model: input.model,
      reasoning_effort: "medium",
      vision_models: [],
      max_tokens: 4096,
      temperature: 0.7,
      system_prompt: null,
      max_agentic_iterations: input.maxAgenticIterations,
      max_turn_duration_ms: 300_000,
      fallbacks: [],
      session_reset_policy: {
        daily_reset_enabled: true,
        daily_reset_hour: 4,
        idle_expiry_enabled: true,
        idle_expiry_minutes: 1440,
      },
    },
    telegram: {
      mode: input.telegramMode,
      api_id: input.telegramMode === "user" ? input.apiId : 0,
      api_hash: input.telegramMode === "user" ? input.apiHash : "",
      phone: input.telegramMode === "user" ? input.phone : "",
      session_name: "teleton_session",
      session_path: input.sessionPath,
      dm_policy: input.dmPolicy,
      allow_from: [],
      group_policy: input.groupPolicy,
      group_allow_from: [],
      require_mention: input.requireMention,
      max_message_length: TELEGRAM_MAX_MESSAGE_LENGTH,
      typing_simulation: true,
      reaction_events: true,
      rate_limit_messages_per_second: 1.0,
      rate_limit_groups_per_minute: 20,
      admin_ids: [input.userId],
      owner_id: input.userId,
      agent_channel: null,
      debounce_ms: 1500,
      dm_debounce_ms: 1000,
      bot_token: input.botToken,
      bot_username: input.botUsername,
      stream_mode: "all",
      reply_style: "auto",
      guest_mode: false,
      humanization: HumanizationConfigSchema.parse({}),
    },
    storage: {
      sessions_file: `${input.workspaceRoot}/sessions.json`,
      memory_file: `${input.workspaceRoot}/memory.json`,
      history_limit: 100,
    },
    embedding: { provider: "local" },
    webui: {
      enabled: false,
      port: 7777,
      host: "127.0.0.1",
      cors_origins: ["http://localhost:5173", "http://localhost:7777"],
      log_requests: false,
    },
    dev: { hot_reload: false },
    tool_rag: {
      enabled: true,
      top_k: 25,
      always_include: [...DEFAULT_TOOL_RAG_ALWAYS_INCLUDE],
      skip_unlimited_providers: false,
    },
    tool_search: { enabled: true },
    logging: { level: "info", pretty: true },
    mcp: { servers: {} },
    capabilities: {
      exec: {
        mode: input.execMode,
        scope: "admin-only",
        allowlist: [],
        limits: { timeout: 120, max_output: 50000 },
        audit: { log_commands: true },
      },
    },
    ton_proxy: { enabled: false, port: 8080 },
    ton_features: { enabled: false },
    heartbeat: {
      enabled: true,
      interval_ms: 3_600_000,
      prompt: "Execute your HEARTBEAT.md checklist now. Work through each item using tool calls.",
      startup_prompt: null,
      min_interval_between_replies_ms: 30_000,
      reply_delay_ms: 1_000,
      self_configurable: false,
      proactive_enabled: false,
      proactive_chat_ids: [],
      proactive_cooldown_ms: 86_400_000,
      proactive_mode: "suggestion",
      proactive_min_score: 7,
      proactive_prompt:
        "Review this chat's recent context. Only send a message if there is a genuinely useful reason to check in, follow up, remind, or share something relevant. Otherwise answer HEARTBEAT_OK. Do not send generic greetings or filler.",
    },
    scheduler: {
      enabled: true,
      poll_interval_ms: 15_000,
      max_catch_up_ms: 86_400_000,
      default_timezone: "UTC",
    },
    plugins: {},
    ...(input.provider === "gocoon" && input.gocoonPort
      ? { gocoon: { port: input.gocoonPort } }
      : {}),
    tonapi_key: input.tonapiKey,
    toncenter_api_key: input.toncenterApiKey,
    tavily_api_key: input.tavilyApiKey,
  };
}
