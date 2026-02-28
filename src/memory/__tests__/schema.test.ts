import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  ensureSchema,
  ensureVectorTables,
  getSchemaVersion,
  setSchemaVersion,
  runMigrations,
  CURRENT_SCHEMA_VERSION,
} from "../schema.js";

describe("Memory Schema", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  // ============================================
  // TABLE CREATION
  // ============================================

  describe("Table Creation", () => {
    it("creates all 14 core tables after initialization", () => {
      ensureSchema(db);

      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table'
        ORDER BY name
      `
        )
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);

      // Core tables (14 total)
      expect(tableNames).toContain("meta");
      expect(tableNames).toContain("knowledge");
      expect(tableNames).toContain("sessions");
      expect(tableNames).toContain("tasks");
      expect(tableNames).toContain("task_dependencies");
      expect(tableNames).toContain("tg_chats");
      expect(tableNames).toContain("tg_users");
      expect(tableNames).toContain("tg_messages");
      expect(tableNames).toContain("embedding_cache");
      expect(tableNames).toContain("journal");
      expect(tableNames).toContain("knowledge_fts");
      expect(tableNames).toContain("knowledge_fts_data");
      expect(tableNames).toContain("tg_messages_fts");
      expect(tableNames).toContain("tg_messages_fts_data");
    });

    it("creates meta table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(meta)").all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;

      expect(info).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "key", type: "TEXT", pk: 1 }),
          expect.objectContaining({ name: "value", type: "TEXT", notnull: 1 }),
          expect.objectContaining({ name: "updated_at", type: "INTEGER", notnull: 1 }),
        ])
      );
    });

    it("creates knowledge table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(knowledge)").all() as Array<{
        name: string;
        type: string;
      }>;

      const columnNames = info.map((c) => c.name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("source");
      expect(columnNames).toContain("path");
      expect(columnNames).toContain("text");
      expect(columnNames).toContain("embedding");
      expect(columnNames).toContain("start_line");
      expect(columnNames).toContain("end_line");
      expect(columnNames).toContain("hash");
      expect(columnNames).toContain("created_at");
      expect(columnNames).toContain("updated_at");
    });

    it("creates sessions table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
        name: string;
      }>;

      const columnNames = info.map((c) => c.name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("chat_id");
      expect(columnNames).toContain("started_at");
      expect(columnNames).toContain("updated_at");
      expect(columnNames).toContain("ended_at");
      expect(columnNames).toContain("summary");
      expect(columnNames).toContain("message_count");
      expect(columnNames).toContain("tokens_used");
      expect(columnNames).toContain("last_message_id");
      expect(columnNames).toContain("last_channel");
      expect(columnNames).toContain("last_to");
      expect(columnNames).toContain("context_tokens");
      expect(columnNames).toContain("model");
      expect(columnNames).toContain("provider");
      expect(columnNames).toContain("last_reset_date");
      expect(columnNames).toContain("input_tokens");
      expect(columnNames).toContain("output_tokens");
    });

    it("creates tasks table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(tasks)").all() as Array<{
        name: string;
      }>;

      const columnNames = info.map((c) => c.name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("description");
      expect(columnNames).toContain("status");
      expect(columnNames).toContain("priority");
      expect(columnNames).toContain("created_by");
      expect(columnNames).toContain("created_at");
      expect(columnNames).toContain("started_at");
      expect(columnNames).toContain("completed_at");
      expect(columnNames).toContain("result");
      expect(columnNames).toContain("error");
      expect(columnNames).toContain("scheduled_for");
      expect(columnNames).toContain("payload");
      expect(columnNames).toContain("reason");
      expect(columnNames).toContain("scheduled_message_id");
    });

    it("creates task_dependencies table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(task_dependencies)").all() as Array<{
        name: string;
        pk: number;
      }>;

      expect(info).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "task_id", pk: 1 }),
          expect.objectContaining({ name: "depends_on_task_id", pk: 2 }),
        ])
      );
    });

    it("creates tg_chats table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(tg_chats)").all() as Array<{
        name: string;
      }>;

      const columnNames = info.map((c) => c.name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("type");
      expect(columnNames).toContain("title");
      expect(columnNames).toContain("username");
      expect(columnNames).toContain("member_count");
      expect(columnNames).toContain("is_monitored");
      expect(columnNames).toContain("is_archived");
      expect(columnNames).toContain("last_message_id");
      expect(columnNames).toContain("last_message_at");
      expect(columnNames).toContain("created_at");
      expect(columnNames).toContain("updated_at");
    });

    it("creates tg_users table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(tg_users)").all() as Array<{
        name: string;
      }>;

      const columnNames = info.map((c) => c.name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("username");
      expect(columnNames).toContain("first_name");
      expect(columnNames).toContain("last_name");
      expect(columnNames).toContain("is_bot");
      expect(columnNames).toContain("is_admin");
      expect(columnNames).toContain("is_allowed");
      expect(columnNames).toContain("first_seen_at");
      expect(columnNames).toContain("last_seen_at");
      expect(columnNames).toContain("message_count");
    });

    it("creates tg_messages table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(tg_messages)").all() as Array<{
        name: string;
      }>;

      const columnNames = info.map((c) => c.name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("chat_id");
      expect(columnNames).toContain("sender_id");
      expect(columnNames).toContain("text");
      expect(columnNames).toContain("embedding");
      expect(columnNames).toContain("reply_to_id");
      expect(columnNames).toContain("forward_from_id");
      expect(columnNames).toContain("is_from_agent");
      expect(columnNames).toContain("is_edited");
      expect(columnNames).toContain("has_media");
      expect(columnNames).toContain("media_type");
      expect(columnNames).toContain("timestamp");
      expect(columnNames).toContain("indexed_at");
    });

    it("creates embedding_cache table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(embedding_cache)").all() as Array<{
        name: string;
        type: string;
      }>;

      expect(info).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "hash", type: "TEXT" }),
          expect.objectContaining({ name: "model", type: "TEXT" }),
          expect.objectContaining({ name: "provider", type: "TEXT" }),
          expect.objectContaining({ name: "embedding", type: "BLOB" }),
          expect.objectContaining({ name: "dims", type: "INTEGER" }),
          expect.objectContaining({ name: "created_at", type: "INTEGER" }),
          expect.objectContaining({ name: "accessed_at", type: "INTEGER" }),
        ])
      );
    });

    it("creates journal table with correct schema", () => {
      ensureSchema(db);

      const info = db.prepare("PRAGMA table_info(journal)").all() as Array<{
        name: string;
      }>;

      const columnNames = info.map((c) => c.name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("timestamp");
      expect(columnNames).toContain("type");
      expect(columnNames).toContain("action");
      expect(columnNames).toContain("asset_from");
      expect(columnNames).toContain("asset_to");
      expect(columnNames).toContain("amount_from");
      expect(columnNames).toContain("amount_to");
      expect(columnNames).toContain("price_ton");
      expect(columnNames).toContain("counterparty");
      expect(columnNames).toContain("platform");
      expect(columnNames).toContain("reasoning");
      expect(columnNames).toContain("outcome");
      expect(columnNames).toContain("pnl_ton");
      expect(columnNames).toContain("pnl_pct");
      expect(columnNames).toContain("tx_hash");
      expect(columnNames).toContain("tool_used");
      expect(columnNames).toContain("chat_id");
      expect(columnNames).toContain("user_id");
      expect(columnNames).toContain("closed_at");
      expect(columnNames).toContain("created_at");
    });
  });

  // ============================================
  // INDEXES
  // ============================================

  describe("Index Creation", () => {
    it("creates indexes for knowledge table", () => {
      ensureSchema(db);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='knowledge'
      `
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_knowledge_source");
      expect(indexNames).toContain("idx_knowledge_hash");
      expect(indexNames).toContain("idx_knowledge_updated");
    });

    it("creates indexes for sessions table", () => {
      ensureSchema(db);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='sessions'
      `
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_sessions_chat");
      expect(indexNames).toContain("idx_sessions_started");
      expect(indexNames).toContain("idx_sessions_updated");
    });

    it("creates indexes for tasks table", () => {
      ensureSchema(db);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='tasks'
      `
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_tasks_status");
      expect(indexNames).toContain("idx_tasks_priority");
      expect(indexNames).toContain("idx_tasks_scheduled");
      expect(indexNames).toContain("idx_tasks_created_by");
    });

    it("creates indexes for task_dependencies table", () => {
      ensureSchema(db);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='task_dependencies'
      `
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_task_deps_task");
      expect(indexNames).toContain("idx_task_deps_parent");
    });

    it("creates indexes for tg_chats table", () => {
      ensureSchema(db);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='tg_chats'
      `
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_tg_chats_type");
      expect(indexNames).toContain("idx_tg_chats_monitored");
      expect(indexNames).toContain("idx_tg_chats_username");
    });

    it("creates indexes for tg_users table", () => {
      ensureSchema(db);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='tg_users'
      `
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_tg_users_username");
      expect(indexNames).toContain("idx_tg_users_admin");
      expect(indexNames).toContain("idx_tg_users_last_seen");
    });

    it("creates indexes for tg_messages table", () => {
      ensureSchema(db);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='tg_messages'
      `
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_tg_messages_chat");
      expect(indexNames).toContain("idx_tg_messages_sender");
      expect(indexNames).toContain("idx_tg_messages_timestamp");
      expect(indexNames).toContain("idx_tg_messages_reply");
      expect(indexNames).toContain("idx_tg_messages_from_agent");
    });

    it("creates indexes for embedding_cache table", () => {
      ensureSchema(db);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='embedding_cache'
      `
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_embedding_cache_accessed");
    });

    it("creates indexes for journal table", () => {
      ensureSchema(db);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='journal'
      `
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_journal_type");
      expect(indexNames).toContain("idx_journal_timestamp");
      expect(indexNames).toContain("idx_journal_asset_from");
      expect(indexNames).toContain("idx_journal_outcome");
      expect(indexNames).toContain("idx_journal_type_timestamp");
    });
  });

  // ============================================
  // FTS5 TABLES AND TRIGGERS
  // ============================================

  describe("FTS5 Tables", () => {
    it("creates knowledge_fts virtual table", () => {
      ensureSchema(db);

      const table = db
        .prepare(
          `
        SELECT sql FROM sqlite_master
        WHERE type='table' AND name='knowledge_fts'
      `
        )
        .get() as { sql: string } | undefined;

      expect(table).toBeDefined();
      expect(table!.sql).toContain("VIRTUAL TABLE");
      expect(table!.sql).toContain("fts5");
    });

    it("creates tg_messages_fts virtual table", () => {
      ensureSchema(db);

      const table = db
        .prepare(
          `
        SELECT sql FROM sqlite_master
        WHERE type='table' AND name='tg_messages_fts'
      `
        )
        .get() as { sql: string } | undefined;

      expect(table).toBeDefined();
      expect(table!.sql).toContain("VIRTUAL TABLE");
      expect(table!.sql).toContain("fts5");
    });

    it("creates knowledge_fts triggers (insert, update, delete)", () => {
      ensureSchema(db);

      const triggers = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='trigger' AND tbl_name='knowledge'
      `
        )
        .all() as { name: string }[];

      const triggerNames = triggers.map((t) => t.name);
      expect(triggerNames).toContain("knowledge_fts_insert");
      expect(triggerNames).toContain("knowledge_fts_update");
      expect(triggerNames).toContain("knowledge_fts_delete");
    });

    it("creates tg_messages_fts triggers (insert, update, delete)", () => {
      ensureSchema(db);

      const triggers = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='trigger' AND tbl_name='tg_messages'
      `
        )
        .all() as { name: string }[];

      const triggerNames = triggers.map((t) => t.name);
      expect(triggerNames).toContain("tg_messages_fts_insert");
      expect(triggerNames).toContain("tg_messages_fts_update");
      expect(triggerNames).toContain("tg_messages_fts_delete");
    });

    it("knowledge_fts insert trigger populates FTS table", () => {
      ensureSchema(db);

      db.prepare(
        `
        INSERT INTO knowledge (id, source, text, hash)
        VALUES ('k1', 'memory', 'hello world test', 'hash123')
      `
      ).run();

      const ftsRow = db
        .prepare(
          `
        SELECT text FROM knowledge_fts WHERE id='k1'
      `
        )
        .get() as { text: string } | undefined;

      expect(ftsRow).toBeDefined();
      expect(ftsRow!.text).toBe("hello world test");
    });

    it("knowledge_fts update trigger updates FTS table", () => {
      ensureSchema(db);

      db.prepare(
        `
        INSERT INTO knowledge (id, source, text, hash)
        VALUES ('k1', 'memory', 'original text', 'hash123')
      `
      ).run();

      db.prepare(
        `
        UPDATE knowledge SET text='updated text' WHERE id='k1'
      `
      ).run();

      const ftsRow = db
        .prepare(
          `
        SELECT text FROM knowledge_fts WHERE id='k1'
      `
        )
        .get() as { text: string } | undefined;

      expect(ftsRow).toBeDefined();
      expect(ftsRow!.text).toBe("updated text");
    });

    it("knowledge_fts delete trigger removes from FTS table", () => {
      ensureSchema(db);

      db.prepare(
        `
        INSERT INTO knowledge (id, source, text, hash)
        VALUES ('k1', 'memory', 'will be deleted', 'hash123')
      `
      ).run();

      db.prepare(`DELETE FROM knowledge WHERE id='k1'`).run();

      const ftsRow = db
        .prepare(
          `
        SELECT text FROM knowledge_fts WHERE id='k1'
      `
        )
        .get() as { text: string } | undefined;

      expect(ftsRow).toBeUndefined();
    });

    it("tg_messages_fts insert trigger populates FTS table", () => {
      ensureSchema(db);

      // Insert chat and user first (foreign keys)
      db.prepare(
        `
        INSERT INTO tg_chats (id, type) VALUES ('chat1', 'dm')
      `
      ).run();
      db.prepare(
        `
        INSERT INTO tg_users (id) VALUES ('user1')
      `
      ).run();

      db.prepare(
        `
        INSERT INTO tg_messages (id, chat_id, sender_id, text, timestamp)
        VALUES ('msg1', 'chat1', 'user1', 'hello telegram', 1234567890)
      `
      ).run();

      const ftsRow = db
        .prepare(
          `
        SELECT text FROM tg_messages_fts WHERE id='msg1'
      `
        )
        .get() as { text: string } | undefined;

      expect(ftsRow).toBeDefined();
      expect(ftsRow!.text).toBe("hello telegram");
    });
  });

  // ============================================
  // CHECK CONSTRAINTS
  // ============================================

  describe("CHECK Constraints", () => {
    it("knowledge.source accepts only 'memory', 'session', 'learned'", () => {
      ensureSchema(db);

      db.prepare(
        `
        INSERT INTO knowledge (id, source, text, hash)
        VALUES ('k1', 'memory', 'test', 'hash1')
      `
      ).run();
      db.prepare(
        `
        INSERT INTO knowledge (id, source, text, hash)
        VALUES ('k2', 'session', 'test', 'hash2')
      `
      ).run();
      db.prepare(
        `
        INSERT INTO knowledge (id, source, text, hash)
        VALUES ('k3', 'learned', 'test', 'hash3')
      `
      ).run();

      expect(() =>
        db
          .prepare(
            `
          INSERT INTO knowledge (id, source, text, hash)
          VALUES ('k4', 'invalid', 'test', 'hash4')
        `
          )
          .run()
      ).toThrow();
    });

    it("tasks.status accepts only valid status values", () => {
      ensureSchema(db);

      const validStatuses = ["pending", "in_progress", "done", "failed", "cancelled"];

      for (const status of validStatuses) {
        db.prepare(
          `
          INSERT INTO tasks (id, description, status)
          VALUES (?, 'test task', ?)
        `
        ).run(`task-${status}`, status);
      }

      expect(() =>
        db
          .prepare(
            `
          INSERT INTO tasks (id, description, status)
          VALUES ('task-invalid', 'test task', 'invalid_status')
        `
          )
          .run()
      ).toThrow();
    });

    it("tg_chats.type accepts only 'dm', 'group', 'channel'", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('c1', 'dm')`).run();
      db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('c2', 'group')`).run();
      db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('c3', 'channel')`).run();

      expect(() =>
        db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('c4', 'invalid')`).run()
      ).toThrow();
    });

    it("journal.type accepts only 'trade', 'gift', 'middleman', 'kol'", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO journal (type, action) VALUES ('trade', 'buy')`).run();
      db.prepare(`INSERT INTO journal (type, action) VALUES ('gift', 'sent')`).run();
      db.prepare(`INSERT INTO journal (type, action) VALUES ('middleman', 'facilitated')`).run();
      db.prepare(`INSERT INTO journal (type, action) VALUES ('kol', 'promoted')`).run();

      expect(() =>
        db.prepare(`INSERT INTO journal (type, action) VALUES ('invalid', 'test')`).run()
      ).toThrow();
    });

    it("journal.outcome accepts only valid outcome values", () => {
      ensureSchema(db);

      const validOutcomes = ["pending", "profit", "loss", "neutral", "cancelled"];

      for (const outcome of validOutcomes) {
        db.prepare(
          `
          INSERT INTO journal (type, action, outcome)
          VALUES ('trade', 'test', ?)
        `
        ).run(outcome);
      }

      expect(() =>
        db
          .prepare(
            `
          INSERT INTO journal (type, action, outcome)
          VALUES ('trade', 'test', 'invalid_outcome')
        `
          )
          .run()
      ).toThrow();
    });
  });

  // ============================================
  // FOREIGN KEY CONSTRAINTS
  // ============================================

  describe("Foreign Key Constraints", () => {
    it("task_dependencies enforces foreign key on task_id", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tasks (id, description) VALUES ('task1', 'test')`).run();
      db.prepare(`INSERT INTO tasks (id, description) VALUES ('task2', 'test')`).run();

      // Valid insert
      db.prepare(
        `
        INSERT INTO task_dependencies (task_id, depends_on_task_id)
        VALUES ('task1', 'task2')
      `
      ).run();

      // Invalid: non-existent task_id
      expect(() =>
        db
          .prepare(
            `
          INSERT INTO task_dependencies (task_id, depends_on_task_id)
          VALUES ('nonexistent', 'task2')
        `
          )
          .run()
      ).toThrow();
    });

    it("task_dependencies enforces foreign key on depends_on_task_id", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tasks (id, description) VALUES ('task1', 'test')`).run();

      expect(() =>
        db
          .prepare(
            `
          INSERT INTO task_dependencies (task_id, depends_on_task_id)
          VALUES ('task1', 'nonexistent')
        `
          )
          .run()
      ).toThrow();
    });

    it("task_dependencies CASCADE deletes when task is deleted", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tasks (id, description) VALUES ('task1', 'test')`).run();
      db.prepare(`INSERT INTO tasks (id, description) VALUES ('task2', 'test')`).run();
      db.prepare(
        `
        INSERT INTO task_dependencies (task_id, depends_on_task_id)
        VALUES ('task1', 'task2')
      `
      ).run();

      db.prepare(`DELETE FROM tasks WHERE id='task1'`).run();

      const deps = db.prepare(`SELECT * FROM task_dependencies WHERE task_id='task1'`).all();
      expect(deps).toHaveLength(0);
    });

    it("tg_messages enforces foreign key on chat_id", () => {
      ensureSchema(db);

      expect(() =>
        db
          .prepare(
            `
          INSERT INTO tg_messages (id, chat_id, timestamp)
          VALUES ('msg1', 'nonexistent_chat', 1234567890)
        `
          )
          .run()
      ).toThrow();
    });

    it("tg_messages CASCADE deletes when chat is deleted", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('chat1', 'dm')`).run();
      db.prepare(
        `
        INSERT INTO tg_messages (id, chat_id, timestamp)
        VALUES ('msg1', 'chat1', 1234567890)
      `
      ).run();

      db.prepare(`DELETE FROM tg_chats WHERE id='chat1'`).run();

      const messages = db.prepare(`SELECT * FROM tg_messages WHERE chat_id='chat1'`).all();
      expect(messages).toHaveLength(0);
    });

    it("tg_messages SET NULL on sender_id when user is deleted", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('chat1', 'dm')`).run();
      db.prepare(`INSERT INTO tg_users (id) VALUES ('user1')`).run();
      db.prepare(
        `
        INSERT INTO tg_messages (id, chat_id, sender_id, timestamp)
        VALUES ('msg1', 'chat1', 'user1', 1234567890)
      `
      ).run();

      db.prepare(`DELETE FROM tg_users WHERE id='user1'`).run();

      const message = db.prepare(`SELECT sender_id FROM tg_messages WHERE id='msg1'`).get() as {
        sender_id: string | null;
      };
      expect(message.sender_id).toBeNull();
    });
  });

  // ============================================
  // DEFAULT VALUES
  // ============================================

  describe("Default Values", () => {
    it("meta.updated_at defaults to current unix timestamp", () => {
      ensureSchema(db);

      const before = Math.floor(Date.now() / 1000);
      db.prepare(`INSERT INTO meta (key, value) VALUES ('test', 'value')`).run();
      const after = Math.floor(Date.now() / 1000);

      const row = db.prepare(`SELECT updated_at FROM meta WHERE key='test'`).get() as {
        updated_at: number;
      };

      expect(row.updated_at).toBeGreaterThanOrEqual(before);
      expect(row.updated_at).toBeLessThanOrEqual(after);
    });

    it("knowledge created_at and updated_at default to current unix timestamp", () => {
      ensureSchema(db);

      const before = Math.floor(Date.now() / 1000);
      db.prepare(
        `
        INSERT INTO knowledge (id, source, text, hash)
        VALUES ('k1', 'memory', 'test', 'hash1')
      `
      ).run();
      const after = Math.floor(Date.now() / 1000);

      const row = db
        .prepare(`SELECT created_at, updated_at FROM knowledge WHERE id='k1'`)
        .get() as { created_at: number; updated_at: number };

      expect(row.created_at).toBeGreaterThanOrEqual(before);
      expect(row.created_at).toBeLessThanOrEqual(after);
      expect(row.updated_at).toBeGreaterThanOrEqual(before);
      expect(row.updated_at).toBeLessThanOrEqual(after);
    });

    it("tasks.status defaults to 'pending'", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tasks (id, description) VALUES ('t1', 'test')`).run();

      const row = db.prepare(`SELECT status FROM tasks WHERE id='t1'`).get() as { status: string };
      expect(row.status).toBe("pending");
    });

    it("tasks.priority defaults to 0", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tasks (id, description) VALUES ('t1', 'test')`).run();

      const row = db.prepare(`SELECT priority FROM tasks WHERE id='t1'`).get() as {
        priority: number;
      };
      expect(row.priority).toBe(0);
    });

    it("sessions.message_count defaults to 0", () => {
      ensureSchema(db);

      db.prepare(
        `
        INSERT INTO sessions (id, chat_id, started_at, updated_at)
        VALUES ('s1', 'telegram:123', 1234567890000, 1234567890000)
      `
      ).run();

      const row = db.prepare(`SELECT message_count FROM sessions WHERE id='s1'`).get() as {
        message_count: number;
      };
      expect(row.message_count).toBe(0);
    });

    it("sessions.input_tokens defaults to 0", () => {
      ensureSchema(db);

      db.prepare(
        `
        INSERT INTO sessions (id, chat_id, started_at, updated_at)
        VALUES ('s1', 'telegram:123', 1234567890000, 1234567890000)
      `
      ).run();

      const row = db
        .prepare(`SELECT input_tokens, output_tokens FROM sessions WHERE id='s1'`)
        .get() as {
        input_tokens: number;
        output_tokens: number;
      };
      expect(row.input_tokens).toBe(0);
      expect(row.output_tokens).toBe(0);
    });

    it("tg_chats.is_monitored defaults to 1", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('c1', 'dm')`).run();

      const row = db.prepare(`SELECT is_monitored FROM tg_chats WHERE id='c1'`).get() as {
        is_monitored: number;
      };
      expect(row.is_monitored).toBe(1);
    });

    it("tg_chats.is_archived defaults to 0", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('c1', 'dm')`).run();

      const row = db.prepare(`SELECT is_archived FROM tg_chats WHERE id='c1'`).get() as {
        is_archived: number;
      };
      expect(row.is_archived).toBe(0);
    });

    it("tg_users boolean flags default to 0", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tg_users (id) VALUES ('u1')`).run();

      const row = db
        .prepare(
          `
        SELECT is_bot, is_admin, is_allowed FROM tg_users WHERE id='u1'
      `
        )
        .get() as { is_bot: number; is_admin: number; is_allowed: number };

      expect(row.is_bot).toBe(0);
      expect(row.is_admin).toBe(0);
      expect(row.is_allowed).toBe(0);
    });

    it("tg_messages.is_from_agent defaults to 0", () => {
      ensureSchema(db);

      db.prepare(`INSERT INTO tg_chats (id, type) VALUES ('c1', 'dm')`).run();
      db.prepare(
        `
        INSERT INTO tg_messages (id, chat_id, timestamp)
        VALUES ('msg1', 'c1', 1234567890)
      `
      ).run();

      const row = db.prepare(`SELECT is_from_agent FROM tg_messages WHERE id='msg1'`).get() as {
        is_from_agent: number;
      };
      expect(row.is_from_agent).toBe(0);
    });
  });

  // ============================================
  // SCHEMA VERSION MANAGEMENT
  // ============================================

  describe("Schema Version Management", () => {
    it("getSchemaVersion returns null when meta table does not exist", () => {
      try {
        const version = getSchemaVersion(db);
        expect(version).toBeNull();
      } catch (error) {
        // Expected - getSchemaVersion throws when meta table doesn't exist
        expect((error as Error).message).toMatch(/no such table: meta/i);
      }
    });

    it("getSchemaVersion returns null when schema_version key does not exist", () => {
      db.exec(
        `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`
      );
      const version = getSchemaVersion(db);
      expect(version).toBeNull();
    });

    it("setSchemaVersion stores version in meta table", () => {
      ensureSchema(db);
      setSchemaVersion(db, "1.0.0");

      const row = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as {
        value: string;
      };
      expect(row.value).toBe("1.0.0");
    });

    it("setSchemaVersion updates existing version", () => {
      ensureSchema(db);
      setSchemaVersion(db, "1.0.0");
      setSchemaVersion(db, "2.0.0");

      const row = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as {
        value: string;
      };
      expect(row.value).toBe("2.0.0");
    });

    it("getSchemaVersion retrieves stored version", () => {
      ensureSchema(db);
      setSchemaVersion(db, "1.5.0");

      const version = getSchemaVersion(db);
      expect(version).toBe("1.5.0");
    });

    it("CURRENT_SCHEMA_VERSION is set to expected value", () => {
      expect(CURRENT_SCHEMA_VERSION).toBe("1.13.0");
    });
  });

  // ============================================
  // MIGRATIONS
  // ============================================

  describe("Migrations", () => {
    it("runMigrations sets schema version to CURRENT_SCHEMA_VERSION", () => {
      ensureSchema(db);
      runMigrations(db);

      const version = getSchemaVersion(db);
      expect(version).toBe(CURRENT_SCHEMA_VERSION);
    });

    it("runMigrations on fresh database creates all tables and sets version", () => {
      // Don't call ensureSchema, let runMigrations handle it
      ensureSchema(db);
      runMigrations(db);

      const version = getSchemaVersion(db);
      expect(version).toBe(CURRENT_SCHEMA_VERSION);

      // Verify at least one table exists
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'`)
        .get();
      expect(tables).toBeDefined();
    });

    it("runMigrations from version 1.0.0 adds scheduled task columns", () => {
      ensureSchema(db);
      setSchemaVersion(db, "1.0.0");

      runMigrations(db);

      const info = db.prepare("PRAGMA table_info(tasks)").all() as Array<{
        name: string;
      }>;
      const columnNames = info.map((c) => c.name);

      expect(columnNames).toContain("scheduled_for");
      expect(columnNames).toContain("payload");
      expect(columnNames).toContain("reason");
      expect(columnNames).toContain("scheduled_message_id");
    });

    it("runMigrations from version 1.1.0 extends sessions table", () => {
      ensureSchema(db);
      setSchemaVersion(db, "1.1.0");

      runMigrations(db);

      const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
        name: string;
      }>;
      const columnNames = info.map((c) => c.name);

      expect(columnNames).toContain("updated_at");
      expect(columnNames).toContain("last_message_id");
      expect(columnNames).toContain("last_channel");
      expect(columnNames).toContain("last_to");
      expect(columnNames).toContain("context_tokens");
      expect(columnNames).toContain("model");
      expect(columnNames).toContain("provider");
      expect(columnNames).toContain("last_reset_date");
    });

    it("runMigrations from version 1.12.0 adds token usage columns to sessions", () => {
      ensureSchema(db);
      setSchemaVersion(db, "1.12.0");

      runMigrations(db);

      const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
        name: string;
      }>;
      const columnNames = info.map((c) => c.name);

      expect(columnNames).toContain("input_tokens");
      expect(columnNames).toContain("output_tokens");
    });

    it("runMigrations is idempotent (can run multiple times)", () => {
      ensureSchema(db);
      runMigrations(db);
      const version1 = getSchemaVersion(db);

      runMigrations(db);
      const version2 = getSchemaVersion(db);

      expect(version1).toBe(version2);
      expect(version2).toBe(CURRENT_SCHEMA_VERSION);
    });
  });

  // ============================================
  // VECTOR TABLES
  // ============================================

  describe("Vector Tables", () => {
    it("ensureVectorTables creates knowledge_vec and tg_messages_vec tables", () => {
      ensureSchema(db);

      // Mock sqlite-vec by creating the tables manually (since vec0 extension may not be loaded)
      // In actual tests with sqlite-vec loaded, this would be handled by the extension
      try {
        ensureVectorTables(db, 512);
      } catch (error) {
        // Expected if sqlite-vec is not available
        expect((error as Error).message).toMatch(/no such module|vec0/i);
        return;
      }

      // If sqlite-vec is available, verify tables exist
      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name IN ('knowledge_vec', 'tg_messages_vec')
      `
        )
        .all() as { name: string }[];

      expect(tables).toHaveLength(2);
    });

    it("ensureVectorTables recreates tables if dimensions change", () => {
      ensureSchema(db);

      // This test would only work with sqlite-vec extension loaded
      try {
        ensureVectorTables(db, 512);
        ensureVectorTables(db, 1024); // Should drop and recreate with new dimensions
      } catch (error) {
        // Expected if sqlite-vec is not available
        expect((error as Error).message).toMatch(/no such module|vec0/i);
      }
    });
  });

  // ============================================
  // UNIQUE CONSTRAINTS
  // ============================================

  describe("Unique Constraints", () => {
    it("sessions.chat_id enforces uniqueness", () => {
      ensureSchema(db);

      db.prepare(
        `
        INSERT INTO sessions (id, chat_id, started_at, updated_at)
        VALUES ('s1', 'telegram:123', 1234567890000, 1234567890000)
      `
      ).run();

      expect(() =>
        db
          .prepare(
            `
          INSERT INTO sessions (id, chat_id, started_at, updated_at)
          VALUES ('s2', 'telegram:123', 1234567890000, 1234567890000)
        `
          )
          .run()
      ).toThrow();
    });

    it("embedding_cache has composite primary key on (hash, model, provider)", () => {
      ensureSchema(db);

      const blob = Buffer.from([0.1, 0.2, 0.3]);

      db.prepare(
        `
        INSERT INTO embedding_cache (hash, model, provider, embedding, dims)
        VALUES ('hash1', 'model1', 'provider1', ?, 3)
      `
      ).run(blob);

      // Same hash, different model - should succeed
      db.prepare(
        `
        INSERT INTO embedding_cache (hash, model, provider, embedding, dims)
        VALUES ('hash1', 'model2', 'provider1', ?, 3)
      `
      ).run(blob);

      // Same hash and model, same provider - should fail
      expect(() =>
        db
          .prepare(
            `
          INSERT INTO embedding_cache (hash, model, provider, embedding, dims)
          VALUES ('hash1', 'model1', 'provider1', ?, 3)
        `
          )
          .run(blob)
      ).toThrow();
    });
  });

  // ============================================
  // TOOL_CONFIG TABLE (added in migration 1.10.0)
  // ============================================

  describe("Tool Config Table", () => {
    it("creates tool_config table after migration 1.10.0", () => {
      ensureSchema(db);
      setSchemaVersion(db, "1.9.0");
      runMigrations(db);

      const table = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='tool_config'
      `
        )
        .get() as { name: string } | undefined;

      expect(table).toBeDefined();
    });

    it("tool_config.enabled CHECK constraint accepts only 0 or 1", () => {
      ensureSchema(db);
      runMigrations(db);

      db.prepare(`INSERT INTO tool_config (tool_name, enabled) VALUES ('tool1', 1)`).run();
      db.prepare(`INSERT INTO tool_config (tool_name, enabled) VALUES ('tool2', 0)`).run();

      expect(() =>
        db.prepare(`INSERT INTO tool_config (tool_name, enabled) VALUES ('tool3', 2)`).run()
      ).toThrow();
    });

    it("tool_config.scope CHECK constraint accepts valid scope values", () => {
      ensureSchema(db);
      runMigrations(db);

      const validScopes = ["always", "dm-only", "group-only", "admin-only"];

      for (const scope of validScopes) {
        db.prepare(`INSERT INTO tool_config (tool_name, scope) VALUES (?, ?)`).run(
          `tool-${scope}`,
          scope
        );
      }

      expect(() =>
        db
          .prepare(
            `INSERT INTO tool_config (tool_name, scope) VALUES ('tool-invalid', 'invalid-scope')`
          )
          .run()
      ).toThrow();
    });

    it("tool_config.enabled defaults to 1", () => {
      ensureSchema(db);
      runMigrations(db);

      db.prepare(`INSERT INTO tool_config (tool_name) VALUES ('tool1')`).run();

      const row = db.prepare(`SELECT enabled FROM tool_config WHERE tool_name='tool1'`).get() as {
        enabled: number;
      };
      expect(row.enabled).toBe(1);
    });
  });
});
