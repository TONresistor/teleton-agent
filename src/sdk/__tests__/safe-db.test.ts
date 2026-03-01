import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { stripSqlComments } from "../index.js";
import { createPluginSDK, type SDKDependencies } from "../index.js";

function createTestDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
  return db;
}

function createSafeDbViaSDK(db: Database.Database) {
  const mockBridge = { isAvailable: () => false, getClient: () => null } as any;
  const deps: SDKDependencies = { bridge: mockBridge };
  const sdk = createPluginSDK(deps, {
    pluginName: "test-plugin",
    db,
    sanitizedConfig: {},
    pluginConfig: {},
  });
  return sdk.db!;
}

describe("stripSqlComments", () => {
  it("strips block comments", () => {
    expect(stripSqlComments("SELECT /* comment */ 1")).toBe("SELECT   1");
  });

  it("strips line comments", () => {
    expect(stripSqlComments("SELECT 1 -- comment\nFROM t")).toBe("SELECT 1  \nFROM t");
  });

  it("strips nested-looking block comments", () => {
    expect(stripSqlComments("AT/* */TACH DATABASE")).toBe("AT TACH DATABASE");
  });

  it("preserves normal SQL", () => {
    expect(stripSqlComments("SELECT * FROM users WHERE id = 1")).toBe(
      "SELECT * FROM users WHERE id = 1"
    );
  });
});

describe("createSafeDb", () => {
  // ─── Blocked operations ───────────────────────────────────

  it("blocks ATTACH DATABASE via exec", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => safe.exec("ATTACH DATABASE ':memory:' AS ext")).toThrow(
      "ATTACH/DETACH DATABASE is not allowed"
    );
  });

  it("blocks DETACH DATABASE via exec", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => safe.exec("DETACH DATABASE ext")).toThrow("ATTACH/DETACH DATABASE is not allowed");
  });

  it("blocks ATTACH DATABASE via prepare", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => safe.prepare("ATTACH DATABASE ':memory:' AS ext")).toThrow(
      "ATTACH/DETACH DATABASE is not allowed"
    );
  });

  it("blocks case variations (lowercase)", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => safe.exec("attach database ':memory:' as ext")).toThrow(
      "ATTACH/DETACH DATABASE is not allowed"
    );
  });

  it("blocks case variations (mixed)", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => safe.exec("Attach Database ':memory:' as ext")).toThrow(
      "ATTACH/DETACH DATABASE is not allowed"
    );
  });

  // ─── Comment bypass attempts ──────────────────────────────

  it("blocks ATTACH with block comment bypass", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => safe.exec("ATTACH /* bypass */ DATABASE ':memory:' AS ext")).toThrow(
      "ATTACH/DETACH DATABASE is not allowed"
    );
  });

  it("blocks ATTACH with line comment bypass", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => safe.exec("ATTACH -- bypass\nDATABASE ':memory:' AS ext")).toThrow(
      "ATTACH/DETACH DATABASE is not allowed"
    );
  });

  it("blocks DETACH with block comment bypass", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => safe.exec("DETACH /* */ DATABASE ext")).toThrow(
      "ATTACH/DETACH DATABASE is not allowed"
    );
  });

  it("does not match ATTACH split across block comment (SQLite also rejects it)", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    // AT/**/TACH becomes "AT TACH" after stripping — doesn't match \bATTACH\b
    // Our guard lets it through, but SQLite itself rejects "AT TACH" as invalid SQL
    expect(() => safe.exec("AT/**/TACH DATABASE ':memory:' AS ext")).toThrow("syntax error");
  });

  // ─── Allowed operations ───────────────────────────────────

  it("allows normal SELECT via exec", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() => safe.exec("INSERT INTO test (name) VALUES ('hello')")).not.toThrow();
  });

  it("allows normal SELECT via prepare", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    const stmt = safe.prepare("SELECT * FROM test");
    expect(stmt.all()).toEqual([]);
  });

  it("allows CREATE TABLE", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    expect(() =>
      safe.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
    ).not.toThrow();
  });

  it("blocks SQL containing ATTACH DATABASE even in string literals (known limitation)", () => {
    const db = createTestDb();
    const safe = createSafeDbViaSDK(db);
    // Regex cannot distinguish SQL keywords from string contents — false positive is acceptable
    expect(() =>
      safe.exec("INSERT INTO test (name) VALUES ('attach database is blocked')")
    ).toThrow("ATTACH/DETACH DATABASE is not allowed");
  });
});
