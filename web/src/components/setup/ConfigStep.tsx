import { useState, useEffect } from 'react';
import { setup, SetupModelOption, BotValidation } from '../../lib/api';
import { Select } from '../Select';
import type { StepProps } from '../../pages/Setup';

export function ConfigStep({ data, onChange }: StepProps) {
  const [models, setModels] = useState<SetupModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const [botLoading, setBotLoading] = useState(false);
  const [botValid, setBotValid] = useState<boolean | null>(null);
  const [botNetworkError, setBotNetworkError] = useState(false);
  const [botError, setBotError] = useState('');

  const handleValidateBot = async () => {
    if (!data.botToken) return;
    setBotLoading(true);
    setBotError('');
    setBotValid(null);
    setBotNetworkError(false);
    try {
      const result: BotValidation = await setup.validateBotToken(data.botToken);
      if (result.valid && result.bot) {
        setBotValid(true);
        onChange({ ...data, botUsername: result.bot.username });
      } else if (result.networkError) {
        setBotNetworkError(true);
      } else {
        setBotValid(false);
        setBotError(result.error || 'Invalid bot token');
      }
    } catch (err) {
      setBotError(err instanceof Error ? err.message : String(err));
    } finally {
      setBotLoading(false);
    }
  };

  // Always load models (no quick/advanced gate)
  useEffect(() => {
    if (data.provider === 'cocoon' || data.provider === 'local' || !data.provider) return;
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

  const policyOptions = ['open', 'allowlist', 'disabled'];
  const policyLabels = ['Open', 'Allowlist', 'Disabled'];

  const dmPolicyHelp: Record<string, string> = {
    open: 'Anyone can message the agent in DMs.',
    allowlist: 'Only admin users can DM the agent.',
    disabled: 'Agent ignores all DMs.',
  };

  const groupPolicyHelp: Record<string, string> = {
    open: 'Agent responds in any group it\'s added to.',
    allowlist: 'Agent only responds in groups explicitly allowed by admins.',
    disabled: 'Agent ignores all group messages.',
  };

  return (
    <div className="step-content">
      <h2 className="step-title">Configuration</h2>
      <p className="step-description">
        Configure your agent's model and behavior. Defaults are pre-filled — adjust what you need.
      </p>

      {(data.provider === 'cocoon' || data.provider === 'local') ? (
        <div className="info-panel">
          Model is auto-discovered from the {data.provider === 'local' ? 'local server' : 'Cocoon proxy'} at startup.
        </div>
      ) : (
        <div className="form-group">
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

      <div className="form-group">
        <label>DM Policy</label>
        <Select
          value={data.dmPolicy}
          options={policyOptions}
          labels={policyLabels}
          onChange={(v) => onChange({ ...data, dmPolicy: v })}
          style={{ width: '100%' }}
        />
        <div className="helper-text">{dmPolicyHelp[data.dmPolicy] || ''}</div>
      </div>

      <div className="form-group">
        <label>Group Policy</label>
        <Select
          value={data.groupPolicy}
          options={policyOptions}
          labels={policyLabels}
          onChange={(v) => onChange({ ...data, groupPolicy: v })}
          style={{ width: '100%' }}
        />
        <div className="helper-text">{groupPolicyHelp[data.groupPolicy] || ''}</div>
      </div>

      <div className="form-group">
        <div className="card-toggle">
          <span style={{ fontSize: '13px', fontWeight: 500 }}>Require @mention in groups</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={data.requireMention}
              onChange={(e) => onChange({ ...data, requireMention: e.target.checked })}
            />
            <div className="toggle-track" />
            <div className="toggle-thumb" />
          </label>
        </div>
        <div className="helper-text">
          When enabled, the agent only responds when mentioned by name in group chats.
        </div>
      </div>

      <div className="form-group">
        <label>Max Agentic Iterations</label>
        <input
          type="number"
          value={data.maxIterations}
          onChange={(e) => onChange({ ...data, maxIterations: parseInt(e.target.value) || 1 })}
          min={1}
          max={50}
          className="w-full"
        />
        <div className="helper-text">
          Maximum tool-call loops per message (1-50). Higher values allow more complex tasks.
        </div>
      </div>

      {/* ── Optional Integrations ── */}
      <h3 style={{ fontSize: '14px', fontWeight: 600, marginTop: '24px', marginBottom: '12px' }}>
        Optional API Keys
      </h3>

      <div className="module-list">
        {/* Bot Token — inline field like TonAPI/Tavily */}
        <div className="module-item">
          <div className="form-row" style={{ gap: '12px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 'var(--font-md)' }}>Bot Token</strong>
              <span className="module-desc" style={{ marginLeft: '8px' }}>(recommended)</span>
            </div>
            <input
              type="password"
              value={data.botToken}
              onChange={(e) => {
                onChange({ ...data, botToken: e.target.value, botUsername: '' });
                setBotValid(null);
                setBotNetworkError(false);
                setBotError('');
              }}
              placeholder="123456:ABC-DEF..."
              style={{ flex: 1 }}
            />
            <button onClick={handleValidateBot} disabled={botLoading || !data.botToken} type="button">
              {botLoading ? <><span className="spinner sm" /> Validating</> : 'Validate'}
            </button>
          </div>
          {botValid && data.botUsername && (
            <div className="alert success">Bot verified: @{data.botUsername}</div>
          )}
          {botNetworkError && (
            <>
              <div className="info-box">
                Could not reach Telegram API. Enter the bot username manually.
              </div>
              <div className="form-row" style={{ gap: '12px', alignItems: 'center', marginTop: '8px' }}>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 'var(--font-md)' }}>Bot Username</strong>
                </div>
                <input
                  type="text"
                  value={data.botUsername}
                  onChange={(e) => onChange({ ...data, botUsername: e.target.value })}
                  placeholder="my_bot"
                  style={{ flex: 1 }}
                />
              </div>
            </>
          )}
          {botValid === false && botError && (
            <div className="alert error">{botError}</div>
          )}
          <div className="helper-text">
            Inline buttons and rich interactions. Create via <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a>.
          </div>
        </div>

        {/* TonAPI Key — simple field, no toggle */}
        <div className="module-item">
          <div className="form-row" style={{ gap: '12px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 'var(--font-md)' }}>TonAPI Key</strong>
              <span className="module-desc" style={{ marginLeft: '8px' }}>(optional)</span>
            </div>
            <input
              type="text"
              value={data.tonapiKey}
              onChange={(e) => onChange({ ...data, tonapiKey: e.target.value })}
              placeholder="Your TonAPI key"
              style={{ flex: 1 }}
            />
          </div>
          <div className="helper-text">
            Enhanced blockchain queries. Free key from <a href="https://t.me/tonapibot" target="_blank" rel="noopener noreferrer">@tonapibot</a>.
          </div>
        </div>

        {/* Tavily Key — simple field, no toggle */}
        <div className="module-item">
          <div className="form-row" style={{ gap: '12px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 'var(--font-md)' }}>Web Search</strong>
              <span className="module-desc" style={{ marginLeft: '8px' }}>(optional)</span>
            </div>
            <input
              type="text"
              value={data.tavilyKey}
              onChange={(e) => onChange({ ...data, tavilyKey: e.target.value })}
              placeholder="tvly-..."
              style={{ flex: 1 }}
            />
          </div>
          <div className="helper-text">
            Tavily web search. Free plan at <a href="https://tavily.com" target="_blank" rel="noopener noreferrer">tavily.com</a>.
          </div>
        </div>
      </div>
    </div>
  );
}
