import type {
  APIResponse,
  ConfigKeyData,
  ConversationChat,
  ConversationMessage,
  FileEntry,
  LogEntry,
  MarketplacePlugin,
  McpServerInfo,
  MemoryChunk,
  MemorySourceFile,
  MemoryStats,
  ModuleInfo,
  PluginManifest,
  PluginSecretsInfo,
  SearchResult,
  StatusData,
  TaskData,
  ToolAccessLevel,
  ToolConfigData,
  ToolRagStatus,
  WalletInfo,
  WalletTransaction,
  WorkspaceInfo,
} from "./api-types";
import { API_BASE, fetchAPI } from "./http-client";

export * from "./api-types";
export { checkAuth, login, logout } from "./http-client";
export { setup } from "./setup-api";

// ── API methods ─────────────────────────────────────────────────────

export const api = {
  async getStatus() {
    return fetchAPI<APIResponse<StatusData>>("/status");
  },

  // gocoon: decentralized LLM on TON
  async gocoonStatus() {
    return fetchAPI<
      APIResponse<{
        installed: boolean;
        version: string | null;
        wallet: {
          fundAddress: string;
          ownerAddress: string;
          balanceTon: string;
          balanceNano: string;
          funded: boolean;
          recommendedFundingTon: string;
        } | null;
        runner: boolean;
      }>
    >("/gocoon/status");
  },
  async gocoonInstall() {
    return fetchAPI<APIResponse<{ version: string }>>("/gocoon/install", { method: "POST" });
  },
  async gocoonInit() {
    return fetchAPI<APIResponse<{ fundAddress: string; recommendedFundingTon: string }>>(
      "/gocoon/init",
      { method: "POST" }
    );
  },
  async gocoonTopup(amount: string) {
    return fetchAPI<APIResponse<{ amount: string }>>("/gocoon/topup", {
      method: "POST",
      body: JSON.stringify({ amount }),
    });
  },
  async gocoonWithdrawStart(destination: string) {
    return fetchAPI<APIResponse<{ started: boolean }>>("/gocoon/withdraw", {
      method: "POST",
      body: JSON.stringify({ destination }),
    });
  },
  async gocoonWithdrawStatus() {
    return fetchAPI<
      APIResponse<{
        running: boolean;
        done: boolean;
        events: { stage: string; status: string; message: string; at: number }[];
        error?: string;
      }>
    >("/gocoon/withdraw");
  },
  async gocoonRunnerStop() {
    return fetchAPI<APIResponse<{ stopped: boolean }>>("/gocoon/runner/stop", { method: "POST" });
  },
  async gocoonReset() {
    return fetchAPI<APIResponse<{ reset: boolean }>>("/gocoon/reset", { method: "POST" });
  },

  async getTools() {
    return fetchAPI<APIResponse<ModuleInfo[]>>("/tools");
  },

  async getMemoryStats() {
    return fetchAPI<APIResponse<MemoryStats>>("/memory/stats");
  },

  async searchKnowledge(query: string, limit = 10) {
    return fetchAPI<APIResponse<SearchResult[]>>(
      `/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
  },

  async getMemorySources() {
    return fetchAPI<APIResponse<MemorySourceFile[]>>("/memory/sources");
  },

  async getSourceChunks(sourceKey: string) {
    return fetchAPI<APIResponse<MemoryChunk[]>>(`/memory/sources/${encodeURIComponent(sourceKey)}`);
  },

  async getWallet() {
    return fetchAPI<APIResponse<WalletInfo>>("/wallet");
  },

  async getWalletTransactions() {
    return fetchAPI<APIResponse<WalletTransaction[]>>("/wallet/transactions");
  },

  async getConversations() {
    return fetchAPI<APIResponse<ConversationChat[]>>("/conversations");
  },

  async getConversationMessages(chatId: string, limit = 50, offset = 0) {
    return fetchAPI<APIResponse<ConversationMessage[]>>(
      `/conversations/${encodeURIComponent(chatId)}/messages?limit=${limit}&offset=${offset}`
    );
  },

  async getSoulFile(filename: string) {
    return fetchAPI<APIResponse<{ content: string }>>(`/soul/${filename}`);
  },

  async updateSoulFile(filename: string, content: string) {
    return fetchAPI<APIResponse<{ message: string }>>(`/soul/${filename}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
  },

  async getPlugins() {
    return fetchAPI<APIResponse<PluginManifest[]>>("/plugins");
  },

  async setPluginPriority(pluginName: string, priority: number) {
    return fetchAPI<APIResponse<{ pluginName: string; priority: number }>>("/plugins/priorities", {
      method: "POST",
      body: JSON.stringify({ pluginName, priority }),
    });
  },

  async getToolRag() {
    return fetchAPI<APIResponse<ToolRagStatus>>("/tools/rag");
  },

  async updateToolRag(config: {
    enabled?: boolean;
    topK?: number;
    alwaysInclude?: string[];
    skipUnlimitedProviders?: boolean;
  }) {
    return fetchAPI<APIResponse<ToolRagStatus>>("/tools/rag", {
      method: "PUT",
      body: JSON.stringify(config),
    });
  },

  async getMcpServers() {
    return fetchAPI<APIResponse<McpServerInfo[]>>("/mcp");
  },

  async addMcpServer(data: {
    package?: string;
    url?: string;
    name?: string;
    args?: string[];
    scope?: string;
    env?: Record<string, string>;
  }) {
    return fetchAPI<APIResponse<{ name: string; message: string }>>("/mcp", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async removeMcpServer(name: string) {
    return fetchAPI<APIResponse<{ name: string; message: string }>>(
      `/mcp/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
      }
    );
  },

  async updateToolConfig(toolName: string, config: { level?: ToolAccessLevel }) {
    return fetchAPI<APIResponse<ToolConfigData>>(`/tools/${toolName}`, {
      method: "PUT",
      body: JSON.stringify(config),
    });
  },

  async workspaceList(_path = "", _recursive = false) {
    const params = new URLSearchParams();
    if (_path) params.set("path", _path);
    if (_recursive) params.set("recursive", "true");
    const qs = params.toString();
    return fetchAPI<APIResponse<{ entries: FileEntry[]; truncated?: boolean }>>(
      `/workspace${qs ? `?${qs}` : ""}`
    );
  },

  async workspaceRead(path: string) {
    return fetchAPI<APIResponse<{ content: string; size: number }>>(
      `/workspace/read?path=${encodeURIComponent(path)}`
    );
  },

  async workspaceWrite(path: string, content: string) {
    return fetchAPI<APIResponse<{ message: string }>>("/workspace/write", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    });
  },

  async workspaceMkdir(path: string) {
    return fetchAPI<APIResponse<{ message: string }>>("/workspace/mkdir", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  },

  async workspaceDelete(path: string, recursive = false) {
    return fetchAPI<APIResponse<{ message: string }>>("/workspace", {
      method: "DELETE",
      body: JSON.stringify({ path, recursive }),
    });
  },

  async workspaceRename(from: string, to: string) {
    return fetchAPI<APIResponse<{ message: string }>>("/workspace/rename", {
      method: "POST",
      body: JSON.stringify({ from, to }),
    });
  },

  async workspaceInfo() {
    return fetchAPI<APIResponse<WorkspaceInfo>>("/workspace/info");
  },

  workspaceRawUrl(path: string): string {
    return `/api/workspace/raw?path=${encodeURIComponent(path)}`;
  },

  async tasksList(_status?: string) {
    const qs = _status ? `?status=${_status}` : "";
    return fetchAPI<APIResponse<TaskData[]>>(`/tasks${qs}`);
  },

  async tasksDelete(_id: string) {
    return fetchAPI<APIResponse<{ message: string }>>(`/tasks/${_id}`, { method: "DELETE" });
  },

  async tasksCancel(_id: string) {
    return fetchAPI<APIResponse<TaskData>>(`/tasks/${_id}/cancel`, { method: "POST" });
  },

  async tasksClean(status: string) {
    return fetchAPI<APIResponse<{ deleted: number }>>("/tasks/clean", {
      method: "POST",
      body: JSON.stringify({ status }),
    });
  },

  async getConfigKeys() {
    return fetchAPI<APIResponse<ConfigKeyData[]>>("/config");
  },

  async setConfigKey(key: string, value: string | string[]) {
    return fetchAPI<APIResponse<ConfigKeyData>>(`/config/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  },

  async getModelsForProvider(provider: string) {
    return fetchAPI<APIResponse<Array<{ value: string; name: string; description: string }>>>(
      `/config/models/${encodeURIComponent(provider)}`
    );
  },

  async getProviderMeta(provider: string) {
    return fetchAPI<
      APIResponse<{
        needsKey: boolean;
        keyHint: string;
        keyPrefix: string | null;
        consoleUrl: string;
        displayName: string;
      }>
    >(`/config/provider-meta/${encodeURIComponent(provider)}`);
  },

  async validateApiKey(provider: string, apiKey: string) {
    return fetchAPI<APIResponse<{ valid: boolean; error: string | null }>>(
      "/config/validate-api-key",
      {
        method: "POST",
        body: JSON.stringify({ provider, apiKey }),
      }
    );
  },

  async getMarketplace(_refresh = false) {
    const qs = _refresh ? "?refresh=true" : "";
    return fetchAPI<APIResponse<MarketplacePlugin[]>>(`/marketplace${qs}`);
  },

  async installPlugin(id: string) {
    return fetchAPI<APIResponse<{ name: string; version: string; toolCount: number }>>(
      "/marketplace/install",
      {
        method: "POST",
        body: JSON.stringify({ id }),
      }
    );
  },

  async uninstallPlugin(id: string) {
    return fetchAPI<APIResponse<{ message: string }>>("/marketplace/uninstall", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  },

  async updatePlugin(id: string) {
    return fetchAPI<APIResponse<{ name: string; version: string; toolCount: number }>>(
      "/marketplace/update",
      {
        method: "POST",
        body: JSON.stringify({ id }),
      }
    );
  },

  async getPluginSecrets(pluginId: string) {
    return fetchAPI<APIResponse<PluginSecretsInfo>>(
      `/marketplace/secrets/${encodeURIComponent(pluginId)}`
    );
  },

  async setPluginSecret(pluginId: string, key: string, value: string) {
    return fetchAPI<APIResponse<{ key: string; set: boolean }>>(
      `/marketplace/secrets/${encodeURIComponent(pluginId)}/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        body: JSON.stringify({ value }),
      }
    );
  },

  async unsetPluginSecret(pluginId: string, key: string) {
    return fetchAPI<APIResponse<{ key: string; set: boolean }>>(
      `/marketplace/secrets/${encodeURIComponent(pluginId)}/${encodeURIComponent(key)}`,
      {
        method: "DELETE",
      }
    );
  },

  // ── Hooks ─────────────────────────────────────────────────────────

  async getBlocklist() {
    return fetchAPI<APIResponse<{ enabled: boolean; keywords: string[]; message: string }>>(
      "/hooks/blocklist"
    );
  },

  async updateBlocklist(config: { enabled: boolean; keywords: string[]; message: string }) {
    return fetchAPI<APIResponse<{ enabled: boolean; keywords: string[]; message: string }>>(
      "/hooks/blocklist",
      {
        method: "PUT",
        body: JSON.stringify(config),
      }
    );
  },

  async getTriggers() {
    return fetchAPI<
      APIResponse<Array<{ id: string; keyword: string; context: string; enabled: boolean }>>
    >("/hooks/triggers");
  },

  async createTrigger(data: { keyword: string; context: string; enabled?: boolean }) {
    return fetchAPI<
      APIResponse<{ id: string; keyword: string; context: string; enabled: boolean }>
    >("/hooks/triggers", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateTrigger(id: string, data: { keyword?: string; context?: string; enabled?: boolean }) {
    return fetchAPI<
      APIResponse<{ id: string; keyword: string; context: string; enabled: boolean }>
    >(`/hooks/triggers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deleteTrigger(id: string) {
    return fetchAPI<APIResponse<null>>(`/hooks/triggers/${id}`, { method: "DELETE" });
  },

  async toggleTrigger(id: string, enabled: boolean) {
    return fetchAPI<APIResponse<{ id: string; enabled: boolean }>>(`/hooks/triggers/${id}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
  },

  // ── TON Proxy ──────────────────────────────────────────────────────

  async getTonProxyStatus() {
    return fetchAPI<
      APIResponse<{
        running: boolean;
        installed: boolean;
        port: number;
        enabled: boolean;
        pid?: number;
      }>
    >("/ton-proxy");
  },

  async startTonProxy() {
    return fetchAPI<
      APIResponse<{
        running: boolean;
        installed: boolean;
        port: number;
        enabled: boolean;
        pid?: number;
      }>
    >("/ton-proxy/start", { method: "POST" });
  },

  async stopTonProxy() {
    return fetchAPI<
      APIResponse<{
        running: boolean;
        installed: boolean;
        port: number;
        enabled: boolean;
        pid?: number;
      }>
    >("/ton-proxy/stop", { method: "POST" });
  },

  async uninstallTonProxy() {
    return fetchAPI<
      APIResponse<{ running: boolean; installed: boolean; port: number; enabled: boolean }>
    >("/ton-proxy/uninstall", { method: "POST" });
  },

  connectLogs(onLog: (entry: LogEntry) => void, onError?: (error: Event) => void) {
    const url = `${API_BASE}/logs/stream`;
    const eventSource = new EventSource(url);

    eventSource.addEventListener("log", (event) => {
      try {
        const entry = JSON.parse(event.data);
        onLog(entry);
      } catch (error) {
        console.error("Failed to parse log entry:", error);
      }
    });

    eventSource.onerror = (error) => {
      onError?.(error);
    };

    return () => eventSource.close();
  },
};
