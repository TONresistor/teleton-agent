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
import { createSecretsSDK } from "../../sdk/secrets.js";
import type { SecretDeclaration } from "@teleton-agent/sdk";

const PLUGIN_DATA_DIR = join(TELETON_ROOT, "plugins", "data");

interface RawPluginExports {
  tools?: SimpleToolDef[] | ((sdk: PluginSDK) => SimpleToolDef[]);
  manifest?: unknown;
  migrate?: (db: Database.Database) => void;
  start?: (ctx: EnhancedPluginContext) => Promise<void>;
  stop?: () => Promise<void>;
}

interface EnhancedPluginContext extends Omit<PluginContext, "db" | "config"> {
  db: Database.Database | null;
  config: Record<string, unknown>;
  pluginConfig: Record<string, unknown>;
  log: (...args: unknown[]) => void;
}

// ─── Plugin Adapter ─────────────────────────────────────────────────

export function adaptPlugin(
  raw: RawPluginExports,
  entryName: string,
  config: Config,
  loadedModuleNames: string[],
  sdkDeps: SDKDependencies
): PluginModule {
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

  if (manifest?.dependencies) {
    for (const dep of manifest.dependencies) {
      if (!loadedModuleNames.includes(dep)) {
        throw new Error(`Plugin "${pluginName}" requires module "${dep}" which is not loaded`);
      }
    }
  }

  if (manifest?.sdkVersion) {
    if (!semverSatisfies(SDK_VERSION, manifest.sdkVersion)) {
      throw new Error(
        `Plugin "${pluginName}" requires SDK ${manifest.sdkVersion} but current SDK is ${SDK_VERSION}`
      );
    }
  }

  const pluginConfigKey = pluginName.replace(/-/g, "_");
  const rawPluginConfig = (config.plugins?.[pluginConfigKey] as Record<string, unknown>) ?? {};
  const pluginConfig = { ...manifest?.defaultConfig, ...rawPluginConfig };

  const log = (...args: unknown[]) => console.log(`[${pluginName}]`, ...args);

  // Validate declared secrets and warn if missing
  if (manifest?.secrets) {
    const dummyLogger = {
      info: log,
      warn: (...a: unknown[]) => console.warn(`⚠️ [${pluginName}]`, ...a),
      error: (...a: unknown[]) => console.error(`❌ [${pluginName}]`, ...a),
      debug: () => {},
    };
    const secretsCheck = createSecretsSDK(pluginName, pluginConfig, dummyLogger);
    const missing: string[] = [];
    for (const [key, decl] of Object.entries(
      manifest.secrets as Record<string, SecretDeclaration>
    )) {
      if (decl.required && !secretsCheck.has(key)) {
        missing.push(`${key} — ${decl.description}`);
      }
    }
    if (missing.length > 0) {
      console.warn(
        `⚠️  [${pluginName}] Missing required secrets:\n` +
          missing.map((m) => `   • ${m}`).join("\n") +
          `\n   Set via: /plugin set ${pluginName} <key> <value>`
      );
    }
  }

  const hasMigrate = typeof raw.migrate === "function";
  let pluginDb: Database.Database | null = null;
  const getDb = () => pluginDb;
  const withPluginDb = createDbWrapper(getDb, pluginName);

  const sanitizedConfig = sanitizeConfigForPlugins(config);

  return {
    name: pluginName,
    version: pluginVersion,

    configure() {},

    migrate() {
      try {
        // Always create plugin DB (needed for sdk.storage even without migrate())
        const dbPath = join(PLUGIN_DATA_DIR, `${pluginName}.db`);
        pluginDb = openModuleDb(dbPath);

        // Run plugin's custom migrations if provided
        if (hasMigrate) {
          raw.migrate!(pluginDb);

          const pluginTables = (
            pluginDb
              .prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
              )
              .all() as { name: string }[]
          )
            .map((t) => t.name)
            .filter((n) => n !== "_kv"); // Exclude storage table
          if (pluginTables.length > 0) {
            migrateFromMainDb(pluginDb, pluginTables);
          }
        }
      } catch (err) {
        console.error(
          `❌ [${pluginName}] migrate() failed:`,
          err instanceof Error ? err.message : err
        );
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
        let toolDefs: SimpleToolDef[];
        if (typeof raw.tools === "function") {
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

        const validDefs = validateToolDefs(toolDefs, pluginName);

        return validDefs.map((def) => {
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
            executor: pluginDb ? withPluginDb(sandboxedExecutor) : sandboxedExecutor,
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
        const enhancedContext: EnhancedPluginContext = {
          bridge: context.bridge,
          db: pluginDb ?? null,
          config: sanitizedConfig,
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

// ─── Initial Plugin Loading ─────────────────────────────────────────

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

  // Phase 1: Discover plugin paths (synchronous)
  const pluginPaths: Array<{ entry: string; path: string }> = [];

  for (const entry of entries) {
    if (entry === "data") continue;

    const entryPath = join(pluginsDir, entry);
    let modulePath: string | null = null;

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

    if (modulePath) {
      pluginPaths.push({ entry, path: modulePath });
    }
  }

  // Phase 2: Load plugins in parallel
  const loadResults = await Promise.allSettled(
    pluginPaths.map(async ({ entry, path }) => {
      const moduleUrl = pathToFileURL(path).href;
      const mod = (await import(moduleUrl)) as RawPluginExports;
      return { entry, mod };
    })
  );

  // Phase 3: Validate and adapt plugins (sequential for consistency)
  for (const result of loadResults) {
    if (result.status === "rejected") {
      console.error(
        `❌ Plugin failed to load:`,
        result.reason instanceof Error ? result.reason.message : result.reason
      );
      continue;
    }

    const { entry, mod } = result.value;

    try {
      if (!mod.tools || (typeof mod.tools !== "function" && !Array.isArray(mod.tools))) {
        console.warn(`⚠️  Plugin "${entry}": no 'tools' array or function exported, skipping`);
        continue;
      }

      const adapted = adaptPlugin(mod, entry, config, loadedModuleNames, sdkDeps);

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
        `❌ Plugin "${entry}" failed to adapt:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return modules;
}
