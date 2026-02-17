import type { AgentRuntime } from "../agent/runtime.js";
import type { TelegramBridge } from "../telegram/bridge.js";
import type { MemorySystem } from "../memory/index.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { WebUIConfig, Config } from "../config/schema.js";
import type { Database } from "better-sqlite3";
import type { PluginModule, PluginContext } from "../agent/tools/types.js";
import type { SDKDependencies } from "../sdk/index.js";

export interface LoadedPlugin {
  name: string;
  version: string;
}

export interface McpServerInfo {
  name: string;
  type: "stdio" | "sse";
  target: string;
  scope: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  tools: string[];
  envKeys: string[];
}

export interface WebUIServerDeps {
  agent: AgentRuntime;
  bridge: TelegramBridge;
  memory: {
    db: Database;
    embedder: MemorySystem["embedder"];
    knowledge: MemorySystem["knowledge"];
  };
  toolRegistry: ToolRegistry;
  plugins: LoadedPlugin[];
  mcpServers: McpServerInfo[];
  config: WebUIConfig;
  configPath: string;
  marketplace?: MarketplaceDeps;
}

// ── Marketplace types ───────────────────────────────────────────────

export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  tags: string[];
  path: string;
}

export interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  tags: string[];
  remoteVersion: string;
  installedVersion: string | null;
  status: "available" | "installed" | "updatable";
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  secrets?: Record<string, { required: boolean; description: string; env?: string }>;
}

export interface MarketplaceDeps {
  modules: PluginModule[];
  config: Config;
  sdkDeps: SDKDependencies;
  pluginContext: PluginContext;
  loadedModuleNames: string[];
  rewireHooks: () => void;
}

export interface LogEntry {
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
}

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StatusResponse {
  uptime: number;
  model: string;
  provider: string;
  sessionCount: number;
  paused: boolean;
  toolCount: number;
}

export interface ToolInfo {
  name: string;
  description: string;
  module: string;
  scope: "always" | "dm-only" | "group-only" | "admin-only";
  category?: string;
  enabled: boolean;
}

export interface ModuleInfo {
  name: string;
  toolCount: number;
  tools: ToolInfo[];
  isPlugin: boolean;
}

export interface PluginManifest {
  name: string;
  version: string;
  author?: string;
  description?: string;
  dependencies?: string[];
  sdkVersion?: string;
}

export interface MemorySearchResult {
  id: string;
  text: string;
  source: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
}

export interface SessionInfo {
  chatId: string;
  sessionId: string;
  messageCount: number;
  contextTokens: number;
  lastActivity: number;
}
