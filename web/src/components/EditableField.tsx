import { useState, useRef, useEffect } from 'react';
import { InfoTip } from './InfoTip';

export interface EditableFieldProps {
  label: string;
  description?: string;
  configKey: string;
  type?: 'text' | 'number' | 'password';
  value: string;
  serverValue: string;
  onChange: (value: string) => void;
  onSave: (value: string) => Promise<void>;
  onCancel: () => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  hotReload?: 'instant' | 'restart';
  badge?: string;
  inline?: boolean;
}

export function EditableField({
  label,
  description,
  type = 'text',
  value,
  serverValue,
  onChange,
  onSave,
  onCancel,
  min,
  max,
  step,
  placeholder,
  hotReload,
  badge,
  inline,
}: EditableFieldProps) {
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDirty = value !== serverValue;

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (saving) return;
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  useEffect(() => {
    if (saving && inputRef.current) {
      inputRef.current.blur();
    }
  }, [saving]);

  const badgeEl = badge ? (
    <span style={{
      fontSize: 11,
      padding: '1px 6px',
      borderRadius: 4,
      backgroundColor: badge === 'Set' ? 'var(--accent)' : 'var(--red)',
      color: 'var(--text-on-accent)',
      marginLeft: 6,
      fontWeight: 500,
    }}>
      {badge}
    </span>
  ) : null;

  const restartEl = hotReload === 'restart' ? (
    <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>
      (requires restart)
    </span>
  ) : null;

  const labelRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span>{label}</span>
      {description && <InfoTip text={description} />}
      {badgeEl}
      {restartEl}
    </div>
  );

  const actionButtons = isDirty ? (
    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '4px 8px',
          fontSize: 13,
          border: '1px solid var(--accent)',
          borderRadius: 4,
          background: 'var(--accent)',
          color: 'var(--text-on-accent)',
          cursor: saving ? 'wait' : 'pointer',
          opacity: saving ? 0.6 : 1,
          lineHeight: 1,
        }}
      >
        {saving ? '...' : '\u2713'}
      </button>
      <button
        onClick={handleCancel}
        disabled={saving}
        style={{
          padding: '4px 8px',
          fontSize: 13,
          border: '1px solid var(--separator)',
          borderRadius: 4,
          background: 'var(--surface)',
          color: 'var(--text)',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        {'\u2717'}
      </button>
    </div>
  ) : null;

  const inputEl = (
    <input
      ref={inputRef}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      disabled={saving}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      style={{
        flex: 1,
        padding: '6px 10px',
        fontSize: 14,
        border: '1px solid var(--separator)',
        borderRadius: 4,
        background: 'var(--surface)',
        color: 'var(--text)',
        minWidth: 0,
      }}
    />
  );

  if (inline) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 36 }}>
        <div style={{ flex: '0 0 auto', minWidth: 120 }}>{labelRow}</div>
        <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
          {inputEl}
          {actionButtons}
        </div>
      </div>
    );
  }

  return (
    <div className="form-group">
      <label>{labelRow}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {inputEl}
        {actionButtons}
      </div>
    </div>
  );
}
