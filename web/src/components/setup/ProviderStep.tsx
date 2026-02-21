import { useState, useEffect, useRef } from 'react';
import { setup, SetupProvider } from '../../lib/api';
import type { StepProps } from '../../pages/Setup';

export function ProviderStep({ data, onChange }: StepProps) {
  const [providers, setProviders] = useState<SetupProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [keyError, setKeyError] = useState('');
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setup.getProviders()
      .then((p) => setProviders(p))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const selected = providers.find((p) => p.id === data.provider);

  const handleSelect = (id: string) => {
    onChange({ ...data, provider: id, apiKey: '', model: '', customModel: '' });
    setKeyValid(null);
    setKeyError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  const validateKey = async (provider: string, key: string) => {
    if (!key || !provider) return;
    setValidating(true);
    try {
      const result = await setup.validateApiKey(provider, key);
      setKeyValid(result.valid);
      setKeyError(result.error || '');
    } catch {
      setKeyValid(null);
      setKeyError('');
    } finally {
      setValidating(false);
    }
  };

  const handleKeyChange = (value: string) => {
    onChange({ ...data, apiKey: value });
    setKeyValid(null);
    setKeyError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length > 0 && data.provider) {
      debounceRef.current = setTimeout(() => validateKey(data.provider, value), 500);
    }
  };

  if (loading) return <div className="loading">Loading providers...</div>;
  if (error) return <div className="alert error">{error}</div>;

  return (
    <div className="step-content">
      <h2 className="step-title">Choose Your LLM Provider</h2>
      <p className="step-description">
        This is the AI model that powers your agent's intelligence. Pick the one you have an API key for.
      </p>

      <div className="provider-grid">
        {providers.map((p) => (
          <div
            key={p.id}
            className={`provider-card${data.provider === p.id ? ' selected' : ''}`}
            onClick={() => handleSelect(p.id)}
          >
            <h3>{p.displayName}</h3>
            <div className="provider-meta">{p.defaultModel}</div>
            {p.toolLimit === null && (
              <span className="badge always" style={{ marginTop: '6px' }}>
                Recommended
              </span>
            )}
          </div>
        ))}
      </div>

      {selected && selected.toolLimit !== null && (
        <div className="info-box" style={{ marginTop: '16px' }}>
          Teleton has ~116 tools. With a {selected.toolLimit}-tool limit, some tools may be truncated or unavailable.
        </div>
      )}

      {selected && selected.requiresApiKey && (
        <div className="form-group" style={{ marginTop: '16px' }}>
          <label>API Key</label>
          <input
            type="password"
            value={data.apiKey}
            onChange={(e) => handleKeyChange(e.target.value)}
            placeholder={selected.keyPrefix ? `${selected.keyPrefix}...` : 'Enter API key'}
            className="w-full"
          />
          {validating && (
            <div className="helper-text"><span className="spinner sm" /> Validating...</div>
          )}
          {!validating && keyValid === true && (
            <div className="helper-text success">Key format looks valid.</div>
          )}
          {!validating && keyValid === false && keyError && (
            <div className="helper-text error">{keyError}</div>
          )}
          {selected.consoleUrl && (
            <div className="helper-text">
              Get your key at:{' '}
              <a href={selected.consoleUrl} target="_blank" rel="noopener noreferrer">
                {selected.consoleUrl}
              </a>
            </div>
          )}
        </div>
      )}

      {selected && !selected.requiresApiKey && selected.id === 'cocoon' && (
        <div style={{ marginTop: '16px' }}>
          <div className="info-panel">
            Cocoon Network uses a local proxy. No API key required.
          </div>
          <div className="form-group">
            <label>Cocoon Proxy Port</label>
            <input
              type="number"
              value={data.cocoonPort}
              onChange={(e) => onChange({ ...data, cocoonPort: parseInt(e.target.value) || 0 })}
              min={1}
              max={65535}
              className="w-full"
            />
            <div className="helper-text">
              Port where the Cocoon client proxy is running (1-65535).
            </div>
          </div>
        </div>
      )}

      {selected && selected.id === 'local' && (
        <div style={{ marginTop: '16px' }}>
          <div className="info-panel">
            Connect to any OpenAI-compatible server (Ollama, vLLM, LM Studio, llama.cpp). No API key required.
          </div>
          <div className="form-group">
            <label>Server URL</label>
            <input
              type="url"
              value={data.localUrl}
              onChange={(e) => onChange({ ...data, localUrl: e.target.value })}
              placeholder="http://localhost:11434/v1"
              className="w-full"
            />
            <div className="helper-text">
              Ollama :11434 · vLLM :8000 · LM Studio :1234 · llama.cpp :8080
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
