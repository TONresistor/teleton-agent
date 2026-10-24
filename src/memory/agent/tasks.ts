import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { TaskRow } from "../types/db-rows.js";

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "failed"
  | "cancelled"
  | "incomplete"
  | "blocked"
  | "unknown";

export interface Task {
  id: string;
  runId?: string;
  revision: number;
  legacyOutcome: boolean;
  resolvedFromStatus?: TaskStatus;
  replacesTaskId?: string;
  notificationError?: string;
  resolutionNote?: string;
  description: string;
  status: TaskStatus;
  priority: number;
  createdBy?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  scheduledFor?: Date;
  payload?: string;
  reason?: string;
  scheduledMessageId?: number;
  originSenderId?: number;
  originChatId?: string;
  originIsGroup?: boolean;
}

export interface TaskRun {
  run_id: string;
  task_id: string;
  status: TaskStatus;
  started_at: number;
  completed_at: number | null;
  turn_id: string | null;
  outcome_reason: string | null;
  result: string | null;
  error: string | null;
  resolution_status: string | null;
  resolution_note: string | null;
  resolved_at: number | null;
}

export class TaskStore {
  constructor(private db: Database.Database) {}

  recoverInterruptedTasks(): number {
    return this.db.transaction(() => {
      const interrupted = this.db
        .prepare(
          `UPDATE tasks SET status = 'unknown',
        revision = revision + 1, completed_at = unixepoch(),
        error = 'Execution interrupted; outcome unknown. Reconcile previous actions before proceeding.'
        WHERE status = 'in_progress'`
        )
        .run().changes;
      this.db
        .prepare(
          `UPDATE task_runs SET status = 'unknown', completed_at = unixepoch(),
        outcome_reason = 'interrupted', error = 'Process stopped before task outcome was persisted'
        WHERE status = 'in_progress'`
        )
        .run();
      this.blockUnfinishedDependents();
      this.releaseReadyDependents();
      return interrupted;
    })();
  }

  blockUnfinishedDependents(): void {
    let changed: number;
    do {
      changed = this.db
        .prepare(
          `UPDATE tasks SET status = 'blocked', revision = revision + 1,
        error = 'Parent task requires review before this task may execute.'
        WHERE status = 'pending' AND EXISTS (
          SELECT 1 FROM task_dependencies d JOIN tasks p ON p.id = d.depends_on_task_id
          WHERE d.task_id = tasks.id AND p.status IN ('unknown', 'incomplete', 'blocked', 'failed', 'cancelled')
        )`
        )
        .run().changes;
    } while (changed > 0);
  }

  finishTask(
    taskId: string,
    runId: string,
    revision: number,
    status: Exclude<TaskStatus, "pending" | "in_progress">,
    result?: string,
    error?: string,
    metadata?: { turnId?: string; outcomeReason?: string }
  ): Task | undefined {
    return this.db.transaction(() => {
      const changed = this.db
        .prepare(
          `UPDATE tasks SET status = ?, result = ?, error = ?,
        completed_at = unixepoch(), revision = revision + 1
        WHERE id = ? AND status = 'in_progress' AND run_id = ? AND revision = ?`
        )
        .run(status, result ?? null, error ?? null, taskId, runId, revision).changes;
      if (!changed) return undefined;
      const run = this.db
        .prepare(
          `UPDATE task_runs SET status = ?, completed_at = unixepoch(),
        turn_id = COALESCE(?, turn_id), outcome_reason = ?, result = ?, error = ? WHERE run_id = ? AND task_id = ? AND status = 'in_progress'`
        )
        .run(
          status,
          metadata?.turnId ?? null,
          metadata?.outcomeReason ?? error ?? null,
          result ?? null,
          error ?? null,
          runId,
          taskId
        );
      if (run.changes !== 1) throw new Error("Task run receipt compare-and-set failed");
      if (status !== "done") this.blockUnfinishedDependents();
      if (status === "done") this.releaseReadyDependents(taskId);
      return this.getTask(taskId);
    })();
  }

  private releaseReadyDependents(parentId?: string): void {
    this.db
      .prepare(
        `UPDATE tasks SET status = 'pending', error = NULL, revision = revision + 1
      WHERE status = 'blocked' AND run_id IS NULL
      AND error = 'Parent task requires review before this task may execute.'
      AND EXISTS (SELECT 1 FROM task_dependencies d WHERE d.task_id = tasks.id)
      AND (? IS NULL OR id IN (SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?))
      AND NOT EXISTS (SELECT 1 FROM task_dependencies d LEFT JOIN tasks p ON p.id = d.depends_on_task_id
        WHERE d.task_id = tasks.id AND (p.id IS NULL OR p.status != 'done'))`
      )
      .run(parentId ?? null, parentId ?? null);
  }

