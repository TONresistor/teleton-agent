import { Select } from './Select';

interface TelegramSettingsPanelProps {
  getLocal: (key: string) => string;
  setLocal: (key: string, value: string) => void;
  saveConfig: (key: string, value: string) => Promise<void>;
  extended?: boolean;
}

function TextField({ label, configKey, getLocal, setLocal, saveConfig }: {
  label: string;
  configKey: string;
  getLocal: (key: string) => string;
  setLocal: (key: string, value: string) => void;
  saveConfig: (key: string, value: string) => Promise<void>;
}) {
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <input
        type="text"
        value={getLocal(configKey)}
        onChange={(e) => setLocal(configKey, e.target.value)}
        onBlur={(e) => saveConfig(configKey, e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && saveConfig(configKey, e.currentTarget.value)}
        style={{ width: '100%' }}
      />
    </div>
  );
}

export function TelegramSettingsPanel({ getLocal, setLocal, saveConfig, extended }: TelegramSettingsPanelProps) {
  return (
    <>
      <div className="section-title">Telegram</div>
      <div style={{ display: 'grid', gap: '16px' }}>
        {extended && (
          <>
            <TextField label="Bot Username" configKey="telegram.bot_username" getLocal={getLocal} setLocal={setLocal} saveConfig={saveConfig} />
            <TextField label="Owner Name" configKey="telegram.owner_name" getLocal={getLocal} setLocal={setLocal} saveConfig={saveConfig} />
            <TextField label="Owner Username" configKey="telegram.owner_username" getLocal={getLocal} setLocal={setLocal} saveConfig={saveConfig} />
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>DM Policy</label>
            <Select
              value={getLocal('telegram.dm_policy')}
              options={['open', 'pairing', 'admin']}
              onChange={(v) => saveConfig('telegram.dm_policy', v)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Group Policy</label>
            <Select
              value={getLocal('telegram.group_policy')}
              options={['open', 'admin', 'disabled']}
              onChange={(v) => saveConfig('telegram.group_policy', v)}
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }} htmlFor="require-mention">
            Require Mention
          </label>
          <label className="toggle">
            <input
              id="require-mention"
              type="checkbox"
              checked={getLocal('telegram.require_mention') === 'true'}
              onChange={(e) => saveConfig('telegram.require_mention', String(e.target.checked))}
            />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </label>
        </div>
        {extended && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer' }} htmlFor="typing-sim">
              Typing Simulation
            </label>
            <label className="toggle">
              <input
                id="typing-sim"
                type="checkbox"
                checked={getLocal('telegram.typing_simulation') === 'true'}
                onChange={(e) => saveConfig('telegram.typing_simulation', String(e.target.checked))}
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>
        )}
        {extended && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Debounce (ms)</label>
            <input
              type="number"
              min="0"
              value={getLocal('telegram.debounce_ms')}
              onChange={(e) => setLocal('telegram.debounce_ms', e.target.value)}
              onBlur={(e) => saveConfig('telegram.debounce_ms', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveConfig('telegram.debounce_ms', e.currentTarget.value)}
              style={{ width: '100%' }}
            />
          </div>
        )}
        {extended && (
          <TextField label="Agent Channel" configKey="telegram.agent_channel" getLocal={getLocal} setLocal={setLocal} saveConfig={saveConfig} />
        )}
      </div>
    </>
  );
}
