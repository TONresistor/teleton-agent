import { useEffect, useState, useRef, Fragment } from 'react';
import { api, TaskData } from '../lib/api';
import { formatDate, formatDateTime, errMsg } from '../lib/utils';
import { SearchBar } from '../components/SearchBar';
import { PillTabs } from '../components/PillTabs';
import { List, ListRow } from '../components/List';
import { CodeBlock } from '../components/CodeBlock';
import { useResource } from '../hooks/useResource';
import { RefreshButton } from '../components/RefreshButton';
import { Alert } from '../components/Alert';
import { SkeletonRows } from '../components/Skeleton';
import { toast } from '../lib/toast';
import { useConfirm } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';

type TaskStatus = TaskData['status'];
type Task = TaskData;

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'var(--warning)',
  in_progress: 'var(--accent)',
  done: 'var(--green)',
  failed: 'var(--red)',
  cancelled: 'var(--text-secondary)',
  incomplete: 'var(--warning)',
  blocked: 'var(--warning)',
  unknown: 'var(--red)',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  incomplete: 'Incomplete',
  blocked: 'Blocked',
  unknown: 'Unknown',
};

const STATUSES: TaskStatus[] = ['pending', 'in_progress', 'incomplete', 'blocked', 'unknown', 'done', 'failed', 'cancelled'];

function PriorityDots({ priority }: { priority: number }) {
  if (priority === 0) return null;
  const filled = Math.min(priority, 5);
  return (
    <span className="task-prio" title={`Priority ${priority}/10`}>
      {'●'.repeat(filled)}{'○'.repeat(5 - filled)}
    </span>
  );
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function prettyJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="task-kv-label">{label}</span>
      <span className="task-kv-value">{children}</span>
    </>
  );
}

