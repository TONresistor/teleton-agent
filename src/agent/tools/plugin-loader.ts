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

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { execFile } from "child_process";
import { getPluginPriorities } from "./plugin-config-store.js";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import { WORKSPACE_PATHS, TELETON_ROOT } from "../../workspace/paths.js";
import { openModuleDb, createDbWrapper, migrateFromMainDb } from "../../utils/module-db.js";
import type { PluginModule, Tool, ToolExecutor, ToolScope } from "./types.js";
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
  createSafePluginDb,
  SDK_VERSION,
  semverSatisfies,
  type SDKDependencies,
} from "../../sdk/index.js";
import type { PluginSDK, PluginToolContext, StartContext } from "@teleton-agent/sdk";
import { HookRegistry } from "../../sdk/hooks/registry.js";
import { createSecretsSDK } from "../../sdk/secrets.js";
import type {
  SecretDeclaration,
  PluginMessageEvent,
  PluginCallbackEvent,
} from "@teleton-agent/sdk";
import { createLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errors.js";

const log = createLogger("PluginLoader");

const PLUGIN_DATA_DIR = join(TELETON_ROOT, "plugins", "data");

interface RawPluginExports {
  tools?: SimpleToolDef[] | ((sdk: PluginSDK) => SimpleToolDef[]);
  manifest?: unknown;
  migrate?: (db: Database.Database) => void;
  start?: (ctx: StartContext) => Promise<void>;
  stop?: () => Promise<void>;
  onMessage?: (event: PluginMessageEvent) => Promise<void>;
  onCallbackQuery?: (event: PluginCallbackEvent) => Promise<void>;
}

/** Extended PluginModule with event hooks (external plugins only) */
export interface PluginModuleWithHooks extends PluginModule {
  onMessage?: (event: PluginMessageEvent) => Promise<void>;
  onCallbackQuery?: (event: PluginCallbackEvent) => Promise<void>;
}

// ─── Plugin Adapter ─────────────────────────────────────────────────

export function adaptPlugin(
  raw: RawPluginExports,
  entryName: string,
  config: Config,
  loadedModuleNames: string[],
  sdkDeps: SDKDependencies,
  hookRegistry?: HookRegistry,
  pluginPriorities?: Map<string, number>
): PluginModuleWithHooks {
  let manifest: PluginManifest | null = null;

  if (raw.manifest) {
    try {
      manifest = validateManifest(raw.manifest);
    } catch (error: unknown) {
      throw new Error(`Plugin "${entryName}" has an invalid manifest: ${getErrorMessage(error)}`);
    }
  }

  // Legacy plugins may only ship manifest.json on disk. Use its display metadata
  // when the executable module does not export a manifest.
  if (!raw.manifest && !manifest) {
    const manifestPath = join(WORKSPACE_PATHS.PLUGINS_DIR, entryName, "manifest.json");
    try {
      if (existsSync(manifestPath)) {
        const diskManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        if (diskManifest && typeof diskManifest.version === "string") {
          manifest = {
            name: entryName,
            version: diskManifest.version,
            description:
              typeof diskManifest.description === "string" ? diskManifest.description : undefined,
            author:
              typeof diskManifest.author === "string"
                ? diskManifest.author
                : (diskManifest.author?.name ?? undefined),
          };
        }
      }
    } catch {
      // ignore read/parse errors
    }
  }

  const pluginName = manifest?.name ?? entryName.replace(/\.js$/, "");
  const pluginVersion = manifest?.version ?? "0.0.0";
  const globalPriority = pluginPriorities?.get(pluginName) ?? 0;

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

  const pluginLog = createLogger(`Plugin:${pluginName}`);
  // Validate declared secrets and warn if missing
  if (manifest?.secrets) {
    const dummyLogger = {
      info: (...a: unknown[]) => pluginLog.info(a.map(String).join(" ")),
      warn: (...a: unknown[]) => pluginLog.warn(a.map(String).join(" ")),
      error: (...a: unknown[]) => pluginLog.error(a.map(String).join(" ")),
      debug: () => {},
    };
    const secretsCheck = createSecretsSDK(pluginName, pluginConfig, dummyLogger, manifest.secrets);
    const missing: string[] = [];
    for (const [key, decl] of Object.entries(
      manifest.secrets as Record<string, SecretDeclaration>
    )) {
      if (decl.required && !secretsCheck.has(key)) {
        missing.push(`${key} — ${decl.description}`);
      }
    }
    if (missing.length > 0) {
      pluginLog.warn(
        `Missing required secrets:\n` +
          missing.map((m) => `   • ${m}`).join("\n") +
          `\n   Set via: /plugin set ${pluginName} <key> <value>`
      );
    }
  }

  const hasMigrate = typeof raw.migrate === "function";
  let pluginDb: Database.Database | null = null;
  let exposedPluginDb: Database.Database | null = null;
  const getDb = () => exposedPluginDb;
  const withPluginDb = createDbWrapper(getDb, pluginName);

  const sanitizedConfig = sanitizeConfigForPlugins(config);
  let pluginSdk: PluginSDK | null = null;
  const getSdk = (): PluginSDK => {
    pluginSdk ??= createPluginSDK(sdkDeps, {
      pluginName,
      db: exposedPluginDb,
      sanitizedConfig,
      pluginConfig,
      botManifest: manifest?.bot,
      secretDeclarations: manifest?.secrets,
      hookRegistry,
      declaredHooks: manifest?.hooks,
      globalPriority,
    });
    return pluginSdk;
  };

  const module: PluginModuleWithHooks = {
    name: pluginName,
    version: pluginVersion,

    // Store event hooks from plugin exports
    onMessage: typeof raw.onMessage === "function" ? raw.onMessage : undefined,
    onCallbackQuery: typeof raw.onCallbackQuery === "function" ? raw.onCallbackQuery : undefined,

    configure() {},

    migrate() {
      try {
        // Always create plugin DB (needed for sdk.storage even without migrate())
        const dbPath = join(PLUGIN_DATA_DIR, `${pluginName}.db`);
        pluginDb = openModuleDb(dbPath);
        exposedPluginDb = createSafePluginDb(pluginDb);

        // Run plugin's custom migrations if provided
        if (hasMigrate) {
          raw.migrate?.(exposedPluginDb);

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
      } catch (error: unknown) {
        pluginLog.error(`migrate() failed: ${getErrorMessage(error)}`);
        if (pluginDb) {
          try {
            pluginDb.close();
          } catch {
            /* ignore */
          }
          pluginDb = null;
        }
        exposedPluginDb = null;
      }
    },

    tools() {
      try {
        let toolDefs: SimpleToolDef[];
        if (typeof raw.tools === "function") {
          toolDefs = raw.tools(getSdk());
        } else if (Array.isArray(raw.tools)) {
          toolDefs = raw.tools;
        } else {
          return [];
        }

        const validDefs = validateToolDefs(toolDefs, pluginName);

        return validDefs.map((def) => {
          const rawExecutor = def.execute;
          const sandboxedExecutor: ToolExecutor = (params, context) => {
            const sanitizedContext: PluginToolContext = {
              chatId: context.chatId,
              senderId: context.senderId,
              isGroup: context.isGroup,
              db: context.db,
              config: context.config ? sanitizeConfigForPlugins(context.config) : undefined,
            };
            return rawExecutor(params as Record<string, unknown>, sanitizedContext);
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
            // Always replace the agent DB from ToolContext with the plugin's
            // isolated handle. Failing closed also covers DB startup errors.
            executor: withPluginDb(sandboxedExecutor),
            scope: def.scope as ToolScope | undefined,
            requiresApproval: def.requiresApproval,
          };
        });
      } catch (error: unknown) {
        pluginLog.error(`tools() failed: ${getErrorMessage(error)}`);
        return [];
      }
    },

    async start(_context) {
      if (!raw.start) return;

      try {
        const enhancedContext: StartContext = {
          sdk: getSdk(),
          db: exposedPluginDb,
          config: sanitizedConfig,
          pluginConfig,
          log: getSdk().log,
        };
        await raw.start(enhancedContext);
      } catch (error: unknown) {
        pluginLog.error(`start() failed: ${getErrorMessage(error)}`);
      }
    },

    async stop() {
      try {
        await raw.stop?.();
      } catch (error: unknown) {
        pluginLog.error(`stop() failed: ${getErrorMessage(error)}`);
      } finally {
        if (pluginDb) {
          try {
            pluginDb.close();
          } catch {
            /* ignore */
          }
        }
        pluginDb = null;
        exposedPluginDb = null;
        pluginSdk = null;
      }
    },
  };

  return module;
}

// ─── Plugin Dependency Installation ─────────────────────────────────

/**
 * Install npm dependencies for a plugin that has a package.json + package-lock.json.
 * Skips if node_modules is already up-to-date (lockfile mtime check).
 * Runs `npm ci --ignore-scripts` for deterministic, secure installs.
 */
export async function ensurePluginDeps(pluginDir: string, pluginEntry: string): Promise<void> {
  const pkgJson = join(pluginDir, "package.json");
  const lockfile = join(pluginDir, "package-lock.json");
  const nodeModules = join(pluginDir, "node_modules");

  if (!existsSync(pkgJson)) return;

  if (!existsSync(lockfile)) {
    log.warn(
      `[${pluginEntry}] package.json without package-lock.json — skipping (lockfile required)`
    );
    return;
  }

  // Skip if already installed and lockfile hasn't changed
  if (existsSync(nodeModules)) {
    const marker = join(nodeModules, ".package-lock.json");
    if (existsSync(marker) && statSync(marker).mtimeMs >= statSync(lockfile).mtimeMs) return;
  }

  log.info(`[${pluginEntry}] Installing dependencies...`);
  try {
    await execFileAsync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: pluginDir,
      timeout: 60_000,
      env: { ...process.env, NODE_ENV: "production" },
    });
    log.info(`[${pluginEntry}] Dependencies installed`);
  } catch (error: unknown) {
    log.error(`[${pluginEntry}] Failed to install deps: ${String(error).slice(0, 300)}`);
  }
}

