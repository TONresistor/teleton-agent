import { readFileSync, writeFileSync, existsSync } from "fs";
import { parse, stringify } from "yaml";
import { expandPath } from "./loader.js";
import { ConfigSchema } from "./schema.js";

// ── Types ──────────────────────────────────────────────────────────────

export type ConfigKeyType = "string" | "number" | "boolean" | "enum" | "array";

export type ConfigCategory =
  | "API Keys"
  | "Agent"
  | "Session"
  | "Telegram"
  | "Embedding"
  | "WebUI"
  | "Deals"
  | "Developer";

export interface ConfigKeyMeta {
  type: ConfigKeyType;
  category: ConfigCategory;
  label: string;
  description: string;
  sensitive: boolean;
  hotReload: "instant" | "restart";
  validate: (v: string) => string | undefined;
  mask: (v: string) => string;
  parse: (v: string) => unknown;
  options?: string[];
  optionLabels?: Record<string, string>;
  itemType?: "string" | "number";
}

// ── Helpers ────────────────────────────────────────────────────────────

const noValidation = () => undefined;
const identity = (v: string) => v;
const nonEmpty = (v: string) => (v.length > 0 ? undefined : "Must not be empty");

function numberInRange(min: number, max: number) {
  return (v: string) => {
    const n = Number(v);
    if (isNaN(n)) return "Must be a number";
    if (n < min || n > max) return `Must be between ${min} and ${max}`;
    return undefined;
  };
}

function enumValidator(options: string[]) {
  return (v: string) => (options.includes(v) ? undefined : `Must be one of: ${options.join(", ")}`);
}

function positiveInteger(v: string) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return "Must be a positive integer";
  return undefined;
}

function validateUrl(v: string) {
  if (v === "") return undefined; // empty to reset
  if (v.startsWith("http://") || v.startsWith("https://")) return undefined;
  return "Must be empty or start with http:// or https://";
}

// ── Whitelist ──────────────────────────────────────────────────────────

