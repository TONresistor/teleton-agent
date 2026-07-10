import type {
  ConfigKeyData,
  FileEntry,
  LogEntry,
  MarketplacePlugin,
  McpServerInfo,
  MemorySearchResult,
  MemorySourceFile,
  ModuleInfo,
  StatusResponse,
  ToolAccessLevel,
  ToolInfo,
  WorkspaceInfo,
} from "../../../src/webui/contracts";

export type {
  ConfigKeyData,
  FileEntry,
  LogEntry,
  MarketplacePlugin,
  McpServerInfo,
  MemorySourceFile,
  ModuleInfo,
  ToolAccessLevel,
  ToolInfo,
  WorkspaceInfo,
};
export type StatusData = StatusResponse;
export type SearchResult = MemorySearchResult;

// ── Setup types ─────────────────────────────────────────────────────

export interface SetupStatusResponse {
  workspaceExists: boolean;
  configExists: boolean;
  walletExists: boolean;
  walletAddress: string | null;
  sessionExists: boolean;
  envVars: {
    apiKey: string | null;
    apiKeyRaw: boolean;
    telegramApiId: string | null;
    telegramApiHash: string | null;
    telegramPhone: string | null;
  };
}

export interface SetupProvider {
  id: string;
  displayName: string;
  defaultModel: string;
  utilityModel: string;
  toolLimit: number | null;
  keyPrefix: string | null;
  consoleUrl: string | null;
  credentialMode: "api-key" | "cli-auto" | "none";
  requiresApiKey: boolean;
}

export interface SetupModelOption {
  value: string;
  name: string;
  description: string;
  isCustom?: boolean;
}

export interface BotValidation {
  valid: boolean;
  networkError: boolean;
  bot?: { username: string; firstName: string };
  error?: string;
}

export interface WalletStatus {
  exists: boolean;
  address?: string;
}

export interface WalletResult {
  address: string;
  mnemonic: string[];
}

export interface AuthCodeResult {
  authSessionId: string;
  codeDelivery: "app" | "sms" | "fragment";
  fragmentUrl?: string;
  codeLength?: number;
  expiresAt: number;
}

export interface AuthVerifyResult {
  status: "authenticated" | "2fa_required";
  user?: { id: number; firstName: string; username: string };
  passwordHint?: string;
}

export interface SetupConfig {
  agent: {
    provider: string;
    api_key?: string;
    base_url?: string;
    model?: string;
    max_agentic_iterations?: number;
  };
  telegram: {
    mode?: "user" | "bot";
    api_id: number;
    api_hash: string;
    phone: string;
    admin_ids: number[];
    owner_id: number;
    dm_policy?: string;
    group_policy?: string;
    require_mention?: boolean;
    bot_token?: string;
    bot_username?: string;
  };
  gocoon?: { port: number };
  tonapi_key?: string;
  toncenter_api_key?: string;
  tavily_api_key?: string;
  webui?: { enabled: boolean };
}

// ── Response types ──────────────────────────────────────────────────

export interface MemoryStats {
  knowledge: number;
  sessions: number;
  messages: number;
  chats: number;
}

export interface MemoryChunk {
  id: string;
  text: string;
  source: string;
  startLine: number | null;
  endLine: number | null;
  updatedAt: number;
}

export interface ConversationChat {
  id: string;
  type: string;
  title: string | null;
  username: string | null;
  message_count: number;
  last_message_at: number | null;
  last_message: string | null;
}

export interface ConversationMessage {
  id: string;
  chat_id: string;
  sender_id: string | null;
  text: string | null;
  is_from_agent: number;
  has_media: number;
  media_type: string | null;
  timestamp: number;
}

export interface WalletInfo {
  address: string | null;
  balance: string;
}

export interface WalletTransaction {
  type: string;
  hash: string;
  amount?: string;
  from?: string;
  to?: string;
  comment?: string | null;
  date: string;
  secondsAgo: number;
  explorer: string;
  jettonAmount?: string;
  jettonWallet?: string;
  nftAddress?: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  author?: string;
  description?: string;
  dependencies?: string[];
  sdkVersion?: string;
}

export interface TaskData {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "done" | "failed" | "cancelled";
  priority: number;
  createdBy?: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  scheduledFor?: string | null;
  payload?: string | null;
  reason?: string | null;
  result?: string | null;
  error?: string | null;
  dependencies: string[];
  dependents: string[];
}

export interface ToolConfigData {
  tool: string;
  level: ToolAccessLevel;
  scope?: string;
  enabled?: boolean;
}

export interface ToolRagStatus {
  enabled: boolean;
  indexed: boolean;
  topK: number;
  totalTools: number;
  alwaysInclude?: string[];
  skipUnlimitedProviders?: boolean;
}

export interface SecretDeclaration {
  required: boolean;
  description: string;
  env?: string;
}

export interface PluginSecretsInfo {
  declared: Record<string, SecretDeclaration>;
  configured: string[];
}

// ── API response wrapper ────────────────────────────────────────────

export interface APIResponse<T> {
  success: boolean;
  data: T;
}
