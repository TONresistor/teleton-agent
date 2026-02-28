import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { Readable } from "stream";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Must import AFTER mock
import { spawn } from "child_process";
import { runCommand } from "../runner.js";

const mockSpawn = vi.mocked(spawn);

function createMockProcess(): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  proc.stdout = new Readable({ read() {} }) as any;
  proc.stderr = new Readable({ read() {} }) as any;
  proc.stdout!.setEncoding = vi.fn().mockReturnThis();
  proc.stderr!.setEncoding = vi.fn().mockReturnThis();
  proc.pid = 12345;
  proc.kill = vi.fn();
  return proc;
}

describe("runner", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("executes command and returns stdout/stderr/exitCode", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runCommand("echo hello", { timeout: 5000, maxOutput: 50000 });

    proc.stdout!.emit("data", "hello\n");
    proc.stderr!.emit("data", "warn\n");
    proc.emit("close", 0, null);

    const result = await promise;
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("warn\n");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("truncates stdout at maxOutput chars", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runCommand("cat bigfile", { timeout: 5000, maxOutput: 10 });

    proc.stdout!.emit("data", "abcdefghijklmnop");
    proc.emit("close", 0, null);

    const result = await promise;
    expect(result.stdout).toBe("abcdefghij");
    expect(result.truncated).toBe(true);
  });

  it("truncates stderr at maxOutput chars", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runCommand("failing", { timeout: 5000, maxOutput: 5 });

    proc.stderr!.emit("data", "error: something long");
    proc.emit("close", 1, null);

    const result = await promise;
    expect(result.stderr).toBe("error");
    expect(result.truncated).toBe(true);
  });

  it("handles non-zero exit code", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runCommand("exit 42", { timeout: 5000, maxOutput: 50000 });
    proc.emit("close", 42, null);

    const result = await promise;
    expect(result.exitCode).toBe(42);
  });

  it("handles spawn error (command not found)", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runCommand("nonexistent", { timeout: 5000, maxOutput: 50000 });
    proc.emit("error", new Error("spawn ENOENT"));

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ENOENT");
  });

  it("kills process tree on timeout", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const promise = runCommand("sleep 999", { timeout: 100, maxOutput: 50000 });

    vi.advanceTimersByTime(150);

    // Process gets killed, simulate close
    proc.emit("close", null, "SIGTERM");

    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(-12345, "SIGTERM");

    killSpy.mockRestore();
  });

  it("returns duration in ms", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = runCommand("sleep 0.1", { timeout: 5000, maxOutput: 50000 });

    vi.advanceTimersByTime(50);
    proc.emit("close", 0, null);

    const result = await promise;
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});
