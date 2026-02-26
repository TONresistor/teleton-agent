import type { StepProps } from '../../pages/Setup';

function maskKey(key: string): string {
  if (key.length <= 10) return '***';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

export function ReviewStep({ data, onChange }: StepProps) {
  const resolvedModel =
    data.mode === 'quick'
      ? '(default)'
      : data.model === '__custom__'
        ? data.customModel || '(custom)'
        : data.model || '(default)';

  return (
    <div className="step-content">
      <h2 className="step-title">Review Your Setup</h2>
      <p className="step-description">
        Double-check everything before saving. You can go back to change any step.
      </p>

      {/* Provider */}
      <div className="card">
        <div className="section-title">Provider</div>
        <div className="review-list">
          <div><span className="review-label">Provider:</span> {data.provider}</div>
          <div><span className="review-label">Model:</span> {resolvedModel}</div>
          {data.provider !== 'cocoon' && data.apiKey && (
            <div><span className="review-label">API Key:</span> <span className="mono">{maskKey(data.apiKey)}</span></div>
          )}
          {data.provider === 'cocoon' && (
            <div><span className="review-label">Port:</span> {data.cocoonPort}</div>
          )}
        </div>
      </div>

      {/* Telegram */}
      <div className="card">
        <div className="section-title">Telegram</div>
        <div className="review-list">
          <div><span className="review-label">Phone:</span> {data.phone}</div>
          <div><span className="review-label">User ID:</span> {data.userId}</div>
          {data.apiHash && (
            <div><span className="review-label">API Hash:</span> <span className="mono">{maskKey(data.apiHash)}</span></div>
          )}
          {data.botToken && (
            <div><span className="review-label">Bot Token:</span> <span className="mono">{maskKey(data.botToken)}</span></div>
          )}
          {data.botUsername && (
            <div><span className="review-label">Bot:</span> @{data.botUsername}</div>
          )}
        </div>
      </div>

      {/* Policies */}
      <div className="card">
        <div className="section-title">Policies</div>
        <div className="review-list">
          <div><span className="review-label">DM Policy:</span> {data.dmPolicy}</div>
          <div><span className="review-label">Group Policy:</span> {data.groupPolicy}</div>
          <div><span className="review-label">Require @mention:</span> {data.requireMention ? 'Yes' : 'No'}</div>
        </div>
      </div>

      {/* Modules */}
      <div className="card">
        <div className="section-title">Modules</div>
        <div className="review-list">
          <div><span className="review-label">TonAPI:</span> {data.tonapiKey ? <span className="mono">{maskKey(data.tonapiKey)}</span> : 'No'}</div>
          <div><span className="review-label">TonCenter:</span> {data.toncenterKey ? <span className="mono">{maskKey(data.toncenterKey)}</span> : 'No'}</div>
          <div><span className="review-label">Web Search:</span> {data.tavilyKey ? <span className="mono">{maskKey(data.tavilyKey)}</span> : 'No'}</div>
          {data.customizeThresholds && (
            <div><span className="review-label">Deals:</span> Buy max {data.buyMaxFloor}% / Sell min {data.sellMinFloor}%</div>
          )}
        </div>
      </div>

      {/* Wallet */}
      <div className="card">
        <div className="section-title">Wallet</div>
        <div className="review-list">
          {data.walletAddress ? (
            <span className="mono" style={{ wordBreak: 'break-all' }}>{data.walletAddress}</span>
          ) : (
            <span className="review-unset">Not configured</span>
          )}
        </div>
      </div>

      {/* Connection */}
      <div className="card">
        <div className="section-title">Connection</div>
        <div className="review-list">
          {data.telegramUser ? (
            <span style={{ color: 'var(--green)' }}>
              Connected as {data.telegramUser.firstName}
              {data.telegramUser.username && <> (@{data.telegramUser.username})</>}
            </span>
          ) : (
            <span className="review-unset">Not connected (deferred)</span>
          )}
        </div>
      </div>

      {/* WebUI Toggle */}
      <div className="card">
        <div className="card-toggle">
          <div>
            <strong>Enable WebUI Dashboard</strong>
            <div className="helper-text" style={{ marginTop: '2px' }}>
              Start the dashboard on next launch
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={data.webuiEnabled}
              onChange={(e) => onChange({ ...data, webuiEnabled: e.target.checked })}
            />
            <div className="toggle-track" />
            <div className="toggle-thumb" />
          </label>
        </div>
      </div>
    </div>
  );
}
