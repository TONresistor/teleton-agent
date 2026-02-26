import { useState } from 'react';
import { setup, BotValidation } from '../../lib/api';
import { Select } from '../Select';
import type { StepProps } from '../../pages/Setup';

export function ConfigStep({ data, onChange }: StepProps) {
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
        Configure your agent's behavior policies. Defaults are pre-filled — adjust what you need.
      </p>

      <div className="form-group">
        <label>Admin User ID</label>
        <input
          type="number"
          value={data.userId || ''}
          onChange={(e) => onChange({ ...data, userId: parseInt(e.target.value) || 0 })}
          placeholder="123456789"
          className="w-full"
        />
        <div className="helper-text">
          This account will have admin control over the agent in DMs and groups.
          Get your ID from <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer">@userinfobot</a> on Telegram.
        </div>
      </div>

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
        {/* Bot Token */}
        <div className="module-item">
          <div style={{ marginBottom: '8px' }}>
            <strong style={{ fontSize: 'var(--font-md)' }}>Bot Token</strong>
            <span className="module-desc" style={{ marginLeft: '8px' }}>(recommended)</span>
          </div>
          <p style={{ fontSize: 'var(--font-sm)', margin: '0 0 8px' }}>
            Inline buttons and deals module.
          </p>
          <div className="form-row" style={{ gap: '8px' }}>
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
              <div className="form-group" style={{ marginTop: '8px', marginBottom: 0 }}>
                <label>Bot Username</label>
                <input
                  type="text"
                  value={data.botUsername}
                  onChange={(e) => onChange({ ...data, botUsername: e.target.value })}
                  placeholder="my_bot"
                  className="w-full"
                />
              </div>
            </>
          )}
          {botValid === false && botError && (
            <div className="alert error">{botError}</div>
          )}
          <div className="helper-text">
            Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a> on Telegram.
          </div>
        </div>

        {/* TonAPI Key */}
        <div className="module-item">
          <div style={{ marginBottom: '8px' }}>
            <strong style={{ fontSize: 'var(--font-md)' }}>TonAPI Key</strong>
            <span className="module-desc" style={{ marginLeft: '8px' }}>(recommended)</span>
          </div>
          <p style={{ fontSize: 'var(--font-sm)', margin: '0 0 8px' }}>
            Blockchain data — jettons, NFTs, prices, transaction history. Free key: 5 req/s (vs 1).
          </p>
          <input
            type="text"
            value={data.tonapiKey}
            onChange={(e) => onChange({ ...data, tonapiKey: e.target.value })}
            placeholder="Your TonAPI key"
            className="w-full"
          />
          <div className="helper-text">
            Open <a href="https://t.me/tonapibot" target="_blank" rel="noopener noreferrer">@tonapibot</a> on Telegram → mini app → generate server key.
          </div>
        </div>

        {/* TonCenter API Key */}
        <div className="module-item">
          <div style={{ marginBottom: '8px' }}>
            <strong style={{ fontSize: 'var(--font-md)' }}>TonCenter API Key</strong>
            <span className="module-desc" style={{ marginLeft: '8px' }}>(optional)</span>
          </div>
          <p style={{ fontSize: 'var(--font-sm)', margin: '0 0 8px' }}>
            Blockchain RPC — send transactions, check balances. Dedicated endpoint (vs ORBS fallback).
          </p>
          <input
            type="text"
            value={data.toncenterKey}
            onChange={(e) => onChange({ ...data, toncenterKey: e.target.value })}
            placeholder="Your TonCenter API key"
            className="w-full"
          />
          <div className="helper-text">
            Get a free key at <a href="https://toncenter.com" target="_blank" rel="noopener noreferrer">toncenter.com</a> (instant, no signup).
          </div>
        </div>

        {/* Tavily Key */}
        <div className="module-item">
          <div style={{ marginBottom: '8px' }}>
            <strong style={{ fontSize: 'var(--font-md)' }}>Web Search</strong>
            <span className="module-desc" style={{ marginLeft: '8px' }}>(optional)</span>
          </div>
          <p style={{ fontSize: 'var(--font-sm)', margin: '0 0 8px' }}>
            Web search for real-time info. Free tier: 1,000 req/month.
          </p>
          <input
            type="text"
            value={data.tavilyKey}
            onChange={(e) => onChange({ ...data, tavilyKey: e.target.value })}
            placeholder="tvly-..."
            className="w-full"
          />
          <div className="helper-text">
            Get a free key at <a href="https://tavily.com" target="_blank" rel="noopener noreferrer">tavily.com</a>.
          </div>
        </div>
      </div>
    </div>
  );
}
