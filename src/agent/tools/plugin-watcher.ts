/**
 * Plugin hot-reload watcher — watches ~/.teleton/plugins/ for changes
 * and reloads plugins without restarting the agent.
 *
 * Key design decisions:
 * - Validates candidate metadata before disrupting the live runtime
 * - Quiesces every plugin execution surface before closing its database
 * - Stages hooks and Bot handlers until activation
 * - Restores the old runtime if candidate initialization fails
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
import type { InlineRouter } from "../../bot/inline-router.js";
import type { PluginExecutionGate } from "./plugin-execution-gate.js";
import { botRegistrationShape, StagedBotRegistrar } from "./staged-bot-registrar.js";
import { withPluginDrainTimeout } from "./plugin-drain-timeout.js";

const log = createLogger("PluginWatcher");

const RELOAD_DEBOUNCE_MS = 300;
const PLUGIN_DRAIN_TIMEOUT_MS = 30_000;

interface PluginWatcherDeps {
  config: Config;
  registry: ToolRegistry;
  sdkDeps: SDKDependencies;
  modules: PluginModule[];
  pluginContext: PluginContext;
  loadedModuleNames: string[];
  hookRegistry: HookRegistry;
  inlineRouter: InlineRouter;
  executionGate: PluginExecutionGate;
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

    const {
      config,
      registry,
      sdkDeps,
      modules,
      pluginContext,
      loadedModuleNames,
      hookRegistry,
      inlineRouter,
      executionGate,
    } = this.deps;

    // Find existing module
    const oldIndex = modules.findIndex((m) => m.sourceId === pluginName || m.name === pluginName);
    const oldModule = oldIndex >= 0 ? modules[oldIndex] : null;

    log.info(`Reloading plugin "${pluginName}"${oldModule ? ` (v${oldModule.version})` : ""}...`);

    let oldStopped = false;
    let candidatePluginId = pluginName;
    let candidateModule: PluginModule | null = null;
    let candidateMigrated = false;
    let runtimeActivated = false;
    let stagedBotRegistrar: StagedBotRegistrar | null = null;
    let quiescedPluginIds: string[] = [];
    const oldHookPluginId = oldModule?.name ?? pluginName;
    const oldToolPluginId = oldModule?.name ?? pluginName;
    const oldHooks = hookRegistry.getRegistrations(oldHookPluginId);
    const oldBotHandlers = inlineRouter.getPluginHandlers(oldHookPluginId);

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
      stagedBotRegistrar = new StagedBotRegistrar();
      const candidateSdkDeps: SDKDependencies = {
        ...sdkDeps,
        inlineRouter: sdkDeps.inlineRouter ? stagedBotRegistrar : null,
      };
      const adapted = adaptPlugin(
        freshMod,
        entryName,
        config,
        loadedModuleNames,
        candidateSdkDeps,
        candidateHooks
      );
      candidateModule = adapted;
      candidatePluginId = adapted.name;
      const conflictingModule = modules.find(
        (module, index) => index !== oldIndex && module.name === adapted.name
      );
      if (conflictingModule) {
        throw new Error(`Plugin manifest name "${adapted.name}" is already loaded`);
      }

      // Stop new work and drain every plugin-owned execution surface before
      // closing the old database or changing any live registration.
      quiescedPluginIds = [...new Set([oldHookPluginId, oldToolPluginId, adapted.name])];
      await withPluginDrainTimeout(
        executionGate.quiesce(quiescedPluginIds),
        PLUGIN_DRAIN_TIMEOUT_MS,
        `Plugin "${pluginName}" in-flight work did not drain after 30s`
      );

      // Stop the old runtime only after the candidate passed static validation.
      if (oldModule) {
        try {
          await oldModule.stop?.();
        } finally {
          oldStopped = true;
        }
      }

      // Initialize the candidate completely before publishing any of its live
      // tools, hooks, module callbacks, or Bot SDK handlers.
      adapted.migrate?.(pluginContext.db);
      candidateMigrated = true;
      const newTools = adapted.tools(config);
      if (newTools.length === 0) throw new Error("Plugin produced zero valid tools");
      await adapted.start?.(pluginContext);

      // Publish the prepared runtime synchronously while its execution gate is
      // still closed. No request can observe a partially activated plugin.
      if (oldToolPluginId !== adapted.name) {
        registry.removePluginTools(oldToolPluginId);
        registry.registerPluginTools(adapted.name, newTools);
      } else {
        registry.replacePluginTools(adapted.name, newTools);
      }
      hookRegistry.unregister(oldHookPluginId);
      hookRegistry.replacePlugin(adapted.name, candidateHooks.getRegistrations(adapted.name));
      stagedBotRegistrar.activate(inlineRouter, oldHookPluginId, adapted.name);

      if (oldIndex >= 0) {
        modules[oldIndex] = adapted;
      } else {
        modules.push(adapted);
      }
      runtimeActivated = true;

      log.info(`Plugin "${pluginName}" v${adapted.version} reloaded (${newTools.length} tools)`);
      return true;
    } catch (error: unknown) {
      log.error(`Failed to reload "${pluginName}": ${getErrorMessage(error)}`);

      stagedBotRegistrar?.deactivate();
      if (candidateModule && candidateMigrated) {
        try {
          await candidateModule.stop?.();
        } catch (cleanupError) {
          log.error(`Candidate plugin cleanup failed: ${getErrorMessage(cleanupError)}`);
        }
      }

      if (oldModule && oldIndex >= 0 && oldStopped) {
        try {
          registry.removePluginTools(candidatePluginId);
          registry.removePluginTools(oldToolPluginId);
          hookRegistry.unregister(candidatePluginId);
          hookRegistry.unregister(oldHookPluginId);
          inlineRouter.unregisterPlugin(candidatePluginId);
          inlineRouter.unregisterPlugin(oldHookPluginId);

          oldModule.migrate?.(pluginContext.db);
          const restoredTools = oldModule.tools(config);
          await oldModule.start?.(pluginContext);
          registry.registerPluginTools(oldToolPluginId, restoredTools);

          // Reusing the old handler snapshots would retain the closed SDK and
          // database. Rollback therefore succeeds only if the reopened runtime
          // recreated every registration surface itself.
          if (hookRegistry.getRegistrations(oldHookPluginId).length !== oldHooks.length) {
            throw new Error(`Plugin "${pluginName}" did not restore all hooks during rollback`);
          }
          if (
            botRegistrationShape(inlineRouter.getPluginHandlers(oldHookPluginId)) !==
            botRegistrationShape(oldBotHandlers)
          ) {
            throw new Error(`Plugin "${pluginName}" did not restore Bot handlers during rollback`);
          }
          log.warn(`Rolled back to previous version of "${pluginName}"`);
        } catch {
          log.error(`Rollback also failed for "${pluginName}" — plugin disabled`);
          registry.removePluginTools(candidatePluginId);
          registry.removePluginTools(oldToolPluginId);
          hookRegistry.unregister(oldHookPluginId);
          inlineRouter.unregisterPlugin(candidatePluginId);
          inlineRouter.unregisterPlugin(oldHookPluginId);
          modules.splice(oldIndex, 1);
        }
      } else if (!oldModule && runtimeActivated) {
        registry.removePluginTools(candidatePluginId);
        hookRegistry.unregister(candidatePluginId);
        inlineRouter.unregisterPlugin(candidatePluginId);
        const candidateIndex = modules.findIndex((module) => module.name === candidatePluginId);
        if (candidateIndex >= 0) modules.splice(candidateIndex, 1);
      }

      return false;
    } finally {
      executionGate.resume(quiescedPluginIds);
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
