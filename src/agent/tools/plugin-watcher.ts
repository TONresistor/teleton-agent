/**
 * Plugin hot-reload watcher — watches ~/.teleton/plugins/ for changes
 * and reloads plugins without restarting the agent.
 *
 * Key design decisions:
 * - Validates new plugin BEFORE stopping old one ("keep old until new succeeds")
 * - Per-plugin debounce (300ms) to avoid reload storms
 * - ESM cache busting via ?t= query parameter
 * - Never crashes the main process on reload failure
 */

import chokidar from "chokidar";
import { basename, relative, resolve, sep } from "path";
import { existsSync } from "fs";
import { pathToFileURL } from "url";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { adaptPlugin, assertTrustedPluginPath, ensurePluginDeps } from "./plugin-loader.js";
import type { PluginModule, PluginContext } from "./types.js";
import type { ToolRegistry } from "./registry.js";
import type { Config } from "../../config/schema.js";
import type { SDKDependencies } from "../../sdk/index.js";
import { createLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errors.js";
import { HookRegistry } from "../../sdk/hooks/registry.js";

const log = createLogger("PluginWatcher");

const RELOAD_DEBOUNCE_MS = 300;
const PLUGIN_START_TIMEOUT_MS = 30_000;
const PLUGIN_STOP_TIMEOUT_MS = 30_000;

// A timeout is diagnostic, never proof that plugin code has stopped using its
// resources. Keep the generation unavailable until the actual operation settles.
async function awaitLifecycle(
  operation: () => unknown | Promise<unknown>,
  label: string,
  timeoutMs: number
): Promise<void> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    log.warn(`${label} exceeded ${timeoutMs}ms; awaiting actual settlement`);
  }, timeoutMs);
  try {
    await operation();
    if (timedOut) throw new Error(`${label} exceeded its lifecycle deadline`);
  } finally {
    clearTimeout(timer);
  }
}

interface PluginWatcherDeps {
  config: Config;
  registry: ToolRegistry;
  sdkDeps: SDKDependencies;
  modules: PluginModule[];
  pluginContext: PluginContext;
  loadedModuleNames: string[];
  hookRegistry: HookRegistry;
}

