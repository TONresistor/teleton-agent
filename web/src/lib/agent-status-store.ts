export type AgentState = 'stopped' | 'starting' | 'running' | 'stopping';

export interface AgentStatusSnapshot {
  state: AgentState;
  error: string | null;
}

interface AgentStatusEvent {
  state: AgentState;
  error: string | null;
  timestamp: number;
}

type Listener = () => void;

const SSE_URL = '/api/agent/events';
const POLL_URL = '/api/agent/status';
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  return base + base * 0.3 * Math.random();
}

/**
 * Singleton store for agent run-state. A single EventSource (with polling
 * fallback) is shared by every useAgentStatus() consumer — ref-counted so it
 * connects on the first subscriber and tears down on the last. Previously each
 * hook instance opened its own SSE connection (badge + control = 2 streams).
 */
class AgentStatusStore {
  private snapshot: AgentStatusSnapshot = { state: 'stopped', error: 'Status not received' };
  private listeners = new Set<Listener>();

  private es: EventSource | null = null;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityBound = false;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  getSnapshot = (): AgentStatusSnapshot => this.snapshot;

  private setStatus(state: AgentState, error: string | null) {
    if (this.snapshot.state === state && this.snapshot.error === error) return;
    this.snapshot = { state, error };
    for (const fn of this.listeners) fn();
  }

  private start() {
    if (!this.visibilityBound) {
      document.addEventListener('visibilitychange', this.handleVisibility);
      this.visibilityBound = true;
    }
    this.connect();
  }

  private stop() {
    this.closeSSE();
    this.stopPolling();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.visibilityBound) {
      document.removeEventListener('visibilitychange', this.handleVisibility);
      this.visibilityBound = false;
    }
  }

  private handleStatusEvent = (ev: MessageEvent) => {
    try {
      const data: AgentStatusEvent = JSON.parse(ev.data);
      this.setStatus(data.state, data.error ?? null);
      this.retryCount = 0;
    } catch {
      // ignore parse errors
    }
  };

  private closeSSE() {
    if (this.es) {
      this.es.removeEventListener('status', this.handleStatusEvent as EventListener);
      this.es.close();
      this.es = null;
    }
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startPolling() {
    if (this.pollTimer) return;
    const poll = async () => {
      try {
        const res = await fetch(POLL_URL, { credentials: 'include' });
        if (!res.ok) throw new Error('Status unavailable');
        const json = await res.json();
        const data = json.data ?? json;
        this.setStatus(data.state, data.error ?? null);
      } catch {
        this.setStatus(this.snapshot.state, 'Connection unavailable');
      }
    };
    poll();
    this.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }

  private connect = () => {
    if (this.listeners.size === 0) return;
    this.closeSSE();

    const es = new EventSource(SSE_URL, { withCredentials: true });
    this.es = es;

    es.addEventListener('status', this.handleStatusEvent as EventListener);

    es.addEventListener('open', () => {
      this.retryCount = 0;
      this.stopPolling();
    });

    es.onerror = () => {
      this.setStatus(this.snapshot.state, 'Connection unavailable');
      this.closeSSE();
      if (this.listeners.size === 0) return;

      this.retryCount += 1;
      if (this.retryCount <= MAX_RETRIES) {
        const delay = backoffMs(this.retryCount - 1);
        this.retryTimer = setTimeout(this.connect, delay);
      } else {
        // SSE exhausted — fall back to polling
        this.startPolling();
      }
    };
  };

  private handleVisibility = () => {
    if (document.hidden) {
      this.closeSSE();
      this.stopPolling();
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    } else if (this.listeners.size > 0) {
      this.retryCount = 0;
      this.connect();
    }
  };
}

// Singleton — one connection shared across all consumers, survives route changes.
export const agentStatusStore = new AgentStatusStore();
