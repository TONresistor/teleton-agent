import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createStorageSDK } from "../storage.js";

describe("StorageSDK", () => {
  let db: InstanceType<typeof Database>;
  let storage: ReturnType<typeof createStorageSDK>;

  beforeEach(() => {
    // Disable probabilistic cleanup so it doesn't interfere with deterministic tests
    vi.spyOn(Math, "random").mockReturnValue(1);
    db = new Database(":memory:");
    storage = createStorageSDK(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  // ---------- Basic CRUD ----------

  describe("basic CRUD", () => {
    it("set and get a value", () => {
      storage.set("key1", "hello");
      expect(storage.get("key1")).toBe("hello");
    });

    it("has returns true for existing key", () => {
      storage.set("key1", 42);
      expect(storage.has("key1")).toBe(true);
    });

    it("has returns false for non-existent key", () => {
      expect(storage.has("nope")).toBe(false);
    });

    it("delete removes a key and returns true", () => {
      storage.set("key1", "val");
      expect(storage.delete("key1")).toBe(true);
      expect(storage.get("key1")).toBeUndefined();
    });

    it("delete returns false for non-existent key", () => {
      expect(storage.delete("nope")).toBe(false);
    });

    it("clear removes all keys", () => {
      storage.set("a", 1);
      storage.set("b", 2);
      storage.set("c", 3);
      storage.clear();
      expect(storage.get("a")).toBeUndefined();
      expect(storage.get("b")).toBeUndefined();
      expect(storage.get("c")).toBeUndefined();
    });
  });

  // ---------- JSON serialization ----------

  describe("JSON serialization", () => {
    it("stores and retrieves objects", () => {
      const obj = { name: "alice", age: 30, nested: { x: true } };
      storage.set("obj", obj);
      expect(storage.get("obj")).toEqual(obj);
    });

    it("stores and retrieves arrays", () => {
      const arr = [1, "two", null, { three: 3 }];
      storage.set("arr", arr);
      expect(storage.get("arr")).toEqual(arr);
    });

    it("stores and retrieves numbers", () => {
      storage.set("int", 42);
      storage.set("float", 3.14);
      storage.set("negative", -99);
      storage.set("zero", 0);
      expect(storage.get<number>("int")).toBe(42);
      expect(storage.get<number>("float")).toBe(3.14);
      expect(storage.get<number>("negative")).toBe(-99);
      expect(storage.get<number>("zero")).toBe(0);
    });

    it("stores and retrieves strings", () => {
      storage.set("str", "hello world");
      storage.set("empty", "");
      expect(storage.get<string>("str")).toBe("hello world");
      expect(storage.get<string>("empty")).toBe("");
    });

    it("stores and retrieves booleans", () => {
      storage.set("t", true);
      storage.set("f", false);
      expect(storage.get<boolean>("t")).toBe(true);
      expect(storage.get<boolean>("f")).toBe(false);
    });

    it("stores and retrieves null", () => {
      storage.set("nil", null);
      expect(storage.get("nil")).toBeNull();
    });
  });

  // ---------- Overwrite ----------

  describe("overwrite", () => {
    it("second set on same key overwrites the value", () => {
      storage.set("key", "first");
      storage.set("key", "second");
      expect(storage.get("key")).toBe("second");
    });

    it("overwrites with a different type", () => {
      storage.set("key", 42);
      storage.set("key", { replaced: true });
      expect(storage.get("key")).toEqual({ replaced: true });
    });
  });

  // ---------- TTL ----------

  describe("TTL", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("get returns value before TTL expiry", () => {
      storage.set("temp", "data", { ttl: 5000 });
      vi.advanceTimersByTime(4999);
      expect(storage.get("temp")).toBe("data");
    });

    it("get returns undefined after TTL expiry", () => {
      storage.set("temp", "data", { ttl: 5000 });
      vi.advanceTimersByTime(5001);
      expect(storage.get("temp")).toBeUndefined();
    });

    it("has returns true before TTL expiry", () => {
      storage.set("temp", "data", { ttl: 10_000 });
      vi.advanceTimersByTime(9999);
      expect(storage.has("temp")).toBe(true);
    });

    it("has returns false after TTL expiry", () => {
      storage.set("temp", "data", { ttl: 10_000 });
      vi.advanceTimersByTime(10_001);
      expect(storage.has("temp")).toBe(false);
    });

    it("expired key is deleted from DB on get", () => {
      storage.set("temp", "data", { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      // First get triggers delete
      expect(storage.get("temp")).toBeUndefined();
      // Confirm row is gone from the DB
      const row = db.prepare("SELECT * FROM _kv WHERE key = ?").get("temp");
      expect(row).toBeUndefined();
    });

    it("expired key is deleted from DB on has", () => {
      storage.set("temp", "data", { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      expect(storage.has("temp")).toBe(false);
      const row = db.prepare("SELECT * FROM _kv WHERE key = ?").get("temp");
      expect(row).toBeUndefined();
    });

    it("key without TTL never expires", () => {
      storage.set("permanent", "forever");
      vi.advanceTimersByTime(999_999_999);
      expect(storage.get("permanent")).toBe("forever");
    });

    it("overwriting a TTL key with no TTL removes the expiration", () => {
      storage.set("key", "v1", { ttl: 1000 });
      storage.set("key", "v2"); // no TTL
      vi.advanceTimersByTime(5000);
      expect(storage.get("key")).toBe("v2");
    });
  });

  // ---------- Probabilistic cleanup ----------

  describe("probabilistic cleanup", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("cleans up expired rows when Math.random < 0.05", () => {
      storage.set("expired1", "a", { ttl: 100 });
      storage.set("expired2", "b", { ttl: 100 });
      storage.set("alive", "c", { ttl: 999_999 });

      vi.advanceTimersByTime(200);

      // Restore the mock so we can set random to trigger cleanup
      vi.spyOn(Math, "random").mockReturnValue(0.01); // < 0.05 threshold

      // Any get triggers maybeCleanup
      storage.get("alive");

      // Expired rows should have been cleaned up from the DB
      const rows = db.prepare("SELECT key FROM _kv").all() as { key: string }[];
      const keys = rows.map((r) => r.key);
      expect(keys).toContain("alive");
      expect(keys).not.toContain("expired1");
      expect(keys).not.toContain("expired2");
    });

    it("does not clean up when Math.random >= 0.05", () => {
      storage.set("expired", "x", { ttl: 100 });
      vi.advanceTimersByTime(200);

      // random returns 1 (from the top-level beforeEach mock), no cleanup
      storage.get("other_key");

      // Expired row still in DB (just not returned by get)
      const row = db.prepare("SELECT * FROM _kv WHERE key = ?").get("expired");
      expect(row).toBeDefined();
    });
  });

  // ---------- Edge cases ----------

  describe("edge cases", () => {
    it("get on non-existent key returns undefined", () => {
      expect(storage.get("ghost")).toBeUndefined();
    });

    it("delete on already-deleted key returns false", () => {
      storage.set("key", "val");
      expect(storage.delete("key")).toBe(true);
      expect(storage.delete("key")).toBe(false);
    });

    it("clear on empty store does not throw", () => {
      expect(() => storage.clear()).not.toThrow();
    });

    it("handles keys with special characters", () => {
      const key = "plugin:cache:user/123?q=test&foo=bar";
      storage.set(key, "ok");
      expect(storage.get(key)).toBe("ok");
      expect(storage.has(key)).toBe(true);
      expect(storage.delete(key)).toBe(true);
    });

    it("handles empty string key", () => {
      storage.set("", "empty-key");
      expect(storage.get("")).toBe("empty-key");
    });

    it("handles very large values", () => {
      const large = { data: "x".repeat(100_000) };
      storage.set("big", large);
      expect(storage.get<typeof large>("big")).toEqual(large);
    });
  });

  // ---------- Table creation ----------

  describe("table creation", () => {
    it("creates _kv table automatically", () => {
      const freshDb = new Database(":memory:");
      createStorageSDK(freshDb);
      const tables = freshDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get("_kv") as { name: string } | undefined;
      expect(tables).toBeDefined();
      expect(tables!.name).toBe("_kv");
      freshDb.close();
    });

    it("does not fail if _kv table already exists", () => {
      // createStorageSDK was already called in beforeEach, call it again
      expect(() => createStorageSDK(db)).not.toThrow();
    });
  });
});
