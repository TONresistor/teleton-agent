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
    .enum(["anthropic", "openai", "google", "xai", "groq", "openrouter"])
    .default("anthropic"),
  api_key: z.string(),
  model: z.string().default("claude-opus-4-5-20251101"),
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
  session_reset_policy: SessionResetPolicySchema.default({}),
});

export const TelegramConfigSchema = z.object({
  api_id: z.number(),
  api_hash: z.string(),
  phone: z.string(),
  session_name: z.string().default("tonnet_session"),
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
  // Bot for inline deal confirmations (required for deals system)
  bot_token: z
    .string()
    .optional()
    .describe("Telegram Bot token from @BotFather for inline deal buttons"),
  bot_username: z.string().optional().describe("Bot username without @ (e.g., 'tonnet_deals_bot')"),
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

export const CasinoConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    min_bet: z.number().default(0.1),
    max_bet_percent: z.number().default(5),
    min_bankroll: z.number().default(10),
    cooldown_seconds: z.number().default(30),
    house_edge_percent: z.number().default(5),
    jackpot_threshold: z.number().default(100),
    jackpot_cooldown_hours: z.number().default(24),
    payment_window_minutes: z.number().default(5),
    max_payment_age_minutes: z.number().default(10),
    tx_retention_days: z.number().default(30),
    rate_limit_max_attempts: z.number().default(5),
    rate_limit_window_seconds: z.number().default(60),
    rate_limit_block_seconds: z.number().default(300),
  })
  .default({});

export const DealsConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    expiry_seconds: z.number().default(120),
    buy_max_floor_percent: z.number().default(100),
    sell_min_floor_percent: z.number().default(105),
    poll_interval_ms: z.number().default(5000),
    max_verification_retries: z.number().default(12),
    expiry_check_interval_ms: z.number().default(60000),
  })
  .default({});

export const MarketConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    cache_ttl_minutes: z.number().default(15),
    refresh_interval_minutes: z.number().default(120),
  })
  .default({});

export const ConfigSchema = z.object({
  meta: MetaConfigSchema.default({}),
  agent: AgentConfigSchema,
  telegram: TelegramConfigSchema,
  storage: StorageConfigSchema.default({}),
  casino: CasinoConfigSchema,
  deals: DealsConfigSchema,
  market: MarketConfigSchema,
  tonapi_key: z
    .string()
    .optional()
    .describe("TonAPI key for higher rate limits (from @tonapi_bot)"),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type SessionResetPolicy = z.infer<typeof SessionResetPolicySchema>;
export type CasinoConfig = z.infer<typeof CasinoConfigSchema>;
export type DealsConfig = z.infer<typeof DealsConfigSchema>;
export type MarketConfig = z.infer<typeof MarketConfigSchema>;
