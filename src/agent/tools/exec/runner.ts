import { spawn } from "child_process";
import type { ExecResult, RunOptions } from "./types.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Exec");

const KILL_GRACE_MS = 5000;

export function runCommand(command: string, options: RunOptions): Promise<ExecResult> {
  const { timeout, maxOutput } = options;
  const startTime = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let resolved = false;

    const child = spawn("bash", ["-c", command], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    } as any);

    const finish = (exitCode: number | null, signal: string | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        duration: Date.now() - startTime,
        truncated,
        timedOut,
      });
    };

    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");

    child.stdout!.on("data", (chunk: string) => {
      if (stdout.length < maxOutput) {
        stdout += chunk;
        if (stdout.length > maxOutput) {
          stdout = stdout.slice(0, maxOutput);
          truncated = true;
        }
      }
    });

    child.stderr!.on("data", (chunk: string) => {
      if (stderr.length < maxOutput) {
        stderr += chunk;
        if (stderr.length > maxOutput) {
          stderr = stderr.slice(0, maxOutput);
          truncated = true;
        }
      }
    });

    child.on("close", (code, sig) => {
      finish(code, sig);
    });

    child.on("error", (err) => {
      log.error({ err }, "Spawn error");
      stderr += err.message;
      finish(1, null);
    });

    // Timeout handling: SIGTERM then SIGKILL
    let killTimer: ReturnType<typeof setTimeout>;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      log.warn({ command, timeout }, "Command timed out, sending SIGTERM");
      killProcessGroup(child.pid!, "SIGTERM");

      killTimer = setTimeout(() => {
        log.warn({ command }, "Grace period expired, sending SIGKILL");
        killProcessGroup(child.pid!, "SIGKILL");
      }, KILL_GRACE_MS);
    }, timeout);
  });
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Process already dead — expected
  }
}
