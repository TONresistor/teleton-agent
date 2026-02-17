import { useEffect, useState } from 'react';
import { api, ConfigKeyData } from '../lib/api';
import { Select } from '../components/Select';

const CATEGORY_ORDER = ['API Keys', 'Agent', 'Telegram', 'Embedding', 'WebUI', 'Deals', 'Developer'];

function groupByCategory(keys: ConfigKeyData[]): Map<string, ConfigKeyData[]> {
  const groups = new Map<string, ConfigKeyData[]>();
  for (const key of keys) {
    const cat = key.category || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(key);
  }
  // Sort by CATEGORY_ORDER, unknown categories go last
  const sorted = new Map<string, ConfigKeyData[]>();
  for (const cat of CATEGORY_ORDER) {
    if (groups.has(cat)) {
      sorted.set(cat, groups.get(cat)!);
      groups.delete(cat);
    }
  }
  for (const [cat, items] of groups) {
    sorted.set(cat, items);
  }
  return sorted;
}

export function Config() {
  const [keys, setKeys] = useState<ConfigKeyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const loadKeys = (initial = false) => {
    if (initial) setLoading(true);
    api.getConfigKeys()
      .then((res) => {
        setKeys(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  };

  useEffect(() => { loadKeys(true); }, []);

  const startEdit = (item: ConfigKeyData) => {
    setEditingKey(item.key);
    if (item.type === 'boolean') {
      setEditValue(item.set && item.value !== null ? item.value : 'true');
    } else if (item.type === 'enum' && item.options?.length) {
      setEditValue(item.set && item.value !== null ? item.value : item.options[0]);
    } else {
      setEditValue('');
    }
  };

  const handleSave = async (key: string) => {
    const item = keys.find((k) => k.key === key);
    const isSelectType = item?.type === 'boolean' || item?.type === 'enum';
    if (!isSelectType && !editValue.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.setConfigKey(key, editValue.trim());
      setEditingKey(null);
      setEditValue('');
      setSuccess(`${key} updated successfully`);
      loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUnset = async (key: string) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.unsetConfigKey(key);
      setSuccess(`${key} removed`);
      loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingKey(null);
    setEditValue('');
  };

  if (loading) return <div className="loading">Loading...</div>;

  const groups = groupByCategory(keys);

  return (
    <div>
      <div className="header">
        <h1>Configuration</h1>
        <p>Manage API keys and settings</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
            Dismiss
          </button>
        </div>
      )}

      {success && (
        <div className="alert success" style={{ marginBottom: '14px' }}>
          {success}
          <button onClick={() => setSuccess(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
            Dismiss
          </button>
        </div>
      )}

      {Array.from(groups.entries()).map(([category, items]) => (
        <div key={category} className="card" style={{ marginBottom: '10px' }}>
          <h2 style={{ marginBottom: '8px' }}>{category}</h2>

          {items.map((item, idx) => (
            <div
              key={item.key}
              style={{
                padding: '12px 0',
                borderBottom: idx < items.length - 1 ? '1px solid var(--separator)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontFamily: 'monospace' }}>{item.key}</strong>
                  <span
                    style={{
                      marginLeft: '10px',
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: item.set ? 'var(--accent)' : 'var(--surface)',
                      color: item.set ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {item.set ? 'Set' : 'Not set'}
                  </span>
                  {item.sensitive && (
                    <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      sensitive
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => startEdit(item)}
                    style={{ padding: '4px 12px', fontSize: '12px' }}
                    disabled={saving}
                  >
                    Edit
                  </button>
                  {item.set && (
                    <button
                      onClick={() => handleUnset(item.key)}
                      style={{ padding: '4px 12px', fontSize: '12px', opacity: 0.7 }}
                      disabled={saving}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {item.description}
              </div>

              {item.set && item.value && editingKey !== item.key && (
                <div style={{ marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                  {item.value}
                </div>
              )}

              {editingKey === item.key && (
                <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
                  {item.type === 'boolean' ? (
                    <Select
                      value={editValue}
                      options={['true', 'false']}
                      onChange={setEditValue}
                      style={{ width: '100%', marginBottom: '8px' }}
                    />
                  ) : item.type === 'enum' && item.options ? (
                    <Select
                      value={editValue}
                      options={item.options}
                      onChange={setEditValue}
                      style={{ width: '100%', marginBottom: '8px' }}
                    />
                  ) : (
                    <input
                      type={item.type === 'number' ? 'number' : item.sensitive ? 'password' : 'text'}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSave(item.key)}
                      placeholder={`Enter value for ${item.key}...`}
                      autoFocus
                      style={{ width: '100%', marginBottom: '8px' }}
                    />
                  )}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => handleSave(item.key)}
                      disabled={saving || (item.type !== 'boolean' && item.type !== 'enum' && !editValue.trim())}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={handleCancel} style={{ opacity: 0.7 }} disabled={saving}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
