import { useEffect, useState, Fragment } from 'react';
import { api, FileEntry, WorkspaceInfo } from '../lib/api';
import { formatDate, errMsg } from '../lib/utils';
import { useResource } from '../hooks/useResource';
import { toast } from '../lib/toast';
import { useConfirm } from '../components/ConfirmDialog';
import { List, ListRow } from '../components/List';
import { Menu } from '../components/Menu';
import { Alert } from '../components/Alert';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { RefreshButton } from '../components/RefreshButton';
import folderBadge from '../assets/memory-folder.svg';
import fileBadge from '../assets/workspace-file.svg';

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const BINARY_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'bin', 'exe', 'dll', 'so', 'db', 'sqlite', 'wasm', 'pdf']);

function getExtension(path: string): string {
  return path.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
}
const isImageFile = (p: string) => IMAGE_EXTENSIONS.has(getExtension(p));
const isBinaryFile = (p: string) => BINARY_EXTENSIONS.has(getExtension(p));

const FolderIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 7a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8l.6.8a1 1 0 0 0 .8.4H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
  </svg>
);
const DocIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 3h6l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
  </svg>
);
const PencilIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </svg>
);
const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </svg>
);
const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export function Workspace() {
  const confirm = useConfirm();
  const [currentPath, setCurrentPath] = useState('');

  const { data: dirData, loading, error, reload, setError } = useResource(
    () => api.workspaceList(currentPath).then((r) => r.data),
    [currentPath],
  );

  const entries: FileEntry[] = dirData?.entries ?? [];
  const sorted = [...entries].sort((a, b) =>
    a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1,
  );

  const [info, setInfo] = useState<WorkspaceInfo | null>(null);

  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editDirty, setEditDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileMode, setFileMode] = useState<'text' | 'image' | 'binary'>('text');

  const [dialog, setDialog] = useState<{ type: 'newFile' | 'newFolder' | 'rename'; target?: string } | null>(null);
  const [dialogInput, setDialogInput] = useState('');

  const refreshInfo = () => api.workspaceInfo().then((r) => setInfo(r.data ?? null)).catch(() => {});

  useEffect(() => { refreshInfo(); }, []);

  useEffect(() => {
    if (!editDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editDirty]);

  const breadcrumbs = currentPath ? currentPath.split('/') : [];

  const resetEditor = () => {
    setEditingFile(null);
    setEditContent('');
    setEditDirty(false);
    setFileMode('text');
  };

  const closeEditor = async (): Promise<boolean> => {
    if (fileMode === 'text' && editDirty &&
        !(await confirm({ message: 'Discard unsaved changes?', confirmLabel: 'Discard', destructive: true }))) {
      return false;
    }
    resetEditor();
    return true;
  };

  const navigateTo = async (path: string) => {
    if (!(await closeEditor())) return;
    setCurrentPath(path);
  };

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
      setError(errMsg(err));
    }
  };

  const handleFileClick = async (path: string) => {
    if (editingFile === path) { await closeEditor(); return; }
    if (!(await closeEditor())) return;
    openFile(path);
  };

  const saveFile = async () => {
    if (!editingFile) return;
    setSaving(true);
    try {
      await api.workspaceWrite(editingFile, editContent);
      setEditDirty(false);
      reload();
      toast.success('Saved');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (entry: FileEntry) => {
    const label = entry.isDirectory ? 'directory' : 'file';
    if (!(await confirm({ message: `Delete ${label} "${entry.name}"?`, destructive: true, confirmLabel: 'Delete' }))) return;
    try {
      await api.workspaceDelete(entry.path, entry.isDirectory);
      if (editingFile === entry.path) resetEditor();
      reload();
      refreshInfo();
      toast.success('Deleted');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    }
  };

  const openDialog = (type: 'newFile' | 'newFolder' | 'rename', target?: string) => {
    setDialog({ type, target });
    setDialogInput(type === 'rename' ? target?.split('/').pop() ?? '' : '');
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
        await api.workspaceRename(dialog.target, fullPath);
        if (editingFile === dialog.target) resetEditor();
      }
      setDialog(null);
      setDialogInput('');
      reload();
      refreshInfo();
      toast.success(dialog.type === 'rename' ? 'Renamed' : 'Created');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    }
  };

  const dialogLabel = dialog?.type === 'newFile' ? 'New file' : dialog?.type === 'newFolder' ? 'New folder' : 'Rename to';

  return (
    <div>
      <div className="header">
        <h1>Workspace</h1>
        <p>{info ? `${info.totalFiles} files · ${formatSize(info.totalSize)}` : 'Agent workspace files'}</p>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      <div className="ws-path">
        <nav className="ws-crumbs" aria-label="Path">
          <button className={`ws-crumb${currentPath ? '' : ' current'}`} onClick={() => void navigateTo('')}>workspace</button>
          {breadcrumbs.map((seg, i) => {
            const path = breadcrumbs.slice(0, i + 1).join('/');
            const isLast = i === breadcrumbs.length - 1;
            return (
              <Fragment key={path}>
                <span className="ws-crumb-sep">/</span>
                <button
                  className={`ws-crumb${isLast ? ' current' : ''}`}
                  onClick={() => !isLast && void navigateTo(path)}
                >
                  {seg}
                </button>
              </Fragment>
            );
          })}
        </nav>
        <Menu
          ariaLabel="New"
          triggerClassName="ws-add"
          trigger={<PlusIcon />}
          items={[
            { label: 'New File', icon: <DocIcon />, onClick: () => openDialog('newFile') },
            { label: 'New Folder', icon: <FolderIcon />, onClick: () => openDialog('newFolder') },
          ]}
        />
        <RefreshButton onRefresh={reload} />
      </div>

      {dialog && (
        <div className="ws-prompt">
          <span className="ws-prompt-label">{dialogLabel}</span>
          <input
            type="text"
            value={dialogInput}
            onChange={(e) => setDialogInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleDialogSubmit(); if (e.key === 'Escape') setDialog(null); }}
            placeholder="name…"
            autoFocus
          />
          <button className="btn-sm" onClick={handleDialogSubmit}>OK</button>
          <button className="btn-ghost btn-sm" onClick={() => setDialog(null)}>Cancel</button>
        </div>
      )}

      {loading ? (
        <SkeletonRows />
      ) : sorted.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState title="Empty directory" description="This folder has no files." />
        </div>
      ) : (
        <List>
          {sorted.map((entry) => {
            const isExpanded = !entry.isDirectory && editingFile === entry.path;
            const actions = (
              <div className="ws-row-actions">
                <button className="ws-act" aria-label="Rename" title="Rename"
                  onClick={() => openDialog('rename', entry.path)}><PencilIcon /></button>
                <button className="ws-act delete" aria-label="Delete" title="Delete"
                  onClick={() => deleteEntry(entry)}><TrashIcon /></button>
              </div>
            );
            return (
              <Fragment key={entry.path}>
                <ListRow
                  leading={<img src={entry.isDirectory ? folderBadge : fileBadge} alt="" aria-hidden="true" />}
                  leadingClassName="file-type-icon"
                  title={entry.name}
                  subtitle={entry.isDirectory ? 'Folder' : `${formatSize(entry.size)} · ${formatDate(entry.mtime)}`}
                  trailing={actions}
                  disclosure
                  expanded={isExpanded}
                  insetSeparator
                  onClick={() => entry.isDirectory ? void navigateTo(entry.path) : void handleFileClick(entry.path)}
                />
                {isExpanded && (
                  <div className="ios-sublist" style={{ padding: '12px 16px 16px' }}>
                    <div className="ws-editor-head">
                      <span className="ws-editor-name">
                        {editingFile}
                        {fileMode === 'text' && editDirty && <span className="dot">•</span>}
                      </span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {fileMode === 'text' && (
                          <button className="btn-sm" onClick={saveFile} disabled={saving || !editDirty}>
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        )}
                        <button className="btn-ghost btn-sm" onClick={() => void closeEditor()}>Close</button>
                      </div>
                    </div>
                    {fileMode === 'text' && (
                      <textarea
                        className="ws-editor"
                        value={editContent}
                        onChange={(e) => { setEditContent(e.target.value); setEditDirty(true); }}
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
                        }}
                        spellCheck={false}
                      />
                    )}
                    {fileMode === 'image' && editingFile && (
                      <div className="ws-preview">
                        <img
                          src={api.workspaceRawUrl(editingFile)}
                          alt={editingFile}
                          onError={(e) => { (e.target as HTMLImageElement).alt = 'Failed to load image'; }}
                        />
                      </div>
                    )}
                    {fileMode === 'binary' && <div className="ws-binary">Binary file — preview not available</div>}
                  </div>
                )}
              </Fragment>
            );
          })}
        </List>
      )}
    </div>
  );
}
