import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
  existsSync: vi.fn(() => true),
  lstatSync: vi.fn(),
}));

vi.mock("../../workspace/validator.js", () => ({
  validateReadPath: vi.fn(),
  validatePath: vi.fn(),
  validateWritePath: vi.fn(),
  validateDirectory: vi.fn(),
  WorkspaceSecurityError: class WorkspaceSecurityError extends Error {
    constructor(
      message: string,
      public readonly attemptedPath: string
    ) {
      super(message);
      this.name = "WorkspaceSecurityError";
    }
  },
}));

vi.mock("../../workspace/paths.js", () => ({
  WORKSPACE_ROOT: "/tmp/test-workspace",
}));

vi.mock("../../utils/errors.js", () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { readFileSync, statSync } from "node:fs";
import { validateReadPath, WorkspaceSecurityError } from "../../workspace/validator.js";
import { createWorkspaceRoutes } from "../routes/workspace.js";
import type { WebUIServerDeps } from "../types.js";

describe("GET /workspace/raw", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/workspace", createWorkspaceRoutes({} as WebUIServerDeps));
  });

  it("serves .png files with correct Content-Type", async () => {
    const buf = Buffer.from("fake-png-data");
    vi.mocked(validateReadPath).mockReturnValue({
      absolutePath: "/tmp/test-workspace/test.png",
      relativePath: "test.png",
      exists: true,
      isDirectory: false,
      extension: ".png",
      filename: "test.png",
    });
    vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);
    vi.mocked(readFileSync).mockReturnValue(buf as any);

    const res = await app.request("/workspace/raw?path=test.png");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(buf);
  });

  it("serves .jpg files with correct Content-Type", async () => {
    const buf = Buffer.from("fake-jpg-data");
    vi.mocked(validateReadPath).mockReturnValue({
      absolutePath: "/tmp/test-workspace/photo.jpg",
      relativePath: "photo.jpg",
      exists: true,
      isDirectory: false,
      extension: ".jpg",
      filename: "photo.jpg",
    });
    vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);
    vi.mocked(readFileSync).mockReturnValue(buf as any);

    const res = await app.request("/workspace/raw?path=photo.jpg");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("serves .svg files with sandbox CSP header", async () => {
    const buf = Buffer.from("<svg></svg>");
    vi.mocked(validateReadPath).mockReturnValue({
      absolutePath: "/tmp/test-workspace/icon.svg",
      relativePath: "icon.svg",
      exists: true,
      isDirectory: false,
      extension: ".svg",
      filename: "icon.svg",
    });
    vi.mocked(statSync).mockReturnValue({ size: 256 } as any);
    vi.mocked(readFileSync).mockReturnValue(buf as any);

    const res = await app.request("/workspace/raw?path=icon.svg");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
  });

  it("returns 415 for unsupported file types", async () => {
    vi.mocked(validateReadPath).mockReturnValue({
      absolutePath: "/tmp/test-workspace/readme.txt",
      relativePath: "readme.txt",
      exists: true,
      isDirectory: false,
      extension: ".txt",
      filename: "readme.txt",
    });

    const res = await app.request("/workspace/raw?path=readme.txt");

    expect(res.status).toBe(415);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Unsupported");
  });

  it("returns 400 when path query param is missing", async () => {
    const res = await app.request("/workspace/raw");

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("path");
  });

  it("returns 403 on path traversal attempt", async () => {
    vi.mocked(validateReadPath).mockImplementation(() => {
      throw new WorkspaceSecurityError("Path traversal detected", "../../etc/passwd");
    });

    const res = await app.request("/workspace/raw?path=../../etc/passwd");

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Path traversal");
  });

  it("returns 413 when file exceeds 5MB limit", async () => {
    vi.mocked(validateReadPath).mockReturnValue({
      absolutePath: "/tmp/test-workspace/huge.png",
      relativePath: "huge.png",
      exists: true,
      isDirectory: false,
      extension: ".png",
      filename: "huge.png",
    });
    vi.mocked(statSync).mockReturnValue({
      size: 6 * 1024 * 1024,
    } as any);

    const res = await app.request("/workspace/raw?path=huge.png");

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("5MB");
  });
});
