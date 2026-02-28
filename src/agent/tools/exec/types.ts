export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  duration: number; // ms
  truncated: boolean;
  timedOut: boolean;
}

export interface ExecAuditEntry {
  userId: number;
  username?: string;
  tool: "exec_run" | "exec_install" | "exec_service" | "exec_status";
  command: string;
  status: "running" | "success" | "failed" | "timeout" | "killed";
  exitCode?: number;
  signal?: string;
  duration?: number;
  stdout?: string;
  stderr?: string;
  truncated: boolean;
}

export interface RunOptions {
  timeout: number; // ms
  maxOutput: number; // chars
}
