import { useEffect, useRef, useSyncExternalStore, useState } from 'react';
import { useConfigState } from '../hooks/useConfigState';
import { AgentSettingsPanel } from '../components/AgentSettingsPanel';
import { TelegramSettingsPanel } from '../components/TelegramSettingsPanel';
import { ExecSettingsPanel } from '../components/ExecSettingsPanel';
import { logStore } from '../lib/log-store';
import { api, StatusData } from '../lib/api';

function Metric({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}

export function Dashboard() {
  const {
    loading, error, setError, saveSuccess, status, stats,
    getLocal, getServer, setLocal, cancelLocal, saveConfig,
    modelOptions, pendingProvider, pendingMeta,
    pendingApiKey, setPendingApiKey,
    pendingValidating, pendingError, setPendingError,
    handleProviderChange, handleProviderConfirm, handleProviderCancel,
  } = useConfigState();

  // Poll /api/status every 10s for live metrics (tokens, uptime)
  const [liveStatus, setLiveStatus] = useState<StatusData | null>(null);
  useEffect(() => {
    let active = true;
    const poll = () => {
      api.getStatus().then((res) => { if (active) setLiveStatus(res.data); }).catch(() => {});
    };
    const id = setInterval(poll, 10_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const currentStatus = liveStatus ?? status;

  const logs = useSyncExternalStore(
    (cb) => logStore.subscribe(cb),
    () => logStore.getLogs()
  );
  const connected = useSyncExternalStore(
    (cb) => logStore.subscribe(cb),
    () => logStore.isConnected()
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logStore.connect();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (loading) return <div className="loading">Loading...</div>;
  if (!status || !stats) return <div className="alert error">Failed to load dashboard data</div>;

  const s = currentStatus ?? status;
  const uptime = s.uptime < 3600
    ? `${Math.floor(s.uptime / 60)}m`
    : `${Math.floor(s.uptime / 3600)}h ${Math.floor((s.uptime % 3600) / 60)}m`;

  return (
    <div className="dashboard-root">
      <div className="header">
        <h1>Dashboard</h1>
        <p>System overview</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>Dismiss</button>
        </div>
      )}

      {saveSuccess && (
        <div className="alert success" style={{ marginBottom: '16px' }}>
          {saveSuccess}
        </div>
      )}

      {/* ── Status bar ─────────────────────────────────────── */}
      <div className="card status-bar">
        <div className="status-row">
          <Metric label="Uptime" value={uptime} />
          <Metric label="Sessions" value={s.sessionCount} />
          <Metric label="Tools" value={s.toolCount} />
          <Metric label="Knowledge" value={stats.knowledge} />
          <Metric label="Messages" value={stats.messages.toLocaleString()} />
          <Metric label="Chats" value={stats.chats} />
          <Metric label="Tokens" value={s.tokenUsage ? `${(s.tokenUsage.totalTokens / 1000).toFixed(1)}K` : '0'} mono />
          <Metric label="Cost" value={s.tokenUsage ? `$${s.tokenUsage.totalCost.toFixed(3)}` : '$0.000'} mono />
        </div>
      </div>

      {/* ── Settings (side by side) ────────────────────────── */}
      <div className="dashboard-settings">
        <div className="card">
          <AgentSettingsPanel
            compact
            getLocal={getLocal} getServer={getServer} setLocal={setLocal} saveConfig={saveConfig} cancelLocal={cancelLocal}
            modelOptions={modelOptions}
            pendingProvider={pendingProvider} pendingMeta={pendingMeta}
            pendingApiKey={pendingApiKey} setPendingApiKey={setPendingApiKey}
            pendingValidating={pendingValidating}
            pendingError={pendingError} setPendingError={setPendingError}
            handleProviderChange={handleProviderChange}
            handleProviderConfirm={handleProviderConfirm}
            handleProviderCancel={handleProviderCancel}
          />
        </div>
        <div className="card">
          <TelegramSettingsPanel getLocal={getLocal} getServer={getServer} setLocal={setLocal} saveConfig={saveConfig} cancelLocal={cancelLocal} />
        </div>
        {s.platform === 'linux' && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <ExecSettingsPanel getLocal={getLocal} saveConfig={saveConfig} />
          </div>
        )}
      </div>

      {/* ── Live Logs ──────────────────────────────────────── */}
      <div className="card dashboard-logs">
        <div className="dashboard-logs-header">
          <div className="section-title" style={{ marginBottom: 0 }}>
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
            Live Logs
          </div>
          <button className="btn-ghost btn-sm" onClick={() => logStore.clear()}>Clear</button>
        </div>
        <div className="dashboard-logs-scroll">
          {logs.length === 0 ? (
            <div className="empty">Waiting for logs...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="log-entry">
                <span className={`badge ${log.level === 'warn' ? 'warn' : log.level === 'error' ? 'error' : 'info'}`}>
                  {log.level.toUpperCase()}
                </span>{' '}
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>{' '}
                {log.message}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