// ─── Initial Plugin Loading ─────────────────────────────────────────

export interface LoadEnhancedPluginsResult {
  modules: PluginModuleWithHooks[];
  hookRegistry: HookRegistry;
}

export async function loadEnhancedPlugins(
  config: Config,
  loadedModuleNames: string[],
  sdkDeps: SDKDependencies,
  db?: import("better-sqlite3").Database // eslint-disable-line @typescript-eslint/consistent-type-imports
): Promise<LoadEnhancedPluginsResult> {
  const hookRegistry = new HookRegistry();
  const pluginsDir = WORKSPACE_PATHS.PLUGINS_DIR;

  if (!existsSync(pluginsDir)) {
    return { modules: [], hookRegistry };
  }

  // Read plugin priorities from DB (if available)
  let pluginPriorities = new Map<string, number>();
  if (db) {
    try {
      pluginPriorities = getPluginPriorities(db);
    } catch {
      // Table may not exist yet on first run before migration — ignore
    }
  }

  const entries = readdirSync(pluginsDir).sort(); // deterministic cross-OS
  const modules: PluginModuleWithHooks[] = [];
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

  // Phase 1.5: Install npm deps for plugins with package.json
  await Promise.allSettled(
    pluginPaths
      .filter(({ path }) => path.endsWith("index.js"))
      .map(({ entry }) => ensurePluginDeps(join(pluginsDir, entry), entry))
  );

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
      log.error(`Plugin failed to load: ${getErrorMessage(result.reason)}`);
      continue;
    }

    const { entry, mod } = result.value;

    try {
      if (!mod.tools || (typeof mod.tools !== "function" && !Array.isArray(mod.tools))) {
        log.warn(`Plugin "${entry}": no 'tools' array or function exported, skipping`);
        continue;
      }

      const adapted = adaptPlugin(
        mod,
        entry,
        config,
        loadedModuleNames,
        sdkDeps,
        hookRegistry,
        pluginPriorities
      );

      if (loadedNames.has(adapted.name)) {
        log.warn(`Plugin "${adapted.name}" already loaded, skipping duplicate from "${entry}"`);
        continue;
      }

      loadedNames.add(adapted.name);
      modules.push(adapted);
    } catch (error: unknown) {
      log.error(`Plugin "${entry}" failed to adapt: ${getErrorMessage(error)}`);
    }
  }

  return { modules, hookRegistry };
}
