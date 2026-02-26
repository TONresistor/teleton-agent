import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ConfigKeyData } from '../lib/api';
import { useConfigState } from '../hooks/useConfigState';
import { PillBar } from '../components/PillBar';
import { AgentSettingsPanel } from '../components/AgentSettingsPanel';
import { TelegramSettingsPanel } from '../components/TelegramSettingsPanel';
import { Select } from '../components/Select';
import { ArrayInput } from '../components/ArrayInput';
import { EditableField } from '../components/EditableField';
import { ConfigSection } from '../components/ConfigSection';
import { InfoTip } from '../components/InfoTip';

const TABS = [
  { id: 'llm', label: 'LLM' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'session', label: 'Session' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'advanced', label: 'Advanced' },
];

const API_KEY_KEYS = ['agent.api_key', 'telegram.bot_token', 'tavily_api_key', 'tonapi_key', 'toncenter_api_key'];
const ADVANCED_KEYS = [
  'embedding.provider', 'embedding.model', 'webui.port', 'webui.log_requests',
  'deals.enabled', 'deals.expiry_seconds', 'deals.buy_max_floor_percent', 'deals.sell_min_floor_percent',
  'agent.base_url', 'dev.hot_reload',
];

export function Config() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'llm';

  const config = useConfigState();

  // Raw config keys state for ConfigSection tabs
  const [configKeys, setConfigKeys] = useState<ConfigKeyData[]>([]);

  const handleTabChange = (id: string) => {
    setSearchParams({ tab: id }, { replace: true });
  };

  // Load config keys on mount (needed by ConfigSection in multiple tabs)
  useEffect(() => {
    api.getConfigKeys()
      .then((res) => setConfigKeys(res.data))
      .catch(() => {});
  }, []);

  const loadKeys = () => {
    api.getConfigKeys()
      .then((res) => setConfigKeys(res.data))
      .catch(() => {});
  };

  const handleArraySave = async (key: string, values: string[]) => {
    config.setError(null);
    try {
      await api.setConfigKey(key, values);
      config.showSuccess(`${key} updated successfully`);
      loadKeys();
    } catch (err) {
      config.setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (config.loading) return <div className="loading">Loading...</div>;

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
              getServer={config.getServer}
              setLocal={config.setLocal}
              saveConfig={config.saveConfig}
              cancelLocal={config.cancelLocal}
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

          {config.getLocal('agent.provider') === 'cocoon' && (
            <div className="card">
              <div className="section-title">Cocoon</div>
              <EditableField
                label="Proxy Port"
                description="Cocoon Network proxy port"
                configKey="cocoon.port"
                type="number"
                value={config.getLocal('cocoon.port')}
                serverValue={config.getServer('cocoon.port')}
                onChange={(v) => config.setLocal('cocoon.port', v)}
                onSave={(v) => config.saveConfig('cocoon.port', v)}
                onCancel={() => config.cancelLocal('cocoon.port')}
                min={1}
                max={65535}
                placeholder="11434"
                hotReload="restart"
              />
            </div>
          )}

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
                  <label style={{ fontSize: '13px', color: 'var(--text)' }}>
                    Indexed <InfoTip text="Whether tool embeddings have been indexed for semantic search" />
                  </label>
                  <span style={{ fontSize: '13px', color: 'var(--text)' }}>{config.toolRag.indexed ? 'Yes' : 'No'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text)' }}>
                    Top-K <InfoTip text="Number of most relevant tools to send per message" />
                  </label>
                  <Select
                    value={String(config.toolRag.topK)}
                    options={['10', '15', '20', '25', '30', '40', '50']}
                    onChange={(v) => config.saveToolRag({ topK: Number(v) })}
                    style={{ minWidth: '80px' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text)' }}>
                    Total Tools <InfoTip text="Total number of registered tools available" />
                  </label>
                  <span style={{ fontSize: '13px', color: 'var(--text)' }}>{config.toolRag.totalTools}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }} htmlFor="skip-unlimited">
                    Skip Unlimited Providers <InfoTip text="Skip RAG filtering for providers with no tool limit" />
                  </label>
                  <label className="toggle">
                    <input
                      id="skip-unlimited"
                      type="checkbox"
                      checked={config.toolRag.skipUnlimitedProviders ?? false}
                      onChange={() => config.saveToolRag({ skipUnlimitedProviders: !config.toolRag!.skipUnlimitedProviders })}
                    />
                    <span className="toggle-track" />
                    <span className="toggle-thumb" />
                  </label>
                </div>
                <div>
                  <label style={{ fontSize: '13px', color: 'var(--text)', display: 'block', marginBottom: '6px' }}>
                    Always Include (glob patterns) <InfoTip text="Tool name patterns that are always included regardless of RAG scoring" />
                  </label>
                  <ArrayInput
                    value={config.toolRag.alwaysInclude ?? []}
                    onChange={(values) => config.saveToolRag({ alwaysInclude: values })}
                    placeholder="e.g. telegram_send_*"
                  />
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
            getServer={config.getServer}
            setLocal={config.setLocal}
            saveConfig={config.saveConfig}
            cancelLocal={config.cancelLocal}
            configKeys={configKeys}
            onArraySave={handleArraySave}
            extended={true}
          />
        </div>
      )}

      {/* Session Tab */}
      {activeTab === 'session' && (
        <div className="card">
          <ConfigSection
            keys={[
              'agent.session_reset_policy.daily_reset_enabled',
              'agent.session_reset_policy.daily_reset_hour',
              'agent.session_reset_policy.idle_expiry_enabled',
              'agent.session_reset_policy.idle_expiry_minutes',
            ]}
            configKeys={configKeys}
            getLocal={config.getLocal}
            getServer={config.getServer}
            setLocal={config.setLocal}
            saveConfig={config.saveConfig}
            cancelLocal={config.cancelLocal}
            title="Session"
          />
        </div>
      )}

      {/* API Keys Tab */}
      {activeTab === 'api-keys' && (
        <div className="card">
          <ConfigSection
            keys={API_KEY_KEYS}
            configKeys={configKeys}
            getLocal={config.getLocal}
            getServer={config.getServer}
            setLocal={config.setLocal}
            saveConfig={config.saveConfig}
            cancelLocal={config.cancelLocal}
            title="API Keys"
          />
        </div>
      )}

      {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <div className="card">
          <ConfigSection
            keys={ADVANCED_KEYS}
            configKeys={configKeys}
            getLocal={config.getLocal}
            getServer={config.getServer}
            setLocal={config.setLocal}
            saveConfig={config.saveConfig}
            cancelLocal={config.cancelLocal}
            title="Advanced"
          />
        </div>
      )}
    </div>
  );
}
