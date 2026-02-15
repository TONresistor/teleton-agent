const API_BASE = '/api';

// ── Response types ──────────────────────────────────────────────────

export interface StatusData {
  uptime: number;
  model: string;
  provider: string;
  sessionCount: number;
  paused: boolean;
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

export interface LogEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

// ── API response wrapper ────────────────────────────────────────────

interface APIResponse<T> {
  success: boolean;
  data: T;
}

// ── Fetch helper ────────────────────────────────────────────────────

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

  async updateToolConfig(
    toolName: string,
    config: { enabled?: boolean; scope?: 'always' | 'dm-only' | 'group-only' | 'admin-only' }
  ) {
    return fetchAPI<APIResponse<ToolConfigData>>(`/tools/${toolName}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async workspaceList(path = '', recursive = false) {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (recursive) params.set('recursive', 'true');
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

  async tasksList(status?: string) {
    const qs = status ? `?status=${status}` : '';
    return fetchAPI<APIResponse<TaskData[]>>(`/tasks${qs}`);
  },

  async tasksGet(id: string) {
    return fetchAPI<APIResponse<TaskData>>(`/tasks/${id}`);
  },

  async tasksDelete(id: string) {
    return fetchAPI<APIResponse<{ message: string }>>(`/tasks/${id}`, { method: 'DELETE' });
  },

  async tasksCancel(id: string) {
    return fetchAPI<APIResponse<TaskData>>(`/tasks/${id}/cancel`, { method: 'POST' });
  },

  async tasksCleanDone() {
    return fetchAPI<APIResponse<{ deleted: number }>>('/tasks/clean-done', { method: 'POST' });
  },

  connectLogs(onLog: (entry: LogEntry) => void, onError?: (error: Event) => void) {
    // No token needed — HttpOnly cookie is sent automatically by the browser
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
