import type { StepProps } from '../../pages/Setup';

export function TelegramStep({ data, onChange }: StepProps) {
  return (
    <div className="step-content">
      <h2 className="step-title">Telegram Credentials</h2>
      <p className="step-description">
        These credentials allow your agent to use your Telegram account to send and receive messages.
      </p>

      <details className="guide-dropdown">
        <summary>How to get these credentials</summary>
        <div className="guide-content">
          <div className="guide-section">
            <strong>API ID &amp; API Hash</strong>
            <ol>
              <li>Open <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer">my.telegram.org</a> in your browser</li>
              <li>Log in with your phone number (the one linked to your Telegram account)</li>
              <li>Click <strong>API development tools</strong></li>
              <li>If prompted, create a new app — the name and platform don't matter (e.g. "MyApp", Desktop)</li>
              <li>Copy <strong>App api_id</strong> (a number) and <strong>App api_hash</strong> (a hex string)</li>
            </ol>
          </div>
          <div className="guide-section">
            <strong>Phone Number</strong>
            <p>The phone number linked to your Telegram account, with country code (e.g. +33612345678).</p>
          </div>
          <div className="guide-section">
            <strong>User ID</strong>
            <ol>
              <li>Open Telegram and search for <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer">@userinfobot</a></li>
              <li>Send <code>/start</code> — the bot will reply with your numeric User ID</li>
            </ol>
          </div>
        </div>
      </details>

      <div className="form-group">
        <label>API ID</label>
        <input
          type="number"
          value={data.apiId || ''}
          onChange={(e) => onChange({ ...data, apiId: parseInt(e.target.value) || 0 })}
          placeholder="12345678"
          className="w-full"
        />
      </div>

      <div className="form-group">
        <label>API Hash</label>
        <input
          type="text"
          value={data.apiHash}
          onChange={(e) => onChange({ ...data, apiHash: e.target.value })}
          placeholder="abcdef0123456789abcdef0123456789"
          className="w-full"
        />
        {data.apiHash.length > 0 && data.apiHash.length < 10 && (
          <div className="helper-text">API Hash should be at least 10 characters.</div>
        )}
      </div>

      <div className="form-group">
        <label>Phone Number</label>
        <input
          type="text"
          value={data.phone}
          onChange={(e) => onChange({ ...data, phone: e.target.value })}
          placeholder="+33612345678"
          className="w-full"
        />
        {data.phone.length > 0 && !data.phone.startsWith('+') && (
          <div className="helper-text">Phone number must start with "+"</div>
        )}
      </div>

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
    </div>
  );
}
