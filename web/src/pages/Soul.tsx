import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const SOUL_FILES = ['SOUL.md', 'SECURITY.md', 'STRATEGY.md', 'MEMORY.md'] as const;

export function Soul() {
  const [activeTab, setActiveTab] = useState<string>(SOUL_FILES[0]);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const dirty = content !== savedContent;

  const loadFile = useCallback(async (filename: string) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.getSoulFile(filename);
      setContent(res.data.content);
      setSavedContent(res.data.content);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  const saveFile = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.updateSoulFile(activeTab, content);
      setSavedContent(content);
      setMessage({ type: 'success', text: res.data.message });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Confirm before switching tabs with unsaved changes
  const handleTabSwitch = (file: string) => {
    if (file === activeTab) return;
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    setActiveTab(file);
  };

  useEffect(() => {
    loadFile(activeTab);
  }, [activeTab, loadFile]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      <div className="header" style={{ marginBottom: '16px' }}>
        <h1>Soul Editor</h1>
        <p>Edit system prompt files</p>
      </div>

      {message && (
        <div className={`alert ${message.type}`} style={{ marginBottom: '8px' }}>{message.text}</div>
      )}

      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px' }}>
        <div className="tabs" style={{ marginBottom: '8px' }}>
          {SOUL_FILES.map((file) => (
            <button
              key={file}
              className={`tab ${activeTab === file ? 'active' : ''}`}
              onClick={() => handleTabSwitch(file)}
            >
              {file}{activeTab === file && dirty ? ' *' : ''}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`Edit ${activeTab}...`}
              style={{ flex: 1, minHeight: '200px' }}
            />
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button onClick={saveFile} disabled={saving || !dirty}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              {dirty && <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Unsaved changes</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
