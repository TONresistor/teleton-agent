import { validateToolCall } from "@mariozechner/pi-ai";
import type { Tool as PiAiTool, ToolCall } from "@mariozechner/pi-ai";
import type {
  RegisteredTool,
  Tool,
  ToolContext,
  ToolExecutor,
  ToolResult,
  ToolScope,
} from "./types.js";
import type { ModulePermissions } from "./module-permissions.js";
import { TOOL_EXECUTION_TIMEOUT_MS } from "../../constants/timeouts.js";

/**
 * Registry for managing and executing agent tools
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private scopes: Map<string, ToolScope> = new Map();
  private toolModules: Map<string, string> = new Map();
  private permissions: ModulePermissions | null = null;

  /**
   * Register a new tool with optional scope
   */
  register<TParams = unknown>(
    tool: Tool,
    executor: ToolExecutor<TParams>,
    scope?: ToolScope
  ): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, { tool, executor: executor as ToolExecutor });
    if (scope && scope !== "always") {
      this.scopes.set(tool.name, scope);
    }
    this.toolModules.set(tool.name, tool.name.split("_")[0]);
  }

  /**
   * Set the module permissions manager
   */
  setPermissions(mp: ModulePermissions): void {
    this.permissions = mp;
  }

  /**
   * Get sorted unique module names derived from registered tools
   */
  getAvailableModules(): string[] {
    const modules = new Set(this.toolModules.values());
    return Array.from(modules).sort();
  }

  /**
   * Get the number of tools in a module
   */
  getModuleToolCount(module: string): number {
    let count = 0;
    for (const mod of this.toolModules.values()) {
      if (mod === module) count++;
    }
    return count;
  }

  /**
   * Get tools belonging to a module with their scope
   */
  getModuleTools(module: string): Array<{ name: string; scope: ToolScope | "always" }> {
    const result: Array<{ name: string; scope: ToolScope | "always" }> = [];
    for (const [name, mod] of this.toolModules) {
      if (mod === module) {
        result.push({ name, scope: this.scopes.get(name) ?? "always" });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get all registered tools for pi-ai
   */
  getAll(): PiAiTool[] {
    return Array.from(this.tools.values()).map((rt) => rt.tool);
  }

  /**
   * Execute a tool call from the LLM
   */
  async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
    const registered = this.tools.get(toolCall.name);

    if (!registered) {
      return {
        success: false,
        error: `Unknown tool: ${toolCall.name}`,
      };
    }

    // Enforce scope: block dm-only tools in groups and group-only tools in DMs
    const scope = this.scopes.get(toolCall.name);
    if (scope === "dm-only" && context.isGroup) {
      return {
        success: false,
        error: `Tool "${toolCall.name}" is not available in group chats`,
      };
    }
    if (scope === "group-only" && !context.isGroup) {
      return {
        success: false,
        error: `Tool "${toolCall.name}" is only available in group chats`,
      };
    }

    // Enforce module permissions in groups
    if (context.isGroup && this.permissions) {
      const module = this.toolModules.get(toolCall.name);
      if (module) {
        const level = this.permissions.getLevel(context.chatId, module);
        if (level === "disabled") {
          return {
            success: false,
            error: `Module "${module}" is disabled in this group`,
          };
        }
        if (level === "admin") {
          const isAdmin = context.config?.telegram.admin_ids.includes(context.senderId) ?? false;
          if (!isAdmin) {
            return {
              success: false,
              error: `Module "${module}" is restricted to admins in this group`,
            };
          }
        }
      }
    }

    try {
      // Validate arguments against the tool's schema
      const validatedArgs = validateToolCall(this.getAll(), toolCall);

      // Execute the tool with timeout protection
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        registered.executor(validatedArgs, context),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () =>
              reject(
                new Error(
                  `Tool "${toolCall.name}" timed out after ${TOOL_EXECUTION_TIMEOUT_MS / 1000}s`
                )
              ),
            TOOL_EXECUTION_TIMEOUT_MS
          );
        }),
      ]).finally(() => clearTimeout(timeoutHandle));

      return result;
    } catch (error) {
      console.error(`Error executing tool ${toolCall.name}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get tools respecting a provider's tool limit
   */
  getForProvider(toolLimit: number | null): PiAiTool[] {
    const all = this.getAll();
    if (toolLimit === null || all.length <= toolLimit) {
      return all;
    }
    console.warn(
      `⚠️ Provider tool limit: ${toolLimit}, registered: ${all.length}. Truncating to ${toolLimit} tools.`
    );
    return all.slice(0, toolLimit);
  }

  /**
   * Get tools filtered by chat context (DM vs group), module permissions, and provider limit.
   * - In groups: excludes "dm-only" tools (financial, private)
   * - In DMs: excludes "group-only" tools (moderation)
   * - In groups with permissions: excludes disabled modules, admin-only modules for non-admins
   */
  getForContext(
    isGroup: boolean,
    toolLimit: number | null,
    chatId?: string,
    isAdmin?: boolean
  ): PiAiTool[] {
    const excluded = isGroup ? "dm-only" : "group-only";
    const filtered = Array.from(this.tools.values())
      .filter((rt) => {
        // Scope filter
        if (this.scopes.get(rt.tool.name) === excluded) return false;

        // Module permission filter (only in groups)
        if (isGroup && chatId && this.permissions) {
          const module = this.toolModules.get(rt.tool.name);
          if (module) {
            const level = this.permissions.getLevel(chatId, module);
            if (level === "disabled") return false;
            if (level === "admin" && !isAdmin) return false;
          }
        }

        return true;
      })
      .map((rt) => rt.tool);

    if (toolLimit !== null && filtered.length > toolLimit) {
      console.warn(
        `⚠️ Provider tool limit: ${toolLimit}, after scope filter: ${filtered.length}. Truncating to ${toolLimit} tools.`
      );
      return filtered.slice(0, toolLimit);
    }
    return filtered;
  }

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get the number of registered tools
   */
  get count(): number {
    return this.tools.size;
  }

  /**
   * Get the category of a tool by name
   */
  getToolCategory(name: string): "data-bearing" | "action" | undefined {
    const registered = this.tools.get(name);
    return registered?.tool.category;
  }
}
