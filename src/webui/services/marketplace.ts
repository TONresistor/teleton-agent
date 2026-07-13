/**
 * Marketplace service — fetch, install, uninstall, and update plugins
 * from the community registry at GitHub.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import {
  adaptPlugin,
  assertTrustedPluginPath,
  ensurePluginDeps,
} from "../../agent/tools/plugin-loader.js";
import type { ToolRegistry } from "../../agent/tools/registry.js";
import type { PluginModule } from "../../agent/tools/types.js";
import { HookRegistry } from "../../sdk/hooks/registry.js";
import type { MarketplaceDeps, RegistryEntry, MarketplacePlugin } from "../types.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("WebUI");

const REGISTRY_URL =
  "https://raw.githubusercontent.com/TONresistor/teleton-plugins/main/registry.json";
const PLUGIN_BASE_URL = "https://raw.githubusercontent.com/TONresistor/teleton-plugins/main";
const GITHUB_API_BASE = "https://api.github.com/repos/TONresistor/teleton-plugins/contents";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PLUGINS_DIR = WORKSPACE_PATHS.PLUGINS_DIR;

const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;

interface ManifestData {
  name: string;
  version: string;
  description?: string;
  author?: string;
  tools?: Array<{ name: string; description: string }>;
  secrets?: Record<string, { required: boolean; description: string; env?: string }>;
}

interface ServiceDeps extends MarketplaceDeps {
  toolRegistry: ToolRegistry;
}

export class MarketplaceService {
  private deps: ServiceDeps;
  private cache: { entries: RegistryEntry[]; fetchedAt: number } | null = null;
  private fetchPromise: Promise<RegistryEntry[]> | null = null;
  private manifestCache = new Map<string, { data: ManifestData; fetchedAt: number }>();
  private installing = new Set<string>();
  private updating = new Set<string>();

  constructor(deps: ServiceDeps) {
    this.deps = deps;
  }

  // ── Registry ────────────────────────────────────────────────────────

  async getRegistry(forceRefresh = false): Promise<RegistryEntry[]> {
    // Return cached if fresh
    if (!forceRefresh && this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL) {
      return this.cache.entries;
    }

    // Dedup concurrent fetches
    if (this.fetchPromise) return this.fetchPromise;

    this.fetchPromise = this.fetchRegistry();
    try {
      const entries = await this.fetchPromise;
      this.cache = { entries, fetchedAt: Date.now() };
      return entries;
    } catch (error: unknown) {
      // Stale-on-error: return stale cache if available
      if (this.cache) {
        log.warn({ error }, "Registry fetch failed, using stale cache");
        return this.cache.entries;
      }
      throw error;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async fetchRegistry(): Promise<RegistryEntry[]> {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    // Registry format: { version: "1.0.0", plugins: [...] }
    const plugins = Array.isArray(data) ? data : data?.plugins;
    if (!Array.isArray(plugins)) throw new Error("Registry has no plugins array");

    // Validate each entry — defense-in-depth against poisoned registries
    const VALID_PATH = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/;
    for (const entry of plugins) {
      if (!entry.id || !entry.name || !entry.path) {
        throw new Error(`Invalid registry entry: missing required fields (id=${entry.id ?? "?"})`);
      }
      if (!VALID_PATH.test(entry.path) || entry.path.includes("..")) {
        throw new Error(`Invalid registry path for "${entry.id}": "${entry.path}"`);
      }
    }

    return plugins as RegistryEntry[];
  }

  // ── Remote manifest ─────────────────────────────────────────────────

  private async fetchRemoteManifest(entry: RegistryEntry): Promise<ManifestData> {
    const cached = this.manifestCache.get(entry.id);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.data;
    }

    const url = `${PLUGIN_BASE_URL}/${entry.path}/manifest.json`;
    const res = await fetch(url);
    if (!res.ok) {
      // Fallback: construct from registry entry
      return {
        name: entry.name,
        version: "0.0.0",
        description: entry.description,
        author: entry.author,
      };
    }
    const raw = await res.json();
    // Normalize author: manifest may have { name, url } object or a plain string
    const data: ManifestData = {
      ...raw,
      author: normalizeAuthor(raw.author),
    };
    this.manifestCache.set(entry.id, { data, fetchedAt: Date.now() });
    return data;
  }

  // ── List plugins (combined view) ────────────────────────────────────

  async listPlugins(forceRefresh = false): Promise<MarketplacePlugin[]> {
    const registry = await this.getRegistry(forceRefresh);
    const results: MarketplacePlugin[] = [];

    // Fetch all manifests in parallel
    const manifests = await Promise.allSettled(
      registry.map((entry) => this.fetchRemoteManifest(entry))
    );

    for (let i = 0; i < registry.length; i++) {
      const entry = registry[i];
      const manifestResult = manifests[i];
      const manifest: ManifestData =
        manifestResult.status === "fulfilled"
          ? manifestResult.value
          : {
              name: entry.name,
              version: "0.0.0",
              description: entry.description,
              author: entry.author,
            };

      // Cross-reference with loaded modules
      const installed = this.deps.modules.find((m) => m.name === entry.id || m.name === entry.name);
      const installedVersion = installed?.version ?? null;
      const remoteVersion = manifest.version || "0.0.0";

      let status: MarketplacePlugin["status"] = "available";
      if (installedVersion) {
        status = installedVersion !== remoteVersion ? "updatable" : "installed";
      }

      // Get tool info from remote manifest or from loaded module
      let toolCount = manifest.tools?.length ?? 0;
      let tools: Array<{ name: string; description: string }> = manifest.tools ?? [];

      if (installed) {
        // Use live data from registry for installed plugins
        const moduleTools = this.deps.toolRegistry.getModuleTools(installed.name);
        const allToolDefs = this.deps.toolRegistry.getAll();
        const toolMap = new Map(allToolDefs.map((t) => [t.name, t]));
        tools = moduleTools.map((mt) => ({
          name: mt.name,
          description: toolMap.get(mt.name)?.description ?? "",
        }));
        toolCount = tools.length;
      }

      results.push({
        id: entry.id,
        name: entry.name,
        description: manifest.description || entry.description,
        author: manifest.author || entry.author,
        tags: entry.tags,
        remoteVersion,
        installedVersion,
        status,
        toolCount,
        tools,
        secrets: manifest.secrets,
      });
    }

    return results;
  }

  // ── Install ─────────────────────────────────────────────────────────

  async installPlugin(
    pluginId: string,
    fromUpdate = false
  ): Promise<{ name: string; version: string; toolCount: number }> {
    this.validateId(pluginId);

    if (this.installing.has(pluginId) || (!fromUpdate && this.updating.has(pluginId))) {
      throw new ConflictError(`Plugin "${pluginId}" is already being installed`);
    }

    // Check if already installed (resolve via registry name, not just ID)
    const existing = this.findModuleByPluginId(pluginId);
    if (existing) {
      throw new ConflictError(`Plugin "${pluginId}" is already installed`);
    }

    this.installing.add(pluginId);
    const pluginDir = join(PLUGINS_DIR, pluginId);
    let stagedModule: PluginModule | null = null;
    let runtimeStaged = false;

    try {
      // Find entry in registry
      const registry = await this.getRegistry();
      const entry = registry.find((e) => e.id === pluginId);
      if (!entry) throw new Error(`Plugin "${pluginId}" not found in registry`);

      // Fetch remote manifest
      const _manifest = await this.fetchRemoteManifest(entry);

      // Create plugin directory
      mkdirSync(pluginDir, { recursive: true });

      // Download the entire plugin directory from GitHub
      await this.downloadDir(entry.path, pluginDir);

      // Install npm deps if package.json exists
      await ensurePluginDeps(pluginDir, pluginId);

      // Import the plugin module
      const indexPath = join(pluginDir, "index.js");
      assertTrustedPluginPath(indexPath, PLUGINS_DIR);
      const moduleUrl = pathToFileURL(indexPath).href + `?t=${Date.now()}`;
      const mod = await import(moduleUrl);

      // Adapt plugin (validates manifest, tools, SDK version, etc.)
      const candidateHooks = new HookRegistry();
      const adapted = adaptPlugin(
        mod,
        pluginId,
        this.deps.config,
        typeof this.deps.loadedModuleNames === "function"
          ? this.deps.loadedModuleNames()
          : this.deps.loadedModuleNames,
        this.deps.sdkDeps,
        candidateHooks
      );
      stagedModule = adapted;
      if (this.deps.modules.some((module) => module.name === adapted.name)) {
        throw new ConflictError(`Plugin manifest name "${adapted.name}" is already installed`);
      }

      // Run migrations
      adapted.migrate?.(this.deps.pluginContext.db);

      // Register tools
      const tools = adapted.tools(this.deps.config);
      if (tools.length === 0) throw new Error(`Plugin "${adapted.name}" produced zero tools`);
      const toolCount = this.deps.toolRegistry.registerPluginTools(adapted.name, tools);
      const hookRegistry =
        typeof this.deps.hookRegistry === "function"
          ? this.deps.hookRegistry()
          : this.deps.hookRegistry;
      hookRegistry?.replacePlugin(adapted.name, candidateHooks.getRegistrations(adapted.name));
      runtimeStaged = true;

      // Start plugin
      await adapted.start?.(this.deps.pluginContext);
      hookRegistry?.replacePlugin(adapted.name, candidateHooks.getRegistrations(adapted.name));

      // Add to modules array (shared reference)
      this.deps.modules.push(adapted);

      // Re-wire plugin event hooks
      this.deps.rewireHooks();

      return {
        name: adapted.name,
        version: adapted.version,
        toolCount,
      };
    } catch (error: unknown) {
      if (stagedModule) {
        if (runtimeStaged) this.deps.toolRegistry.removePluginTools(stagedModule.name);
        const hookRegistry =
          typeof this.deps.hookRegistry === "function"
            ? this.deps.hookRegistry()
            : this.deps.hookRegistry;
        if (runtimeStaged) hookRegistry?.unregister(stagedModule.name);
        const moduleIndex = this.deps.modules.indexOf(stagedModule);
        if (moduleIndex >= 0) this.deps.modules.splice(moduleIndex, 1);
        try {
          await stagedModule.stop?.();
        } catch (cleanupError) {
          log.error({ error: cleanupError }, `Failed to stop staged plugin ${pluginId}`);
        }
        this.deps.rewireHooks();
      }
      // Cleanup on failure
      if (existsSync(pluginDir)) {
        try {
          rmSync(pluginDir, { recursive: true, force: true });
        } catch (cleanupErr: unknown) {
          log.error({ error: cleanupErr }, `Failed to cleanup ${pluginDir}`);
        }
      }
      throw error;
    } finally {
      this.installing.delete(pluginId);
    }
  }

  // ── Uninstall ───────────────────────────────────────────────────────

  async uninstallPlugin(pluginId: string, fromUpdate = false): Promise<{ message: string }> {
    this.validateId(pluginId);

    if (this.installing.has(pluginId) || (!fromUpdate && this.updating.has(pluginId))) {
      throw new ConflictError(`Plugin "${pluginId}" has an operation in progress`);
    }

    // Resolve registry ID → actual module (handles name mismatch)
    const mod = this.findModuleByPluginId(pluginId);
    if (!mod) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }
    const moduleName = mod.name;
    const idx = this.deps.modules.indexOf(mod);

    this.installing.add(pluginId);
    try {
      // Stop plugin
      await mod.stop?.();

      // Remove tools from registry (use actual module name, not registry ID)
      this.deps.toolRegistry.removePluginTools(moduleName);
      const hookRegistry =
        typeof this.deps.hookRegistry === "function"
          ? this.deps.hookRegistry()
          : this.deps.hookRegistry;
      hookRegistry?.unregister(moduleName);

      // Remove from modules array
      if (idx >= 0) this.deps.modules.splice(idx, 1);

      // Re-wire hooks without this plugin
      this.deps.rewireHooks();

      // Delete plugin directory (keep data DB)
      const pluginDir = join(PLUGINS_DIR, pluginId);
      if (existsSync(pluginDir)) {
        rmSync(pluginDir, { recursive: true, force: true });
      }

      return { message: `Plugin "${pluginId}" uninstalled successfully` };
    } finally {
      this.installing.delete(pluginId);
    }
  }

  // ── Update ──────────────────────────────────────────────────────────

  async updatePlugin(
    pluginId: string
  ): Promise<{ name: string; version: string; toolCount: number }> {
    this.validateId(pluginId);
    if (this.installing.has(pluginId) || this.updating.has(pluginId)) {
      throw new ConflictError(`Plugin "${pluginId}" has an operation in progress`);
    }
    const previousModule = this.findModuleByPluginId(pluginId);
    if (!previousModule) throw new Error(`Plugin "${pluginId}" is not installed`);

    const previousIndex = this.deps.modules.indexOf(previousModule);
    const pluginDir = join(PLUGINS_DIR, pluginId);
    const backupDir = `${pluginDir}.update-backup-${Date.now()}`;
    const hookRegistry =
      typeof this.deps.hookRegistry === "function"
        ? this.deps.hookRegistry()
        : this.deps.hookRegistry;
    const previousHooks = hookRegistry?.getRegistrations(previousModule.name) ?? [];

    if (existsSync(pluginDir)) renameSync(pluginDir, backupDir);
    this.updating.add(pluginId);
    let updated = false;
    try {
      await this.uninstallPlugin(pluginId, true);
      const result = await this.installPlugin(pluginId, true);
      updated = true;
      return result;
    } catch (updateError) {
      if (existsSync(pluginDir)) rmSync(pluginDir, { recursive: true, force: true });
      if (existsSync(backupDir)) renameSync(backupDir, pluginDir);

      try {
        previousModule.migrate?.(this.deps.pluginContext.db);
        const previousTools = previousModule.tools(this.deps.config);
        this.deps.toolRegistry.registerPluginTools(previousModule.name, previousTools);
        hookRegistry?.replacePlugin(previousModule.name, previousHooks);
        await previousModule.start?.(this.deps.pluginContext);
        if (!this.deps.modules.includes(previousModule)) {
          this.deps.modules.splice(Math.max(0, previousIndex), 0, previousModule);
        }
        this.deps.rewireHooks();
      } catch (rollbackError) {
        throw new AggregateError(
          [updateError, rollbackError],
          `Plugin "${pluginId}" update and rollback both failed`
        );
      }
      throw updateError;
    } finally {
      if (updated && existsSync(backupDir)) {
        try {
          rmSync(backupDir, { recursive: true, force: true });
        } catch (cleanupError) {
          log.error({ error: cleanupError }, `Failed to remove update backup ${backupDir}`);
        }
      }
      this.updating.delete(pluginId);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Resolve a registry plugin ID to the actual loaded module.
   * Handles name mismatch: registry id "fragment" → module name "Fragment Marketplace".
   */
  private findModuleByPluginId(pluginId: string) {
    // Direct match (module name === registry id)
    let mod = this.deps.modules.find((m) => m.sourceId === pluginId || m.name === pluginId);
    if (mod) return mod;

    // Via registry display name (registry id → registry name → module name)
    const entry = this.cache?.entries.find((e) => e.id === pluginId);
    if (entry) {
      mod = this.deps.modules.find((m) => m.name === entry.name);
    }
    return mod ?? null;
  }

  /**
   * Recursively download a GitHub directory to a local path.
   * Uses the GitHub Contents API to list files, then fetches each via raw.githubusercontent.
   */
  private async downloadDir(remotePath: string, localDir: string, depth = 0): Promise<void> {
    if (depth > 5) throw new Error("Plugin directory too deeply nested");

    const res = await fetch(`${GITHUB_API_BASE}/${remotePath}`);
    if (!res.ok) throw new Error(`Failed to list directory "${remotePath}": ${res.status}`);
    const entries: Array<{
      name: string;
      type: string;
      download_url: string | null;
      path: string;
    }> = await res.json();

    for (const item of entries) {
      // Validate name — block path traversal
      if (!item.name || /[/\\]/.test(item.name) || item.name === ".." || item.name === ".") {
        throw new Error(`Invalid entry name in plugin directory: "${item.name}"`);
      }

      const target = resolve(localDir, item.name);
      if (!target.startsWith(resolve(PLUGINS_DIR))) {
        throw new Error(`Path escape detected: ${target}`);
      }

      if (item.type === "dir") {
        mkdirSync(target, { recursive: true });
        await this.downloadDir(item.path, target, depth + 1);
      } else if (item.type === "file" && item.download_url) {
        // Validate download URL is from GitHub
        const url = new URL(item.download_url);
        if (
          !url.hostname.endsWith("githubusercontent.com") &&
          !url.hostname.endsWith("github.com")
        ) {
          throw new Error(`Untrusted download host: ${url.hostname}`);
        }
        const fileRes = await fetch(item.download_url);
        if (!fileRes.ok) throw new Error(`Failed to download ${item.name}: ${fileRes.status}`);
        const content = await fileRes.text();
        writeFileSync(target, content, { encoding: "utf-8", mode: 0o600 });
      }
    }
  }

  private validateId(id: string): void {
    if (!VALID_ID.test(id)) {
      throw new Error(`Invalid plugin ID: "${id}"`);
    }
  }
}

function normalizeAuthor(author: unknown): string {
  if (typeof author === "string") return author;
  if (author && typeof author === "object" && "name" in author) {
    return String((author as { name: unknown }).name);
  }
  return "unknown";
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
