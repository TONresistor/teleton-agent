import { useConfigState } from '../hooks/useConfigState';
import { AgentSettingsPanel } from '../components/AgentSettingsPanel';
import { TelegramSettingsPanel } from '../components/TelegramSettingsPanel';

export function Dashboard() {
  const {
    loading, error, setError, saveSuccess, status, stats,
    getLocal, getServer, setLocal, cancelLocal, saveConfig,
    modelOptions, pendingProvider, pendingMeta,
    pendingApiKey, setPendingApiKey,
    pendingValidating, pendingError, setPendingError,
    handleProviderChange, handleProviderConfirm, handleProviderCancel,
  } = useConfigState();

  if (loading) return <div className="loading">Loading...</div>;
  if (!status || !stats) return <div className="alert error">Failed to load dashboard data</div>;

  return (
    <div>
      <div className="header">
        <h1>Dashboard</h1>
        <p>System status and settings</p>
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

      <div className="stats">
        <div className="stat-card">
          <h3>Uptime</h3>
          <div className="value">{Math.floor(status.uptime / 60)}m</div>
        </div>
        <div className="stat-card">
          <h3>Model</h3>
          <div className="value" style={{ fontSize: '14px' }}>
            {status.model}
          </div>
        </div>
        <div className="stat-card">
          <h3>Sessions</h3>
          <div className="value">{status.sessionCount}</div>
        </div>
        <div className="stat-card">
          <h3>Tools</h3>
          <div className="value">{status.toolCount}</div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Memory</div>
        <div className="stats" style={{ marginBottom: 0 }}>
          <div className="stat-card">
            <h3>Knowledge</h3>
            <div className="value">{stats.knowledge}</div>
          </div>
          <div className="stat-card">
            <h3>Messages</h3>
            <div className="value">{stats.messages}</div>
          </div>
          <div className="stat-card">
            <h3>Chats</h3>
            <div className="value">{stats.chats}</div>
          </div>
        </div>
      </div>

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
    </div>
  );
}
