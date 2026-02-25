import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock readRawConfig and writeRawConfig, keep everything else real
const mockReadRawConfig = vi.fn();
const mockWriteRawConfig = vi.fn();

vi.mock("../../config/configurable-keys.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/configurable-keys.js")>();
  return {
    ...actual,
    readRawConfig: (...args: any[]) => mockReadRawConfig(...args),
    writeRawConfig: (...args: any[]) => mockWriteRawConfig(...args),
  };
});

import { createConfigRoutes } from "../routes/config.js";
import type { WebUIServerDeps } from "../types.js";

function createTestApp(mockConfig: Record<string, any>) {
  const deps = {
    configPath: "/tmp/test.yaml",
    agent: {
      getConfig: () => mockConfig,
    },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/api/config", createConfigRoutes(deps));
  return app;
}

describe("GET /api/config — array keys", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp({});
  });

  it("returns array value as JSON string", async () => {
    mockReadRawConfig.mockReturnValue({ telegram: { admin_ids: [123, 456] } });

    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const json = await res.json();
    const keyData = json.data.find((k: any) => k.key === "telegram.admin_ids");
    expect(keyData.value).toBe("[123,456]");
  });

  it("returns type 'array' and itemType 'number'", async () => {
    mockReadRawConfig.mockReturnValue({ telegram: { admin_ids: [123] } });

    const res = await app.request("/api/config");
    const json = await res.json();
    const keyData = json.data.find((k: any) => k.key === "telegram.admin_ids");
    expect(keyData.type).toBe("array");
    expect(keyData.itemType).toBe("number");
  });

  it("returns null value for unset array", async () => {
    mockReadRawConfig.mockReturnValue({ telegram: {} });

    const res = await app.request("/api/config");
    const json = await res.json();
    const keyData = json.data.find((k: any) => k.key === "telegram.admin_ids");
    expect(keyData.set).toBe(false);
    expect(keyData.value).toBeNull();
  });
});

describe("PUT /api/config/:key — arrays", () => {
  let app: ReturnType<typeof createTestApp>;
  let mockConfig: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = { telegram: {} };
    app = createTestApp(mockConfig);
    mockReadRawConfig.mockReturnValue({ telegram: {} });
    mockWriteRawConfig.mockImplementation(() => {});
  });

  it("accepts valid array of strings", async () => {
    const res = await app.request("/api/config/telegram.admin_ids", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: ["123", "456"] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    // writeRawConfig should be called with parsed numbers
    expect(mockWriteRawConfig).toHaveBeenCalledTimes(1);
    const rawArg = mockWriteRawConfig.mock.calls[0][0];
    expect(rawArg.telegram.admin_ids).toEqual([123, 456]);
  });

  it("rejects non-array value for array key", async () => {
    const res = await app.request("/api/config/telegram.admin_ids", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "123" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("must be an array");
  });

  it("rejects array with invalid item", async () => {
    const res = await app.request("/api/config/telegram.admin_ids", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: ["123", "abc"] }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("accepts empty array", async () => {
    const res = await app.request("/api/config/telegram.admin_ids", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: [] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const rawArg = mockWriteRawConfig.mock.calls[0][0];
    expect(rawArg.telegram.admin_ids).toEqual([]);
  });

  it("updates runtime config for array", async () => {
    await app.request("/api/config/telegram.admin_ids", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: ["123"] }),
    });

    expect(mockConfig.telegram.admin_ids).toEqual([123]);
  });
});

describe("PUT /api/config/:key — existing scalars unchanged", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp({ agent: { model: "old-model" } });
    mockReadRawConfig.mockReturnValue({ agent: { model: "old-model" } });
    mockWriteRawConfig.mockImplementation(() => {});
  });

  it("still accepts string value for string key", async () => {
    const res = await app.request("/api/config/agent.model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "claude-opus-4-6" }),
    });
    expect(res.status).toBe(200);
  });

  it("still rejects non-whitelisted key", async () => {
    const res = await app.request("/api/config/some.unknown.key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/config/:key — arrays", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp({ telegram: { admin_ids: [123] } });
    mockReadRawConfig.mockReturnValue({ telegram: { admin_ids: [123] } });
    mockWriteRawConfig.mockImplementation(() => {});
  });

  it("unsets array key", async () => {
    const res = await app.request("/api/config/telegram.admin_ids", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.set).toBe(false);
    expect(json.data.value).toBeNull();
  });
});
