const API_BASE = '/api';

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
  codeViaApp: boolean;
  expiresAt: number;
}

export interface AuthVerifyResult {
  status: 'authenticated' | '2fa_required';
  user?: { id: number; firstName: string; username: string };
  passwordHint?: string;
}

export interface SetupConfig {
  agent: { provider: string; api_key?: string; base_url?: string; model?: string; max_agentic_iterations?: number };
  telegram: {
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
  cocoon?: { port: number };
  deals?: { buy_max_floor_percent?: number; sell_min_floor_percent?: number };
  tonapi_key?: string;
  tavily_api_key?: string;
  webui?: { enabled: boolean };
}

// ── Response types ──────────────────────────────────────────────────

export interface StatusData {
  uptime: number;
  model: string;
  provider: string;
  sessionCount: number;
  toolCount: number;
}

export interface MemoryStats {
  knowledge: number;
  sessions: number;
  messages: number;
  chats: number;
}

export interface SearchResult {
  id: string;
  text: string;
  source: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
}

export interface ToolInfo {
  name: string;
  description: string;
  module: string;
  scope: 'always' | 'dm-only' | 'group-only' | 'admin-only';
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

export interface TaskData {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
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
}

export interface ToolConfigData {
  tool: string;
  enabled: boolean;
  scope: string;
}

export interface ToolRagStatus {
  enabled: boolean;
  indexed: boolean;
  topK: number;
  totalTools: number;
  alwaysInclude?: string[];
  skipUnlimitedProviders?: boolean;
}

export interface McpServerInfo {
  name: string;
  type: 'stdio' | 'sse' | 'streamable-http';
  target: string;
  scope: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  tools: string[];
  envKeys: string[];
}

export interface ConfigKeyData {
  key: string;
  set: boolean;
  value: string | null;
  sensitive: boolean;
  type: 'string' | 'number' | 'boolean' | 'enum';
  options?: string[];
  category: string;
  description: string;
}

export interface LogEntry {
  level: 'log' | 'warn' | 'error';
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
  status: 'available' | 'installed' | 'updatable';
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  secrets?: Record<string, { required: boolean; description: string; env?: string }>;
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

interface APIResponse<T> {
  success: boolean;
  data: T;
}

// ── Fetch helpers ───────────────────────────────────────────────────

async function fetchSetupAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options?.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const json = await response.json();
  return json.data !== undefined ? json.data : json;
}

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options?.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include', // send HttpOnly cookie automatically
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ── Auth ────────────────────────────────────────────────────────────

/** Check if session cookie is valid */
export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/auth/check', { credentials: 'include' });
    const data = await res.json();
    return data.success && data.data?.authenticated;
  } catch {
    return false;
  }
}

/** Login with token — server sets HttpOnly cookie */
export async function login(token: string): Promise<boolean> {
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Logout — server clears cookie */
export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
}

// ── API methods ─────────────────────────────────────────────────────

