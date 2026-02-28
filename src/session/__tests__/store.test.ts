import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema, runMigrations } from "../../memory/schema.js";

// Mock getDatabase to return our test DB
let testDb: InstanceType<typeof Database>;

vi.mock("../../memory/index.js", () => ({
  getDatabase: () => ({
    getDb: () => testDb,
  }),
}));

// Import after mock setup
const {
  getOrCreateSession,
  updateSession,
  getSession,
  saveSessionStore,
  loadSessionStore,
  pruneOldSessions,
} = await import("../store.js");

describe("Session Store", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    testDb.pragma("foreign_keys = ON");
    ensureSchema(testDb);
    runMigrations(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  // ============================================
  // TOKEN USAGE PERSISTENCE
  // ============================================

  describe("Token Usage Persistence", () => {
    it("persists inputTokens and outputTokens via updateSession", () => {
      getOrCreateSession("123");

      updateSession("123", {
        inputTokens: 5000,
        outputTokens: 1200,
      });

      const session = getSession("123");
      expect(session).not.toBeNull();
      expect(session!.inputTokens).toBe(5000);
      expect(session!.outputTokens).toBe(1200);
    });

    it("accumulates tokens across multiple updates", () => {
      getOrCreateSession("123");

      updateSession("123", {
        inputTokens: 1000,
        outputTokens: 200,
      });

      // Simulate agent accumulating: read current + add new
      const current = getSession("123")!;
      updateSession("123", {
        inputTokens: current.inputTokens! + 3000,
        outputTokens: current.outputTokens! + 800,
      });

      const session = getSession("123");
      expect(session!.inputTokens).toBe(4000);
      expect(session!.outputTokens).toBe(1000);
    });

    it("loads token usage from database via loadSessionStore", () => {
      getOrCreateSession("123");
      updateSession("123", {
        inputTokens: 9999,
        outputTokens: 4444,
      });

      const store = loadSessionStore();
      const session = store["telegram:123"];
      expect(session).toBeDefined();
      expect(session.inputTokens).toBe(9999);
      expect(session.outputTokens).toBe(4444);
    });

    it("saves and restores token usage via saveSessionStore + loadSessionStore", () => {
      const session = getOrCreateSession("456");
      session.inputTokens = 7777;
      session.outputTokens = 3333;

      saveSessionStore({ "telegram:456": session });

      const store = loadSessionStore();
      const restored = store["telegram:456"];
      expect(restored.inputTokens).toBe(7777);
      expect(restored.outputTokens).toBe(3333);
    });

    it("defaults to 0 for new sessions", () => {
      getOrCreateSession("789");
      const loaded = getSession("789");
      // DB default is 0, rowToSession maps via `?? undefined` — 0 is not null so it stays 0
      expect(loaded!.inputTokens).toBe(0);
      expect(loaded!.outputTokens).toBe(0);
    });
  });

  // ============================================
  // SESSION PRUNING
  // ============================================

  describe("Session Pruning", () => {
    it("deletes sessions older than maxAgeDays", () => {
      const now = Date.now();
      const oldTime = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago

      // Insert an old session directly
      testDb
        .prepare(
          `INSERT INTO sessions (id, chat_id, started_at, updated_at, message_count)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run("old-session", "telegram:old", oldTime, oldTime, 5);

      // Insert a recent session
      testDb
        .prepare(
          `INSERT INTO sessions (id, chat_id, started_at, updated_at, message_count)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run("new-session", "telegram:new", now, now, 3);

      const pruned = pruneOldSessions(30);

      expect(pruned).toBe(1);

      // Old session should be gone
      const old = testDb.prepare(`SELECT * FROM sessions WHERE id = 'old-session'`).get();
      expect(old).toBeUndefined();

      // New session should remain
      const recent = testDb.prepare(`SELECT * FROM sessions WHERE id = 'new-session'`).get();
      expect(recent).toBeDefined();
    });

    it("keeps sessions newer than maxAgeDays", () => {
      const now = Date.now();
      const recentTime = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago

      testDb
        .prepare(
          `INSERT INTO sessions (id, chat_id, started_at, updated_at, message_count)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run("recent-session", "telegram:recent", recentTime, recentTime, 2);

      const pruned = pruneOldSessions(30);

      expect(pruned).toBe(0);

      const session = testDb.prepare(`SELECT * FROM sessions WHERE id = 'recent-session'`).get();
      expect(session).toBeDefined();
    });

    it("handles sessions with updated_at = 0 (null-like) gracefully", () => {
      // Sessions with updated_at = 0 should NOT be pruned (the WHERE clause requires > 0)
      testDb
        .prepare(
          `INSERT INTO sessions (id, chat_id, started_at, updated_at, message_count)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run("zero-session", "telegram:zero", 0, 0, 0);

      const pruned = pruneOldSessions(30);

      expect(pruned).toBe(0);

      const session = testDb.prepare(`SELECT * FROM sessions WHERE id = 'zero-session'`).get();
      expect(session).toBeDefined();
    });

    it("returns 0 when no sessions to prune", () => {
      const pruned = pruneOldSessions(30);
      expect(pruned).toBe(0);
    });
  });
});
