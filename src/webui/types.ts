import type { AgentRuntime } from "../agent/runtime.js";
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import type { MemorySystem } from "../memory/index.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { WebUIConfig, Config } from "../config/schema.js";
import type { Database } from "better-sqlite3";
import type { PluginModule, PluginContext } from "../agent/tools/types.js";
import type { SDKDependencies } from "../sdk/index.js";
import type { AgentLifecycle } from "../agent/lifecycle.js";
import type { UserHookEvaluator } from "../agent/hooks/user-hook-evaluator.js";
import type { McpServerInfo } from "./contracts.js";

export type {
  APIResponse,
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
  ToolScope,
  WorkspaceInfo,
} from "./contracts.js";

export interface LoadedPlugin {
  name: string;
  version: string;
}

export interface WebUIServerDeps {
  agent: AgentRuntime;
  bridge: ITelegramBridge;
  memory: {
    db: Database;
    embedder: MemorySystem["embedder"];
    knowledge: MemorySystem["knowledge"];
  };
  toolRegistry: ToolRegistry;
  plugins: LoadedPlugin[];
  mcpServers: McpServerInfo[] | (() => McpServerInfo[]);
  config: WebUIConfig;
  configPath: string;
  lifecycle?: AgentLifecycle;
  marketplace?: MarketplaceDeps;
  userHookEvaluator?: UserHookEvaluator | null;
  /** Stop the supervised gocoon runner + proxy so a withdraw can close the channel. */
  gocoonControl?: { stopRunner: () => boolean };
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

export interface MarketplaceDeps {
  modules: PluginModule[];
  config: Config;
  sdkDeps: SDKDependencies;
  pluginContext: PluginContext;
  loadedModuleNames: string[];
  rewireHooks: () => void;
}

export interface SessionInfo {
  chatId: string;
  sessionId: string;
  messageCount: number;
  contextTokens: number;
  lastActivity: number;
}