export class PluginWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private reloadTimers = new Map<string, NodeJS.Timeout>();
  private reloading = false;
  private activeReloads = new Set<Promise<boolean>>();
  private stopping = false;
  private pendingReloads = new Set<string>();
  private deps: PluginWatcherDeps;
  private pluginsDir: string;

  constructor(deps: PluginWatcherDeps) {
    this.deps = deps;
    this.pluginsDir = WORKSPACE_PATHS.PLUGINS_DIR;
  }

  /**
   * Start watching the plugins directory for changes.
   */
  start(): void {
    this.stopping = false;
    this.watcher = chokidar.watch(this.pluginsDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      ignored: [
        "**/node_modules/**",
        "**/data/**",
        "**/.git/**",
        "**/*.map",
        "**/*.d.ts",
        "**/*.md",
        "**/package-lock.json",
      ],
      depth: 1,
      followSymlinks: false,
      ignorePermissionErrors: true,
      usePolling: false,
    });

    this.watcher.on("change", (filePath: string) => {
      const pluginName = this.resolvePluginName(filePath);
      if (pluginName) {
        this.scheduleReload(pluginName);
      }
    });

    this.watcher.on("error", (err: unknown) => {
      log.error(`Watcher error: ${getErrorMessage(err)}`);
    });

    log.info("Plugin watcher started");
  }

  /**
   * Resolve a changed file path to a plugin name.
   * Supports both directory plugins (pluginName/index.js) and single-file plugins (pluginName.js).
   */
  private resolvePluginName(filePath: string): string | null {
    const fileName = basename(filePath);

    // React to .js and package.json file changes
    if (!fileName.endsWith(".js") && fileName !== "package.json") return null;

    const rel = relative(this.pluginsDir, filePath);
    const segments = rel.split(sep);

    // Defense-in-depth: reject path traversal
    if (segments.some((s) => s === ".." || s === ".")) return null;

    // Directory plugin: pluginName/index.js or pluginName/package.json
    if (segments.length === 2 && (segments[1] === "index.js" || segments[1] === "package.json")) {
      return segments[0];
    }

    // Single-file plugin: pluginName.js (at root level)
    if (segments.length === 1 && fileName.endsWith(".js")) {
      return fileName.replace(/\.js$/, "");
    }

    return null;
  }

  /**
   * Stop watching and clear pending reloads.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const timer of this.reloadTimers.values()) {
      clearTimeout(timer);
    }
    this.reloadTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    await Promise.allSettled([...this.activeReloads]);
    this.pendingReloads.clear();
  }

  private scheduleReload(pluginName: string): void {
    if (this.stopping) return;
    const existing = this.reloadTimers.get(pluginName);
    if (existing) clearTimeout(existing);

    this.reloadTimers.set(
      pluginName,
      setTimeout(() => {
        this.reloadTimers.delete(pluginName);
        const reload = this.reloadPlugin(pluginName);
        this.activeReloads.add(reload);
        reload.catch((error: unknown) => {
          log.error(`Unexpected error reloading "${pluginName}": ${getErrorMessage(error)}`);
        });
        const clearActive = () => {
          this.activeReloads.delete(reload);
        };
        void reload.then(clearActive, clearActive);
      }, RELOAD_DEBOUNCE_MS)
    );
  }

  /**
   * Resolve the entry file for a plugin (supports directory and single-file plugins).
   */
  private resolveModulePath(pluginName: string): string | null {
    // Directory plugin: pluginName/index.js
    const dirPath = resolve(this.pluginsDir, pluginName, "index.js");
    if (existsSync(dirPath)) return dirPath;

    // Single-file plugin: pluginName.js
    const filePath = resolve(this.pluginsDir, `${pluginName}.js`);
    if (existsSync(filePath)) return filePath;

    return null;
  }

  private async reloadPlugin(pluginName: string): Promise<boolean> {
    if (this.stopping) return false;
    if (this.reloading) {
      log.warn(`Reload already in progress, queuing "${pluginName}"`);
      this.pendingReloads.add(pluginName);
      return false;
    }

    this.reloading = true;

    const { config, registry, sdkDeps, modules, pluginContext, loadedModuleNames, hookRegistry } =
      this.deps;

    // Find existing module
    const oldIndex = modules.findIndex((m) => m.sourceId === pluginName || m.name === pluginName);
    const oldModule = oldIndex >= 0 ? modules[oldIndex] : null;

    log.info(`Reloading plugin "${pluginName}"${oldModule ? ` (v${oldModule.version})` : ""}...`);

    let oldStopped = false;
    let oldStopAttempted = false;
    let runtimeStaged = false;
    let candidate: PluginModule | undefined;
    let candidatePluginId = pluginName;
    const oldHookPluginId = oldModule?.name ?? pluginName;
    const oldToolPluginId = oldModule?.name ?? pluginName;
    const oldHooks = hookRegistry.getRegistrations(oldHookPluginId);

    try {
      // 1. Resolve module path
      const modulePath = this.resolveModulePath(pluginName);
      if (!modulePath) {
        throw new Error(`Plugin file not found for "${pluginName}"`);
      }
      assertTrustedPluginPath(modulePath, this.pluginsDir);

      // 1.5. Install npm deps if package.json exists (directory plugins only)
      if (basename(modulePath) === "index.js") {
        const pluginDir = resolve(this.pluginsDir, pluginName);
        await ensurePluginDeps(pluginDir, pluginName);
      }

      // 2. Import with cache bust
      const moduleUrl = pathToFileURL(modulePath).href + `?t=${Date.now()}`;
      const freshMod = await import(moduleUrl);

      // 3. Validate exports BEFORE stopping old plugin
      if (
        !freshMod.tools ||
        (typeof freshMod.tools !== "function" && !Array.isArray(freshMod.tools))
      ) {
        throw new Error("No valid 'tools' export found");
      }

      // 4. Adapt and validate (old plugin still running)
      const entryName = basename(modulePath) === "index.js" ? pluginName : `${pluginName}.js`;
      const candidateHooks = new HookRegistry();
      const adapted = adaptPlugin(
        freshMod,
        entryName,
        config,
        loadedModuleNames,
        sdkDeps,
        candidateHooks
      );
      candidate = adapted;
      const newTools = adapted.tools(config);
      candidatePluginId = adapted.name;
      const conflictingModule = modules.find(
        (module, index) => index !== oldIndex && module.name === adapted.name
      );
      if (conflictingModule) {
        throw new Error(`Plugin manifest name "${adapted.name}" is already loaded`);
      }
      if (newTools.length === 0) {
        throw new Error("Plugin produced zero valid tools");
      }

      // Adapter stop() first pauses admission and waits for the actual tools,
      // hooks and events, including work whose caller has already timed out.
      if (oldModule) {
        oldStopAttempted = true;
        await awaitLifecycle(
          () => oldModule.stop?.(),
          `Plugin "${pluginName}" stop()`,
          PLUGIN_STOP_TIMEOUT_MS
        );
        oldStopped = true;
      }
      registry.removePluginTools(oldToolPluginId);
      hookRegistry.unregister(oldHookPluginId);
      runtimeStaged = true;

      adapted.migrate?.(pluginContext.db);
      await awaitLifecycle(
        () => adapted.start?.(pluginContext),
        `Plugin "${pluginName}" start()`,
        PLUGIN_START_TIMEOUT_MS
      );

      // Publish only after initialization has fully completed.
      registry.registerPluginTools(adapted.name, newTools);
      hookRegistry.replacePlugin(adapted.name, candidateHooks.getRegistrations(adapted.name));

      // 9. Update modules array
      if (oldIndex >= 0) {
        modules[oldIndex] = adapted;
      } else {
        modules.push(adapted);
      }

      log.info(`Plugin "${pluginName}" v${adapted.version} reloaded (${newTools.length} tools)`);
      return true;
    } catch (error: unknown) {
      log.error(`Failed to reload "${pluginName}": ${getErrorMessage(error)}`);

      if (candidate) {
        try {
          await awaitLifecycle(
            () => candidate?.stop?.(),
            `Candidate "${pluginName}" cleanup`,
            PLUGIN_STOP_TIMEOUT_MS
          );
        } catch (cleanupError) {
          log.error(`Candidate cleanup failed: ${getErrorMessage(cleanupError)}; plugin disabled`);
          registry.removePluginTools(candidatePluginId);
          registry.removePluginTools(oldToolPluginId);
          hookRegistry.unregister(candidatePluginId);
          hookRegistry.unregister(oldHookPluginId);
          return false;
        }
      }

      // Rollback: only if we actually stopped the old plugin (steps 1-4 errors
      // don't need rollback — old module is still running)
      if (oldModule && oldIndex >= 0 && oldStopped) {
        try {
          registry.removePluginTools(candidatePluginId);
          hookRegistry.unregister(candidatePluginId);
          // Reopen plugin DB (stop() closed it)
          oldModule.migrate?.(pluginContext.db);
          const oldTools = oldModule.tools(config);
          await awaitLifecycle(
            () => oldModule.start?.(pluginContext),
            `Plugin "${pluginName}" rollback start()`,
            PLUGIN_START_TIMEOUT_MS
          );
          registry.registerPluginTools(oldToolPluginId, oldTools);
          // Replaying tools/start may register hooks again. Restore the exact
          // pre-reload set once the old runtime is active.
          hookRegistry.replacePlugin(oldHookPluginId, oldHooks);
          log.warn(`Rolled back to previous version of "${pluginName}"`);
        } catch {
          log.error(`Rollback also failed for "${pluginName}" — plugin disabled`);
          registry.removePluginTools(candidatePluginId);
          registry.removePluginTools(oldToolPluginId);
          hookRegistry.unregister(oldHookPluginId);
          modules.splice(oldIndex, 1);
        }
      } else if (oldModule && oldStopAttempted) {
        registry.removePluginTools(oldToolPluginId);
        hookRegistry.unregister(oldHookPluginId);
        log.error(`Plugin "${pluginName}" disabled after stop failure`);
      } else if (!oldModule && runtimeStaged) {
        // A newly added plugin may fail after its tools/hooks were staged.
        // Leave no partial runtime state behind.
        registry.removePluginTools(candidatePluginId);
        hookRegistry.unregister(candidatePluginId);
      }

      return false;
    } finally {
      this.reloading = false;
      // Process any queued reloads
      if (!this.stopping && this.pendingReloads.size > 0) {
        const next = this.pendingReloads.values().next().value;
        if (next) {
          this.pendingReloads.delete(next);
          this.scheduleReload(next);
        }
      }
    }
  }
}
