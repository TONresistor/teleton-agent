import type { ProviderMeta } from '../hooks/useConfigState';

export const PROVIDER_OPTIONS = ['anthropic', 'openai', 'codex', 'grok-build', 'google', 'xai', 'groq', 'openrouter', 'moonshot', 'mistral', 'cerebras', 'zai', 'minimax', 'huggingface', 'gocoon', 'local'];
export const PROVIDER_LABELS = ['Anthropic', 'OpenAI', 'Codex (Auto)', 'Grok Build (Auto)', 'Google', 'xAI', 'Groq', 'OpenRouter', 'Moonshot', 'Mistral', 'Cerebras', 'ZAI (Zhipu)', 'MiniMax', 'HuggingFace', 'Gocoon', 'Local'];

interface ProviderSwitchZoneProps {
  pendingMeta: ProviderMeta;
  pendingApiKey: string;
  setPendingApiKey: (v: string) => void;
  pendingValidating: boolean;
  pendingError: string | null;
  setPendingError: (v: string | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Gated API-key entry shown while switching to a provider that needs a key. */
export function ProviderSwitchZone({
  pendingMeta, pendingApiKey, setPendingApiKey, pendingValidating, pendingError, setPendingError, onConfirm, onCancel,
}: ProviderSwitchZoneProps) {
  return (
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
            onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
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
        <div style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '8px' }}>{pendingError}</div>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn-ghost btn-sm" onClick={onCancel} disabled={pendingValidating}>Cancel</button>
        <button className="btn-sm" onClick={onConfirm} disabled={pendingValidating}>
          {pendingValidating ? <><span className="spinner sm" /> Validating...</> : 'Validate & Save'}
        </button>
      </div>
    </div>
  );
}
