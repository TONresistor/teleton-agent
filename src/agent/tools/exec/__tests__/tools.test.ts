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

function commandResult(
  overrides: Partial<Awaited<ReturnType<typeof runCommand>>> = {}
): Awaited<ReturnType<typeof runCommand>> {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    duration: 10,
    truncated: false,
    timedOut: false,
    ...overrides,
  };
}

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
    bridge: { getMode: () => "user" } as any,
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
    mockRunCommand.mockResolvedValue(commandResult({ stdout: "hello\n", duration: 50 }));

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
    mockRunCommand.mockResolvedValue(commandResult({ stderr: "not found\n", exitCode: 127 }));

    const executor = createExecRunExecutor(db, makeExecConfig());
    const result = await executor({ command: "nonexistent" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("127");
  });

  it("logs audit entry before and after execution", async () => {
    mockRunCommand.mockResolvedValue(commandResult({ stdout: "ok", duration: 100 }));

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
    mockRunCommand.mockResolvedValue(commandResult());

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

  it.each([
    ["apt", "nginx curl", "apt install -y nginx curl"],
    ["pip", "flask", "pip install flask"],
    ["npm", "pm2", "npm install -g pm2"],
    ["docker", "nginx:latest", "docker pull nginx:latest"],
  ] as const)("constructs the correct %s command", async (manager, packages, command) => {
    mockRunCommand.mockResolvedValue(commandResult());

    const executor = createExecInstallExecutor(db, makeExecConfig());
    await executor({ manager, packages }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith(command, expect.any(Object));
  });

  it("logs audit entry", async () => {
    mockRunCommand.mockResolvedValue(commandResult({ duration: 1000 }));

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
    mockRunCommand.mockResolvedValue(commandResult({ stdout: "active", duration: 100 }));

    const executor = createExecServiceExecutor(db, makeExecConfig());
    await executor({ action: "status", name: "nginx" }, makeContext());

    expect(mockRunCommand).toHaveBeenCalledWith("systemctl status nginx", expect.any(Object));
  });

  it("logs audit entry", async () => {
    mockRunCommand.mockResolvedValue(commandResult({ duration: 200 }));

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
    mockRunCommand.mockResolvedValue(commandResult({ stdout: "some output", duration: 50 }));

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
        return commandResult({
          stderr: "free: command not found",
          exitCode: 127,
        });
      }
      return commandResult({ stdout: "some data" });
    });

    const executor = createExecStatusExecutor(db, makeExecConfig());
    const result = await executor({} as any, makeContext());

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      memory: expect.stringContaining("failed"),
      disk: "some data",
    });
  });
});
