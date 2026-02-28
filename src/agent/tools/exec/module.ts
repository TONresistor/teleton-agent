import type Database from "better-sqlite3";
import type { Config, ExecConfig } from "../../../config/schema.js";
import type { PluginModule, ToolScope } from "../types.js";
import { createLogger } from "../../../utils/logger.js";
import { execRunTool, createExecRunExecutor } from "./run.js";
import { execInstallTool, createExecInstallExecutor } from "./install.js";
import { execServiceTool, createExecServiceExecutor } from "./service.js";
import { execStatusTool, createExecStatusExecutor } from "./status.js";

const log = createLogger("Exec");

let moduleDb: Database.Database | null = null;
let moduleConfig: ExecConfig | null = null;

function resolveScope(scope: ExecConfig["scope"]): ToolScope {
  switch (scope) {
    case "admin-only":
      return "admin-only";
    case "allowlist":
    case "all":
      return "always";
  }
}

const execModule: PluginModule = {
  name: "exec",
  version: "1.0.0",

  configure(config: Config) {
    moduleConfig = config.capabilities.exec;
  },

  migrate(db: Database.Database) {
    // exec_audit table is created in ensureSchema() — nothing extra needed here
    moduleDb = db;
  },

  tools(config: Config) {
    const execCfg = config.capabilities.exec;

    if (execCfg.mode === "off") {
      return [];
    }

    if (process.platform !== "linux") {
      log.warn("Exec capability requires Linux, disabling");
      return [];
    }

    if (!moduleDb) {
      log.error("Exec module has no database reference — tools disabled");
      return [];
    }

    const scope = resolveScope(execCfg.scope);
    const db = moduleDb;

    return [
      { tool: execRunTool, executor: createExecRunExecutor(db, execCfg), scope },
      { tool: execInstallTool, executor: createExecInstallExecutor(db, execCfg), scope },
      { tool: execServiceTool, executor: createExecServiceExecutor(db, execCfg), scope },
      { tool: execStatusTool, executor: createExecStatusExecutor(db, execCfg), scope },
    ];
  },

  async start() {
    if (!moduleConfig || moduleConfig.mode === "off") return;
    if (process.platform !== "linux") return;
    log.info({ mode: moduleConfig.mode, scope: moduleConfig.scope }, "Exec capability active");
  },
};

export default execModule;
