import { useEffect, useRef, useState } from 'react';

export type AgentState = 'stopped' | 'starting' | 'running' | 'stopping';

interface AgentStatusEvent {
  state: AgentState;
  error: string | null;
  timestamp: number;
}

const SSE_URL = '/api/agent/events';
const POLL_URL = '/api/agent/status';
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = base * 0.3 * Math.random();
  return base + jitter;
}

export function useAgentStatus(): { state: AgentState; error: string | null } {
  const [state, setState] = useState<AgentState>('stopped');
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sseFailedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    function handleStatusEvent(ev: MessageEvent) {
      if (!mountedRef.current) return;
      try {
        const data: AgentStatusEvent = JSON.parse(ev.data);
        setState(data.state);
        setError(data.error ?? null);
        retryCountRef.current = 0; // reset on successful message
      } catch {
        // ignore parse errors
      }
    }

    function closeSSE() {
      if (esRef.current) {
        esRef.current.removeEventListener('status', handleStatusEvent as EventListener);
        esRef.current.close();
        esRef.current = null;
      }
    }

    function stopPolling() {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    function startPolling() {
      if (pollTimerRef.current) return;
      const poll = async () => {
        if (!mountedRef.current) return;
        try {
          const res = await fetch(POLL_URL, { credentials: 'include' });
          if (!res.ok) return;
          const json = await res.json();
          const data = json.data ?? json;
          if (mountedRef.current) {
            setState(data.state);
            setError(data.error ?? null);
          }
        } catch {
          // ignore fetch errors during polling
        }
      };
      poll(); // immediate first poll
      pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    }

    function connect() {
      if (!mountedRef.current) return;
      closeSSE();

      const es = new EventSource(SSE_URL, { withCredentials: true });
      esRef.current = es;

      es.addEventListener('status', handleStatusEvent as EventListener);

      es.addEventListener('open', () => {
        retryCountRef.current = 0;
        sseFailedRef.current = false;
        stopPolling();
      });

      es.onerror = () => {
        closeSSE();
        if (!mountedRef.current) return;

        retryCountRef.current += 1;
        if (retryCountRef.current <= MAX_RETRIES) {
          const delay = backoffMs(retryCountRef.current - 1);
          retryTimerRef.current = setTimeout(connect, delay);
        } else {
          // SSE exhausted — fall back to polling
          sseFailedRef.current = true;
          startPolling();
        }
      };
    }

    function handleVisibility() {
      if (document.hidden) {
        closeSSE();
        stopPolling();
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      } else {
        retryCountRef.current = 0;
        sseFailedRef.current = false;
        connect();
      }
    }

    connect();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      closeSSE();
      stopPolling();
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return { state, error };
}
