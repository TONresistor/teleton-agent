import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import type { ExecConfig } from "../../../config/schema.js";
import { runCommand } from "./runner.js";
import { insertAuditEntry, updateAuditEntry } from "./audit.js";
import type Database from "better-sqlite3";

interface ExecInstallParams {
  manager: "apt" | "pip" | "npm" | "docker";
  packages: string;
}

const INSTALL_COMMANDS: Record<string, (pkgs: string) => string> = {
  apt: (pkgs) => `apt install -y ${pkgs}`,
  pip: (pkgs) => `pip install ${pkgs}`,
  npm: (pkgs) => `npm install -g ${pkgs}`,
  docker: (pkgs) => `docker pull ${pkgs}`,
};

export const execInstallTool: Tool = {
  name: "exec_install",
  description:
    "Install packages using a specified package manager (apt, pip, npm, or docker pull). Constructs the correct install command automatically.",
  parameters: Type.Object({
    manager: Type.Union(
      [Type.Literal("apt"), Type.Literal("pip"), Type.Literal("npm"), Type.Literal("docker")],
      { description: "Package manager to use" }
    ),
    packages: Type.String({
      description: "Space-separated package names to install (e.g. 'nginx curl')",
    }),
  }),
};

export function createExecInstallExecutor(
  db: Database.Database,
  execConfig: ExecConfig
): ToolExecutor<ExecInstallParams> {
  return async (params, context): Promise<ToolResult> => {
    const { manager, packages } = params;
    const { timeout, max_output } = execConfig.limits;

    const buildCommand = INSTALL_COMMANDS[manager];
    if (!buildCommand) {
      return {
        success: false,
        error: `Unsupported package manager: ${manager}. Use apt, pip, npm, or docker.`,
      };
    }

    const command = buildCommand(packages);

    let auditId: number | undefined;
    if (execConfig.audit.log_commands) {
      auditId = insertAuditEntry(db, {
        userId: context.senderId,
        username: undefined,
        tool: "exec_install",
        command,
        status: "running",
        truncated: false,
      });
    }

    const result = await runCommand(command, {
      timeout: timeout * 1000,
      maxOutput: max_output,
    });

    const status = result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "failed";

    if (auditId !== undefined) {
      updateAuditEntry(db, auditId, {
        status,
        exitCode: result.exitCode ?? undefined,
        signal: result.signal ?? undefined,
        duration: result.duration,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
      });
    }

    return {
      success: result.exitCode === 0 && !result.timedOut,
      data: {
        manager,
        packages,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration: result.duration,
        truncated: result.truncated,
        timedOut: result.timedOut,
      },
      ...(result.timedOut
        ? { error: `Install timed out after ${timeout}s` }
        : result.exitCode !== 0
          ? { error: `Install failed with exit code ${result.exitCode}` }
          : {}),
    };
  };
}