export function Tasks() {
  const confirm = useConfirm();
  const [filter, setFilter] = useState<TaskStatus | ''>('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionStatus, setResolutionStatus] = useState<'done' | 'failed' | 'cancelled'>('cancelled');
  const [resolving, setResolving] = useState(false);

  const [cleanMenuOpen, setCleanMenuOpen] = useState(false);
  const cleanRef = useRef<HTMLDivElement>(null);

  const { data: tasks, loading, error, reload, setError } = useResource<Task[]>(
    () => api.tasksList().then((r) => r.data ?? []),
    [],
  );

  const allTasks = tasks ?? [];

  // Poll only while a task is active (pending/in_progress).
  const hasActiveTask = allTasks.some((t) => t.status === 'pending' || t.status === 'in_progress');
  useEffect(() => {
    if (!hasActiveTask) return;
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [hasActiveTask, reload]);

  // Close clean dropdown on outside click.
  useEffect(() => {
    if (!cleanMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (cleanRef.current && !cleanRef.current.contains(e.target as Node)) setCleanMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [cleanMenuOpen]);

  const handleClean = async (status: TaskStatus) => {
    setCleanMenuOpen(false);
    const n = counts[status] || 0;
    if (!(await confirm({
      message: `Permanently delete all ${n} ${STATUS_LABELS[status].toLowerCase()} task${n === 1 ? '' : 's'}? This cannot be undone.`,
      destructive: true,
      confirmLabel: `Delete ${n}`,
    }))) return;
    try {
      await api.tasksClean(status);
      reload();
      toast.success('Tasks cleared');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    }
  };

  const cancelTask = async (id: string) => {
    if (!(await confirm({ message: 'Cancel this task?', confirmLabel: 'Cancel task' }))) return;
    try {
      await api.tasksCancel(id);
      reload();
      toast.success('Task cancelled');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    }
  };

  const deleteTask = async (id: string) => {
    if (!(await confirm({ message: 'Permanently delete this task?', destructive: true, confirmLabel: 'Delete' }))) return;
    try {
      await api.tasksDelete(id);
      reload();
      if (openId === id) setOpenId(null);
      toast.success('Task deleted');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    }
  };

  const resolveTask = async (task: Task) => {
    setResolving(true);
    try {
      await api.taskResolve(task.id, task.revision, resolutionStatus, resolutionNote);
      setResolutionNote('');
      reload();
      toast.success('Task resolution recorded');
    } catch (err) { setError(errMsg(err)); }
    finally { setResolving(false); }
  };

  const createNewAttempt = async (task: Task) => {
    if (!(await confirm({ message: 'Create and start a new attempt? Previous records remain available. Review all remote effects before continuing.', confirmLabel: 'Create new attempt' }))) return;
    setResolving(true);
    try { await api.taskNewAttempt(task.id, task.revision, resolutionNote); setResolutionNote(''); reload(); toast.success('New task attempt created'); }
    catch (err) { setError(errMsg(err)); }
    finally { setResolving(false); }
  };

  const counts = allTasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {} as Record<string, number>);
  const terminalStatuses = (['done', 'failed', 'cancelled'] as TaskStatus[]).filter((s) => (counts[s] || 0) > 0);

  const statusFiltered = filter ? allTasks.filter((t) => t.status === filter) : allTasks;
  const q = query.trim().toLowerCase();
  const filteredTasks = q
    ? statusFiltered.filter((t) =>
        t.description.toLowerCase().includes(q) ||
        (t.reason ?? '').toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q))
    : statusFiltered;

  const filterOptions = [
    { value: '' as const, label: `All ${allTasks.length}` },
    ...STATUSES.map((s) => ({ value: s, label: `${STATUS_LABELS[s]} ${counts[s] || 0}` })),
  ];

  return (
    <div>
      <div className="header">
        <h1>Tasks</h1>
        <p>Scheduled and queued agent tasks</p>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      {/* Filters */}
      <div style={{ marginBottom: '10px', overflowX: 'auto' }}>
        <PillTabs value={filter} options={filterOptions} onChange={setFilter} ariaLabel="Filter by status" />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ flex: 1 }}>
          <SearchBar value={query} onChange={setQuery} placeholder="Search tasks…" />
        </div>
        {terminalStatuses.length > 0 && (
          <div ref={cleanRef} style={{ position: 'relative' }}>
            <button className="btn-ghost btn-sm" onClick={() => setCleanMenuOpen((v) => !v)}>Clean</button>
            {cleanMenuOpen && (
              <div className="custom-select-menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 10, minWidth: '170px' }}>
                {terminalStatuses.map((s) => (
                  <div key={s} className="custom-select-option" onClick={() => handleClean(s)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="task-dot" style={{ background: STATUS_COLORS[s] }} />
                    {STATUS_LABELS[s]} ({counts[s]})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <RefreshButton onRefresh={reload} />
      </div>

      {loading ? (
        <SkeletonRows />
      ) : filteredTasks.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState
            title={q || filter ? 'No matching tasks' : 'No tasks yet'}
            description={
              q ? 'No tasks match your search.'
                : filter ? `No ${STATUS_LABELS[filter].toLowerCase()} tasks.`
                : 'Scheduled and queued tasks will appear here.'
            }
          />
        </div>
      ) : (
        <List>
          {filteredTasks.map((task) => {
            const isOpen = openId === task.id;
            const active = task.status === 'pending';
            const unresolved = ['unknown', 'incomplete', 'blocked'].includes(task.status);
            return (
              <Fragment key={task.id}>
                <ListRow
                  className="task-row"
                  leading={<span className={`task-dot${task.status === 'in_progress' ? ' pulse' : ''}`} style={{ background: STATUS_COLORS[task.status] }} />}
                  title={truncate(task.description, 120)}
                  subtitle={
                    <span>
                      <span style={{ color: STATUS_COLORS[task.status], fontWeight: 600 }}>{STATUS_LABELS[task.status]}</span>
                      {' · '}
                      {task.scheduledFor ? `scheduled ${formatDate(task.scheduledFor)}` : `created ${formatDate(task.createdAt)}`}
                      {task.reason ? ` · ${truncate(task.reason, 60)}` : ''}
                    </span>
                  }
                  trailing={<PriorityDots priority={task.priority} />}
                  disclosure
                  expanded={isOpen}
                  onClick={() => { setOpenId(isOpen ? null : task.id); setResolutionNote(''); setResolutionStatus('cancelled'); }}
                />
                {isOpen && (
                  <div className="ios-sublist task-detail">
                    <div className="task-kv">
                      <KV label="ID"><code>{task.id}</code></KV>
                      <KV label="Revision">{task.revision}</KV>
                      {task.legacyOutcome && <KV label="Historical outcome">Imported from an older schema; completion was not verified by the current outcome contract.</KV>}
                      {task.replacesTaskId && <KV label="Replaces task"><code>{task.replacesTaskId}</code></KV>}
                      {task.runId && <KV label="Run"><code>{task.runId}</code></KV>}
                      <KV label="Priority">{task.priority}/10</KV>
                      <KV label="Description">{task.description}</KV>
                      {task.reason && <KV label="Reason">{task.reason}</KV>}
                      <KV label="Created by">{task.createdBy || '—'}</KV>
                      <KV label="Created">{formatDateTime(task.createdAt)}</KV>
                      <KV label="Scheduled">{formatDateTime(task.scheduledFor)}</KV>
                      <KV label="Started">{formatDateTime(task.startedAt)}</KV>
                      <KV label="Completed">{formatDateTime(task.completedAt)}</KV>
                      {task.dependencies.length > 0 && <KV label="Depends on">{task.dependencies.length} task(s)</KV>}
                      {task.dependents.length > 0 && <KV label="Dependents">{task.dependents.length} task(s)</KV>}
                    </div>

                    {task.payload && (
                      <CodeBlock header="Payload" maxHeight={150}>{prettyJson(task.payload)}</CodeBlock>
                    )}
                    {task.result && (
                      <CodeBlock header={<span style={{ color: 'var(--green)' }}>Result</span>} maxHeight={200}>{truncate(task.result, 2000)}</CodeBlock>
                    )}
                    {task.error && (
                      <CodeBlock header={<span style={{ color: 'var(--red)' }}>Error</span>} maxHeight={150}>{task.error}</CodeBlock>
                    )}

                    {task.notificationError && <CodeBlock header="Notification error">{task.notificationError}</CodeBlock>}
                    {task.resolutionNote && <CodeBlock header="Review note">{task.resolutionNote}</CodeBlock>}
                    {unresolved && (
                      <form onSubmit={(event) => { event.preventDefault(); void resolveTask(task); }} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                        <p>Review the task and its operations before recording a final outcome. This records a decision without executing the task.</p>
                        <label>Outcome <select value={resolutionStatus} onChange={(event) => setResolutionStatus(event.target.value as typeof resolutionStatus)}>
                          <option value="cancelled">Cancelled</option><option value="done">Completed and verified</option><option value="failed">Failed and verified</option>
                        </select></label>
                        <label>Review evidence <textarea required maxLength={4000} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} /></label>
                        <button className="btn-ghost btn-sm" disabled={resolving || !resolutionNote.trim()}>Record resolution</button>
                      </form>
                    )}
                    {task.runs && task.runs.length > 0 && <CodeBlock header="Execution history" maxHeight={300}>{JSON.stringify(task.runs, null, 2)}</CodeBlock>}
                    {task.resolutionNote && ['incomplete', 'unknown'].includes(task.resolvedFromStatus ?? '') && (
                      <form onSubmit={(event) => { event.preventDefault(); void createNewAttempt(task); }} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                        <p>Create a separate attempt after reviewing the previous outcome and its operations.</p>
                        <label>New attempt evidence <textarea required maxLength={4000} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} /></label>
                        <button className="btn-ghost btn-sm" disabled={resolving || !resolutionNote.trim()}>Create new attempt</button>
                      </form>
                    )}
                    <div className="task-detail-actions">
                      {active && <button className="btn-ghost btn-sm" onClick={() => cancelTask(task.id)}>Cancel task</button>}
                      {['done', 'failed', 'cancelled'].includes(task.status) && !task.runs?.length && <button className="btn-danger btn-sm" onClick={() => deleteTask(task.id)}>Delete</button>}
                    </div>
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
