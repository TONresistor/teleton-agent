import { useEffect, useState, useCallback } from 'react';
import { api, StatusData, MemoryStats, ToolRagStatus } from '../lib/api';
import { Select } from '../components/Select';

interface ProviderMeta {
  needsKey: boolean;
  keyHint: string;
  keyPrefix: string | null;
  consoleUrl: string;
  displayName: string;
}

export function Dashboard() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [toolRag, setToolRag] = useState<ToolRagStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; name: string }>>([]);

  // Provider switch gating state
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [pendingMeta, setPendingMeta] = useState<ProviderMeta | null>(null);
  const [pendingApiKey, setPendingApiKey] = useState('');
  const [pendingValidating, setPendingValidating] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // Local input state — decoupled from server values to avoid sending empty/partial values
  const [localInputs, setLocalInputs] = useState<Record<string, string>>({});

  const loadData = useCallback(() => {
    Promise.all([api.getStatus(), api.getMemoryStats(), api.getConfigKeys(), api.getToolRag()])
      .then(([statusRes, statsRes, configRes, ragRes]) => {
        setStatus(statusRes.data);
        setStats(statsRes.data);
        setToolRag(ragRes.data);
        // Sync local inputs from server values
        const inputs: Record<string, string> = {};
        for (const c of configRes.data) {
          if (c.value != null) inputs[c.key] = c.value;
        }
        setLocalInputs(inputs);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getLocal = (key: string): string => localInputs[key] ?? '';

  // Load model options when provider changes
  const currentProvider = getLocal('agent.provider');
  useEffect(() => {
    if (!currentProvider) return;
    api.getModelsForProvider(currentProvider).then((res) => {
      const models = res.data.map((m) => ({ value: m.value, name: m.name }));
      setModelOptions(models);
      // Auto-select first model if current model isn't in the new list
      const currentModel = localInputs['agent.model'] ?? '';
      if (models.length > 0 && !models.some((m) => m.value === currentModel)) {
        saveConfig('agent.model', models[0].value);
      }
    }).catch(() => setModelOptions([]));
  }, [currentProvider]);

  // Handle provider change — gate on API key
  const handleProviderChange = async (newProvider: string) => {
    if (newProvider === currentProvider) return;
    try {
      const res = await api.getProviderMeta(newProvider);
      const meta = res.data;
      if (!meta.needsKey) {
        // No key needed — save directly
        await saveConfig('agent.provider', newProvider);
        setPendingProvider(null);
        setPendingMeta(null);
      } else {
        // Show the gated transition zone
        setPendingProvider(newProvider);
        setPendingMeta(meta);
        setPendingApiKey('');
        setPendingError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleProviderConfirm = async () => {
    if (!pendingProvider || !pendingMeta) return;
    if (pendingMeta.needsKey && !pendingApiKey.trim()) {
      setPendingError('API key is required');
      return;
    }
    setPendingValidating(true);
    setPendingError(null);
    try {
      // Validate API key format
      const valRes = await api.validateApiKey(pendingProvider, pendingApiKey);
      if (!valRes.data.valid) {
        setPendingError(valRes.data.error || 'Invalid API key');
        setPendingValidating(false);
        return;
      }
      // Save provider + API key
      await api.setConfigKey('agent.api_key', pendingApiKey.trim());
      await saveConfig('agent.provider', pendingProvider);
      setPendingProvider(null);
      setPendingMeta(null);
      setPendingApiKey('');
      showSuccess(`Switched to ${pendingMeta.displayName}`);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingValidating(false);
    }
  };

  const handleProviderCancel = () => {
    setPendingProvider(null);
    setPendingMeta(null);
    setPendingApiKey('');
    setPendingError(null);
  };

  const setLocal = (key: string, value: string) => {
    setLocalInputs((prev) => ({ ...prev, [key]: value }));
  };

  const saveConfig = async (key: string, value: string) => {
    if (!value.trim()) return; // never send empty values
    try {
      setError(null);
      await api.setConfigKey(key, value.trim());
      await loadData();
      showSuccess(`Saved ${key.split('.').pop()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveToolRag = async (update: { enabled?: boolean; topK?: number }) => {
    try {
      const res = await api.updateToolRag(update);
      setToolRag(res.data);
      showSuccess('Tool RAG updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showSuccess = (msg: string) => {
    setSaveSuccess(msg);
    setTimeout(() => setSaveSuccess(null), 2000);
  };

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

      {/* Agent Settings */}
      <div className="card">
        <div className="section-title">Agent</div>
        <div style={{ display: 'grid', gap: '16px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Provider</label>
            <Select
              value={pendingProvider ?? getLocal('agent.provider')}
              options={['claude-code', 'anthropic', 'openai', 'google', 'xai', 'groq', 'openrouter', 'moonshot', 'mistral', 'cocoon', 'local']}
              labels={['Claude Code', 'Anthropic', 'OpenAI', 'Google', 'xAI', 'Groq', 'OpenRouter', 'Moonshot', 'Mistral', 'Cocoon', 'Local']}
              onChange={handleProviderChange}
            />
          </div>

          {/* Gated provider switch zone */}
          {pendingProvider && pendingMeta && (
            <div className="provider-switch-zone">
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '12px' }}>
                Switching to {pendingMeta.displayName}
              </div>
              {pendingMeta.needsKey && (
                <div className="form-group" style={{ marginBottom: '8px' }}>
                  <label>API Key</label>
                  <input
                    type="password"
                    placeholder={pendingMeta.keyHint}
                    value={pendingApiKey}
                    onChange={(e) => { setPendingApiKey(e.target.value); setPendingError(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleProviderConfirm()}
                    style={{ width: '100%' }}
                    autoFocus
                  />
                  {pendingMeta.consoleUrl && (
                    <a
                      href={pendingMeta.consoleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'inline-block' }}
                    >
                      Get key at {new URL(pendingMeta.consoleUrl).hostname} ↗
                    </a>
                  )}
                </div>
              )}
              {pendingError && (
                <div style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '8px' }}>
                  {pendingError}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn-ghost btn-sm" onClick={handleProviderCancel} disabled={pendingValidating}>
                  Cancel
                </button>
                <button className="btn-sm" onClick={handleProviderConfirm} disabled={pendingValidating}>
                  {pendingValidating ? <><span className="spinner sm" /> Validating...</> : 'Validate & Save'}
                </button>
              </div>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Model</label>
            <Select
              value={getLocal('agent.model')}
              options={modelOptions.map((m) => m.value)}
              labels={modelOptions.map((m) => m.name)}
              onChange={(v) => saveConfig('agent.model', v)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Temperature (0-2)</label>
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={getLocal('agent.temperature')}
                onChange={(e) => setLocal('agent.temperature', e.target.value)}
                onBlur={(e) => saveConfig('agent.temperature', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveConfig('agent.temperature', e.currentTarget.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Max Tokens</label>
              <input
                type="number"
                min="1"
                value={getLocal('agent.max_tokens')}
                onChange={(e) => setLocal('agent.max_tokens', e.target.value)}
                onBlur={(e) => saveConfig('agent.max_tokens', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveConfig('agent.max_tokens', e.currentTarget.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Max Iterations (1-20)</label>
              <input
                type="number"
                min="1"
                max="20"
                value={getLocal('agent.max_agentic_iterations')}
                onChange={(e) => setLocal('agent.max_agentic_iterations', e.target.value)}
                onBlur={(e) => saveConfig('agent.max_agentic_iterations', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveConfig('agent.max_agentic_iterations', e.currentTarget.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tool RAG Settings */}
      {toolRag && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <div className="section-title" style={{ marginBottom: '4px' }}>Tool RAG</div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                Semantic tool selection — sends only the most relevant tools to the LLM per message.
              </p>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={toolRag.enabled}
                onChange={() => saveToolRag({ enabled: !toolRag.enabled })}
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span>Indexed: {toolRag.indexed ? 'Yes' : 'No'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              Top-K:
              <Select
                value={String(toolRag.topK)}
                options={['10', '15', '20', '25', '30', '40', '50']}
                onChange={(v) => saveToolRag({ topK: Number(v) })}
                style={{ display: 'inline-block', minWidth: '70px' }}
              />
            </span>
            <span>Total: {toolRag.totalTools}</span>
          </div>
        </div>
      )}

      {/* Telegram Settings */}
      <div className="card">
        <div className="section-title">Telegram</div>
        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>DM Policy</label>
              <Select
                value={getLocal('telegram.dm_policy')}
                options={['open', 'pairing', 'admin']}
                onChange={(v) => saveConfig('telegram.dm_policy', v)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Group Policy</label>
              <Select
                value={getLocal('telegram.group_policy')}
                options={['open', 'admin', 'disabled']}
                onChange={(v) => saveConfig('telegram.group_policy', v)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }} htmlFor="require-mention">
              Require Mention
            </label>
            <label className="toggle">
              <input
                id="require-mention"
                type="checkbox"
                checked={getLocal('telegram.require_mention') === 'true'}
                onChange={(e) => saveConfig('telegram.require_mention', String(e.target.checked))}
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }} htmlFor="typing-sim">
              Typing Simulation
            </label>
            <label className="toggle">
              <input
                id="typing-sim"
                type="checkbox"
                checked={getLocal('telegram.typing_simulation') === 'true'}
                onChange={(e) => saveConfig('telegram.typing_simulation', String(e.target.checked))}
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Debounce (ms)</label>
            <input
              type="number"
              min="0"
              value={getLocal('telegram.debounce_ms')}
              onChange={(e) => setLocal('telegram.debounce_ms', e.target.value)}
              onBlur={(e) => saveConfig('telegram.debounce_ms', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveConfig('telegram.debounce_ms', e.currentTarget.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>

      {/* Session Settings */}
      <div className="card">
        <div className="section-title">Session</div>
        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }} htmlFor="daily-reset">
              Daily Reset
            </label>
            <label className="toggle">
              <input
                id="daily-reset"
                type="checkbox"
                checked={getLocal('agent.session_reset_policy.daily_reset_enabled') === 'true'}
                onChange={(e) =>
                  saveConfig('agent.session_reset_policy.daily_reset_enabled', String(e.target.checked))
                }
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Reset Hour (0-23)</label>
            <Select
              value={getLocal('agent.session_reset_policy.daily_reset_hour')}
              options={Array.from({ length: 24 }, (_, i) => String(i))}
              onChange={(v) => saveConfig('agent.session_reset_policy.daily_reset_hour', v)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }} htmlFor="idle-expiry">
              Idle Expiry
            </label>
            <label className="toggle">
              <input
                id="idle-expiry"
                type="checkbox"
                checked={getLocal('agent.session_reset_policy.idle_expiry_enabled') === 'true'}
                onChange={(e) =>
                  saveConfig('agent.session_reset_policy.idle_expiry_enabled', String(e.target.checked))
                }
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Idle Minutes</label>
            <input
              type="number"
              min="1"
              value={getLocal('agent.session_reset_policy.idle_expiry_minutes')}
              onChange={(e) => setLocal('agent.session_reset_policy.idle_expiry_minutes', e.target.value)}
              onBlur={(e) => saveConfig('agent.session_reset_policy.idle_expiry_minutes', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveConfig('agent.session_reset_policy.idle_expiry_minutes', e.currentTarget.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
