import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TonProxyManager, type TonProxyManagerDependencies } from "../manager.js";

class FakeChild extends EventEmitter {
  readonly pid: number;
  exitCode: number | null = null;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    if (this.exitCode !== null) return false;
    this.exitCode = 0;
    this.emit("exit", 0, signal);
    return true;
  });

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  crash(): void {
    this.exitCode = 1;
    this.emit("exit", 1, null);
  }
}

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "teleton-ton-proxy-"));
  roots.push(root);
  return root;
}

function makeDependencies(
  root: string,
  overrides: Partial<TonProxyManagerDependencies> = {}
): TonProxyManagerDependencies {
  return {
    binaryDir: join(root, "bin"),
    pidFile: join(root, "ton-proxy.pid"),
    release: { tag: "v1.2.3", assets: {} },
    fetch: vi.fn(),
    spawn: vi.fn(),
    killProcess: vi.fn(),
    isProcessAlive: vi.fn(() => false),
    isExpectedProcess: vi.fn(() => false),
    isPortListening: vi.fn(async () => false),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

function installFakeBinary(manager: TonProxyManager): void {
  const path = manager.getBinaryPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "fake binary", { mode: 0o755 });
  chmodSync(path, 0o755);
}

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("TonProxyManager", () => {
  it("verifies the release asset digest before atomically installing it", async () => {
    const root = makeRoot();
    const content = Buffer.from("verified ton proxy binary");
    const digest = createHash("sha256").update(content).digest("hex");
    const fetchMock = vi.fn();
    const deps = makeDependencies(root, { fetch: fetchMock as typeof fetch });
    const manager = new TonProxyManager({ enabled: true, port: 8080 }, deps);
    const binaryName = basename(manager.getBinaryPath());

    deps.release.assets[binaryName] = { size: content.length, digest: `sha256:${digest}` };
    fetchMock.mockResolvedValueOnce(new Response(content, { status: 200 }));

    await manager.install();

    expect(readFileSync(manager.getBinaryPath())).toEqual(content);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("removes a download whose digest does not match", async () => {
    const root = makeRoot();
    const content = Buffer.from("tampered binary");
    const fetchMock = vi.fn();
    const deps = makeDependencies(root, { fetch: fetchMock as typeof fetch });
    const manager = new TonProxyManager({ enabled: true, port: 8080 }, deps);
    const binaryName = basename(manager.getBinaryPath());

    deps.release.assets[binaryName] = {
      size: content.length,
      digest: `sha256:${"0".repeat(64)}`,
    };
    fetchMock.mockResolvedValueOnce(new Response(content, { status: 200 }));

    await expect(manager.install()).rejects.toThrow("digest mismatch");
    expect(existsSync(manager.getBinaryPath())).toBe(false);
  });

  it("never kills an unverified PID or an unrelated port owner", async () => {
    const root = makeRoot();
    const killProcess = vi.fn();
    const spawn = vi.fn();
    const deps = makeDependencies(root, {
      killProcess,
      spawn,
      isProcessAlive: vi.fn(() => true),
      isExpectedProcess: vi.fn(() => false),
      isPortListening: vi.fn(async () => true),
    });
    const manager = new TonProxyManager({ enabled: true, port: 8080 }, deps);
    installFakeBinary(manager);
    writeFileSync(deps.pidFile, JSON.stringify({ pid: 4242 }));

    await expect(manager.start()).rejects.toThrow("port 8080 is already in use");

    expect(killProcess).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("terminates an unhealthy proxy after three failed TCP probes", async () => {
    vi.useFakeTimers();
    const root = makeRoot();
    let spawned = false;
    let healthy = true;
    const child = new FakeChild(1001);
    const deps = makeDependencies(root, {
      spawn: vi.fn(() => {
        spawned = true;
        return child as unknown as ChildProcess;
      }),
      isPortListening: vi.fn(async () => spawned && healthy),
    });
    const manager = new TonProxyManager({ enabled: true, port: 8080 }, deps);
    installFakeBinary(manager);
    await manager.start();

    healthy = false;
    const checkHealth = manager as unknown as { checkHealth(): Promise<void> };
    await checkHealth.checkHealth();
    await checkHealth.checkHealth();
    expect(child.kill).not.toHaveBeenCalled();
    await checkHealth.checkHealth();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("caps automatic restarts without resetting the attempt counter", async () => {
    vi.useFakeTimers();
    const root = makeRoot();
    let spawned = false;
    const children: FakeChild[] = [];
    const spawn = vi.fn(() => {
      const child = new FakeChild(2000 + children.length);
      children.push(child);
      spawned = true;
      return child as unknown as ChildProcess;
    });
    const deps = makeDependencies(root, {
      spawn,
      isPortListening: vi.fn(async () => spawned),
    });
    const manager = new TonProxyManager({ enabled: true, port: 8080 }, deps);
    installFakeBinary(manager);
    await manager.start();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      spawned = false;
      children[attempt].crash();
      await vi.advanceTimersByTimeAsync(1_000);
    }

    spawned = false;
    children[3].crash();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(spawn).toHaveBeenCalledTimes(4);
    expect(manager.isRunning()).toBe(false);
  });
});
