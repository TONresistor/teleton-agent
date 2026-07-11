/** Dependency-free HTTP contracts shared by the WebUI server and browser client. */

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
  toolCount: number;
  tokenUsage: { totalTokens: number; totalCost: number };
  platform: string;
}

export type ToolAccessLevel = "all" | "allowlist" | "admin" | "off";
export type ToolScope =
  | "always"
  | "dm-only"
  | "group-only"
  | "admin-only"
  | "open"
  | "allowlist"
  | "disabled";

export interface ToolInfo {
  name: string;
  description: string;
  module: string;
  level: ToolAccessLevel;
  category?: string;
  scope?: ToolScope;
  enabled?: boolean;
}

export interface ModuleInfo {
  name: string;
  toolCount: number;
  tools: ToolInfo[];
  isPlugin: boolean;
}

export interface MemorySearchResult {
  id: string;
  text: string;
  source: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
}

export interface MemorySourceFile {
  source: string;
  entryCount: number;
  lastUpdated: number;
}

export interface McpServerInfo {
  name: string;
  type: "stdio" | "sse" | "streamable-http";
  target: string;
  scope: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  tools: string[];
  envKeys: string[];
}

export interface LogEntry {
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
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

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

export interface WorkspaceInfo {
  root: string;
  totalFiles: number;
  totalSize: number;
  truncated?: boolean;
}

export type ConfigKeyType = "string" | "number" | "boolean" | "enum" | "array";
export type ConfigCategory =
  | "API Keys"
  | "Agent"
  | "Session"
  | "Telegram"
  | "Embedding"
  | "WebUI"
  | "TON Proxy"
  | "Coding Agent"
  | "Developer";

export interface ConfigKeyData {
  key: string;
  label: string;
  set: boolean;
  value: string | null;
  sensitive: boolean;
  type: ConfigKeyType;
  hotReload: "instant" | "restart";
  itemType?: "string" | "number";
  options?: string[];
  optionLabels?: Record<string, string>;
  category: ConfigCategory;
  description: string;
}
