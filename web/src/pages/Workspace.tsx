import React, { useEffect, useState, useCallback } from 'react';
import { api, FileEntry, WorkspaceInfo } from '../lib/api';

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const BINARY_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'bin', 'exe', 'dll', 'so', 'db', 'sqlite', 'wasm', 'pdf']);

function getExtension(path: string): string {
  return path.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
}
function isImageFile(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(path));
}
function isBinaryFile(path: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(path));
}

export function Workspace() {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editDirty, setEditDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileMode, setFileMode] = useState<'text' | 'image' | 'binary'>('text');

  // Dialog state
  const [dialog, setDialog] = useState<{ type: 'newFile' | 'newFolder' | 'rename'; target?: string } | null>(null);
  const [dialogInput, setDialogInput] = useState('');

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.workspaceList(path);
      setEntries(res.data ?? []);
      setCurrentPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInfo = useCallback(async () => {
    try {
      const res = await api.workspaceInfo();
      setInfo(res.data ?? null);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    loadDir('');
    loadInfo();
  }, [loadDir, loadInfo]);

  // Warn on tab close when dirty
  useEffect(() => {
    if (!editDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editDirty]);

  const navigateTo = (path: string) => {
    if (!closeEditor()) return;
    loadDir(path);
  };

  // Breadcrumb segments
  const breadcrumbs = currentPath ? currentPath.split('/') : [];

  // Editor
  const openFile = async (path: string) => {
    try {
      setError(null);
      if (isImageFile(path)) {
        setEditingFile(path);
        setFileMode('image');
        setEditContent('');
        setEditDirty(false);
      } else if (isBinaryFile(path)) {
        setEditingFile(path);
        setFileMode('binary');
        setEditContent('');
        setEditDirty(false);
      } else {
        const res = await api.workspaceRead(path);
        setEditingFile(path);
        setFileMode('text');
        setEditContent(res.data?.content ?? '');
        setEditDirty(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const closeEditor = (): boolean => {
    if (fileMode === 'text' && editDirty && !confirm('You have unsaved changes. Discard?')) return false;
    setEditingFile(null);
    setEditContent('');
    setEditDirty(false);
    setFileMode('text');
    return true;
  };

  const handleFileClick = (path: string) => {
    if (editingFile === path) {
      closeEditor();
    } else {
      if (!closeEditor()) return;
      openFile(path);
    }
  };

  const saveFile = async () => {
    if (!editingFile) return;
    setSaving(true);
    try {
      await api.workspaceWrite(editingFile, editContent);
      setEditDirty(false);
      loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (entry: FileEntry) => {
    const label = entry.isDirectory ? 'directory' : 'file';
    if (!confirm(`Delete ${label} "${entry.name}"?`)) return;

    try {
      await api.workspaceDelete(entry.path, entry.isDirectory);
      if (editingFile === entry.path) {
        setEditingFile(null);
        setEditContent('');
        setEditDirty(false);
      }
      loadDir(currentPath);
      loadInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDialogSubmit = async () => {
    const name = dialogInput.trim();
    if (!name || !dialog) return;

    const fullPath = currentPath ? `${currentPath}/${name}` : name;
    try {
      if (dialog.type === 'newFile') {
        await api.workspaceWrite(fullPath, '');
      } else if (dialog.type === 'newFolder') {
        await api.workspaceMkdir(fullPath);
      } else if (dialog.type === 'rename' && dialog.target) {
        const parentPath = currentPath ? `${currentPath}/${name}` : name;
        await api.workspaceRename(dialog.target, parentPath);
        if (editingFile === dialog.target) {
          setEditingFile(null);
          setEditContent('');
          setEditDirty(false);
        }
      }
      setDialog(null);
      setDialogInput('');
      loadDir(currentPath);
      loadInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className="header">
        <h1>Workspace</h1>
        <p>
          Browse and manage agent workspace files
          {info && (
            <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {info.totalFiles} files · {formatSize(info.totalSize)}
            </span>
          )}
        </p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="card" style={{ padding: '8px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
        <span
          onClick={() => navigateTo('')}
          style={{ cursor: 'pointer', fontWeight: currentPath ? 'normal' : 'bold', color: 'var(--accent)' }}
        >
          workspace
        </span>
        {breadcrumbs.map((seg, i) => {
          const path = breadcrumbs.slice(0, i + 1).join('/');
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span key={path}>
              <span style={{ color: 'var(--text-secondary)', margin: '0 2px' }}>/</span>
              <span
                onClick={() => !isLast && navigateTo(path)}
                style={{
                  cursor: isLast ? 'default' : 'pointer',
                  fontWeight: isLast ? 'bold' : 'normal',
                  color: isLast ? 'var(--text)' : 'var(--accent)',
                }}
              >
                {seg}
              </span>
            </span>
          );
        })}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          <button
            style={{ padding: '3px 10px', fontSize: '12px' }}
            onClick={() => { setDialog({ type: 'newFile' }); setDialogInput(''); }}
          >
            + File
          </button>
          <button
            style={{ padding: '3px 10px', fontSize: '12px' }}
            onClick={() => { setDialog({ type: 'newFolder' }); setDialogInput(''); }}
          >
            + Folder
          </button>
        </div>
      </div>

      {/* Dialog */}
      {dialog && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>
            {dialog.type === 'newFile' ? 'New file:' : dialog.type === 'newFolder' ? 'New folder:' : 'Rename to:'}
          </span>
          <input
            type="text"
            value={dialogInput}
            onChange={(e) => setDialogInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleDialogSubmit()}
            placeholder="name..."
            autoFocus
            style={{ flex: 1, padding: '4px 8px', fontSize: '13px' }}
          />
          <button style={{ padding: '4px 10px', fontSize: '12px' }} onClick={handleDialogSubmit}>
            OK
          </button>
          <button
            style={{ padding: '4px 10px', fontSize: '12px', opacity: 0.7 }}
            onClick={() => setDialog(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* File list */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Empty directory
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--separator)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>Name</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '80px' }}>Size</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '140px' }}>Modified</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '70px' }}></th>
              </tr>
            </thead>
            <tbody>
              {/* Parent directory link */}
              {currentPath && (
                <tr
                  onClick={() => {
                    const parts = currentPath.split('/');
                    parts.pop();
                    navigateTo(parts.join('/'));
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const parts = currentPath.split('/'); parts.pop(); navigateTo(parts.join('/')); } }}
                  tabIndex={0}
                  role="button"
                  style={{ cursor: 'pointer', borderBottom: '1px solid var(--separator)' }}
                  className="file-row"
                >
                  <td style={{ padding: '6px 14px' }}>
                    <span style={{ marginRight: '8px' }}>&#128194;</span>..
                  </td>
                  <td />
                  <td />
                  <td />
                </tr>
              )}
              {entries.map((entry) => {
                const isExpanded = !entry.isDirectory && editingFile === entry.path;
                return (
                  <React.Fragment key={entry.path}>
                    <tr
                      onClick={() => entry.isDirectory ? navigateTo(entry.path) : handleFileClick(entry.path)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entry.isDirectory ? navigateTo(entry.path) : handleFileClick(entry.path); } }}
                      tabIndex={0}
                      role="button"
                      style={{
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--separator)',
                        backgroundColor: isExpanded ? 'rgba(255,255,255,0.03)' : undefined,
                      }}
                      className="file-row"
                    >
                      <td style={{ padding: '6px 14px' }}>
                        {entry.isDirectory ? (
                          <span style={{ marginRight: '8px' }}>{'\u{1F4C2}'}</span>
                        ) : (
                          <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)', marginRight: '8px' }}>
                            {isExpanded ? '\u25BC' : '\u25B6'}
                          </span>
                        )}
                        {entry.name}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', color: 'var(--text-secondary)' }}>
                        {entry.isDirectory ? '' : formatSize(entry.size)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', color: 'var(--text-secondary)' }}>
                        {formatDate(entry.mtime)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-button"
                          onClick={() => { setDialog({ type: 'rename', target: entry.path }); setDialogInput(entry.name); }}
                          title="Rename"
                        >
                          &#9998;
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => deleteEntry(entry)}
                          title="Delete"
                        >
                          &#128465;
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--separator)' }}>
                        <td colSpan={4} style={{ padding: '0 14px 14px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600 }}>
                              {editingFile}
                              {fileMode === 'text' && editDirty && <span style={{ color: 'var(--accent)', marginLeft: '6px' }}>*</span>}
                            </span>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              {fileMode === 'text' && (
                                <button
                                  style={{ padding: '4px 12px', fontSize: '12px' }}
                                  onClick={saveFile}
                                  disabled={saving || !editDirty}
                                >
                                  {saving ? 'Saving...' : 'Save'}
                                </button>
                              )}
                              <button
                                style={{ padding: '4px 12px', fontSize: '12px', opacity: 0.7 }}
                                onClick={() => closeEditor()}
                              >
                                Close
                              </button>
                            </div>
                          </div>
                          {fileMode === 'text' && (
                            <textarea
                              value={editContent}
                              onChange={(e) => { setEditContent(e.target.value); setEditDirty(true); }}
                              onKeyDown={(e) => {
                                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                                  e.preventDefault();
                                  saveFile();
                                }
                              }}
                              style={{
                                width: '100%',
                                minHeight: '300px',
                                maxHeight: '500px',
                                fontFamily: 'monospace',
                                fontSize: '13px',
                                padding: '10px',
                                border: '1px solid var(--separator)',
                                borderRadius: '4px',
                                backgroundColor: 'var(--surface)',
                                color: 'var(--text)',
                                resize: 'vertical',
                                tabSize: 2,
                              }}
                              spellCheck={false}
                            />
                          )}
                          {fileMode === 'image' && editingFile && (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                              <img
                                src={api.workspaceRawUrl(editingFile)}
                                alt={editingFile}
                                style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: '8px' }}
                                onError={(e) => { (e.target as HTMLImageElement).alt = 'Failed to load image'; }}
                              />
                            </div>
                          )}
                          {fileMode === 'binary' && (
                            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                              Binary file — preview not available
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
