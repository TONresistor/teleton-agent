import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { errMsg } from '../lib/utils';
import { toast } from '../lib/toast';
import { useConfirm } from '../components/ConfirmDialog';
import { Segmented } from '../components/Segmented';

const SOUL_FILES = ['SOUL.md', 'SECURITY.md', 'STRATEGY.md', 'MEMORY.md', 'HEARTBEAT.md'] as const;

export function Soul() {
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<string>(SOUL_FILES[0]);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const dirty = content !== savedContent;

  // Editor stats — token count is an estimate (~4 chars/token, no client tokenizer).
  const chars = content.length;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const estTokens = Math.ceil(chars / 4);

  const loadFile = useCallback(async (filename: string) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.getSoulFile(filename);
      setContent(res.data.content);
      setSavedContent(res.data.content);
    } catch (err) {
      setMessage({ type: 'error', text: errMsg(err) });
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
      toast.success('Saved');
    } catch (err) {
      setMessage({ type: 'error', text: errMsg(err) });
      toast.error(errMsg(err));
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
  const handleTabSwitch = async (file: string) => {
    if (file === activeTab) return;
    if (dirty && !(await confirm({ message: 'You have unsaved changes. Discard them?', confirmLabel: 'Discard', destructive: true }))) return;
    setActiveTab(file);
  };

  useEffect(() => {
    loadFile(activeTab);
  }, [activeTab, loadFile]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      <div className="header" style={{ marginBottom: '16px' }}>
        <h1>System Prompt</h1>
        <p>Edit your agent's system prompt files</p>
      </div>

      {message && (
        <div className={`alert ${message.type}`} style={{ marginBottom: '8px' }}>{message.text}</div>
      )}

      <div style={{ marginBottom: '12px', overflowX: 'auto', flexShrink: 0 }}>
        <Segmented<string>
          value={activeTab}
          onChange={(f) => { void handleTabSwitch(f); }}
          ariaLabel="System prompt file"
          options={SOUL_FILES.map((file) => ({
            value: file,
            label: file + (file === activeTab && dirty ? ' •' : ''),
          }))}
        />
      </div>

      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px', minHeight: 0 }}>
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
            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-xs)', fontVariantNumeric: 'tabular-nums' }}>
                ~{estTokens.toLocaleString()} tokens · {words.toLocaleString()} words · {chars.toLocaleString()} chars
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {dirty && <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-sm)' }}>Unsaved changes</span>}
                <button className="btn-sm" onClick={saveFile} disabled={saving || !dirty}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
