import { validateToolCall } from "@earendil-works/pi-ai";
import type { Tool as PiAiTool, ToolCall } from "@earendil-works/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import type {
  RegisteredTool,
  RuntimeMode,
  Tool,
  ToolContext,
  ToolExecutor,
  ToolAccessLevel,
  ToolMode,
  ToolResult,
  ToolScope,
} from "./types.js";
import type { EmbeddingProvider } from "../../memory/embeddings/provider.js";
import type { ModulePermissions } from "./module-permissions.js";
import { TOOL_EXECUTION_TIMEOUT_MS } from "../../constants/timeouts.js";
import type Database from "better-sqlite3";
import {
  loadAllToolConfigs,
  initializeToolConfig,
  saveToolConfig,
  type ToolConfig,
} from "../../memory/tool-config.js";
import { enforceMinimumAccess, scopeToLevel, levelToScope } from "./scope.js";
import type { ToolIndex } from "./tool-index.js";
import { getErrorMessage } from "../../utils/errors.js";
import { createLogger } from "../../utils/logger.js";
import { TELEGRAM_SEND_TOOLS } from "../../constants/tools.js";
import { completeActionExecution, reserveActionExecution } from "../../memory/action-executions.js";
import {
  buildToolNamespaceCatalog,
  formatNamespaceCatalogForPrompt,
  resolveToolNamespace,
  type ToolNamespaceCatalogEntry,
} from "./tool-namespaces.js";

const log = createLogger("Registry");

/**
 * External plugins and MCP servers are not part of the reviewed built-in policy.
 * Their actions therefore require an explicitly trusted Telegram identity even
 * when the plugin omits a scope or declares the legacy "always" scope. Authors
 * can keep genuinely read-only tools public by marking them data-bearing.
 */
function getExternalMinimumAccess(
  tool: Tool,
  scope?: ToolScope,
  declaredMinimum?: ToolAccessLevel
): ToolAccessLevel {
  const declared = declaredMinimum ?? scopeToLevel(scope);
  return tool.category === "data-bearing" ? declared : enforceMinimumAccess(declared, "allowlist");
}

/** Reason a tool is denied for a context — mapped to a user message by execute(). */
type AccessDenial =
  | { kind: "mode"; mode: ToolMode }
  | { kind: "disabled" }
  | { kind: "admin-only" }
  | { kind: "allowlist" }
  | { kind: "dm-only" }
  | { kind: "group-only" }
  | { kind: "guest" }
  | { kind: "module-disabled"; module: string }
  | { kind: "module-admin"; module: string };

export class ToolRegistry {
  // Single source of tool state — tool/executor + declared scope/mode/module/tags.
  private tools: Map<string, RegisteredTool> = new Map();
  private permissions: ModulePermissions | null = null;
  private toolArrayCache: PiAiTool[] | null = null;
  private toolConfigs: Map<string, ToolConfig> = new Map(); // Runtime tool configurations (DB-backed)
  private db: Database.Database | null = null;
  private pluginToolNames: Map<string, string[]> = new Map();
  private toolIndex: ToolIndex | null = null;
  private embedderRef: EmbeddingProvider | null = null;
  private onToolsChangedCallbacks: Array<
    (removed: string[], added: PiAiTool[]) => void | Promise<void>
  > = [];
  private mode: RuntimeMode;
  private allowFrom: Set<number> = new Set();
  private adminIds: Set<number> = new Set();
  private adminIdsConfigured = false;

  constructor(mode: RuntimeMode = "user") {
    this.mode = mode;
  }

  /**
   * Centralised insertion into the parallel registry Maps — single source for the
   * tool/scope/mode/tags/module bookkeeping shared by register() and the plugin
   * (re)registration paths. Callers own collision policy and cache invalidation.
   */
  private insertTool(
    name: string,
    entry: {
      tool: Tool;
      executor: ToolExecutor;
      scope?: ToolScope;
      minimumAccess?: ToolAccessLevel;
      allowFrom?: readonly number[];
      mode: ToolMode;
      module: string;
      tags?: string[];
    }
  ): void {
    const namespace = resolveToolNamespace(name, entry.module, entry.tool.description);
    this.tools.set(name, {
      tool: entry.tool,
      executor: entry.executor,
      scope:
        entry.scope && entry.scope !== "always" && entry.scope !== "open" ? entry.scope : undefined,
      minimumAccess: entry.minimumAccess ?? scopeToLevel(entry.scope),
      allowFrom: entry.allowFrom ? new Set(entry.allowFrom) : undefined,
      mode: entry.mode,
      module: entry.module,
      namespace,
      tags: entry.tags && entry.tags.length > 0 ? entry.tags : undefined,
    });
  }

