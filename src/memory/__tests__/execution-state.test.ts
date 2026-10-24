import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema, runMigrations, setSchemaVersion } from "../schema.js";
import { TaskStore } from "../agent/tasks.js";
import {
  completeActionExecution,
  listActionExecutions,
  reserveActionExecution,
  resolveActionExecution,
} from "../action-executions.js";

describe("durable execution state", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
  });
  afterEach(() => db.close());

  it("keeps incomplete work from releasing descendants and rejects stale run completion", () => {
    const store = new TaskStore(db);
    const parent = store.createTask({ description: "run to budget" });
    const child = store.createTask({ description: "after success", dependsOn: [parent.id] });
    const run = store.startTask(parent.id)!;
    expect(store.finishTask(parent.id, "wrong-run", run.revision, "done")).toBeUndefined();
    expect(
      store.finishTask(
        parent.id,
        run.runId!,
        run.revision,
        "incomplete",
        "partial",
        "iteration_budget"
      )?.status
    ).toBe("incomplete");
    expect(store.getTask(child.id)?.status).toBe("blocked");
    expect(store.canExecute(child.id)).toBe(false);
    expect(store.startTask(child.id)).toBeUndefined();
    expect(store.finishTask(parent.id, run.runId!, run.revision, "done")).toBeUndefined();
    const reviewed = store.getTask(parent.id)!;
    expect(store.resolveTask(parent.id, run.revision, "done", "stale review")).toBeUndefined();
    expect(
      store.resolveTask(parent.id, reviewed.revision, "done", "verified remotely")?.status
    ).toBe("done");
    expect(store.getTask(child.id)?.status).toBe("pending");
    expect(store.deleteTask(parent.id)).toBe(false);
  });

  it("does not overwrite completed work when notification fails or a cancellation races", () => {
    const store = new TaskStore(db);
    const task = store.createTask({ description: "effect" });
    const run = store.startTask(task.id)!;
    expect(store.cancelTask(task.id)).toBeUndefined();
    store.finishTask(task.id, run.runId!, run.revision, "done", "confirmed");
    store.recordNotificationError(task.id, "send failed");
    expect(store.getTask(task.id)).toMatchObject({
      status: "done",
      result: "confirmed",
      notificationError: "send failed",
    });
  });

  it("retains old unknown actions, blocks them across turns, and resolves only the reviewed revision", () => {
    const first = reserveActionExecution(
      db,
      "one",
      "send",
      { x: 1 },
      { logicalSessionKey: "chat" }
    );
    if (first.kind !== "execute") throw new Error("reservation missing");
    completeActionExecution(db, "one", "send", first.argsHash, {
      success: false,
      execution: { outcome: "unknown" },
    });
    db.prepare("UPDATE action_executions SET started_at = 0").run();
    expect(
      reserveActionExecution(db, "two", "send", { x: 1 }, { logicalSessionKey: "chat" })
    ).toMatchObject({ kind: "unknown", operationId: first.operationId });
    const operation = listActionExecutions(db)[0];
    expect(
      resolveActionExecution(db, first.operationId, operation.revision + 1, "succeeded", "stale")
    ).toBe(false);
    expect(
      resolveActionExecution(
        db,
        first.operationId,
        operation.revision,
        "succeeded",
        "remote receipt"
      )
    ).toBe(true);
    expect(
      reserveActionExecution(db, "two", "send", { x: 1 }, { logicalSessionKey: "chat" }).kind
    ).toBe("execute");
  });

  it("migrates legacy CHECK constraints without losing dependencies, indexes, or creator authority", () => {
    db.pragma("foreign_keys = OFF");
    db.exec(`DROP TABLE tasks; CREATE TABLE tasks (
      id TEXT PRIMARY KEY, description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done','failed','cancelled')),
      priority INTEGER DEFAULT 0, created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER, completed_at INTEGER, result TEXT, error TEXT, scheduled_for INTEGER,
      payload TEXT, reason TEXT, scheduled_message_id INTEGER, origin_sender_id INTEGER,
      origin_chat_id TEXT, origin_is_group INTEGER CHECK(origin_is_group IN (0,1))
    );
    INSERT INTO tasks(id,description,origin_sender_id,origin_chat_id,origin_is_group) VALUES('parent','p',123,'chat',0),('child','c',123,'chat',0);
    INSERT INTO task_dependencies VALUES('child','parent');
    DROP TABLE action_executions;
    CREATE TABLE action_executions(turn_id TEXT,tool_name TEXT,args_hash TEXT,status TEXT,result_json TEXT,started_at INTEGER,completed_at INTEGER, PRIMARY KEY(turn_id,tool_name,args_hash));
    INSERT INTO action_executions VALUES('t','send','h','failed','{"success":false}',0,1),('u','send','g','running',NULL,0,NULL);`);
    db.pragma("foreign_keys = ON");
    setSchemaVersion(db, "1.26.0");
    runMigrations(db);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT * FROM task_dependencies").all()).toEqual([
      { task_id: "child", depends_on_task_id: "parent" },
    ]);
    const store = new TaskStore(db);
    expect(store.getTask("parent")).toMatchObject({
      originSenderId: 123,
      originChatId: "chat",
      revision: 0,
    });
    expect(store.updateTask("parent", { status: "unknown" })?.status).toBe("unknown");
    expect(listActionExecutions(db).map((operation) => operation.status)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(
      (db.prepare("PRAGMA index_list(tasks)").all() as Array<{ name: string }>).map(
        (index) => index.name
      )
    ).toContain("idx_tasks_status");
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('turn_ingress','response_deliveries','model_attempts')"
        )
        .all()
    ).toHaveLength(3);
  });
  it("atomically records runs and retains original unknown history after resolution and a new attempt", () => {
    const store = new TaskStore(db);
    const task = store.createTask({
      description: "reviewed retry",
      originSenderId: 123,
      originChatId: "123",
      originIsGroup: false,
    });
    const run = store.startTask(task.id)!;
    expect(store.listTaskRuns(task.id)).toMatchObject([
      { run_id: run.runId, status: "in_progress", turn_id: `task:${task.id}:${run.runId}` },
    ]);
    expect(store.createNewAttempt(task.id, run.revision, "not reviewed")).toBeUndefined();
    db.exec(
      "CREATE TRIGGER reject_run_update BEFORE UPDATE ON task_runs BEGIN SELECT RAISE(ABORT, 'run write failed'); END;"
    );
    expect(() => store.finishTask(task.id, run.runId!, run.revision, "unknown")).toThrow(
      "run write failed"
    );
    expect(store.getTask(task.id)?.status).toBe("in_progress");
    db.exec("DROP TRIGGER reject_run_update;");
    const finished = store.finishTask(
      task.id,
      run.runId!,
      run.revision,
      "unknown",
      "partial",
      "remote response lost"
    )!;
    const reviewed = store.resolveTask(
      task.id,
      finished.revision,
      "cancelled",
      "verified remote state"
    )!;
    const replacement = store.createNewAttempt(
      task.id,
      reviewed.revision,
      "new operator intention"
    )!;
    expect(replacement).toMatchObject({
      replacesTaskId: task.id,
      status: "pending",
      legacyOutcome: false,
    });
    expect(store.getTask(task.id)?.status).toBe("cancelled");
    expect(store.listTaskRuns(task.id)).toMatchObject([
      {
        status: "unknown",
        result: "partial",
        error: "remote response lost",
        resolution_status: "cancelled",
        resolution_note: "verified remote state",
      },
    ]);
    expect(
      store.createNewAttempt(task.id, store.getTask(task.id)!.revision, "duplicate click")
    ).toBeUndefined();
    expect(store.deleteTask(task.id)).toBe(false);
  });
});
