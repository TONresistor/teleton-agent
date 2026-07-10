import { useState } from 'react';
import { setup, BotValidation } from '../../lib/api';
import { Stepper } from '../Stepper';
import { PasswordInput } from './PasswordInput';
import type { StepProps } from '../../pages/Setup';
import { errMsg } from '../../lib/utils';

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
      setBotError(errMsg(err));
    } finally {
      setBotLoading(false);
    }
  };

  const policyOptions = ['admin-only', 'allowlist', 'open', 'disabled'];
  const policyLabels = ['Admin Only', 'Allowlist', 'Open', 'Disabled'];

  const dmPolicyHelp: Record<string, string> = {
    'admin-only': 'Only admins can DM the agent.',
    allowlist: 'Only users in the allowlist (+ admins) can DM the agent.',
    open: 'Anyone can message the agent in DMs.',
    disabled: 'All DMs are ignored.',
  };

  const groupPolicyHelp: Record<string, string> = {
    'admin-only': 'Only admins can trigger the agent in groups.',
    allowlist: 'Agent only responds in groups explicitly allowed by admins.',
    open: 'Agent responds in any group it\'s added to.',
    disabled: 'All group messages are ignored.',
  };

  return (
    <div className="step-content">
      <h2 className="step-title">Configuration</h2>
      <p className="step-description">
        Configure your agent's behavior policies. Defaults are pre-filled, adjust what you need.
      </p>

      <div className="form-group">
        <label>Admin User ID</label>
        <input
          type="text"
          inputMode="numeric"
          value={data.userId || ''}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            onChange({ ...data, userId: parseInt(v) || 0 });
          }}
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
        <div className="pill-bar" style={{ display: 'flex', width: '100%', marginBottom: 0 }}>
          {policyOptions.map((opt, i) => (
            <button
              key={opt}
              type="button"
              className={data.dmPolicy === opt ? 'active' : ''}
              style={{ flex: 1 }}
              onClick={() => onChange({ ...data, dmPolicy: opt })}
            >{policyLabels[i]}</button>
          ))}
        </div>
        <div className="helper-text">{dmPolicyHelp[data.dmPolicy] || ''}</div>
      </div>

      <div className="form-group">
        <label>Group Policy</label>
        <div className="pill-bar" style={{ display: 'flex', width: '100%', marginBottom: 0 }}>
          {policyOptions.map((opt, i) => (
            <button
              key={opt}
              type="button"
              className={data.groupPolicy === opt ? 'active' : ''}
              style={{ flex: 1 }}
              onClick={() => onChange({ ...data, groupPolicy: opt })}
            >{policyLabels[i]}</button>
          ))}
        </div>
        <div className="helper-text">{groupPolicyHelp[data.groupPolicy] || ''}</div>
      </div>

      <div className="form-group">
        <div className="card-toggle">
          <span>Require @mention in groups</span>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ margin: 0 }}>Max Agentic Iterations</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', minWidth: 20, textAlign: 'center' }}>
              {data.maxIterations}
            </span>
            <Stepper
              value={data.maxIterations}
              onChange={(v) => onChange({ ...data, maxIterations: v })}
              min={1}
              max={50}
            />
          </div>
        </div>
        <div className="helper-text">
          Maximum tool-call loops per message (1-50). Higher values allow more complex tasks.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-2xl)', marginBottom: 'var(--space-lg)' }}>
        <h3 className="step-subtitle" style={{ margin: 0 }}>Coding Agent</h3>
        <div className="pill-bar" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={data.execMode === 'off' ? 'active' : ''}
            onClick={() => onChange({ ...data, execMode: 'off' })}
          >Off</button>
          <button
            type="button"
            className={data.execMode === 'yolo' ? 'active' : ''}
            onClick={() => onChange({ ...data, execMode: 'yolo' })}
          >On</button>
        </div>
      </div>

      {/* ── Optional Integrations ── */}
      <h3 className="step-subtitle">
        Optional API Keys
      </h3>

      <div className="module-list">
        {/* Bot Token */}
        <div className="module-item">
          <div style={{ marginBottom: '8px' }}>
            <strong style={{ fontSize: 'var(--font-md)' }}>Bot Token</strong>
            <span className="module-desc" style={{ marginLeft: '8px' }}>
              ({data.telegramMode === 'bot' ? 'required' : 'recommended'})
            </span>
          </div>
          <p style={{ fontSize: 'var(--font-sm)', margin: '0 0 8px' }}>
            Required in bot mode; optional in user mode for plugin inline cards and callbacks.
          </p>
          <div className="form-row" style={{ gap: '8px' }}>
            <PasswordInput
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
            Blockchain data - jettons, NFTs, prices, transaction history. Free key: 5 req/s (vs 1).
          </p>
          <PasswordInput
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
            Blockchain RPC - send transactions, check balances. Dedicated endpoint (vs ORBS fallback).
          </p>
          <PasswordInput
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
          <PasswordInput
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
