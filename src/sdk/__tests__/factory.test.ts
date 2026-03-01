import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createPluginSDK } from "../index.js";
import { SDK_VERSION } from "@teleton-agent/sdk";

// ─── Mocks ──────────────────────────────────────────────────────
import { createMocks } from "./__fixtures__/mocks.js";
const { mockBridge } = createMocks();

describe("createPluginSDK — factory integration", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    db = new Database(":memory:");
    db.exec(
      "CREATE TABLE IF NOT EXISTS plugin_storage (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)"
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  function makeSDK(overrides?: { db?: Database.Database | null }) {
    return createPluginSDK(
      { bridge: mockBridge },
      {
        pluginName: "test-plugin",
        db: overrides?.db !== undefined ? overrides.db : db,
        sanitizedConfig: { foo: "bar" },
        pluginConfig: { secret_key: "s3cret" },
      }
    );
  }

  // ─── 1. All modules present ─────────────────────────────────
  it("exposes all expected SDK modules", () => {
    const sdk = makeSDK();

    expect(sdk.ton).toBeDefined();
    expect(sdk.telegram).toBeDefined();
    expect(sdk.secrets).toBeDefined();
    expect(sdk.storage).toBeDefined();
    expect(sdk.log).toBeDefined();
    expect(sdk.config).toBeDefined();
    expect(sdk.pluginConfig).toBeDefined();
    expect(sdk.version).toBeDefined();

    expect(sdk.ton).not.toBeNull();
    expect(sdk.telegram).not.toBeNull();
    expect(sdk.secrets).not.toBeNull();
    expect(sdk.storage).not.toBeNull();
    expect(sdk.log).not.toBeNull();
  });

  // ─── 2. Freeze works ────────────────────────────────────────
  it("freezes the SDK root and sub-modules", () => {
    const sdk = makeSDK();

    expect(Object.isFrozen(sdk)).toBe(true);
    expect(Object.isFrozen(sdk.ton)).toBe(true);
    expect(Object.isFrozen(sdk.telegram)).toBe(true);
    expect(Object.isFrozen(sdk.secrets)).toBe(true);
    expect(Object.isFrozen(sdk.storage)).toBe(true);
    expect(Object.isFrozen(sdk.log)).toBe(true);

    // Can't add new properties
    expect(() => {
      (sdk as any).hacked = true;
    }).toThrow();
    expect(() => {
      (sdk.ton as any).hacked = true;
    }).toThrow();
  });

  // ─── 3. db: null → storage is null ──────────────────────────
  it("sets storage to null when db is null", () => {
    const sdk = makeSDK({ db: null });

    expect(sdk.storage).toBeNull();
    // Other modules still exist
    expect(sdk.ton).toBeDefined();
    expect(sdk.telegram).toBeDefined();
    expect(sdk.secrets).toBeDefined();
    expect(sdk.log).toBeDefined();
  });

  // ─── 4. Version matches SDK_VERSION ─────────────────────────
  it("reports the correct SDK version", () => {
    const sdk = makeSDK();
    expect(sdk.version).toBe(SDK_VERSION);
  });

  // ─── 5. Config frozen ───────────────────────────────────────
  it("freezes config and pluginConfig", () => {
    const sdk = makeSDK();

    expect(Object.isFrozen(sdk.config)).toBe(true);
    expect(Object.isFrozen(sdk.pluginConfig)).toBe(true);

    expect(() => {
      (sdk.config as any).injected = true;
    }).toThrow();
    expect(() => {
      (sdk.pluginConfig as any).injected = true;
    }).toThrow();
  });

  // ─── 6. Logger callable ─────────────────────────────────────
  it("provides callable logger methods that do not throw", () => {
    const sdk = makeSDK();

    expect(typeof sdk.log.info).toBe("function");
    expect(typeof sdk.log.warn).toBe("function");
    expect(typeof sdk.log.error).toBe("function");
    expect(typeof sdk.log.debug).toBe("function");

    expect(() => sdk.log.info("test message")).not.toThrow();
    expect(() => sdk.log.warn("test warning")).not.toThrow();
    expect(() => sdk.log.error("test error")).not.toThrow();
    expect(() => sdk.log.debug("test debug")).not.toThrow();
  });

  // ─── 7. Storage roundtrip through factory ───────────────────
  it("supports storage set/get roundtrip through factory-created SDK", () => {
    const sdk = makeSDK();

    sdk.storage!.set("greeting", "hello world");
    expect(sdk.storage!.get("greeting")).toBe("hello world");

    sdk.storage!.set("number", 42);
    expect(sdk.storage!.get("number")).toBe(42);

    sdk.storage!.set("obj", { nested: true });
    expect(sdk.storage!.get("obj")).toEqual({ nested: true });
  });
});
