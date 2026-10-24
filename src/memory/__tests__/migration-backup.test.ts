import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryDatabase } from "../database.js";
import { getSchemaVersion } from "../schema.js";

function legacyDatabase(path: string) {
  const db = new Database(path);
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER DEFAULT (unixepoch()));
    INSERT INTO meta(key,value) VALUES('schema_version','1.26.0');
    CREATE TABLE tasks(id TEXT PRIMARY KEY,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','in_progress','done','failed','cancelled')),priority INTEGER DEFAULT 0,
      created_by TEXT,created_at INTEGER NOT NULL DEFAULT (unixepoch()),started_at INTEGER,completed_at INTEGER,
      result TEXT,error TEXT,scheduled_for INTEGER,payload TEXT,reason TEXT,scheduled_message_id INTEGER,
      origin_sender_id INTEGER,origin_chat_id TEXT,origin_is_group INTEGER CHECK(origin_is_group IN (0,1)));
    INSERT INTO tasks(id,description,status,origin_sender_id,origin_chat_id,origin_is_group)
      VALUES('parent','historical success','done',123,'chat',0),('child','dependent','pending',123,'chat',0);
    CREATE TABLE task_dependencies(task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,PRIMARY KEY(task_id,depends_on_task_id));
    INSERT INTO task_dependencies VALUES('child','parent');
    CREATE TABLE action_executions(turn_id TEXT NOT NULL,tool_name TEXT NOT NULL,args_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','unknown')),result_json TEXT,
      started_at INTEGER NOT NULL,completed_at INTEGER,PRIMARY KEY(turn_id,tool_name,args_hash));
    INSERT INTO action_executions VALUES('oldturn','send','hash','failed','{"success":false,"error":"historical"}',1,2);`);
  db.close();
}

describe("pre-migration backups", () => {
  let directory: string;
  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  it("backs up the actual 1.26 database before startup migration and retains dependencies/provenance", () => {
    directory = mkdtempSync(join(tmpdir(), "teleton-migration-"));
    const path = join(directory, "memory.db");
    legacyDatabase(path);
    const memory = new MemoryDatabase({ path, enableVectorSearch: false });
    try {
      const db = memory.getDb();
      expect(getSchemaVersion(db)).toBe("1.27.0");
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(db.prepare("SELECT * FROM task_dependencies").all()).toEqual([
        { task_id: "child", depends_on_task_id: "parent" },
      ]);
      expect(db.prepare("SELECT legacy_outcome FROM tasks WHERE id='parent'").get()).toEqual({
        legacy_outcome: 1,
      });
      expect(
        db
          .prepare(
            "SELECT status,legacy_outcome,result_json,legacy_result_json FROM action_executions"
          )
          .get()
      ).toEqual({
        status: "unknown",
        legacy_outcome: 1,
        result_json: '{"success":false,"error":"historical"}',
        legacy_result_json: '{"success":false,"error":"historical"}',
      });
      const backups = readdirSync(directory).filter((name) => name.endsWith(".bak"));
      expect(backups).toHaveLength(1);
      const backupPath = join(directory, backups[0]);
      expect(statSync(backupPath).mode & 0o777).toBe(0o600);
      const backup = new Database(backupPath, { readonly: true });
      try {
        expect(getSchemaVersion(backup)).toBe("1.26.0");
        expect(backup.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 2 });
        expect(backup.prepare("SELECT COUNT(*) AS n FROM task_dependencies").get()).toEqual({
          n: 1,
        });
        expect(backup.prepare("SELECT status FROM action_executions").get()).toEqual({
          status: "failed",
        });
      } finally {
        backup.close();
      }
    } finally {
      memory.close();
    }
  });
  it("aborts startup without migrating when a private backup cannot be created", () => {
    directory = mkdtempSync(join(tmpdir(), "teleton-backup-failure-"));
    // The original filename is valid; its required unique backup suffix exceeds NAME_MAX.
    const path = join(directory, "a".repeat(235) + ".db");
    legacyDatabase(path);
    expect(() => new MemoryDatabase({ path, enableVectorSearch: false })).toThrow();
    const original = new Database(path, { readonly: true });
    try {
      expect(getSchemaVersion(original)).toBe("1.26.0");
      expect(original.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 2 });
    } finally {
      original.close();
    }
  });
});