export const CONFIGURABLE_KEYS: Record<string, ConfigKeyMeta> = {
  // ─── API Keys ──────────────────────────────────────────────────────
  "agent.api_key": {
    type: "string",
    category: "API Keys",
    label: "LLM API Key",
    description: "LLM provider API key",
    sensitive: true,
    hotReload: "instant",
    validate: (v) => (v.length >= 10 ? undefined : "Must be at least 10 characters"),
    mask: (v) => v.slice(0, 8) + "****",
    parse: identity,
  },
  tavily_api_key: {
    type: "string",
    category: "API Keys",
    label: "Tavily API Key",
    description: "Tavily API key for web search",
    sensitive: true,
    hotReload: "instant",
    validate: (v) => (v.startsWith("tvly-") ? undefined : "Must start with 'tvly-'"),
    mask: (v) => v.slice(0, 9) + "****",
    parse: identity,
  },
  tonapi_key: {
    type: "string",
    category: "API Keys",
    label: "TonAPI Key",
    description: "TonAPI key for higher rate limits",
    sensitive: true,
    hotReload: "instant",
    validate: (v) => (v.length >= 10 ? undefined : "Must be at least 10 characters"),
    mask: (v) => v.slice(0, 10) + "****",
    parse: identity,
  },
  toncenter_api_key: {
    type: "string",
    category: "API Keys",
    label: "TonCenter API Key",
    description: "TonCenter API key for dedicated RPC endpoint (free at toncenter.com)",
    sensitive: true,
    hotReload: "instant",
    validate: (v) => (v.length >= 10 ? undefined : "Must be at least 10 characters"),
    mask: (v) => v.slice(0, 10) + "****",
    parse: identity,
  },
  "telegram.bot_token": {
    type: "string",
    category: "API Keys",
    label: "Bot Token",
    description: "Bot token from @BotFather",
    sensitive: true,
    hotReload: "instant",
    validate: (v) => (v.includes(":") ? undefined : "Must contain ':' (e.g., 123456:ABC...)"),
    mask: (v) => v.split(":")[0] + ":****",
    parse: identity,
  },

  // ─── Agent ─────────────────────────────────────────────────────────
  "agent.provider": {
    type: "enum",
    category: "Agent",
    label: "Provider",
    description: "LLM provider",
    sensitive: false,
    hotReload: "instant",
    options: [
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
    ],
    validate: enumValidator([
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
    ]),
    mask: identity,
    parse: identity,
  },
  "agent.model": {
    type: "string",
    category: "Agent",
    label: "Model",
    description: "Main LLM model ID",
    sensitive: false,
    hotReload: "instant",
    validate: nonEmpty,
    mask: identity,
    parse: identity,
  },
  "agent.utility_model": {
    type: "string",
    category: "Agent",
    label: "Utility Model",
    description: "Cheap model for summarization (auto-detected if empty)",
    sensitive: false,
    hotReload: "instant",
    validate: noValidation,
    mask: identity,
    parse: identity,
  },
  "agent.temperature": {
    type: "number",
    category: "Agent",
    label: "Temperature",
    description: "Response creativity (0.0 = deterministic, 2.0 = max)",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(0, 2),
    mask: identity,
    parse: (v) => Number(v),
  },
  "agent.max_tokens": {
    type: "number",
    category: "Agent",
    label: "Max Tokens",
    description: "Maximum response length in tokens",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(256, 128000),
    mask: identity,
    parse: (v) => Number(v),
  },
  "agent.max_agentic_iterations": {
    type: "number",
    category: "Agent",
    label: "Max Iterations",
    description: "Max tool-call loop iterations per message",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(1, 20),
    mask: identity,
    parse: (v) => Number(v),
  },
  "agent.base_url": {
    type: "string",
    category: "Agent",
    label: "API Base URL",
    description: "Base URL for local LLM server (requires restart)",
    sensitive: false,
    hotReload: "restart",
    validate: validateUrl,
    mask: identity,
    parse: identity,
  },
  "cocoon.port": {
    type: "number",
    category: "Agent",
    label: "Cocoon Port",
    description: "Cocoon proxy port (requires restart)",
    sensitive: false,
    hotReload: "restart",
    validate: numberInRange(1, 65535),
    mask: identity,
    parse: (v) => Number(v),
  },

  // ─── Session ───────────────────────────────────────────────────
  "agent.session_reset_policy.daily_reset_enabled": {
    type: "boolean",
    category: "Session",
    label: "Daily Reset",
    description: "Enable daily session reset at specified hour",
    sensitive: false,
    hotReload: "instant",
    validate: enumValidator(["true", "false"]),
    mask: identity,
    parse: (v) => v === "true",
  },
  "agent.session_reset_policy.daily_reset_hour": {
    type: "number",
    category: "Session",
    label: "Reset Hour",
    description: "Hour (0-23 UTC) for daily session reset",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(0, 23),
    mask: identity,
    parse: (v) => Number(v),
  },
  "agent.session_reset_policy.idle_expiry_enabled": {
    type: "boolean",
    category: "Session",
    label: "Idle Expiry",
    description: "Enable automatic session expiry after idle period",
    sensitive: false,
    hotReload: "instant",
    validate: enumValidator(["true", "false"]),
    mask: identity,
    parse: (v) => v === "true",
  },
  "agent.session_reset_policy.idle_expiry_minutes": {
    type: "number",
    category: "Session",
    label: "Idle Minutes",
    description: "Idle minutes before session expires (minimum 1)",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(1, Number.MAX_SAFE_INTEGER),
    mask: identity,
    parse: (v) => Number(v),
  },

  // ─── Telegram ──────────────────────────────────────────────────────
  "telegram.bot_username": {
    type: "string",
    category: "Telegram",
    label: "Bot Username",
    description: "Bot username without @",
    sensitive: false,
    hotReload: "instant",
    validate: (v) => (v.length >= 3 ? undefined : "Must be at least 3 characters"),
    mask: identity,
    parse: identity,
  },
  "telegram.dm_policy": {
    type: "enum",
    category: "Telegram",
    label: "DM Policy",
    description: "Who can message the bot in private",
    sensitive: false,
    hotReload: "instant",
    options: ["admin-only", "allowlist", "open", "disabled"],
    optionLabels: {
      "admin-only": "Admin Only",
      allowlist: "Allow Users",
      open: "Open",
      disabled: "Disabled",
    },
    validate: enumValidator(["open", "allowlist", "admin-only", "disabled"]),
    mask: identity,
    parse: identity,
  },
  "telegram.group_policy": {
    type: "enum",
    category: "Telegram",
    label: "Group Policy",
    description: "Which groups the bot can respond in",
    sensitive: false,
    hotReload: "instant",
    options: ["open", "allowlist", "admin-only", "disabled"],
    optionLabels: {
      open: "Open",
      allowlist: "Allow Groups",
      "admin-only": "Admin Only",
      disabled: "Disabled",
    },
    validate: enumValidator(["open", "allowlist", "admin-only", "disabled"]),
    mask: identity,
    parse: identity,
  },
  "telegram.require_mention": {
    type: "boolean",
    category: "Telegram",
    label: "Require Mention",
    description: "Require @mention in groups to respond",
    sensitive: false,
    hotReload: "instant",
    validate: enumValidator(["true", "false"]),
    mask: identity,
    parse: (v) => v === "true",
  },
  "telegram.owner_name": {
    type: "string",
    category: "Telegram",
    label: "Owner Name",
    description: "Owner's first name (used in system prompt)",
    sensitive: false,
    hotReload: "instant",
    validate: noValidation,
    mask: identity,
    parse: identity,
  },
  "telegram.owner_username": {
    type: "string",
    category: "Telegram",
    label: "Owner Username",
    description: "Owner's Telegram username (without @)",
    sensitive: false,
    hotReload: "instant",
    validate: noValidation,
    mask: identity,
    parse: identity,
  },
  "telegram.debounce_ms": {
    type: "number",
    category: "Telegram",
    label: "Debounce (ms)",
    description: "Group message debounce delay in ms (0 = disabled)",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(0, 10000),
    mask: identity,
    parse: (v) => Number(v),
  },
  "telegram.agent_channel": {
    type: "string",
    category: "Telegram",
    label: "Agent Channel",
    description: "Channel username for auto-publishing",
    sensitive: false,
    hotReload: "instant",
    validate: noValidation,
    mask: identity,
    parse: identity,
  },
  "telegram.typing_simulation": {
    type: "boolean",
    category: "Telegram",
    label: "Typing Simulation",
    description: "Simulate typing indicator before sending replies",
    sensitive: false,
    hotReload: "instant",
    validate: enumValidator(["true", "false"]),
    mask: identity,
    parse: (v) => v === "true",
  },
  "telegram.owner_id": {
    type: "number",
    category: "Telegram",
    label: "Admin ID",
    description: "Primary admin Telegram user ID (auto-added to Admin IDs)",
    sensitive: false,
    hotReload: "instant",
    validate: positiveInteger,
    mask: identity,
    parse: (v) => Number(v),
  },
  "telegram.max_message_length": {
    type: "number",
    category: "Telegram",
    label: "Max Message Length",
    description: "Maximum message length in characters",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(1, 32768),
    mask: identity,
    parse: (v) => Number(v),
  },
  "telegram.rate_limit_messages_per_second": {
    type: "number",
    category: "Telegram",
    label: "Rate Limit — Messages/sec",
    description: "Rate limit: messages per second (requires restart)",
    sensitive: false,
    hotReload: "restart",
    validate: numberInRange(0.1, 10),
    mask: identity,
    parse: (v) => Number(v),
  },
  "telegram.rate_limit_groups_per_minute": {
    type: "number",
    category: "Telegram",
    label: "Rate Limit — Groups/min",
    description: "Rate limit: groups per minute (requires restart)",
    sensitive: false,
    hotReload: "restart",
    validate: numberInRange(1, 60),
    mask: identity,
    parse: (v) => Number(v),
  },
  "telegram.admin_ids": {
    type: "array",
    itemType: "number",
    category: "Telegram",
    label: "Admin IDs",
    description: "Admin user IDs with elevated access",
    sensitive: false,
    hotReload: "instant",
    validate: positiveInteger,
    mask: identity,
    parse: (v) => Number(v),
  },
  "telegram.allow_from": {
    type: "array",
    itemType: "number",
    category: "Telegram",
    label: "Allowed Users",
    description: "User IDs allowed for DM access",
    sensitive: false,
    hotReload: "instant",
    validate: positiveInteger,
    mask: identity,
    parse: (v) => Number(v),
  },
  "telegram.group_allow_from": {
    type: "array",
    itemType: "number",
    category: "Telegram",
    label: "Allowed Groups",
    description: "Group IDs allowed for group access",
    sensitive: false,
    hotReload: "instant",
    validate: positiveInteger,
    mask: identity,
    parse: (v) => Number(v),
  },

  // ─── Embedding ─────────────────────────────────────────────────────
  "embedding.provider": {
    type: "enum",
    category: "Embedding",
    label: "Embedding Provider",
    description: "Embedding provider for RAG",
    sensitive: false,
    hotReload: "instant",
    options: ["local", "anthropic", "none"],
    validate: enumValidator(["local", "anthropic", "none"]),
    mask: identity,
    parse: identity,
  },
  "embedding.model": {
    type: "string",
    category: "Embedding",
    label: "Embedding Model",
    description: "Embedding model ID (requires restart)",
    sensitive: false,
    hotReload: "restart",
    validate: noValidation,
    mask: identity,
    parse: identity,
  },

  // ─── WebUI ─────────────────────────────────────────────────────────
  "webui.port": {
    type: "number",
    category: "WebUI",
    label: "WebUI Port",
    description: "HTTP server port (requires restart)",
    sensitive: false,
    hotReload: "restart",
    validate: numberInRange(1024, 65535),
    mask: identity,
    parse: (v) => Number(v),
  },
  "webui.log_requests": {
    type: "boolean",
    category: "WebUI",
    label: "Log HTTP Requests",
    description: "Log all HTTP requests to console",
    sensitive: false,
    hotReload: "instant",
    validate: enumValidator(["true", "false"]),
    mask: identity,
    parse: (v) => v === "true",
  },

  // ─── Deals ─────────────────────────────────────────────────────────
  "deals.enabled": {
    type: "boolean",
    category: "Deals",
    label: "Deals Enabled",
    description: "Enable the deals/escrow module",
    sensitive: false,
    hotReload: "instant",
    validate: enumValidator(["true", "false"]),
    mask: identity,
    parse: (v) => v === "true",
  },
  "deals.expiry_seconds": {
    type: "number",
    category: "Deals",
    label: "Deal Expiry",
    description: "Deal expiry timeout in seconds",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(10, 3600),
    mask: identity,
    parse: (v) => Number(v),
  },
  "deals.buy_max_floor_percent": {
    type: "number",
    category: "Deals",
    label: "Buy Max Floor %",
    description: "Maximum floor % for buy deals",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(1, 100),
    mask: identity,
    parse: (v) => Number(v),
  },
  "deals.sell_min_floor_percent": {
    type: "number",
    category: "Deals",
    label: "Sell Min Floor %",
    description: "Minimum floor % for sell deals",
    sensitive: false,
    hotReload: "instant",
    validate: numberInRange(100, 500),
    mask: identity,
    parse: (v) => Number(v),
  },

  // ─── Developer ─────────────────────────────────────────────────────
  "dev.hot_reload": {
    type: "boolean",
    category: "Developer",
    label: "Hot Reload",
    description: "Watch ~/.teleton/plugins/ for live changes",
    sensitive: false,
    hotReload: "instant",
    validate: enumValidator(["true", "false"]),
    mask: identity,
    parse: (v) => v === "true",
  },
};

