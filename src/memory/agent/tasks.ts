import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

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
}

/**
 * Manage agent tasks
 */
export class TaskStore {
  constructor(private db: Database.Database) {}

  /**
   * Create a new task
   */
  createTask(task: {
    description: string;
    priority?: number;
    createdBy?: string;
    scheduledFor?: Date;
    payload?: string;
    reason?: string;
    scheduledMessageId?: number;
    dependsOn?: string[];
  }): Task {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `
      INSERT INTO tasks (id, description, status, priority, created_by, created_at, scheduled_for, payload, reason, scheduled_message_id)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
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
        task.scheduledMessageId ?? null
      );

    // Add dependencies if provided (with cycle detection)
    if (task.dependsOn && task.dependsOn.length > 0) {
      for (const parentId of task.dependsOn) {
        // This will throw if cycle detected
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
    };
  }

  /**
   * Update a task
   */
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

    // Build dynamic update query
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (updates.description !== undefined) {
      updateFields.push("description = ?");
      updateValues.push(updates.description);
    }
    if (updates.status !== undefined) {
      updateFields.push("status = ?");
      updateValues.push(updates.status);

      // Auto-set started_at when status changes to in_progress
      if (updates.status === "in_progress" && !task.startedAt) {
        updateFields.push("started_at = ?");
        updateValues.push(now);
      }

      // Auto-set completed_at when status changes to done/failed/cancelled
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

  /**
   * Get a task by ID
   */
  getTask(id: string): Task | undefined {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      description: row.description,
      status: row.status as TaskStatus,
      priority: row.priority,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at * 1000),
      startedAt: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at * 1000) : undefined,
      result: row.result,
      error: row.error,
      scheduledFor: row.scheduled_for ? new Date(row.scheduled_for * 1000) : undefined,
      payload: row.payload,
      reason: row.reason,
      scheduledMessageId: row.scheduled_message_id,
    };
  }

  /**
   * List tasks with optional filters
   */
  listTasks(filter?: { status?: TaskStatus; createdBy?: string }): Task[] {
    let sql = `SELECT * FROM tasks WHERE 1=1`;
    const params: any[] = [];

    if (filter?.status) {
      sql += ` AND status = ?`;
      params.push(filter.status);
    }

    if (filter?.createdBy) {
      sql += ` AND created_by = ?`;
      params.push(filter.createdBy);
    }

    sql += ` ORDER BY priority DESC, created_at ASC`;

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      status: row.status as TaskStatus,
      priority: row.priority,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at * 1000),
      startedAt: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at * 1000) : undefined,
      result: row.result,
      error: row.error,
      scheduledFor: row.scheduled_for ? new Date(row.scheduled_for * 1000) : undefined,
      payload: row.payload,
      reason: row.reason,
      scheduledMessageId: row.scheduled_message_id,
    }));
  }

  /**
   * Get active (pending or in_progress) tasks
   */
  getActiveTasks(): Task[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM tasks
      WHERE status IN ('pending', 'in_progress')
      ORDER BY priority DESC, created_at ASC
    `
      )
      .all() as any[];

    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      status: row.status as TaskStatus,
      priority: row.priority,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at * 1000),
      startedAt: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at * 1000) : undefined,
      result: row.result,
      error: row.error,
      scheduledFor: row.scheduled_for ? new Date(row.scheduled_for * 1000) : undefined,
      payload: row.payload,
      reason: row.reason,
      scheduledMessageId: row.scheduled_message_id,
    }));
  }

  /**
   * Delete a task
   */
  deleteTask(taskId: string): boolean {
    const result = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
    return result.changes > 0;
  }

  /**
   * Mark task as done
   */
  completeTask(taskId: string, result?: string): Task | undefined {
    return this.updateTask(taskId, { status: "done", result });
  }

  /**
   * Mark task as failed
   */
  failTask(taskId: string, error: string): Task | undefined {
    return this.updateTask(taskId, { status: "failed", error });
  }

  /**
   * Start a task
   */
  startTask(taskId: string): Task | undefined {
    return this.updateTask(taskId, { status: "in_progress" });
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): Task | undefined {
    return this.updateTask(taskId, { status: "cancelled" });
  }

  /**
   * Check if adding a dependency would create a cycle
   * Uses BFS to traverse dependency graph
   */
  private wouldCreateCycle(taskId: string, newParentId: string): boolean {
    // Direct self-dependency
    if (taskId === newParentId) {
      return true;
    }

    // BFS to detect indirect cycles
    const visited = new Set<string>();
    const queue = [newParentId];

    while (queue.length > 0) {
      const current = queue.shift()!;

      // If we reach back to taskId, we have a cycle
      if (current === taskId) {
        return true;
      }

      // Skip if already visited (avoid infinite loop on existing cycles)
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      // Add all dependencies of current to queue
      const deps = this.getDependencies(current);
      queue.push(...deps);
    }

    return false;
  }

  /**
   * Add a dependency (taskId depends on parentTaskId)
   * Throws error if would create circular dependency
   */
  addDependency(taskId: string, parentTaskId: string): void {
    // Check for cycles before adding
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

  /**
   * Get all tasks that this task depends on
   */
  getDependencies(taskId: string): string[] {
    const rows = this.db
      .prepare(`SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?`)
      .all(taskId) as Array<{ depends_on_task_id: string }>;

    return rows.map((r) => r.depends_on_task_id);
  }

  /**
   * Get all tasks that depend on this task
   */
  getDependents(taskId: string): string[] {
    const rows = this.db
      .prepare(`SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?`)
      .all(taskId) as Array<{ task_id: string }>;

    return rows.map((r) => r.task_id);
  }

  /**
   * Check if a task can execute (all dependencies are done)
   * Optimized: Single query with JOIN instead of N+1 queries
   */
  canExecute(taskId: string): boolean {
    // Single query: count dependencies that are NOT done
    // If count > 0, task cannot execute
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
   * Get all parent task results for a dependent task
   * Optimized: Single query with JOIN instead of N+1 queries
   */
  getParentResults(taskId: string): Array<{ taskId: string; description: string; result: any }> {
    // Single query with JOIN to get all parent results
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
      let parsedResult: any;
      try {
        parsedResult = JSON.parse(row.result);
      } catch (e) {
        // If result is not JSON, use as string
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

// Singleton instance cache (keyed by db path to support multiple databases in testing)
const instances = new WeakMap<Database.Database, TaskStore>();

/**
 * Get or create a TaskStore instance for the given database.
 * Uses singleton pattern to avoid creating multiple instances per database.
 */
export function getTaskStore(db: Database.Database): TaskStore {
  let store = instances.get(db);
  if (!store) {
    store = new TaskStore(db);
    instances.set(db, store);
  }
  return store;
}
