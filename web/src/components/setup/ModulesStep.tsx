import { useState } from 'react';
import { setup } from '../../lib/api';
import type { StepProps } from '../../pages/Setup';

export function ModulesStep({ data, onChange }: StepProps) {
  const [botLoading, setBotLoading] = useState(false);
  const [botValid, setBotValid] = useState<boolean | null>(null);
  const [botNetworkError, setBotNetworkError] = useState(false);
  const [botError, setBotError] = useState('');
  const [showBot, setShowBot] = useState(!!data.botToken);
  const [showTonapi, setShowTonapi] = useState(!!data.tonapiKey);
  const [showTavily, setShowTavily] = useState(!!data.tavilyKey);

  const handleValidateBot = async () => {
    if (!data.botToken) return;
    setBotLoading(true);
    setBotError('');
    setBotValid(null);
    setBotNetworkError(false);
    try {
      const result = await setup.validateBotToken(data.botToken);
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

  return (
    <div className="step-content">
      <h2 className="step-title">Optional Modules</h2>
      <p className="step-description">
        Enable extra features. Everything here is optional — you can skip and add them later.
      </p>

      <div className="module-list">
        {/* Bot Token */}
        <div className={`module-item${showBot ? ' expanded' : ''}`}>
          <div className="module-header">
            <div className="module-info">
              <strong>Telegram Bot Token</strong>
              <span className="module-desc">Inline buttons and rich interactions</span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showBot}
                onChange={(e) => {
                  setShowBot(e.target.checked);
                  if (!e.target.checked) onChange({ ...data, botToken: '', botUsername: '' });
                }}
              />
              <div className="toggle-track" />
              <div className="toggle-thumb" />
            </label>
          </div>
          {showBot && (
            <div className="module-body">
              <div className="form-row">
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
                  <div className="form-group">
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
                Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a> on
                Telegram. Send /newbot and follow the prompts.
              </div>
            </div>
          )}
        </div>

        {/* Trading Thresholds */}
        <div className={`module-item${data.customizeThresholds ? ' expanded' : ''}`}>
          <div className="module-header">
            <div className="module-info">
              <strong>Trading Thresholds</strong>
              <span className="module-desc">Custom buy/sell floor percentages</span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={data.customizeThresholds}
                onChange={(e) => onChange({ ...data, customizeThresholds: e.target.checked })}
              />
              <div className="toggle-track" />
              <div className="toggle-thumb" />
            </label>
          </div>
          {data.customizeThresholds && (
            <div className="module-body">
              <div className="form-row" style={{ gap: '12px' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Buy Max Floor (%)</label>
                  <input
                    type="number"
                    value={data.buyMaxFloor}
                    onChange={(e) => onChange({ ...data, buyMaxFloor: parseInt(e.target.value) || 95 })}
                    min={50}
                    max={150}
                    className="w-full"
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Sell Min Floor (%)</label>
                  <input
                    type="number"
                    value={data.sellMinFloor}
                    onChange={(e) => onChange({ ...data, sellMinFloor: parseInt(e.target.value) || 105 })}
                    min={100}
                    max={200}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* TonAPI Key */}
        <div className={`module-item${showTonapi ? ' expanded' : ''}`}>
          <div className="module-header">
            <div className="module-info">
              <strong>TonAPI Key</strong>
              <span className="module-desc">Enhanced blockchain data queries</span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showTonapi}
                onChange={(e) => {
                  setShowTonapi(e.target.checked);
                  if (!e.target.checked) onChange({ ...data, tonapiKey: '' });
                }}
              />
              <div className="toggle-track" />
              <div className="toggle-thumb" />
            </label>
          </div>
          {showTonapi && (
            <div className="module-body">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <input
                  type="text"
                  value={data.tonapiKey}
                  onChange={(e) => onChange({ ...data, tonapiKey: e.target.value })}
                  placeholder="Your TonAPI key (min 10 chars)"
                  className="w-full"
                />
              </div>
              <div className="helper-text">
                Get a free key from <a href="https://t.me/tonapibot" target="_blank" rel="noopener noreferrer">@tonapibot</a> on Telegram.
              </div>
            </div>
          )}
        </div>

        {/* Tavily Key */}
        <div className={`module-item${showTavily ? ' expanded' : ''}`}>
          <div className="module-header">
            <div className="module-info">
              <strong>Web Search (Tavily)</strong>
              <span className="module-desc">Agent can search the web for information</span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showTavily}
                onChange={(e) => {
                  setShowTavily(e.target.checked);
                  if (!e.target.checked) onChange({ ...data, tavilyKey: '' });
                }}
              />
              <div className="toggle-track" />
              <div className="toggle-thumb" />
            </label>
          </div>
          {showTavily && (
            <div className="module-body">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <input
                  type="text"
                  value={data.tavilyKey}
                  onChange={(e) => onChange({ ...data, tavilyKey: e.target.value })}
                  placeholder="tvly-..."
                  className="w-full"
                />
              </div>
              <div className="helper-text">
                Free plan available at{' '}
                <a href="https://tavily.com" target="_blank" rel="noopener noreferrer">tavily.com</a>.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