  resolveTask(
    taskId: string,
    revision: number,
    status: "done" | "failed" | "cancelled",
    note: string
  ): Task | undefined {
    return this.db.transaction(() => {
      const changed = this.db
        .prepare(
          `UPDATE tasks SET resolved_from_status = status, status = ?, resolution_note = ?,
        completed_at = unixepoch(), revision = revision + 1
        WHERE id = ? AND revision = ? AND status IN ('unknown', 'incomplete', 'blocked')`
        )
        .run(status, note, taskId, revision).changes;
      if (changed)
        this.db
          .prepare(
            `UPDATE task_runs SET resolution_status = ?, resolution_note = ?, resolved_at = unixepoch()
        WHERE run_id = (SELECT run_id FROM tasks WHERE id = ?)`
          )
          .run(status, note, taskId);
      if (changed && status === "done") this.releaseReadyDependents(taskId);
      return changed ? this.getTask(taskId) : undefined;
    })();
  }

  recordNotificationError(taskId: string, error: string): void {
    this.db.prepare("UPDATE tasks SET notification_error = ? WHERE id = ?").run(error, taskId);
  }

  createTask(task: {
    description: string;
    priority?: number;
    createdBy?: string;
    scheduledFor?: Date;
    payload?: string;
    reason?: string;
    scheduledMessageId?: number;
    originSenderId?: number;
    originChatId?: string;
    originIsGroup?: boolean;
    dependsOn?: string[];
    replacesTaskId?: string;
  }): Task {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `
      INSERT INTO tasks (
        id, description, status, priority, created_by, created_at,
        scheduled_for, payload, reason, scheduled_message_id,
        origin_sender_id, origin_chat_id, origin_is_group, replaces_task_id
      )
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        task.description,
        task.priority ?? 0,
        task.createdBy ?? null,
        now,
        task.scheduledFor ? Math.floor(task.scheduledFor.getTime() / 1000) : null,
        task.payload ?? null,
        task.reason ?? null,
        task.scheduledMessageId ?? null,
        task.originSenderId ?? null,
        task.originChatId ?? null,
        task.originIsGroup === undefined ? null : task.originIsGroup ? 1 : 0,
        task.replacesTaskId ?? null
      );

    if (task.dependsOn && task.dependsOn.length > 0) {
      for (const parentId of task.dependsOn) {
        this.addDependency(id, parentId);
      }
    }

    return {
      id,
      revision: 0,
      legacyOutcome: false,
      replacesTaskId: task.replacesTaskId,
      description: task.description,
      status: "pending",
      priority: task.priority ?? 0,
      createdBy: task.createdBy,
      createdAt: new Date(now * 1000),
      scheduledFor: task.scheduledFor,
      payload: task.payload,
      reason: task.reason,
      scheduledMessageId: task.scheduledMessageId,
      originSenderId: task.originSenderId,
      originChatId: task.originChatId,
      originIsGroup: task.originIsGroup,
    };
  }

  updateTask(
    taskId: string,
    updates: {
      description?: string;
      status?: TaskStatus;
      priority?: number;
      result?: string;
      error?: string;
    }
  ): Task | undefined {
    const task = this.getTask(taskId);
    if (!task) return undefined;

    const now = Math.floor(Date.now() / 1000);

    const updateFields: string[] = [];
    const updateValues: (string | number)[] = [];

    if (updates.description !== undefined) {
      updateFields.push("description = ?");
      updateValues.push(updates.description);
    }
    if (updates.status !== undefined) {
      updateFields.push("status = ?");
      updateValues.push(updates.status);

      if (updates.status === "in_progress" && !task.startedAt) {
        updateFields.push("started_at = ?");
        updateValues.push(now);
      }

      if (
        (updates.status === "done" ||
          updates.status === "failed" ||
          updates.status === "cancelled") &&
        !task.completedAt
      ) {
        updateFields.push("completed_at = ?");
        updateValues.push(now);
      }
    }
    if (updates.priority !== undefined) {
      updateFields.push("priority = ?");
      updateValues.push(updates.priority);
    }
    if (updates.result !== undefined) {
      updateFields.push("result = ?");
      updateValues.push(updates.result);
    }
    if (updates.error !== undefined) {
      updateFields.push("error = ?");
      updateValues.push(updates.error);
    }

    if (updateFields.length === 0) return task;

    updateValues.push(taskId, task.revision);

    const changed = this.db
      .prepare(
        `
      UPDATE tasks
      SET ${updateFields.join(", ")}, revision = revision + 1
      WHERE id = ? AND revision = ?
    `
      )
      .run(...updateValues);

    return changed.changes === 1 ? this.getTask(taskId) : undefined;
  }

  /** Map a tasks row to a Task (single source for the 13-field projection). */
  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      runId: row.run_id ?? undefined,
      revision: row.revision,
      legacyOutcome: row.legacy_outcome === 1,
      resolvedFromStatus: row.resolved_from_status as TaskStatus | undefined,
      replacesTaskId: row.replaces_task_id ?? undefined,
      notificationError: row.notification_error ?? undefined,
      resolutionNote: row.resolution_note ?? undefined,
      description: row.description,
      status: row.status as TaskStatus,
      priority: row.priority,
      createdBy: row.created_by ?? undefined,
      createdAt: new Date(row.created_at * 1000),
      startedAt: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at * 1000) : undefined,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      scheduledFor: row.scheduled_for ? new Date(row.scheduled_for * 1000) : undefined,
      payload: row.payload ?? undefined,
      reason: row.reason ?? undefined,
      scheduledMessageId: row.scheduled_message_id ?? undefined,
      originSenderId: row.origin_sender_id ?? undefined,
      originChatId: row.origin_chat_id ?? undefined,
      originIsGroup: row.origin_is_group === null ? undefined : row.origin_is_group === 1,
    };
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
    return row ? this.rowToTask(row) : undefined;
  }

  listTasks(filter?: { status?: TaskStatus; createdBy?: string }): Task[] {
    let sql = `SELECT * FROM tasks WHERE 1=1`;
    const params: (string | number)[] = [];

    if (filter?.status) {
      sql += ` AND status = ?`;
      params.push(filter.status);
    }

    if (filter?.createdBy) {
      sql += ` AND created_by = ?`;
      params.push(filter.createdBy);
    }

    sql += ` ORDER BY priority DESC, created_at ASC`;

    const rows = this.db.prepare(sql).all(...params) as TaskRow[];

    return rows.map((row) => this.rowToTask(row));
  }

  getActiveTasks(): Task[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM tasks
      WHERE status IN ('pending', 'in_progress')
      ORDER BY priority DESC, created_at ASC
    `
      )
      .all() as TaskRow[];

