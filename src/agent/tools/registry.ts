import { validateToolCall } from "@mariozechner/pi-ai";
import type { Tool as PiAiTool, ToolCall } from "@mariozechner/pi-ai";
import type { RegisteredTool, Tool, ToolContext, ToolExecutor, ToolResult } from "./types.js";

/**
 * Registry for managing and executing agent tools
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a new tool
   */
  register<TParams = unknown>(tool: Tool, executor: ToolExecutor<TParams>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, { tool, executor: executor as ToolExecutor });
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

    try {
      // Validate arguments against the tool's schema
      const validatedArgs = validateToolCall(this.getAll(), toolCall);

      // Execute the tool
      const result = await registered.executor(validatedArgs, context);

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
