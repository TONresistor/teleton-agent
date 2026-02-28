import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../../memory/schema.js";
import type { ExecConfig } from "../../../../config/schema.js";
import type { ToolContext } from "../../types.js";
import { createExecRunExecutor } from "../run.js";
import { createExecInstallExecutor } from "../install.js";
import { createExecServiceExecutor } from "../service.js";
import { createExecStatusExecutor } from "../status.js";

// Mock the runner to avoid real command execution
vi.mock("../runner.js", () => ({
  runCommand: vi.fn(),
}));

import { runCommand } from "../runner.js";

const mockRunCommand = vi.mocked(runCommand);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  ensureSchema(db);
  return db;
}

function makeExecConfig(overrides?: Partial<ExecConfig>): ExecConfig {
  return {
    mode: "yolo",
    scope: "admin-only",
    allowlist: [],
    limits: { timeout: 120, max_output: 50000 },
    audit: { log_commands: true },
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    bridge: {} as any,
    db: new Database(":memory:"),
    chatId: "123",
    senderId: 42,
    isGroup: false,
    ...overrides,
  };
}

describe("exec_run", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  it("calls runner with correct command and returns result", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 50,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecRunExecutor(db, makeExecConfig());
    const result = await executor({ command: "echo hello" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      stdout: "hello\n",
      exitCode: 0,
      timedOut: false,
    });
    expect(mockRunCommand).toHaveBeenCalledWith("echo hello", {
      timeout: 120000,
      maxOutput: 50000,
    });
  });

  it("returns error when command fails", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "not found\n",
      exitCode: 127,
      signal: null,
      duration: 10,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecRunExecutor(db, makeExecConfig());
    const result = await executor({ command: "nonexistent" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("127");
  });

  it("logs audit entry before and after execution", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 100,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecRunExecutor(db, makeExecConfig());
    await executor({ command: "ls" }, makeContext());

    const rows = db.prepare("SELECT * FROM exec_audit").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tool).toBe("exec_run");
    expect(rows[0].command).toBe("ls");
    expect(rows[0].status).toBe("success");
    expect(rows[0].exit_code).toBe(0);
    expect(rows[0].duration_ms).toBe(100);
  });

  it("skips audit when log_commands is false", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 10,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecRunExecutor(db, makeExecConfig({ audit: { log_commands: false } }));
    await executor({ command: "ls" }, makeContext());

    const rows = db.prepare("SELECT * FROM exec_audit").all();
    expect(rows).toHaveLength(0);
  });
});

describe("exec_install", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  it("constructs correct command for apt", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "installed",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 5000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "apt", packages: "nginx curl" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("apt install -y nginx curl", expect.any(Object));
  });

  it("constructs correct command for pip", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 1000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "pip", packages: "flask" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("pip install flask", expect.any(Object));
  });

  it("constructs correct command for npm", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 1000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "npm", packages: "pm2" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("npm install -g pm2", expect.any(Object));
  });

  it("constructs correct command for docker", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 3000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "docker", packages: "nginx:latest" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("docker pull nginx:latest", expect.any(Object));
  });

  it("logs audit entry", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 1000,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager: "apt", packages: "nginx" }, makeContext());

    const rows = db.prepare("SELECT * FROM exec_audit").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tool).toBe("exec_install");
    expect(rows[0].command).toBe("apt install -y nginx");
  });
});

describe("exec_service", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  it("constructs systemctl command", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "active",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 100,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecServiceExecutor(db, makeExecConfig());
    await executor({ action: "status", name: "nginx" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("systemctl status nginx", expect.any(Object));
  });

  it("logs audit entry", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 200,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecServiceExecutor(db, makeExecConfig());
    await executor({ action: "restart", name: "docker" }, makeContext());

    const rows = db.prepare("SELECT * FROM exec_audit").all() as any[];
    expect(rows[0].tool).toBe("exec_service");
    expect(rows[0].command).toBe("systemctl restart docker");
  });
});

describe("exec_status", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  it("returns structured status data", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "some output",
      stderr: "",
      exitCode: 0,
      signal: null,
      duration: 50,
      truncated: false,
      timedOut: false,
    });

    const executor = createExecStatusExecutor(db, makeExecConfig());
    const result = await executor({} as any, makeContext());

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty("disk");
    expect(result.data).toHaveProperty("memory");
    expect(result.data).toHaveProperty("uptime");
    expect(result.data).toHaveProperty("load");
    expect(result.data).toHaveProperty("os");
    expect(result.data).toHaveProperty("cpu");
  });

  it("handles partial command failures gracefully", async () => {
    let callCount = 0;
    mockRunCommand.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        return {
          stdout: "",
          stderr: "free: command not found",
          exitCode: 127,
          signal: null,
          duration: 10,
          truncated: false,
          timedOut: false,
        };
      }
      return {
        stdout: "some data",
        stderr: "",
        exitCode: 0,
        signal: null,
        duration: 10,
        truncated: false,
        timedOut: false,
      };
    });

    const executor = createExecStatusExecutor(db, makeExecConfig());
    const result = await executor({} as any, makeContext());

    expect(result.success).toBe(true);
    // memory should contain the failure message
    expect(result.data.memory).toContain("failed");
    // other keys should have data
    expect(result.data.disk).toBe("some data");
  });
});
