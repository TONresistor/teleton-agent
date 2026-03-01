import { Select } from './Select';
import { InfoTip } from './InfoTip';

interface ExecSettingsPanelProps {
  getLocal: (key: string) => string;
  saveConfig: (key: string, value: string) => Promise<void>;
}

export function ExecSettingsPanel({ getLocal, saveConfig }: ExecSettingsPanelProps) {
  const isYolo = getLocal('capabilities.exec.mode') === 'yolo';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
      <span className="section-title" style={{ marginBottom: 0 }}>Coding Agent</span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }} htmlFor="exec-yolo">
          YOLO
          <InfoTip text="Full system access — exec_run, exec_install, exec_service, exec_status. Requires restart." />
        </label>
        <label className="toggle">
          <input
            id="exec-yolo"
            type="checkbox"
            checked={isYolo}
            onChange={(e) => saveConfig('capabilities.exec.mode', e.target.checked ? 'yolo' : 'off')}
          />
          <span className="toggle-track" />
          <span className="toggle-thumb" />
        </label>
      </div>

      {isYolo && (
        <>
          <div style={{ width: 1, height: 18, background: 'var(--separator)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              Scope
              <InfoTip text="Who can trigger exec tools. Requires restart." />
            </label>
            <Select
              value={getLocal('capabilities.exec.scope') || 'admin-only'}
              options={['admin-only', 'allowlist', 'all']}
              labels={['Admin Only', 'Allowlist', 'Everyone']}
              onChange={(v) => saveConfig('capabilities.exec.scope', v)}
            />
          </div>
          <div style={{ width: 1, height: 18, background: 'var(--separator)' }} />
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text-tertiary)' }}>
            Full system access enabled
          </span>
        </>
      )}
    </div>
  );
}
