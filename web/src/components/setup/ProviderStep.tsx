import { useState, useEffect, useRef } from 'react';
import { setup, SetupProvider, SetupModelOption, ClaudeCodeKeyDetection } from '../../lib/api';
import { Select } from '../Select';
import type { StepProps } from '../../pages/Setup';

export function ProviderStep({ data, onChange }: StepProps) {
  const [providers, setProviders] = useState<SetupProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [keyError, setKeyError] = useState('');
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ccDetection, setCcDetection] = useState<ClaudeCodeKeyDetection | null>(null);
  const [ccDetecting, setCcDetecting] = useState(false);
  const [ccShowFallback, setCcShowFallback] = useState(false);
  const [models, setModels] = useState<SetupModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setup.getProviders()
      .then((p) => setProviders(p))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const selected = providers.find((p) => p.id === data.provider);

  // Auto-detect Claude Code credentials when provider is selected
  useEffect(() => {
    if (selected?.autoDetectsKey) {
      setCcDetecting(true);
      setCcDetection(null);
      setCcShowFallback(false);
      setup.detectClaudeCodeKey()
        .then((result) => {
          setCcDetection(result);
          if (result.found) {
            // Clear manual key — auto-detected key will be used at runtime
            onChange({ ...data, apiKey: '' });
          }
        })
        .catch(() => setCcDetection({ found: false, maskedKey: null, valid: false }))
        .finally(() => setCcDetecting(false));
    }
  }, [selected?.id]);

  // Load models when provider changes
  useEffect(() => {
    if (!data.provider || data.provider === 'cocoon' || data.provider === 'local') {
      setModels([]);
      return;
    }
    setLoadingModels(true);
    setup.getModels(data.provider)
      .then((m) => {
        setModels(m);
        if (!data.model && m.length > 0) {
          onChange({ ...data, model: m[0].value });
        }
      })
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
  }, [data.provider]);

  const handleSelect = (id: string) => {
    onChange({ ...data, provider: id, apiKey: '', model: '', customModel: '' });
    setKeyValid(null);
    setKeyError('');
    setCcDetection(null);
    setCcShowFallback(false);
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

      {selected && selected.autoDetectsKey && (
        <div style={{ marginTop: '16px' }}>
          {ccDetecting && (
            <div className="info-panel">
              <span className="spinner sm" /> Detecting Claude Code credentials...
            </div>
          )}
          {!ccDetecting && ccDetection?.found && (
            <div className="info-panel">
              <div style={{ marginBottom: '4px', color: 'var(--color-success, #4caf50)' }}>
                <strong>Credentials auto-detected from Claude Code</strong>
              </div>
              <code style={{ fontSize: '0.85em', opacity: 0.8 }}>{ccDetection.maskedKey}</code>
              <div className="helper-text" style={{ marginTop: '6px' }}>
                Token will auto-refresh when it expires. No configuration needed.
              </div>
            </div>
          )}
          {!ccDetecting && ccDetection && !ccDetection.found && !ccShowFallback && (
            <div className="info-panel" style={{ borderColor: 'var(--color-warning, #ff9800)' }}>
              <div style={{ marginBottom: '8px' }}>
                Claude Code credentials not found. Make sure Claude Code is installed and authenticated
                (<code>claude login</code>).
              </div>
              <button
                className="btn btn-sm"
                onClick={() => setCcShowFallback(true)}
              >
                Enter API key manually instead
              </button>
            </div>
          )}
          {!ccDetecting && ccShowFallback && (
            <div className="form-group" style={{ marginTop: '8px' }}>
              <label>API Key (fallback)</label>
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
              <div className="helper-text">
                Get your key at:{' '}
                <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">
                  https://console.anthropic.com/
                </a>
              </div>
            </div>
          )}
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

      {selected && selected.id !== 'cocoon' && selected.id !== 'local' && (
        <div className="form-group" style={{ marginTop: '16px' }}>
          <label>Model</label>
          {loadingModels ? (
            <div className="text-muted"><span className="spinner sm" /> Loading models...</div>
          ) : (
            <Select
              value={data.model}
              options={models.map((m) => m.value)}
              labels={models.map((m) => m.isCustom ? 'Custom...' : `${m.name} - ${m.description}`)}
              onChange={(v) => onChange({ ...data, model: v })}
              style={{ width: '100%' }}
            />
          )}
          {data.model === '__custom__' && (
            <input
              type="text"
              value={data.customModel}
              onChange={(e) => onChange({ ...data, customModel: e.target.value })}
              placeholder="Enter custom model ID"
              className="w-full"
              style={{ marginTop: '8px' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
