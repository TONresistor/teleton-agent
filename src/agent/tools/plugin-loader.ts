/**
 * Enhanced plugin loader — discovers and loads external plugins from ~/.teleton/plugins/
 *
 * Supports a single unified format where everything is optional except `tools`:
 *
 *   export const tools = [...]              ← required (tool definitions)
 *   export const manifest = {...}           ← optional (metadata, defaultConfig, dependencies)
 *   export function migrate(db) {...}       ← optional (enables isolated DB)
 *   export async function start(ctx) {...}  ← optional (background jobs, bridge access)
 *   export async function stop() {...}      ← optional (cleanup)
 *
 * Each plugin is adapted into a PluginModule for unified lifecycle management.
 */

import { readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { WORKSPACE_PATHS, TELETON_ROOT } from "../../workspace/paths.js";
import { openModuleDb, createDbWrapper, migrateFromMainDb } from "../../utils/module-db.js";
import type { PluginModule, PluginContext, Tool, ToolExecutor, ToolScope } from "./types.js";
import type { Config } from "../../config/schema.js";
import type Database from "better-sqlite3";
import {
  validateManifest,
  validateToolDefs,
  sanitizeConfigForPlugins,
  type PluginManifest,
  type SimpleToolDef,
} from "./plugin-validator.js";
import {
  createPluginSDK,
  SDK_VERSION,
  semverSatisfies,
  type SDKDependencies,
} from "../../sdk/index.js";
import type { PluginSDK } from "../../sdk/types.js";

/** Directory for plugin-isolated databases */
const PLUGIN_DATA_DIR = join(TELETON_ROOT, "plugins", "data");

// ─── Raw Plugin Exports ───────────────────────────────────────────

interface RawPluginExports {
  tools?: SimpleToolDef[] | ((sdk: PluginSDK) => SimpleToolDef[]);
  manifest?: unknown;
  migrate?: (db: Database.Database) => void;
  start?: (ctx: EnhancedPluginContext) => Promise<void>;
  stop?: () => Promise<void>;
}

/** Extended context passed to plugin's start() (relaxed types for isolated plugins) */
interface EnhancedPluginContext extends Omit<PluginContext, "db" | "config"> {
  db: Database.Database | null;
  config: Record<string, unknown>;
  pluginConfig: Record<string, unknown>;
  log: (...args: unknown[]) => void;
}

// ─── Plugin Adaptation ────────────────────────────────────────────

/**
 * Adapt a raw plugin module into a PluginModule with full lifecycle.
 */
function adaptPlugin(
  raw: RawPluginExports,
  entryName: string,
  config: Config,
  loadedModuleNames: string[],
  sdkDeps: SDKDependencies
): PluginModule {
  // ── Resolve manifest (optional) ──
  let manifest: PluginManifest | null = null;
  if (raw.manifest) {
    try {
      manifest = validateManifest(raw.manifest);
    } catch (err) {
      console.warn(
        `⚠️  [${entryName}] invalid manifest, ignoring:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const pluginName = manifest?.name ?? entryName.replace(/\.js$/, "");
  const pluginVersion = manifest?.version ?? "0.0.0";

  // ── Validate dependencies ──
  if (manifest?.dependencies) {
    for (const dep of manifest.dependencies) {
      if (!loadedModuleNames.includes(dep)) {
        throw new Error(`Plugin "${pluginName}" requires module "${dep}" which is not loaded`);
      }
    }
  }

  // ── Validate SDK version compatibility ──
  if (manifest?.sdkVersion) {
    if (!semverSatisfies(SDK_VERSION, manifest.sdkVersion)) {
      throw new Error(
        `Plugin "${pluginName}" requires SDK ${manifest.sdkVersion} but current SDK is ${SDK_VERSION}`
      );
    }
  }

  // ── Resolve plugin config ──
  const pluginConfigKey = pluginName.replace(/-/g, "_");
  const rawPluginConfig = (config.plugins?.[pluginConfigKey] as Record<string, unknown>) ?? {};
  const pluginConfig = { ...manifest?.defaultConfig, ...rawPluginConfig };

  // ── Logging ──
  const log = (...args: unknown[]) => console.log(`[${pluginName}]`, ...args);

  // ── DB management (only if migrate is exported) ──
  const hasMigrate = typeof raw.migrate === "function";
  let pluginDb: Database.Database | null = null;
  const getDb = () => pluginDb;
  const withPluginDb = createDbWrapper(getDb, pluginName);

  // ── Sanitized config for SDK ──
  const sanitizedConfig = sanitizeConfigForPlugins(config);

  // ── Build the PluginModule ──
  return {
    name: pluginName,
    version: pluginVersion,

    configure() {
      // Config merge already handled above
    },

    migrate() {
      if (!hasMigrate) return;

      try {
        const dbPath = join(PLUGIN_DATA_DIR, `${pluginName}.db`);
        pluginDb = openModuleDb(dbPath);
        raw.migrate!(pluginDb);

        // One-time migration of legacy data from memory.db (skips if tables already have data)
        const pluginTables = (
          pluginDb
            .prepare(
              `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
            )
            .all() as { name: string }[]
        ).map((t) => t.name);
        if (pluginTables.length > 0) {
          migrateFromMainDb(pluginDb, pluginTables);
        }
      } catch (err) {
        console.error(
          `❌ [${pluginName}] migrate() failed:`,
          err instanceof Error ? err.message : err
        );
        // Close DB if migration failed
        if (pluginDb) {
          try {
            pluginDb.close();
          } catch {
            /* ignore */
          }
          pluginDb = null;
        }
      }
    },

    tools() {
      try {
        // Resolve tools (array or function)
        let toolDefs: SimpleToolDef[];
        if (typeof raw.tools === "function") {
          // Create full Plugin SDK with TON, Telegram, and infrastructure services
          const sdk = createPluginSDK(sdkDeps, {
            pluginName,
            db: pluginDb,
            sanitizedConfig,
            pluginConfig,
          });
          toolDefs = raw.tools(sdk);
        } else if (Array.isArray(raw.tools)) {
          toolDefs = raw.tools;
        } else {
          return [];
        }

        // Validate
        const validDefs = validateToolDefs(toolDefs, pluginName);

        // Adapt to ToolEntry format
        return validDefs.map((def) => {
          // Wrap plugin executor to sanitize config before passing context
          const rawExecutor = def.execute as ToolExecutor;
          const sandboxedExecutor: ToolExecutor = (params, context) => {
            const sanitizedContext = {
              ...context,
              config: context.config ? sanitizeConfigForPlugins(context.config) : undefined,
            } as typeof context;
            return rawExecutor(params, sanitizedContext);
          };

          return {
            tool: {
              name: def.name,
              description: def.description,
              parameters: def.parameters || {
                type: "object" as const,
                properties: {},
              },
              ...(def.category ? { category: def.category } : {}),
            } as Tool,
            executor: hasMigrate && pluginDb ? withPluginDb(sandboxedExecutor) : sandboxedExecutor,
            scope: def.scope as ToolScope | undefined,
          };
        });
      } catch (err) {
        console.error(
          `❌ [${pluginName}] tools() failed:`,
          err instanceof Error ? err.message : err
        );
        return [];
      }
    },

    async start(context) {
      if (!raw.start) return;

      try {
        // Build sanitized context for external plugins (do NOT spread raw context)
        const enhancedContext: EnhancedPluginContext = {
          bridge: context.bridge,
          db: pluginDb ?? null, // Enforce DB isolation
          config: sanitizedConfig, // Use pre-sanitized config
          pluginConfig,
          log,
        };
        await raw.start(enhancedContext);
      } catch (err) {
        console.error(
          `❌ [${pluginName}] start() failed:`,
          err instanceof Error ? err.message : err
        );
      }
    },

    async stop() {
      try {
        await raw.stop?.();
      } catch (err) {
        console.error(
          `❌ [${pluginName}] stop() failed:`,
          err instanceof Error ? err.message : err
        );
      } finally {
        // Always close the plugin DB
        if (pluginDb) {
          try {
            pluginDb.close();
          } catch {
            /* ignore */
          }
          pluginDb = null;
        }
      }
    },
  };
}

