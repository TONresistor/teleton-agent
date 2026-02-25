import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAgentStatus, AgentState } from '../hooks/useAgentStatus';

const API_BASE = '/api';
const MAX_START_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

function jitter(ms: number): number {
  return ms + ms * 0.3 * Math.random();
}

const STATE_CONFIG: Record<AgentState | 'error', { dot: string; label: string; pulse: boolean }> = {
  stopped:  { dot: 'var(--text-tertiary)', label: 'Stopped',     pulse: false },
  starting: { dot: '#FFD60A',              label: 'Starting...',  pulse: true },
  running:  { dot: 'var(--green)',         label: 'Running',      pulse: true },
  stopping: { dot: '#FF9F0A',             label: 'Stopping...',  pulse: true },
  error:    { dot: 'var(--red)',           label: 'Error',        pulse: false },
};

export function AgentControl() {
  const { state, error } = useAgentStatus();
  const [inflight, setInflight] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const displayState = error && state === 'stopped' ? 'error' : state;
  const config = STATE_CONFIG[displayState];

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setRetrying(false);
  }, []);

  const doStart = useCallback(async (attempt = 0): Promise<void> => {
    setInflight(true);
    setActionError(null);
    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API_BASE}/agent/start`, {
        method: 'POST',
        credentials: 'include',
        signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json();

      if (!res.ok && json.error) {
        throw new Error(json.error);
      }
    } catch (err) {
      if (!retryTimerRef.current && attempt < MAX_START_RETRIES) {
        setRetrying(true);
        const delay = jitter(RETRY_DELAYS[attempt] ?? 4000);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          doStart(attempt + 1);
        }, delay);
        setActionError(err instanceof Error ? err.message : String(err));
        setInflight(false);
        return;
      }
      setActionError(err instanceof Error ? err.message : String(err));
      setRetrying(false);
    } finally {
      setInflight(false);
      abortRef.current = null;
    }
  }, []);

  const doStop = useCallback(async () => {
    setShowConfirm(false);
    setInflight(true);
    setActionError(null);
    clearRetry();

    try {
      const res = await fetch(`${API_BASE}/agent/stop`, {
        method: 'POST',
        credentials: 'include',
        signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json();

      if (!res.ok && json.error) {
        throw new Error(json.error);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setInflight(false);
    }
  }, [clearRetry]);

  const handleStart = () => {
    clearRetry();
    doStart(0);
  };

  const handleStopClick = () => {
    setShowConfirm(true);
  };

  const showPlay = displayState === 'stopped' || displayState === 'error';
  const showStop = displayState === 'running';

  return (
    <div style={{ padding: '0 12px', marginBottom: '8px' }}>
      {/* Status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: config.dot,
            animation: config.pulse ? 'agent-pulse 2s ease-in-out infinite' : 'none',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
          {config.label}
        </span>
      </div>

      {/* Action button */}
      {showPlay && !retrying && (
        <button
          onClick={handleStart}
          disabled={inflight}
          style={{
            width: '100%',
            background: 'var(--green-dim)',
            color: 'var(--green)',
            border: '1px solid rgba(48, 209, 88, 0.2)',
            fontSize: '12px',
            padding: '6px 12px',
          }}
        >
          {inflight ? 'Starting...' : 'Start Agent'}
        </button>
      )}

      {showStop && (
        <button
          onClick={handleStopClick}
          disabled={inflight}
          className="btn-danger"
          style={{
            width: '100%',
            fontSize: '12px',
            padding: '6px 12px',
          }}
        >
          {inflight ? 'Stopping...' : 'Stop Agent'}
        </button>
      )}

      {/* Retry indicator */}
      {retrying && (
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Retrying...
        </div>
      )}

      {/* Error message */}
      {actionError && !retrying && (
        <div style={{
          fontSize: '11px',
          color: 'var(--red)',
          marginTop: '4px',
          lineHeight: '1.4',
          wordBreak: 'break-word',
        }}>
          {actionError}
        </div>
      )}

      {/* Stop confirmation dialog — portal to body so it's above the sidebar */}
      {showConfirm && createPortal(
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>Stop Agent?</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.5' }}>
              Active Telegram sessions will be interrupted.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="btn-ghost"
                onClick={() => setShowConfirm(false)}
                style={{ fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={doStop}
                style={{ fontSize: '13px' }}
              >
                Stop
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes agent-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