// ── Category order for frontend grouping ───────────────────────────────

export const CATEGORY_ORDER: ConfigCategory[] = [
  "API Keys",
  "Agent",
  "Session",
  "Telegram",
  "Embedding",
  "WebUI",
  "Deals",
  "Developer",
];

// ── Dot-notation helpers ───────────────────────────────────────────────

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafePath(parts: string[]): void {
  if (parts.some((p) => FORBIDDEN_SEGMENTS.has(p))) {
    throw new Error("Invalid config path: forbidden segment");
  }
}

export function getNestedValue(obj: Record<string, any>, path: string): unknown {
  const parts = path.split(".");
  assertSafePath(parts);
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

export function setNestedValue(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split(".");
  assertSafePath(parts);
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

export function deleteNestedValue(obj: Record<string, any>, path: string): void {
  const parts = path.split(".");
  assertSafePath(parts);
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== "object") return;
    current = current[parts[i]];
  }
  if (current != null && typeof current === "object") {
    delete current[parts[parts.length - 1]];
  }
}

// ── Raw YAML read/write (preserves ~ paths, no expansion) ─────────────

export function readRawConfig(configPath: string): Record<string, any> {
  const fullPath = expandPath(configPath);
  if (!existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}\nRun 'teleton setup' to create one.`);
  }
  const raw = parse(readFileSync(fullPath, "utf-8"));
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid config file: ${fullPath}`);
  }
  return raw as Record<string, any>;
}

export function writeRawConfig(raw: Record<string, any>, configPath: string): void {
  const clone = { ...raw };
  delete clone.market;
  const result = ConfigSchema.safeParse(clone);
  if (!result.success) {
    throw new Error(`Refusing to save invalid config: ${result.error.message}`);
  }

  raw.meta = raw.meta ?? {};
  raw.meta.last_modified_at = new Date().toISOString();

  const fullPath = expandPath(configPath);
  writeFileSync(fullPath, stringify(raw), { encoding: "utf-8", mode: 0o600 });
}
