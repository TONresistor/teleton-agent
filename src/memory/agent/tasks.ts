import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { TaskRow } from "../types/db-rows.js";

export type TaskStatus = "pending" | "in_progress" | "done" | "failed" | "cancelled";

export interface Task {
  id: string;
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

export class TaskStore {
  constructor(private db: Database.Database) {}

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
  }): Task {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `
      INSERT INTO tasks (
        id, description, status, priority, created_by, created_at,
        scheduled_for, payload, reason, scheduled_message_id,
        origin_sender_id, origin_chat_id, origin_is_group
      )
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        task.originIsGroup === undefined ? null : task.originIsGroup ? 1 : 0
      );

    if (task.dependsOn && task.dependsOn.length > 0) {
      for (const parentId of task.dependsOn) {
        this.addDependency(id, parentId);
      }
    }

    return {
      id,
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

    updateValues.push(taskId);

    this.db
      .prepare(
        `
      UPDATE tasks
      SET ${updateFields.join(", ")}
      WHERE id = ?
    `
      )
      .run(...updateValues);

    return this.getTask(taskId);
  }

  /** Map a tasks row to a Task (single source for the 13-field projection). */
  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
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
    const result = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
    return result.changes > 0;
  }

  completeTask(taskId: string, result?: string): Task | undefined {
    return this.updateTask(taskId, { status: "done", result });
  }

  failTask(taskId: string, error: string): Task | undefined {
    return this.updateTask(taskId, { status: "failed", error });
  }

  startTask(taskId: string): Task | undefined {
    return this.updateTask(taskId, { status: "in_progress" });
  }

  cancelTask(taskId: string): Task | undefined {
    return this.updateTask(taskId, { status: "cancelled" });
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