export const api = {
  async getStatus() {
    return fetchAPI<APIResponse<StatusData>>('/status');
  },

  async getTools() {
    return fetchAPI<APIResponse<ModuleInfo[]>>('/tools');
  },

  async getMemoryStats() {
    return fetchAPI<APIResponse<MemoryStats>>('/memory/stats');
  },

  async searchKnowledge(query: string, limit = 10) {
    return fetchAPI<APIResponse<SearchResult[]>>(`/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  },

  async getSoulFile(filename: string) {
    return fetchAPI<APIResponse<{ content: string }>>(`/soul/${filename}`);
  },

  async updateSoulFile(filename: string, content: string) {
    return fetchAPI<APIResponse<{ message: string }>>(`/soul/${filename}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  },

  async getPlugins() {
    return fetchAPI<APIResponse<PluginManifest[]>>('/plugins');
  },

  async getToolRag() {
    return fetchAPI<APIResponse<ToolRagStatus>>('/tools/rag');
  },

  async updateToolRag(config: { enabled?: boolean; topK?: number }) {
    return fetchAPI<APIResponse<ToolRagStatus>>('/tools/rag', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async getMcpServers() {
    return fetchAPI<APIResponse<McpServerInfo[]>>('/mcp');
  },

  async addMcpServer(data: { package?: string; url?: string; name?: string; args?: string[]; scope?: string; env?: Record<string, string> }) {
    return fetchAPI<APIResponse<{ name: string; message: string }>>('/mcp', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async removeMcpServer(name: string) {
    return fetchAPI<APIResponse<{ name: string; message: string }>>(`/mcp/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },

  async updateToolConfig(
    toolName: string,
    config: { enabled?: boolean; scope?: 'always' | 'dm-only' | 'group-only' | 'admin-only' }
  ) {
    return fetchAPI<APIResponse<ToolConfigData>>(`/tools/${toolName}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async workspaceList(_path = '', _recursive = false) {
    const params = new URLSearchParams();
    if (_path) params.set('path', _path);
    if (_recursive) params.set('recursive', 'true');
    const qs = params.toString();
    return fetchAPI<APIResponse<FileEntry[]>>(`/workspace${qs ? `?${qs}` : ''}`);
  },

  async workspaceRead(path: string) {
    return fetchAPI<APIResponse<{ content: string; size: number }>>(`/workspace/read?path=${encodeURIComponent(path)}`);
  },

  async workspaceWrite(path: string, content: string) {
    return fetchAPI<APIResponse<{ message: string }>>('/workspace/write', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    });
  },

  async workspaceMkdir(path: string) {
    return fetchAPI<APIResponse<{ message: string }>>('/workspace/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  async workspaceDelete(path: string, recursive = false) {
    return fetchAPI<APIResponse<{ message: string }>>('/workspace', {
      method: 'DELETE',
      body: JSON.stringify({ path, recursive }),
    });
  },

  async workspaceRename(from: string, to: string) {
    return fetchAPI<APIResponse<{ message: string }>>('/workspace/rename', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    });
  },

  async workspaceInfo() {
    return fetchAPI<APIResponse<WorkspaceInfo>>('/workspace/info');
  },

  async tasksList(_status?: string) {
    const qs = _status ? `?status=${_status}` : '';
    return fetchAPI<APIResponse<TaskData[]>>(`/tasks${qs}`);
  },

  async tasksGet(id: string) {
    return fetchAPI<APIResponse<TaskData>>(`/tasks/${id}`);
  },

  async tasksDelete(_id: string) {
    return fetchAPI<APIResponse<{ message: string }>>(`/tasks/${_id}`, { method: 'DELETE' });
  },

  async tasksCancel(_id: string) {
    return fetchAPI<APIResponse<TaskData>>(`/tasks/${_id}/cancel`, { method: 'POST' });
  },

  async tasksCleanDone() {
    return fetchAPI<APIResponse<{ deleted: number }>>('/tasks/clean-done', { method: 'POST' });
  },

  async getConfigKeys() {
    return fetchAPI<APIResponse<ConfigKeyData[]>>('/config');
  },

  async setConfigKey(key: string, value: string) {
    return fetchAPI<APIResponse<ConfigKeyData>>(`/config/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  },

  async unsetConfigKey(key: string) {
    return fetchAPI<APIResponse<ConfigKeyData>>(`/config/${key}`, {
      method: 'DELETE',
    });
  },

  async getMarketplace(_refresh = false) {
    const qs = _refresh ? '?refresh=true' : '';
    return fetchAPI<APIResponse<MarketplacePlugin[]>>(`/marketplace${qs}`);
  },

  async installPlugin(id: string) {
    return fetchAPI<APIResponse<{ name: string; version: string; toolCount: number }>>('/marketplace/install', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  },

  async uninstallPlugin(id: string) {
    return fetchAPI<APIResponse<{ message: string }>>('/marketplace/uninstall', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  },

  async updatePlugin(id: string) {
    return fetchAPI<APIResponse<{ name: string; version: string; toolCount: number }>>('/marketplace/update', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  },

  async getPluginSecrets(pluginId: string) {
    return fetchAPI<APIResponse<PluginSecretsInfo>>(`/marketplace/secrets/${encodeURIComponent(pluginId)}`);
  },

  async setPluginSecret(pluginId: string, key: string, value: string) {
    return fetchAPI<APIResponse<{ key: string; set: boolean }>>(`/marketplace/secrets/${encodeURIComponent(pluginId)}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  },

  async unsetPluginSecret(pluginId: string, key: string) {
    return fetchAPI<APIResponse<{ key: string; set: boolean }>>(`/marketplace/secrets/${encodeURIComponent(pluginId)}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  },

  connectLogs(onLog: (entry: LogEntry) => void, onError?: (error: Event) => void) {
    const url = `${API_BASE}/logs/stream`;
    const eventSource = new EventSource(url);

    eventSource.addEventListener('log', (event) => {
      try {
        const entry = JSON.parse(event.data);
        onLog(entry);
      } catch (error) {
        console.error('Failed to parse log entry:', error);
      }
    });

    eventSource.onerror = (error) => {
      onError?.(error);
    };

    return () => eventSource.close();
  },
};

// ── Setup API (no auth required) ────────────────────────────────────

export const setup = {
  getStatus: () =>
    fetchSetupAPI<SetupStatusResponse>('/setup/status'),

  getProviders: () =>
    fetchSetupAPI<SetupProvider[]>('/setup/providers'),

  getModels: (_provider: string) =>
    fetchSetupAPI<SetupModelOption[]>(`/setup/models/${encodeURIComponent(_provider)}`),

  validateApiKey: (provider: string, apiKey: string) =>
    fetchSetupAPI<{ valid: boolean; error?: string }>('/setup/validate/api-key', {
      method: 'POST',
      body: JSON.stringify({ provider, apiKey }),
    }),

  validateBotToken: (token: string) =>
    fetchSetupAPI<BotValidation>('/setup/validate/bot-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  initWorkspace: (agentName?: string) =>
    fetchSetupAPI<{ created: boolean; path: string }>('/setup/workspace/init', {
      method: 'POST',
      body: JSON.stringify({ agentName }),
    }),

  getWalletStatus: () =>
    fetchSetupAPI<WalletStatus>('/setup/wallet/status'),

  generateWallet: () =>
    fetchSetupAPI<WalletResult>('/setup/wallet/generate', { method: 'POST' }),

  importWallet: (mnemonic: string) =>
    fetchSetupAPI<{ address: string }>('/setup/wallet/import', {
      method: 'POST',
      body: JSON.stringify({ mnemonic }),
    }),

  sendCode: (apiId: number, apiHash: string, phone: string) =>
    fetchSetupAPI<AuthCodeResult>('/setup/telegram/send-code', {
      method: 'POST',
      body: JSON.stringify({ apiId, apiHash, phone }),
    }),

  verifyCode: (authSessionId: string, code: string) =>
    fetchSetupAPI<AuthVerifyResult>('/setup/telegram/verify-code', {
      method: 'POST',
      body: JSON.stringify({ authSessionId, code }),
    }),

  verifyPassword: (authSessionId: string, password: string) =>
    fetchSetupAPI<AuthVerifyResult>('/setup/telegram/verify-password', {
      method: 'POST',
      body: JSON.stringify({ authSessionId, password }),
    }),

  resendCode: (authSessionId: string) =>
    fetchSetupAPI<{ codeViaApp: boolean }>('/setup/telegram/resend-code', {
      method: 'POST',
      body: JSON.stringify({ authSessionId }),
    }),

  saveConfig: (config: SetupConfig) =>
    fetchSetupAPI<{ path: string }>('/setup/config/save', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  launch: () =>
    fetchSetupAPI<{ token: string }>('/setup/launch', { method: 'POST' }),

  pollHealth: async (timeoutMs = 30000): Promise<void> => {
    const start = Date.now();
    const interval = 1000;
    // Wait a beat for the server to restart
    await new Promise((r) => setTimeout(r, 1500));

    while (Date.now() - start < timeoutMs) {
      try {
        const authRes = await fetch('/auth/check', { signal: AbortSignal.timeout(2000) });
        if (authRes.ok) {
          const json = await authRes.json();
          // The setup server returns { data: { setup: true } } — reject it.
          // The agent WebUI returns { data: { authenticated: bool } } without setup flag.
          if (json.success && json.data && !json.data.setup) return;
        }
      } catch {
        // Server not up yet (connection refused, timeout, etc.)
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error('Agent did not start within the expected time');
  },
};
