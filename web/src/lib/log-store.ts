import { api, LogEntry } from './api';

export type { LogEntry };

type Listener = () => void;

const MAX_LOGS = 2000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

class LogStore {
  private logs: LogEntry[] = [];
  private snapshot: LogEntry[] = [];
  private listeners = new Set<Listener>();
  private disconnect: (() => void) | null = null;
  private _connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private shouldReconnect = false;

  connect() {
    if (this.disconnect) return;
    this.shouldReconnect = true;
    this.reconnectDelay = RECONNECT_BASE_MS;
    this.doConnect();
  }

  private doConnect() {
    if (this.disconnect) return;

    this.disconnect = api.connectLogs(
      (entry) => {
        this.logs.push(entry);
        if (this.logs.length > MAX_LOGS) {
          this.logs = this.logs.slice(-MAX_LOGS);
        }
        this._connected = true;
        this.reconnectDelay = RECONNECT_BASE_MS; // reset backoff on success
        this.snapshot = [...this.logs]; // new reference for React
        this.notify();
      },
      () => {
        this._connected = false;
        if (this.disconnect) {
          this.disconnect();
          this.disconnect = null;
        }
        this.notify();
        this.scheduleReconnect();
      }
    );
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect && !this.disconnect) {
        this.doConnect();
      }
    }, this.reconnectDelay);

    // Exponential backoff: 1s → 2s → 4s → ... → 30s max
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  stop() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.disconnect) {
      this.disconnect();
      this.disconnect = null;
    }
    this._connected = false;
    this.notify();
  }

  getLogs(): LogEntry[] {
    return this.snapshot;
  }

  isConnected(): boolean {
    return this._connected;
  }

  clear() {
    this.logs = [];
    this.snapshot = [];
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}

// Singleton — survives across route changes
export const logStore = new LogStore();
