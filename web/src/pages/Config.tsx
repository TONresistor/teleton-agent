import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ConfigKeyData } from '../lib/api';
import { useConfigState } from '../hooks/useConfigState';
import { PillBar } from '../components/PillBar';
import { AgentSettingsPanel } from '../components/AgentSettingsPanel';
import { TelegramSettingsPanel } from '../components/TelegramSettingsPanel';
import { Select } from '../components/Select';

const TABS = [
  { id: 'llm', label: 'LLM' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'session', label: 'Session' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'advanced', label: 'Advanced' },
];

const API_KEY_KEYS = ['agent.api_key', 'telegram.bot_token', 'tavily_api_key', 'tonapi_key'];
const ADVANCED_KEYS = ['embedding.provider', 'webui.port', 'webui.log_requests', 'deals.enabled', 'dev.hot_reload'];

export function Config() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'llm';

  const config = useConfigState();

  // Raw config keys state for API Keys / Advanced tabs
  const [configKeys, setConfigKeys] = useState<ConfigKeyData[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleTabChange = (id: string) => {
    setSearchParams({ tab: id }, { replace: true });
  };

  // Load raw config keys when switching to API Keys or Advanced tab
  useEffect(() => {
    if (activeTab === 'api-keys' || activeTab === 'advanced') {
      setKeysLoading(true);
      api.getConfigKeys()
        .then((res) => { setConfigKeys(res.data); setKeysLoading(false); })
        .catch(() => setKeysLoading(false));
    }
  }, [activeTab]);

  const loadKeys = () => {
    api.getConfigKeys()
      .then((res) => setConfigKeys(res.data))
      .catch(() => {});
  };

  const startEdit = (item: ConfigKeyData) => {
    setEditingKey(item.key);
    if (item.type === 'boolean') {
      setEditValue(item.set && item.value !== null ? item.value : 'true');
    } else if (item.type === 'enum' && item.options?.length) {
      setEditValue(item.set && item.value !== null ? item.value : item.options[0]);
    } else {
      setEditValue('');
    }
  };

  const handleSave = async (key: string) => {
    const item = configKeys.find((k) => k.key === key);
    const isSelectType = item?.type === 'boolean' || item?.type === 'enum';
    if (!isSelectType && !editValue.trim()) return;
    setSaving(true);
    config.setError(null);
    try {
      await api.setConfigKey(key, editValue.trim());
      setEditingKey(null);
      setEditValue('');
      config.showSuccess(`${key} updated successfully`);
      loadKeys();
    } catch (err) {
      config.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUnset = async (key: string) => {
    setSaving(true);
    config.setError(null);
    try {
      await api.unsetConfigKey(key);
      config.showSuccess(`${key} removed`);
      loadKeys();
    } catch (err) {
      config.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingKey(null);
    setEditValue('');
  };

  if (config.loading) return <div className="loading">Loading...</div>;

  const renderKeyValueList = (filterKeys: string[]) => {
    if (keysLoading) return <div className="loading">Loading...</div>;
    const items = configKeys.filter((k) => filterKeys.includes(k.key));
    if (items.length === 0) return <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No keys found</div>;

    return items.map((item, idx) => (
      <div
        key={item.key}
        style={{
          padding: '12px 0',
          borderBottom: idx < items.length - 1 ? '1px solid var(--separator)' : 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong style={{ fontFamily: 'monospace' }}>{item.key}</strong>
            <span
              style={{
                marginLeft: '10px',
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: item.set ? 'var(--accent)' : 'var(--surface)',
                color: item.set ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              }}
            >
              {item.set ? 'Set' : 'Not set'}
            </span>
            {item.sensitive && (
              <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                sensitive
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => startEdit(item)}
              style={{ padding: '4px 12px', fontSize: '12px' }}
              disabled={saving}
            >
              Edit
            </button>
            {item.set && (
              <button
                onClick={() => handleUnset(item.key)}
                style={{ padding: '4px 12px', fontSize: '12px', opacity: 0.7 }}
                disabled={saving}
              >
                Remove
              </button>
            )}
          </div>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {item.description}
        </div>

        {item.set && item.value && editingKey !== item.key && (
          <div style={{ marginTop: '6px', fontSize: '13px', color: 'var(--text)', fontFamily: 'monospace' }}>
            {item.value}
          </div>
        )}

        {editingKey === item.key && (
          <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
            {item.type === 'boolean' ? (
              <Select
                value={editValue}
                options={['true', 'false']}
                onChange={setEditValue}
                style={{ width: '100%', marginBottom: '8px' }}
              />
            ) : item.type === 'enum' && item.options ? (
              <Select
                value={editValue}
                options={item.options}
                onChange={setEditValue}
                style={{ width: '100%', marginBottom: '8px' }}
              />
            ) : (
              <input
                type={item.type === 'number' ? 'number' : item.sensitive ? 'password' : 'text'}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave(item.key)}
                placeholder={`Enter value for ${item.key}...`}
                autoFocus
                style={{ width: '100%', marginBottom: '8px' }}
              />
            )}
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => handleSave(item.key)}
                disabled={saving || (item.type !== 'boolean' && item.type !== 'enum' && !editValue.trim())}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={handleCancel} style={{ opacity: 0.7 }} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    ));
  };

  return (
    <div>
      <div className="header">
        <h1>Configuration</h1>
        <p>Manage settings and API keys</p>
      </div>

      {config.error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {config.error}
          <button onClick={() => config.setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
            Dismiss
          </button>
        </div>
      )}

      {config.saveSuccess && (
        <div className="alert success" style={{ marginBottom: '16px' }}>
          {config.saveSuccess}
        </div>
      )}

      <PillBar tabs={TABS} activeTab={activeTab} onTabChange={handleTabChange} />

      {/* LLM Tab */}
      {activeTab === 'llm' && (
        <>
          <div className="card">
            <AgentSettingsPanel
              getLocal={config.getLocal}
              setLocal={config.setLocal}
              saveConfig={config.saveConfig}
              modelOptions={config.modelOptions}
              pendingProvider={config.pendingProvider}
              pendingMeta={config.pendingMeta}
              pendingApiKey={config.pendingApiKey}
              setPendingApiKey={config.setPendingApiKey}
              pendingValidating={config.pendingValidating}
              pendingError={config.pendingError}
              setPendingError={config.setPendingError}
              handleProviderChange={config.handleProviderChange}
              handleProviderConfirm={config.handleProviderConfirm}
              handleProviderCancel={config.handleProviderCancel}
            />
          </div>

          {config.toolRag && (
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
                    checked={config.toolRag.enabled}
                    onChange={() => config.saveToolRag({ enabled: !config.toolRag!.enabled })}
                  />
                  <span className="toggle-track" />
                  <span className="toggle-thumb" />
                </label>
              </div>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text)' }}>Indexed</label>
                  <span style={{ fontSize: '13px', color: 'var(--text)' }}>{config.toolRag.indexed ? 'Yes' : 'No'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text)' }}>Top-K</label>
                  <Select
                    value={String(config.toolRag.topK)}
                    options={['10', '15', '20', '25', '30', '40', '50']}
                    onChange={(v) => config.saveToolRag({ topK: Number(v) })}
                    style={{ minWidth: '80px' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text)' }}>Total Tools</label>
                  <span style={{ fontSize: '13px', color: 'var(--text)' }}>{config.toolRag.totalTools}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Telegram Tab */}
      {activeTab === 'telegram' && (
        <div className="card">
          <TelegramSettingsPanel
            getLocal={config.getLocal}
            setLocal={config.setLocal}
            saveConfig={config.saveConfig}
            extended={true}
          />
        </div>
      )}

      {/* Session Tab */}
      {activeTab === 'session' && (
        <div className="card">
          <div className="section-title">Session</div>
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }} htmlFor="daily-reset">
                Daily Reset
              </label>
              <label className="toggle">
                <input
                  id="daily-reset"
                  type="checkbox"
                  checked={config.getLocal('agent.session_reset_policy.daily_reset_enabled') === 'true'}
                  onChange={(e) =>
                    config.saveConfig('agent.session_reset_policy.daily_reset_enabled', String(e.target.checked))
                  }
                />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Reset Hour (0-23)</label>
              <Select
                value={config.getLocal('agent.session_reset_policy.daily_reset_hour')}
                options={Array.from({ length: 24 }, (_, i) => String(i))}
                onChange={(v) => config.saveConfig('agent.session_reset_policy.daily_reset_hour', v)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }} htmlFor="idle-expiry">
                Idle Expiry
              </label>
              <label className="toggle">
                <input
                  id="idle-expiry"
                  type="checkbox"
                  checked={config.getLocal('agent.session_reset_policy.idle_expiry_enabled') === 'true'}
                  onChange={(e) =>
                    config.saveConfig('agent.session_reset_policy.idle_expiry_enabled', String(e.target.checked))
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
                value={config.getLocal('agent.session_reset_policy.idle_expiry_minutes')}
                onChange={(e) => config.setLocal('agent.session_reset_policy.idle_expiry_minutes', e.target.value)}
                onBlur={(e) => config.saveConfig('agent.session_reset_policy.idle_expiry_minutes', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && config.saveConfig('agent.session_reset_policy.idle_expiry_minutes', e.currentTarget.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* API Keys Tab */}
      {activeTab === 'api-keys' && (
        <div className="card">
          <div className="section-title">API Keys</div>
          {renderKeyValueList(API_KEY_KEYS)}
        </div>
      )}

      {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <div className="card">
          <div className="section-title">Advanced</div>
          {renderKeyValueList(ADVANCED_KEYS)}
        </div>
      )}
    </div>
  );
}