// ─── Discovery & Loading ──────────────────────────────────────────

/**
 * Discover, load, and adapt external plugins into PluginModule objects.
 *
 * @param config Full app config
 * @param loadedModuleNames Names of already-loaded built-in modules (for dependency checks)
 * @returns Array of adapted PluginModules ready for lifecycle management
 */
export async function loadEnhancedPlugins(
  config: Config,
  loadedModuleNames: string[],
  sdkDeps: SDKDependencies
): Promise<PluginModule[]> {
  const pluginsDir = WORKSPACE_PATHS.PLUGINS_DIR;

  if (!existsSync(pluginsDir)) {
    return [];
  }

  const entries = readdirSync(pluginsDir);
  const modules: PluginModule[] = [];
  const loadedNames = new Set<string>();

  for (const entry of entries) {
    // Skip the data directory (plugin DBs)
    if (entry === "data") continue;

    const entryPath = join(pluginsDir, entry);
    let modulePath: string | null = null;

    // Determine module path: file.js or folder/index.js
    try {
      const stat = statSync(entryPath);
      if (stat.isFile() && entry.endsWith(".js")) {
        modulePath = entryPath;
      } else if (stat.isDirectory()) {
        const indexPath = join(entryPath, "index.js");
        if (existsSync(indexPath)) {
          modulePath = indexPath;
        }
      }
    } catch {
      continue;
    }

    if (!modulePath) continue;

    try {
      // Dynamic import requires file:// URL
      const moduleUrl = pathToFileURL(modulePath).href;
      const mod = (await import(moduleUrl)) as RawPluginExports;

      // Validate: tools must be exported (array or function)
      if (!mod.tools || (typeof mod.tools !== "function" && !Array.isArray(mod.tools))) {
        console.warn(`⚠️  Plugin "${entry}": no 'tools' array or function exported, skipping`);
        continue;
      }

      // Adapt into PluginModule
      const adapted = adaptPlugin(mod, entry, config, loadedModuleNames, sdkDeps);

      // Check for duplicate plugin names
      if (loadedNames.has(adapted.name)) {
        console.warn(
          `⚠️  Plugin "${adapted.name}" already loaded, skipping duplicate from "${entry}"`
        );
        continue;
      }

      loadedNames.add(adapted.name);
      modules.push(adapted);
    } catch (err) {
      console.error(
        `❌ Plugin "${entry}" failed to load:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return modules;
}
