import { InfoTip } from './InfoTip';
import { EditableField } from './EditableField';
import { ArrayInput } from './ArrayInput';
import type { ConfigKeyData } from '../lib/api';

export interface ConfigSectionProps {
  keys: string[];
  configKeys: ConfigKeyData[];
  getLocal: (key: string) => string;
  getServer: (key: string) => string;
  setLocal: (key: string, value: string) => void;
  saveConfig: (key: string, value: string) => Promise<void>;
  cancelLocal: (key: string) => void;
  onArraySave?: (key: string, values: string[]) => Promise<void>;
  title?: string;
}

export function ConfigSection({
  keys,
  configKeys,
  getLocal,
  getServer,
  setLocal,
  saveConfig,
  cancelLocal,
  onArraySave,
  title,
}: ConfigSectionProps) {
  const items = keys
    .map((k) => configKeys.find((c) => c.key === k))
    .filter((item): item is ConfigKeyData => item != null);

  if (items.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {title && <div className="section-title">{title}</div>}
      {items.map((item) => {
        const restartBadge = item.hotReload === 'restart';

        if (item.type === 'boolean') {
          const checked = getLocal(item.key) === 'true';
          return (
            <div key={item.key} className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label className="toggle" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => saveConfig(item.key, String(e.target.checked))}
                  />
                  <span className="toggle-track" />
                  <span className="toggle-thumb" />
                </label>
                <span>{item.label}</span>
                {item.description && <InfoTip text={item.description} />}
                {restartBadge && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    (requires restart)
                  </span>
                )}
              </div>
            </div>
          );
        }

        if (item.type === 'enum' && item.options) {
          return (
            <div key={item.key} className="form-group">
              <label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {item.label}
                  {item.description && <InfoTip text={item.description} />}
                  {restartBadge && (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      (requires restart)
                    </span>
                  )}
                </span>
              </label>
              <select
                value={getLocal(item.key)}
                onChange={(e) => saveConfig(item.key, e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: 14,
                  border: '1px solid var(--separator)',
                  borderRadius: 4,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                }}
              >
                {item.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {item.optionLabels?.[opt] ?? opt}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (item.type === 'array') {
          const rawValue = getLocal(item.key);
          let arrayValue: string[] = [];
          if (rawValue) {
            try {
              arrayValue = JSON.parse(rawValue).map(String);
            } catch {
              arrayValue = [];
            }
          }
          return (
            <div key={item.key} className="form-group">
              <label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {item.label}
                  {item.description && <InfoTip text={item.description} />}
                  {restartBadge && (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      (requires restart)
                    </span>
                  )}
                </span>
              </label>
              <ArrayInput
                value={arrayValue}
                onChange={(values) => {
                  if (onArraySave) {
                    onArraySave(item.key, values);
                  }
                }}
                placeholder={`Add ${item.label.toLowerCase()}`}
              />
            </div>
          );
        }

        // string or number — use EditableField
        const fieldType = item.type === 'number'
          ? 'number'
          : item.sensitive
            ? 'password'
            : 'text';

        const badge = item.sensitive
          ? (item.set ? 'Set' : 'Not set')
          : undefined;

        return (
          <EditableField
            key={item.key}
            label={item.label}
            description={item.description}
            configKey={item.key}
            type={fieldType}
            value={getLocal(item.key)}
            serverValue={getServer(item.key)}
            onChange={(v) => setLocal(item.key, v)}
            onSave={(v) => saveConfig(item.key, v)}
            onCancel={() => cancelLocal(item.key)}
            hotReload={item.hotReload}
            badge={badge}
            placeholder={item.sensitive ? '********' : undefined}
          />
        );
      })}
    </div>
  );
}