    return rows.map((row) => this.rowToTask(row));
  }

  deleteTask(taskId: string): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM tasks WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.task_id = tasks.id)
      AND NOT EXISTS (SELECT 1 FROM tasks replacement WHERE replacement.replaces_task_id = tasks.id)
      AND NOT EXISTS (SELECT 1 FROM task_dependencies d JOIN tasks child ON child.id = d.task_id
        WHERE d.depends_on_task_id = tasks.id AND child.status NOT IN ('done', 'failed', 'cancelled'))`
      )
      .run(taskId);
    return result.changes > 0;
  }

  completeTask(taskId: string, result?: string): Task | undefined {
    return this.updateTask(taskId, { status: "done", result });
  }

  failTask(taskId: string, error: string): Task | undefined {
    return this.updateTask(taskId, { status: "failed", error });
  }

  listTaskRuns(taskId: string): TaskRun[] {
    return this.db
      .prepare("SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC")
      .all(taskId) as TaskRun[];
  }

  createNewAttempt(taskId: string, revision: number, note: string): Task | undefined {
    return this.db.transaction(() => {
      const original = this.getTask(taskId);
      if (
        !original ||
        original.revision !== revision ||
        !original.resolutionNote ||
        !["incomplete", "unknown"].includes(original.resolvedFromStatus ?? "") ||
        !["done", "failed", "cancelled"].includes(original.status) ||
        this.db.prepare("SELECT 1 FROM tasks WHERE replaces_task_id = ?").get(taskId)
      )
        return undefined;
      // Refuse a new attempt until every ambiguous action in the originating turn is reconciled.
      const unresolved = this.db
        .prepare(
          `SELECT 1 FROM action_executions a JOIN task_runs r ON a.turn_id = r.turn_id
        WHERE r.task_id = ? AND a.status IN ('running', 'unknown') LIMIT 1`
        )
        .get(taskId);
      if (unresolved) return undefined;
      const replacement = this.createTask({
        description: original.description,
        priority: original.priority,
        createdBy: original.createdBy,
        payload: original.payload,
        reason: note,
        originSenderId: original.originSenderId,
        originChatId: original.originChatId,
        originIsGroup: original.originIsGroup,
        dependsOn: this.getDependencies(taskId),
        replacesTaskId: taskId,
      });
      this.db
        .prepare("UPDATE tasks SET revision = revision + 1 WHERE id = ? AND revision = ?")
        .run(taskId, revision);
      return replacement;
    })();
  }

  startTask(taskId: string): Task | undefined {
    return this.db.transaction(() => {
      const now = Math.floor(Date.now() / 1000);
      const runId = randomUUID();
      const claimed = this.db
        .prepare(
          `UPDATE tasks SET status = 'in_progress', started_at = ?, run_id = ?, revision = revision + 1
        WHERE id = ? AND status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM task_dependencies d LEFT JOIN tasks p ON p.id = d.depends_on_task_id
          WHERE d.task_id = tasks.id AND (p.id IS NULL OR p.status != 'done'))`
        )
        .run(now, runId, taskId);
      if (claimed.changes !== 1) return undefined;
      this.db
        .prepare(
          "INSERT INTO task_runs(run_id, task_id, status, started_at, turn_id) VALUES (?, ?, 'in_progress', ?, ?)"
        )
        .run(runId, taskId, now, `task:${taskId}:${runId}`);
      return this.getTask(taskId);
    })();
  }

  cancelTask(taskId: string): Task | undefined {
    const changed = this.db
      .prepare(
        `UPDATE tasks SET status = 'cancelled', completed_at = unixepoch(),
      revision = revision + 1 WHERE id = ? AND status = 'pending'`
      )
      .run(taskId).changes;
    return changed ? this.getTask(taskId) : undefined;
  }

  /**
   * Check if adding a dependency would create a cycle.
   * Uses BFS to traverse the dependency graph.
   */
  private wouldCreateCycle(taskId: string, newParentId: string): boolean {
    if (taskId === newParentId) {
      return true;
    }

    const visited = new Set<string>();
    const queue = [newParentId];

    while (queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- checked length > 0 above
      const current = queue.shift()!;

      if (current === taskId) {
        return true;
      }

      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const deps = this.getDependencies(current);
      queue.push(...deps);
    }

    return false;
  }

  addDependency(taskId: string, parentTaskId: string): void {
    if (this.wouldCreateCycle(taskId, parentTaskId)) {
      throw new Error(
        `Cannot add dependency: would create circular dependency (${taskId} → ${parentTaskId})`
      );
    }

    this.db
      .prepare(
        `INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`
      )
      .run(taskId, parentTaskId);
  }

  getDependencies(taskId: string): string[] {
    const rows = this.db
      .prepare(`SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?`)
      .all(taskId) as Array<{ depends_on_task_id: string }>;

    return rows.map((r) => r.depends_on_task_id);
  }

  getDependents(taskId: string): string[] {
    const rows = this.db
      .prepare(`SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?`)
      .all(taskId) as Array<{ task_id: string }>;

    return rows.map((r) => r.task_id);
  }

  /**
   * Check if a task can execute (all dependencies are done).
   * Uses a single JOIN query instead of N+1 queries.
   */
  canExecute(taskId: string): boolean {
    const result = this.db
      .prepare(
        `
        SELECT COUNT(*) as pending_count
        FROM task_dependencies td
        LEFT JOIN tasks t ON td.depends_on_task_id = t.id
        WHERE td.task_id = ?
          AND (t.id IS NULL OR t.status != 'done')
      `
      )
      .get(taskId) as { pending_count: number };

    return result.pending_count === 0;
  }

  /**
   * Get all parent task results for a dependent task.
   * Uses a single JOIN query instead of N+1 queries.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- result is JSON-parsed dynamic data
  getParentResults(taskId: string): Array<{ taskId: string; description: string; result: any }> {
    const rows = this.db
      .prepare(
        `
        SELECT t.id, t.description, t.result
        FROM task_dependencies td
        JOIN tasks t ON td.depends_on_task_id = t.id
        WHERE td.task_id = ?
          AND t.status = 'done'
          AND t.result IS NOT NULL
      `
      )
      .all(taskId) as Array<{ id: string; description: string; result: string }>;

    return rows.map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON.parse returns unknown structure
      let parsedResult: any;
      try {
        parsedResult = JSON.parse(row.result);
      } catch {
        parsedResult = row.result;
      }
      return {
        taskId: row.id,
        description: row.description,
        result: parsedResult,
      };
    });
  }
}

const instances = new WeakMap<Database.Database, TaskStore>();

export function getTaskStore(db: Database.Database): TaskStore {
  let store = instances.get(db);
  if (!store) {
    store = new TaskStore(db);
    instances.set(db, store);
  }
  return store;
}
