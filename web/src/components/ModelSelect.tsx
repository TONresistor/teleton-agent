import { useEffect, useState } from 'react';
import { Select } from './Select';
import type { ModelOption } from '../lib/model-options';

const CUSTOM = '__custom__';

interface ModelSelectProps {
  provider: string;
  value: string;
  models: ModelOption[];
  onSave: (value: string) => Promise<void>;
}

export function ModelSelect({ provider, value, models, onSave }: ModelSelectProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft('');
  }, [provider, value]);

  const allowCustom = provider === 'openrouter';
  const options = allowCustom ? [...models, { value: CUSTOM, name: 'Custom...' }] : models;
  const modelId = draft.trim();

  return (
    <div>
      <Select
        value={editing && allowCustom ? CUSTOM : value}
        options={options.map((model) => model.value)}
        labels={options.map((model) => model.name)}
        disabled={saving}
        onChange={(selected) => {
          if (selected === CUSTOM && allowCustom) {
            setDraft(value);
            setEditing(true);
          } else {
            setEditing(false);
            void onSave(selected);
          }
        }}
      />
      {editing && allowCustom && (
        <form
          style={{ marginTop: 8, display: 'grid', gap: 8 }}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!modelId || modelId === CUSTOM || saving) return;
            if (modelId === value) { setEditing(false); return; }
            setSaving(true);
            try { await onSave(modelId); } finally { setSaving(false); }
          }}
        >
          <input
            aria-label="Custom OpenRouter model ID"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="provider/model-id"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
            required
            className="w-full"
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={!modelId || modelId === CUSTOM || saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="btn" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
