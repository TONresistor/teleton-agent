import { ProviderMeta } from '../hooks/useConfigState';
import { Select } from './Select';

interface AgentSettingsPanelProps {
  getLocal: (key: string) => string;
  setLocal: (key: string, value: string) => void;
  saveConfig: (key: string, value: string) => Promise<void>;
  modelOptions: Array<{ value: string; name: string }>;
  pendingProvider: string | null;
  pendingMeta: ProviderMeta | null;
  pendingApiKey: string;
  setPendingApiKey: (v: string) => void;
  pendingValidating: boolean;
  pendingError: string | null;
  setPendingError: (v: string | null) => void;
  handleProviderChange: (provider: string) => Promise<void>;
  handleProviderConfirm: () => Promise<void>;
  handleProviderCancel: () => void;
  /** Hide temperature/tokens/iterations (Dashboard mode) */
  compact?: boolean;
}

export function AgentSettingsPanel({
  getLocal, setLocal, saveConfig, modelOptions,
  pendingProvider, pendingMeta, pendingApiKey, setPendingApiKey,
  pendingValidating, pendingError, setPendingError,
  handleProviderChange, handleProviderConfirm, handleProviderCancel,
  compact = false,
}: AgentSettingsPanelProps) {
  return (
    <>
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
        {!compact && (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '13px', color: 'var(--text)' }}>Temperature (0-2)</label>
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={getLocal('agent.temperature')}
                onChange={(e) => setLocal('agent.temperature', e.target.value)}
                onBlur={(e) => saveConfig('agent.temperature', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveConfig('agent.temperature', e.currentTarget.value)}
                style={{ width: '120px', textAlign: 'right' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '13px', color: 'var(--text)' }}>Max Tokens</label>
              <input
                type="number"
                min="1"
                value={getLocal('agent.max_tokens')}
                onChange={(e) => setLocal('agent.max_tokens', e.target.value)}
                onBlur={(e) => saveConfig('agent.max_tokens', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveConfig('agent.max_tokens', e.currentTarget.value)}
                style={{ width: '120px', textAlign: 'right' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '13px', color: 'var(--text)' }}>Max Iterations (1-20)</label>
              <input
                type="number"
                min="1"
                max="20"
                value={getLocal('agent.max_agentic_iterations')}
                onChange={(e) => setLocal('agent.max_agentic_iterations', e.target.value)}
                onBlur={(e) => saveConfig('agent.max_agentic_iterations', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveConfig('agent.max_agentic_iterations', e.currentTarget.value)}
                style={{ width: '120px', textAlign: 'right' }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