  register<TParams = unknown>(
    tool: Tool,
    executor: ToolExecutor<TParams>,
    scope?: ToolScope,
    mode: ToolMode = "both",
    tags?: string[],
    minimumAccess?: ToolAccessLevel,
    _requiresApproval = false,
    allowFrom?: readonly number[]
  ): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.insertTool(tool.name, {
      tool,
      executor: executor as ToolExecutor,
      scope,
      mode,
      module: tool.name.split("_")[0],
      tags,
      minimumAccess,
      allowFrom,
    });
    this.toolArrayCache = null;
  }

  setPermissions(mp: ModulePermissions): void {
    this.permissions = mp;
  }

  setMode(mode: RuntimeMode): void {
    this.mode = mode;
    this.toolArrayCache = null;
    const count = Array.from(this.tools.values()).filter((rt) => {
      const toolMode = this.tools.get(rt.tool.name)?.mode;
      return !toolMode || toolMode === "both" || toolMode === mode;
    }).length;
    log.info(`Mode switched to ${mode}, ${count} tools available`);
  }

  /** Reset the registry in place so long-lived API consumers keep a valid reference. */
  reset(mode: RuntimeMode): void {
    const removed = [...this.tools.keys()];
    this.tools.clear();
    this.pluginToolNames.clear();
    this.toolConfigs.clear();
    this.toolArrayCache = null;
    this.toolIndex = null;
    this.embedderRef = null;
    this.permissions = null;
    this.mode = mode;
    this.allowFrom.clear();
    this.adminIds.clear();
    this.adminIdsConfigured = false;
    this.onToolsChangedCallbacks.length = 0;
    if (removed.length > 0) log.debug(`Reset tool registry (${removed.length} tools removed)`);
  }

  setAllowFrom(ids: number[]): void {
    this.allowFrom = new Set(ids);
  }

  setAdminIds(ids: number[]): void {
    this.adminIds = new Set(ids);
    this.adminIdsConfigured = true;
  }

  getAvailableModules(): string[] {
    const modules = new Set(Array.from(this.tools.values()).map((rt) => rt.module));
    return Array.from(modules).sort();
  }

  getModuleToolCount(module: string): number {
    let count = 0;
    for (const rt of this.tools.values()) {
      if (rt.module === module) count++;
    }
    return count;
  }

  getModuleTools(module: string): Array<{ name: string; scope: ToolScope }> {
    const result: Array<{ name: string; scope: ToolScope }> = [];
    for (const [name, rt] of this.tools) {
      if (rt.module === module) {
        result.push({ name, scope: this.getEffectiveScope(name) });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  getAll(): PiAiTool[] {
    if (!this.toolArrayCache) {
      this.toolArrayCache = Array.from(this.tools.values()).map((rt) => rt.tool);
    }
    return this.toolArrayCache;
  }

  /**
   * Single authorization grid (mode → per-tool access level → group module
   * perms). The tool's level (all/allowlist/admin/off) is context-independent;
   * the DM-vs-group "who does the agent respond to" gating is a separate global
   * concern handled upstream. Shared by execute() (maps the denial to a message)
   * and passesFilters() (uses only .ok), so the two can no longer drift.
   * `isAdmin` is passed in by the caller.
   */
  private checkAccess(
    name: string,
    ctx: {
      isGroup: boolean;
      isAdmin: boolean;
      isGuest?: boolean;
      senderId?: number;
      chatId?: string;
    }
  ): { ok: true } | { ok: false; reason: AccessDenial } {
    const toolMode = this.tools.get(name)?.mode;
    if (toolMode && toolMode !== "both" && toolMode !== this.mode) {
      return { ok: false, reason: { kind: "mode", mode: toolMode } };
    }
    if (ctx.isGuest && TELEGRAM_SEND_TOOLS.has(name)) {
      return { ok: false, reason: { kind: "guest" } };
    }

    // Channel restriction (code-declared, DB cannot override): a "dm-only" tool
    // never runs in a group and a "group-only" tool never runs in a DM. Applies
    // regardless of identity — it gates where the tool runs, not who runs it.
    const channelScope = this.tools.get(name)?.scope;
    if (channelScope === "dm-only" && ctx.isGroup) {
      return { ok: false, reason: { kind: "dm-only" } };
    }
    if (channelScope === "group-only" && !ctx.isGroup) {
      return { ok: false, reason: { kind: "group-only" } };
    }

    const level = this.getEffectiveLevel(name);
    if (level === "off") return { ok: false, reason: { kind: "disabled" } };
    if (level === "admin" && !ctx.isAdmin) return { ok: false, reason: { kind: "admin-only" } };
    if (level === "allowlist" && !ctx.isAdmin) {
      const allowedSenders = this.tools.get(name)?.allowFrom ?? this.allowFrom;
      if (!ctx.senderId || !allowedSenders.has(ctx.senderId)) {
        return { ok: false, reason: { kind: "allowlist" } };
      }
    }

    if (ctx.isGroup && ctx.chatId && this.permissions) {
      const module = this.tools.get(name)?.module;
      if (module) {
        const mLevel = this.permissions.getLevel(ctx.chatId, module);
        if (mLevel === "disabled")
          return { ok: false, reason: { kind: "module-disabled", module } };
        if (mLevel === "admin" && !ctx.isAdmin) {
          return { ok: false, reason: { kind: "module-admin", module } };
        }
      }
    }

    return { ok: true };
  }

  private denialMessage(name: string, reason: AccessDenial): string {
    switch (reason.kind) {
      case "mode":
        return `Tool "${name}" requires ${reason.mode} mode (current: ${this.mode})`;
      case "disabled":
        return `Tool "${name}" is currently disabled`;
      case "admin-only":
        return `Tool "${name}" is restricted to admin users`;
      case "allowlist":
        return `Tool "${name}" is restricted to allowed users`;
      case "dm-only":
        return `Tool "${name}" can only be used in a direct message`;
      case "group-only":
        return `Tool "${name}" can only be used in a group`;
      case "guest":
        return `Tool "${name}" is unavailable in guest mode`;
      case "module-disabled":
        return `Module "${reason.module}" is disabled in this group`;
      case "module-admin":
        return `Module "${reason.module}" is restricted to admins in this group`;
    }
  }

  async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
    const registered = this.tools.get(toolCall.name);

    if (!registered) {
      return {
        success: false,
        error: `Unknown tool: ${toolCall.name}`,
      };
    }

    // Defense-in-depth authorization (tools are also filtered from the LLM tool list)
    const isAdmin = this.adminIdsConfigured
      ? this.adminIds.has(context.senderId)
      : (context.config?.telegram.admin_ids.includes(context.senderId) ?? false);
    const access = this.checkAccess(toolCall.name, {
      isGroup: context.isGroup,
      isAdmin,
      isGuest: context.isGuest,
      senderId: context.senderId,
      chatId: context.chatId,
    });
    if (!access.ok) {
      return { success: false, error: this.denialMessage(toolCall.name, access.reason) };
    }

    try {
      const validatedArgs = validateToolCall(this.getAll(), toolCall);

      return await this.executeRegistered(toolCall.name, registered, validatedArgs, context);
    } catch (error) {
      log.error({ err: error }, `Error executing tool ${toolCall.name}`);
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  private async executeRegistered(
    toolName: string,
    registered: RegisteredTool,
    validatedArgs: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    let actionArgsHash: string | null = null;
    try {
      if (registered.tool.category !== "data-bearing" && context.turnId) {
        const reservation = reserveActionExecution(
          context.db,
          context.turnId,
          toolName,
          validatedArgs
        );
        if (reservation.kind === "replay") return reservation.result;
        if (reservation.kind === "unknown") {
          return {
            success: false,
            error:
              `Action "${toolName}" already started in this turn and its outcome is unknown. ` +
              "Do not retry it automatically; inspect the remote state first.",
          };
        }
        actionArgsHash = reservation.argsHash;
      }

      // Do not race external actions against a timeout: the side effect could
      // continue after a reported failure and invite an unsafe duplicate retry.
      if (registered.tool.category !== "data-bearing") {
        const result = await registered.executor(validatedArgs, context);
        if (actionArgsHash && context.turnId) {
          completeActionExecution(context.db, context.turnId, toolName, actionArgsHash, result);
        }
        return result;
      }

      let timeoutHandle: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        registered.executor(validatedArgs, context),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () =>
              reject(
                new Error(`Tool "${toolName}" timed out after ${TOOL_EXECUTION_TIMEOUT_MS / 1000}s`)
              ),
            TOOL_EXECUTION_TIMEOUT_MS
          );
        }),
      ]).finally(() => clearTimeout(timeoutHandle));

      return result;
    } catch (error) {
      log.error({ err: error }, `Error executing tool ${toolName}`);
      const result = {
        success: false,
        error: getErrorMessage(error),
      };
      if (actionArgsHash && context.turnId) {
        completeActionExecution(context.db, context.turnId, toolName, actionArgsHash, result);
      }
      return result;
    }
  }

  getForContext(
    isGroup: boolean,
    toolLimit: number | null,
    chatId?: string,
    isAdmin?: boolean,
    senderId?: number
  ): PiAiTool[] {
    const filtered = Array.from(this.tools.values())
      .filter((rt) => this.passesFilters(rt.tool.name, isGroup, chatId, isAdmin, senderId))
      .map((rt) => rt.tool);

    if (toolLimit !== null && filtered.length > toolLimit) {
      log.warn(
        `Provider tool limit: ${toolLimit}, after scope filter: ${filtered.length}. Truncating to ${toolLimit} tools.`
      );
      return filtered.slice(0, toolLimit);
    }
    return filtered;
  }

  isPluginModule(moduleName: string): boolean {
    return this.pluginToolNames.has(moduleName);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get count(): number {
    return this.tools.size;
  }

  getToolCategory(name: string): "data-bearing" | "action" | undefined {
    const registered = this.tools.get(name);
    return registered?.tool.category;
  }

  /**
   * Load tool configurations from database and seed missing ones
   */
  /**
   * Seed DB config defaults for any of `names` lacking one, then reload the
   * in-memory config cache once if anything was seeded. No-op without a DB.
   */
  private seedConfigs(names: Iterable<string>): void {
    if (!this.db) return;
    let seeded = false;
    for (const name of names) {
      if (!this.toolConfigs.has(name)) {
        initializeToolConfig(this.db, name, this.getMinimumAccess(name));
        seeded = true;
      }
    }
    if (seeded) {
      this.toolConfigs = loadAllToolConfigs(this.db);
    }
  }

  loadConfigFromDB(db: Database.Database): void {
    this.db = db;
    this.toolConfigs = loadAllToolConfigs(db);
    // Seed DB with defaults for tools that don't have config yet
    this.seedConfigs(this.tools.keys());
    // Security floors are code invariants, not user-configurable defaults. Clamp
    // stale rows created before the floor existed so restarts remain coherent.
    let reconciled = false;
    for (const name of this.tools.keys()) {
      const config = this.toolConfigs.get(name);
      if (!config) continue;
      const clamped = enforceMinimumAccess(config.level, this.getMinimumAccess(name));
      if (clamped !== config.level) {
        saveToolConfig(db, name, clamped, config.updatedBy ?? undefined);
        reconciled = true;
      }
    }
    if (reconciled) this.toolConfigs = loadAllToolConfigs(db);
    // Clear cache to force regeneration with new configs
    this.toolArrayCache = null;
  }

  /**
   * Effective access level for a tool: the DB override if present, else the
   * code-declared default scope mapped to a level.
   */
  private getMinimumAccess(toolName: string): ToolAccessLevel {
    return this.tools.get(toolName)?.minimumAccess ?? "all";
  }

  private getEffectiveLevel(toolName: string): ToolAccessLevel {
    const config = this.toolConfigs.get(toolName);
    return enforceMinimumAccess(config?.level ?? "all", this.getMinimumAccess(toolName));
  }

  /**
   * Legacy single-value scope view (derived from the level). Kept for backward-
   * compatible callers (getModuleTools).
   */
  private getEffectiveScope(toolName: string): ToolScope {
    return levelToScope(this.getEffectiveLevel(toolName));
  }

  /**
   * Check if a tool is enabled (i.e. not off).
   */
  isToolEnabled(toolName: string): boolean {
    return this.getEffectiveLevel(toolName) !== "off";
  }

  /**
   * Update a tool's access level (primary writer).
   */
  updateToolLevel(toolName: string, level: ToolAccessLevel, updatedBy?: number): boolean {
    if (!this.tools.has(toolName) || !this.db) return false;

    saveToolConfig(
      this.db,
      toolName,
      enforceMinimumAccess(level, this.getMinimumAccess(toolName)),
      updatedBy
    );

    // Update in-memory cache
    this.toolConfigs = loadAllToolConfigs(this.db);
    this.toolArrayCache = null;

    return true;
  }

  /**
   * Toggle a tool on/off (backward-compatible adapter). Disabling sets the level
   * off; re-enabling an off tool restores its code-declared default.
   */
  setToolEnabled(toolName: string, enabled: boolean, updatedBy?: number): boolean {
    if (!this.tools.has(toolName) || !this.db) return false;

    let next: ToolAccessLevel;
    if (!enabled) {
      next = "off";
    } else if (this.getEffectiveLevel(toolName) === "off") {
      next = this.getMinimumAccess(toolName);
    } else {
      next = this.getEffectiveLevel(toolName);
    }
    return this.updateToolLevel(toolName, next, updatedBy);
  }

  /**
   * Apply a legacy single-value scope (backward-compatible adapter).
   */
  updateToolScope(toolName: string, scope: ToolScope, updatedBy?: number): boolean {
    return this.updateToolLevel(toolName, scopeToLevel(scope), updatedBy);
  }

  /**
   * Get a tool's effective access level (DB override or code default).
   */
  getToolConfig(toolName: string): { level: ToolAccessLevel } | null {
    if (!this.tools.has(toolName)) return null;
    return { level: this.getEffectiveLevel(toolName) };
  }

  /**
   * Register all tools belonging to a plugin (tracks ownership for hot-reload).
   */
  registerPluginTools(
    pluginName: string,
    tools: Array<{
      tool: Tool;
      executor: ToolExecutor;
      scope?: ToolScope;
      mode?: ToolMode;
      minimumAccess?: ToolAccessLevel;
      requiresApproval?: boolean;
    }>
  ): number {
    if (this.pluginToolNames.has(pluginName)) {
      this.replacePluginTools(pluginName, tools);
      return this.pluginToolNames.get(pluginName)?.length ?? 0;
    }

    const names: string[] = [];
    for (const { tool, executor, scope, mode, minimumAccess } of tools) {
      if (this.tools.has(tool.name)) continue;
      this.insertTool(tool.name, {
        tool,
        executor,
        scope,
        mode: mode ?? "both",
        module: pluginName,
        minimumAccess: getExternalMinimumAccess(tool, scope, minimumAccess),
      });
      names.push(tool.name);
    }
    this.pluginToolNames.set(pluginName, names);

    // Seed new tools into DB config (if DB is initialized)
    this.seedConfigs(names);

    this.toolArrayCache = null;

    // Notify Tool RAG about new tools
    if (names.length > 0) {
      const addedTools = names.map((n) => this.tools.get(n)?.tool).filter((t): t is Tool => !!t);
      this.notifyToolsChanged([], addedTools);
    }

    return names.length;
  }

  /**
   * Replace all tools belonging to a plugin with new ones (hot-reload).
   * Atomically removes old tools then registers new ones.
   */
  replacePluginTools(
    pluginName: string,
    newTools: Array<{
      tool: Tool;
      executor: ToolExecutor;
      scope?: ToolScope;
      mode?: ToolMode;
      minimumAccess?: ToolAccessLevel;
      requiresApproval?: boolean;
    }>
  ): void {
    // Collect old tool names before removal (allowed to re-register these)
    const previousNames = new Set(this.pluginToolNames.get(pluginName) ?? []);
    this.removePluginTools(pluginName, false);
    const names: string[] = [];
    for (const { tool, executor, scope, mode, minimumAccess } of newTools) {
      // Prevent overwriting core/other-plugin tools
      if (this.tools.has(tool.name) && !previousNames.has(tool.name)) {
        log.warn(
          `Plugin "${pluginName}" tried to overwrite existing tool "${tool.name}" — skipped`
        );
        continue;
      }
      this.insertTool(tool.name, {
        tool,
        executor,
        scope,
        mode: mode ?? "both",
        module: pluginName,
        minimumAccess: getExternalMinimumAccess(tool, scope, minimumAccess),
      });
      names.push(tool.name);
    }
    this.pluginToolNames.set(pluginName, names);

    // Seed new tools into DB config (if DB is initialized)
    this.seedConfigs(names);

    this.toolArrayCache = null;

    // Notify Tool RAG about replaced tools
    const removedNames = [...previousNames].filter((n) => !names.includes(n));
    const addedTools = names.map((n) => this.tools.get(n)?.tool).filter((t): t is Tool => !!t);
    if (removedNames.length > 0 || addedTools.length > 0) {
      this.notifyToolsChanged(removedNames, addedTools);
    }
  }

  /**
   * Remove all tools belonging to a plugin.
   */
  removePluginTools(pluginName: string, notify = true): void {
    const tracked = this.pluginToolNames.get(pluginName);
    if (tracked) {
      for (const name of tracked) {
        this.tools.delete(name);
        // Also drop the runtime config so removed plugin tools don't leak (prev. omitted)
        this.toolConfigs.delete(name);
      }
      this.pluginToolNames.delete(pluginName);
      if (notify && tracked.length > 0) this.notifyToolsChanged(tracked, []);
    }
    this.toolArrayCache = null;
  }

  // ─── Tool RAG ──────────────────────────────────────────────────

  setToolIndex(index: ToolIndex | null): void {
    this.toolIndex = index;
  }

  getToolIndex(): ToolIndex | null {
    return this.toolIndex;
  }

  setEmbedder(embedder: EmbeddingProvider | null): void {
    this.embedderRef = embedder;
  }

  getEmbedder(): EmbeddingProvider | null {
    return this.embedderRef;
  }

  // ─── ToolSearch helpers ────────────────────────────────────────

  /**
   * Return the TypeBox parameter schema for a tool, or null if not found.
   * Used by tool_search executor to provide full schemas to the LLM.
   */
  getToolSchema(name: string): TSchema | null {
    const registered = this.tools.get(name);
    return registered?.tool.parameters ?? null;
  }

  /**
   * Returns true if a tool passes all scope/mode/enabled filters for the given context.
   * Extracted from getForContext() for reuse by tool_search and getCoreTools().
   */
  passesFilters(
    name: string,
    isGroup: boolean,
    chatId?: string,
    isAdmin?: boolean,
    senderId?: number
  ): boolean {
    if (!this.tools.has(name)) return false;
    return this.checkAccess(name, { isGroup, isAdmin: isAdmin ?? false, senderId, chatId }).ok;
  }

  /**
   * Return PiAiTool[] for all tools tagged "core" that pass scope/mode filters.
   * Used by the runtime when tool_search.enabled is true to build the initial tool set.
   */
  getCoreTools(
    isGroup: boolean,
    chatId?: string,
    isAdmin?: boolean,
    senderId?: number
  ): PiAiTool[] {
    const tools = Array.from(this.tools.entries())
      .filter(([name]) => {
        const tags = this.tools.get(name)?.tags;
        if (!tags?.includes("core")) return false;
        return this.passesFilters(name, isGroup, chatId, isAdmin, senderId);
      })
      .map(([, rt]) => rt.tool);

    const catalog = this.getNamespaceCatalog(isGroup, chatId, isAdmin, senderId);
    const renderedCatalog = formatNamespaceCatalogForPrompt(catalog);
    if (!renderedCatalog) return tools;

    return tools.map((tool) =>
      tool.name === "tool_search"
        ? {
            ...tool,
            description:
              `${tool.description}\n\nAvailable tool namespaces:\n${renderedCatalog}\n` +
              "Search a namespace by name when you know the domain, or describe the capability you need.",
          }
        : tool
    );
  }

  /**
   * Build the live namespace catalog after applying the same access checks used
   * for tool exposure and execution. The catalog is derived on demand so plugin
   * hot reloads and DB-backed permission changes cannot leave stale routes.
   */
  getNamespaceCatalog(
    isGroup: boolean,
    chatId?: string,
    isAdmin?: boolean,
    senderId?: number
  ): ToolNamespaceCatalogEntry[] {
    const available = Array.from(this.tools.entries())
      .filter(([name]) => this.passesFilters(name, isGroup, chatId, isAdmin, senderId))
      .map(([, registered]) => registered);
    return buildToolNamespaceCatalog(available);
  }

  onToolsChanged(
    callback: (removed: string[], added: PiAiTool[]) => void | Promise<void>
  ): () => void {
    this.onToolsChangedCallbacks.push(callback);
    return () => {
      const index = this.onToolsChangedCallbacks.indexOf(callback);
      if (index >= 0) this.onToolsChangedCallbacks.splice(index, 1);
    };
  }

  private notifyToolsChanged(removed: string[], added: PiAiTool[]): void {
    for (const cb of this.onToolsChangedCallbacks) {
      try {
        const result = cb(removed, added);
        if (result) {
          void result.catch((error: unknown) => {
            log.error({ err: error }, "onToolsChanged callback error");
          });
        }
      } catch (error) {
        log.error({ err: error }, "onToolsChanged callback error");
      }
    }
  }

  /**
   * Select tools using semantic RAG search on the user message.
   * Falls back to getForContext() if search returns nothing.
   */
  async getForContextWithRAG(
    query: string,
    queryEmbedding: number[],
    isGroup: boolean,
    toolLimit: number | null,
    chatId?: string,
    isAdmin?: boolean,
    senderId?: number
  ): Promise<PiAiTool[]> {
    // Get scope-filtered tools (no limit applied yet)
    const scopeFiltered = this.getForContext(isGroup, null, chatId, isAdmin, senderId);
    const scopeSet = new Set(scopeFiltered.map((t) => t.name));

    if (!this.toolIndex?.isIndexed) {
      return this.applyLimit(scopeFiltered, toolLimit);
    }

    // Collect always-on tools
    const selected = new Map<string, PiAiTool>();
    for (const tool of scopeFiltered) {
      if (this.toolIndex.isAlwaysIncluded(tool.name)) {
        selected.set(tool.name, tool);
      }
    }

    // Semantic search
    try {
      const results = await this.toolIndex.search(query, queryEmbedding);

      // Add results that pass the scope filter
      for (const result of results) {
        if (scopeSet.has(result.name) && !selected.has(result.name)) {
          const tool = scopeFiltered.find((t) => t.name === result.name);
          if (tool) selected.set(result.name, tool);
        }
      }
    } catch (error) {
      log.warn({ err: error }, "Search failed, falling back to full tool set");
      return this.applyLimit(scopeFiltered, toolLimit);
    }

    // Fallback: if no results from search, send all scope-filtered
    if (selected.size === 0) {
      log.warn("No tools matched query, sending all scope-filtered tools");
      return this.applyLimit(scopeFiltered, toolLimit);
    }

    const result = Array.from(selected.values());
    return this.applyLimit(result, toolLimit);
  }

  private applyLimit(tools: PiAiTool[], toolLimit: number | null): PiAiTool[] {
    if (toolLimit !== null && tools.length > toolLimit) {
      log.warn(
        `Provider tool limit: ${toolLimit}, selected: ${tools.length}. Truncating to ${toolLimit} tools.`
      );
      return tools.slice(0, toolLimit);
    }
    return tools;
  }
}
