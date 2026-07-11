/**
 * TON Proxy manager — downloads, starts, stops the Tonutils-Proxy binary.
 *
 * Binary source: https://github.com/xssnick/Tonutils-Proxy
 * The CLI binary exposes an HTTP proxy on 127.0.0.1:<port> for .ton sites.
 */

import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { createConnection } from "node:net";
import { basename, dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { TonProxyConfig } from "../config/schema.js";
import { createLogger } from "../utils/logger.js";
import { TELETON_ROOT } from "../workspace/paths.js";

const log = createLogger("TonProxy");

const GITHUB_REPO = "xssnick/Tonutils-Proxy";
const DEFAULT_BINARY_DIR = join(TELETON_ROOT, "bin");
const DEFAULT_PID_FILE = join(TELETON_ROOT, "ton-proxy.pid");
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_FAILURE_LIMIT = 3;
const PORT_PROBE_TIMEOUT_MS = 500;
const STARTUP_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 5_000;
const RESTART_DELAY_MS = 1_000;
const RESTART_STABILITY_MS = 5 * 60_000;
const MAX_RESTARTS = 3;
const MAX_BINARY_SIZE_BYTES = 50 * 1024 * 1024;

interface ReleaseAsset {
  size: number;
  digest: string;
}

export interface TonProxyReleaseManifest {
  tag: string;
  assets: Record<string, ReleaseAsset>;
}

const PINNED_RELEASE: TonProxyReleaseManifest = {
  tag: "v1.8.3",
  assets: {
    "tonutils-proxy-cli-darwin-amd64": {
      size: 18_080_160,
      digest: "sha256:ae9e85bc909318606246a45325c20fa148300989b9405f6696dc298fc87fdcef",
    },
    "tonutils-proxy-cli-darwin-arm64": {
      size: 17_283_778,
      digest: "sha256:d8d4720700a2c59cd2b5947a6d2f7119542b8baa51a2e6b2c247f3a099b8174b",
    },
    "tonutils-proxy-cli-linux-amd64": {
      size: 18_096_026,
      digest: "sha256:8df4974e198db5c7de5883b6ec9b0d3e8e6fda90c0d42c8f6bc0164b9f94aa32",
    },
    "tonutils-proxy-cli-windows-amd64.exe": {
      size: 18_446_336,
      digest: "sha256:4a3ef2798d65f76d62414d38bb53418e6fb33d11badac263ca5946f9359f6ba8",
    },
  },
};

export interface TonProxyManagerDependencies {
  binaryDir: string;
  pidFile: string;
  release: TonProxyReleaseManifest;
  fetch: typeof fetch;
  spawn: (
    command: string,
    args: string[],
    options: {
      cwd: string;
      stdio: ["ignore", "pipe", "pipe"];
      detached: false;
    }
  ) => ChildProcess;
  killProcess: (pid: number, signal: NodeJS.Signals | 0) => void;
  isProcessAlive: (pid: number) => boolean;
  isExpectedProcess: (pid: number, binaryPath: string) => boolean;
  isPortListening: (port: number) => Promise<boolean>;
  sleep: (milliseconds: number) => Promise<void>;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isExpectedProcess(pid: number, binaryPath: string): boolean {
  if (!isProcessAlive(pid)) return false;

  try {
    const expectedPath = realpathSync(binaryPath);

    if (process.platform === "linux") {
      return realpathSync(`/proc/${pid}/exe`) === expectedPath;
    }

    if (process.platform === "darwin") {
      const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
        timeout: 3_000,
      });
      if (result.status !== 0) return false;
      const command = result.stdout.trim();
      return command === expectedPath || command.startsWith(`${expectedPath} `);
    }
  } catch {
    return false;
  }

  // Fail closed on platforms where process identity cannot be established.
  return false;
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;

    const finish = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(PORT_PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

const DEFAULT_DEPENDENCIES: TonProxyManagerDependencies = {
  binaryDir: DEFAULT_BINARY_DIR,
  pidFile: DEFAULT_PID_FILE,
  release: PINNED_RELEASE,
  fetch: globalThis.fetch,
  spawn: (command, args, options) => spawn(command, args, options),
  killProcess: (pid, signal) => {
    process.kill(pid, signal);
  },
  isProcessAlive,
  isExpectedProcess,
  isPortListening,
  sleep,
};

export class TonProxyManager {
  private process: ChildProcess | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartResetTimer: ReturnType<typeof setTimeout> | null = null;
  private startPromise: Promise<void> | null = null;
  private readonly config: TonProxyConfig;
  private readonly dependencies: TonProxyManagerDependencies;
  private restartCount = 0;
  private healthFailures = 0;
  private stopping = false;

  constructor(config: TonProxyConfig, dependencies: Partial<TonProxyManagerDependencies> = {}) {
    this.config = config;
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  }

  /** Resolve the binary path — user-specified or auto-detected. */
  getBinaryPath(): string {
    if (this.config.binary_path) return this.config.binary_path;
    return join(this.dependencies.binaryDir, getBinaryName());
  }

  /** Check if the binary exists on disk. */
  isInstalled(): boolean {
    return existsSync(this.getBinaryPath());
  }

  /** Whether the proxy process is currently running. */
  isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /**
   * Download the reviewed CLI release and verify its pinned SHA-256 digest
   * before atomically promoting it into place.
   */
  async install(): Promise<void> {
    if (this.config.binary_path) {
      throw new Error(`Configured TON Proxy binary does not exist: ${this.config.binary_path}`);
    }

    const binaryName = getBinaryName();
    log.info(`Downloading TON Proxy binary (${binaryName})...`);
    await mkdir(this.dependencies.binaryDir, { recursive: true });

    const release = this.dependencies.release;
    const asset = release.assets[binaryName];
    if (!asset) {
      throw new Error(`Pinned release ${release.tag} has no asset named ${binaryName}`);
    }
    if (
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > MAX_BINARY_SIZE_BYTES
    ) {
      throw new Error(`Invalid TON Proxy asset size: ${asset.size}`);
    }
    if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) {
      throw new Error(`Release asset ${binaryName} has no valid SHA-256 digest`);
    }
    const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(binaryName)}`;
    const binaryResponse = await this.dependencies.fetch(downloadUrl, {
      headers: { Accept: "application/octet-stream", "User-Agent": "teleton-agent" },
    });
    if (!binaryResponse.ok || !binaryResponse.body) {
      throw new Error(
        `Download failed: ${binaryResponse.status} ${binaryResponse.statusText}`.trim()
      );
    }

    const destination = this.getBinaryPath();
    const temporaryPath = join(
      dirname(destination),
      `.${basename(destination)}.${process.pid}.${randomUUID()}.download`
    );
    const hash = createHash("sha256");
    let downloadedBytes = 0;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        downloadedBytes += buffer.length;
        if (downloadedBytes > MAX_BINARY_SIZE_BYTES) {
          callback(new Error("TON Proxy download exceeds 50 MB"));
          return;
        }
        hash.update(buffer);
        callback(null, buffer);
      },
    });

    try {
      await pipeline(
        binaryResponse.body as unknown as NodeJS.ReadableStream,
        verifier,
        createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 })
      );

      if (downloadedBytes !== asset.size) {
        throw new Error(
          `TON Proxy asset size mismatch: expected ${asset.size}, received ${downloadedBytes}`
        );
      }
      const expectedDigest = asset.digest.slice("sha256:".length).toLowerCase();
      const actualDigest = hash.digest("hex");
      if (actualDigest !== expectedDigest) {
        throw new Error(
          `TON Proxy asset digest mismatch: expected ${expectedDigest}, received ${actualDigest}`
        );
      }

      chmodSync(temporaryPath, 0o755);
      renameSync(temporaryPath, destination);
    } catch (error) {
      try {
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      } catch {
        // Preserve the original verification error.
      }
      throw error;
    }

    log.info(`TON Proxy installed: ${destination} (${release.tag})`);
  }

  /** Start the proxy process. Concurrent callers share the same startup. */
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.isRunning()) {
      log.warn("TON Proxy is already running");
      return;
    }

    this.stopping = false;
    this.restartCount = 0;
    this.clearRestartTimer();

    const startup = this.startInitialProcess();
    this.startPromise = startup;
    try {
      await startup;
    } finally {
      if (this.startPromise === startup) this.startPromise = null;
    }
  }

  private async startInitialProcess(): Promise<void> {
    await this.cleanupOrphan();

    if (!this.isInstalled()) await this.install();
    await this.assertPortAvailable();

    await this.launchProcess();
  }

  private async launchProcess(): Promise<void> {
    const binaryPath = this.getBinaryPath();
    const port = String(this.config.port);
    log.info(`Starting TON Proxy on 127.0.0.1:${port}`);

    const child = this.dependencies.spawn(binaryPath, ["-addr", `127.0.0.1:${port}`], {
      cwd: dirname(binaryPath),
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    this.process = child;
    let ready = false;
    let spawnError: Error | null = null;

    child.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) log.debug(`[proxy] ${line}`);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) log.warn(`[proxy:err] ${line}`);
    });
    child.once("error", (error) => {
      spawnError = error;
      log.error({ err: error }, "TON Proxy process error");
    });
    child.once("exit", (code, signal) => {
      const wasCurrentProcess = this.process === child;
      if (wasCurrentProcess) {
        this.process = null;
        this.stopHealthCheck();
        this.clearRestartResetTimer();
        this.removePidFile();
      }
      log.info(`TON Proxy exited (code=${code}, signal=${signal})`);

      if (ready && wasCurrentProcess && !this.stopping) this.scheduleRestart();
    });

    try {
      await this.waitUntilReady(child, () => spawnError);
    } catch (error) {
      if (this.process === child) this.process = null;
      this.removePidFile();
      if (child.exitCode === null) child.kill("SIGTERM");
      throw error;
    }

    if (this.process !== child || child.exitCode !== null) {
      throw new Error("TON Proxy process exited as startup completed");
    }

    ready = true;
    this.healthFailures = 0;
    if (child.pid) this.writePidFile(child.pid);
    this.startHealthCheck();
    this.scheduleRestartReset();
    log.info(`TON Proxy running on 127.0.0.1:${port} (PID ${child.pid})`);
  }

  private async waitUntilReady(
    child: ChildProcess,
    getSpawnError: () => Error | null
  ): Promise<void> {
    const attempts = Math.ceil(STARTUP_TIMEOUT_MS / 100);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const error = getSpawnError();
      if (error) throw new Error(`TON Proxy failed to spawn: ${error.message}`);
      if (this.process !== child || child.exitCode !== null) {
        throw new Error("TON Proxy process exited during startup");
      }
      if (await this.dependencies.isPortListening(this.config.port)) return;
      await this.dependencies.sleep(100);
    }
    throw new Error(`TON Proxy did not listen on port ${this.config.port} within 10 seconds`);
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return;
    if (this.restartCount >= MAX_RESTARTS) {
      log.error(`TON Proxy restart limit reached (${MAX_RESTARTS})`);
      return;
    }

    this.restartCount += 1;
    const attempt = this.restartCount;
    log.warn(`Auto-restarting TON Proxy (attempt ${attempt}/${MAX_RESTARTS})`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping || this.isRunning()) return;
      const restart = this.assertPortAvailable().then(() => this.launchProcess());
      this.startPromise = restart;
      void restart
        .catch((error) => {
          log.error({ err: error }, `TON Proxy restart attempt ${attempt} failed`);
          this.scheduleRestart();
        })
        .finally(() => {
          if (this.startPromise === restart) this.startPromise = null;
        });
    }, RESTART_DELAY_MS);
  }

  /** Stop the proxy process and cancel every pending restart. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer();
    this.clearRestartResetTimer();
    this.stopHealthCheck();

    const child = this.process;
    if (!child) {
      this.removePidFile();
      return;
    }

    log.info("Stopping TON Proxy...");
    await this.terminateChild(child);
    if (this.process === child) this.process = null;
    this.removePidFile();
  }

  /** Remove only a Teleton-managed download, never a user-owned custom binary. */
  async uninstall(): Promise<void> {
    if (this.isRunning()) await this.stop();
    if (this.config.binary_path) {
      log.info("Configured TON Proxy binary is externally managed and was not removed");
      return;
    }

    const binaryPath = this.getBinaryPath();
    if (existsSync(binaryPath)) {
      const { unlink } = await import("node:fs/promises");
      await unlink(binaryPath);
      log.info(`TON Proxy binary removed: ${binaryPath}`);
    }
  }

  /** Get proxy status for WebUI / tools. */
  getStatus(): { running: boolean; port: number; installed: boolean; pid?: number } {
    return {
      running: this.isRunning(),
      port: this.config.port,
      installed: this.isInstalled(),
      pid: this.process?.pid,
    };
  }

  private async cleanupOrphan(): Promise<void> {
    if (!existsSync(this.dependencies.pidFile)) return;

    const pid = this.readPidFile();
    if (!pid) {
      log.warn("Removing invalid TON Proxy PID file");
      this.removePidFile();
      return;
    }
    if (!this.dependencies.isProcessAlive(pid)) {
      this.removePidFile();
      return;
    }
    if (!this.dependencies.isExpectedProcess(pid, this.getBinaryPath())) {
      log.warn(`Refusing to kill unverified process from TON Proxy PID file (PID ${pid})`);
      this.removePidFile();
      return;
    }

    log.warn(`Stopping orphan TON Proxy (PID ${pid}) from previous session`);
    this.dependencies.killProcess(pid, "SIGTERM");
    if (!(await this.waitForPidExit(pid, KILL_GRACE_MS))) {
      log.warn(`Orphan TON Proxy PID ${pid} did not exit gracefully, sending SIGKILL`);
      this.dependencies.killProcess(pid, "SIGKILL");
      if (!(await this.waitForPidExit(pid, 1_000))) {
        throw new Error(`Unable to stop verified orphan TON Proxy process ${pid}`);
      }
    }
    this.removePidFile();
  }

  private async waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
    const attempts = Math.ceil(timeoutMs / 100);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!this.dependencies.isProcessAlive(pid)) return true;
      await this.dependencies.sleep(100);
    }
    return !this.dependencies.isProcessAlive(pid);
  }

  private readPidFile(): number | null {
    try {
      const value = readFileSync(this.dependencies.pidFile, "utf8").trim();
      const parsed = value.startsWith("{") ? (JSON.parse(value) as { pid?: unknown }).pid : value;
      const pid = typeof parsed === "number" ? parsed : Number(parsed);
      return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
    } catch {
      return null;
    }
  }

  private writePidFile(pid: number): void {
    const temporaryPath = `${this.dependencies.pidFile}.${process.pid}.tmp`;
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify({ pid, binaryPath: this.getBinaryPath(), startedAt: Date.now() })}\n`,
        { mode: 0o600, flag: "w" }
      );
      renameSync(temporaryPath, this.dependencies.pidFile);
    } catch {
      try {
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      } catch {
        // Best-effort cleanup.
      }
      log.warn("Failed to write TON Proxy PID file");
    }
  }

  private removePidFile(): void {
    try {
      if (existsSync(this.dependencies.pidFile)) unlinkSync(this.dependencies.pidFile);
    } catch {
      // Best-effort cleanup.
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthInterval = setInterval(() => {
      void this.checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthCheck(): void {
    if (!this.healthInterval) return;
    clearInterval(this.healthInterval);
    this.healthInterval = null;
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private scheduleRestartReset(): void {
    this.clearRestartResetTimer();
    if (this.restartCount === 0) return;
    this.restartResetTimer = setTimeout(() => {
      this.restartResetTimer = null;
      this.restartCount = 0;
      log.info("TON Proxy restart counter reset after stable operation");
    }, RESTART_STABILITY_MS);
  }

  private clearRestartResetTimer(): void {
    if (!this.restartResetTimer) return;
    clearTimeout(this.restartResetTimer);
    this.restartResetTimer = null;
  }

  private async assertPortAvailable(): Promise<void> {
    if (!(await this.dependencies.isPortListening(this.config.port))) return;
    throw new Error(
      `TON Proxy port ${this.config.port} is already in use; refusing to terminate its owner`
    );
  }

  private async checkHealth(): Promise<void> {
    const child = this.process;
    if (!child || child.exitCode !== null) return;

    if (await this.dependencies.isPortListening(this.config.port)) {
      this.healthFailures = 0;
      return;
    }

    this.healthFailures += 1;
    log.warn(`TON Proxy health check failed (${this.healthFailures}/${HEALTH_FAILURE_LIMIT})`);
    if (this.healthFailures < HEALTH_FAILURE_LIMIT) return;

    this.healthFailures = 0;
    this.stopHealthCheck();
    log.error("TON Proxy remained unhealthy; restarting it");
    void this.terminateChild(child).catch((error) => {
      log.error({ err: error }, "Failed to terminate unhealthy TON Proxy");
    });
  }

  private async terminateChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceKill);
        clearTimeout(safetyTimeout);
        child.off("exit", finish);
        resolve();
      };
      const forceKill = setTimeout(() => {
        if (child.exitCode === null) {
          log.warn("TON Proxy did not exit gracefully, sending SIGKILL");
          child.kill("SIGKILL");
        }
      }, KILL_GRACE_MS);
      const safetyTimeout = setTimeout(finish, KILL_GRACE_MS + 1_000);
      child.once("exit", finish);
      child.kill("SIGTERM");
    });
  }
}

/** Get the platform-specific binary name. */
function getBinaryName(): string {
  const platform = process.platform;
  const arch = process.arch;

  let os: string;
  switch (platform) {
    case "linux":
      os = "linux";
      break;
    case "darwin":
      os = "darwin";
      break;
    case "win32":
      os = "windows";
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  let cpuArch: string;
  switch (arch) {
    case "x64":
      cpuArch = "amd64";
      break;
    case "arm64":
      cpuArch = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }

  const extension = platform === "win32" ? ".exe" : "";
  return `tonutils-proxy-cli-${os}-${cpuArch}${extension}`;
}
