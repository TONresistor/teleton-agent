/**
 * Built-in module loader — discovers and registers plugin modules.
 * Unlike plugin-loader.ts (external ~/.teleton/plugins/), this handles
 * first-party modules that ship with the codebase (deals, etc.)
 */

import type { PluginModule } from "./types.js";
import type { ToolRegistry } from "./registry.js";
import type { Config } from "../../config/schema.js";
import type Database from "better-sqlite3";
import dealsModule from "../../deals/module.js";
import { execModule } from "./exec/index.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("ModuleLoader");

const BUILTIN_MODULES: PluginModule[] = [dealsModule, execModule];

export function loadModules(
  registry: ToolRegistry,
  config: Config,
  db: Database.Database
): PluginModule[] {
  const loaded: PluginModule[] = [];

  for (const mod of BUILTIN_MODULES) {
    try {
      mod.configure?.(config);

      mod.migrate?.(db);

      const tools = mod.tools(config);
      for (const { tool, executor, scope } of tools) {
        registry.register(tool, executor, scope);
      }

      loaded.push(mod);
    } catch (error) {
      log.error({ err: error }, `Module "${mod.name}" failed to load`);
    }
  }

  return loaded;
}
