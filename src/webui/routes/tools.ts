import { Hono } from "hono";
import type { WebUIServerDeps, ToolInfo, ModuleInfo, APIResponse } from "../types.js";

export function createToolsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // Get all tools grouped by module
  app.get("/", (c) => {
    try {
      const allTools = deps.toolRegistry.getAll();
      const modules = deps.toolRegistry.getAvailableModules();

      // Create a map of tool name to tool definition for fast lookup
      const toolMap = new Map(allTools.map((t) => [t.name, t]));

      const moduleData: ModuleInfo[] = modules.map((moduleName) => {
        const moduleToolNames = deps.toolRegistry.getModuleTools(moduleName);

        const toolsInfo: ToolInfo[] = moduleToolNames
          .map((toolEntry) => {
            const tool = toolMap.get(toolEntry.name);
            if (!tool) return null;

            const config = deps.toolRegistry.getToolConfig(toolEntry.name);
            return {
              name: tool.name,
              description: tool.description || "",
              module: moduleName,
              scope: config?.scope ?? toolEntry.scope,
              category: deps.toolRegistry.getToolCategory(tool.name),
              enabled: config?.enabled ?? true,
            } as ToolInfo;
          })
          .filter((t) => t !== null) as ToolInfo[];

        return {
          name: moduleName,
          toolCount: moduleToolNames.length,
          tools: toolsInfo,
          isPlugin: deps.toolRegistry.isPluginModule(moduleName),
        };
      });

      const response: APIResponse<ModuleInfo[]> = {
        success: true,
        data: moduleData,
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return c.json(response, 500);
    }
  });

  // Update tool configuration
  app.put("/:name", async (c) => {
    try {
      const toolName = c.req.param("name");
      const body = await c.req.json();

      if (!deps.toolRegistry.has(toolName)) {
        const response: APIResponse = {
          success: false,
          error: `Tool "${toolName}" not found`,
        };
        return c.json(response, 404);
      }

      const { enabled, scope } = body as { enabled?: boolean; scope?: string };

      // Validate scope against whitelist
      const VALID_SCOPES = ["always", "dm-only", "group-only", "admin-only"] as const;
      if (scope !== undefined && !VALID_SCOPES.includes(scope as any)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid scope "${scope}". Must be one of: ${VALID_SCOPES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      // Update enabled status if provided
      if (enabled !== undefined) {
        const success = deps.toolRegistry.setToolEnabled(toolName, enabled);
        if (!success) {
          const response: APIResponse = {
            success: false,
            error: "Failed to update tool enabled status",
          };
          return c.json(response, 500);
        }
      }

      // Update scope if provided
      if (scope !== undefined) {
        const success = deps.toolRegistry.updateToolScope(
          toolName,
          scope as "always" | "dm-only" | "group-only" | "admin-only"
        );
        if (!success) {
          const response: APIResponse = {
            success: false,
            error: "Failed to update tool scope",
          };
          return c.json(response, 500);
        }
      }

      const config = deps.toolRegistry.getToolConfig(toolName);
      const response: APIResponse = {
        success: true,
        data: {
          tool: toolName,
          enabled: config?.enabled ?? true,
          scope: config?.scope ?? "always",
        },
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return c.json(response, 500);
    }
  });

  // Get tool configuration
  app.get("/:name/config", (c) => {
    try {
      const toolName = c.req.param("name");

      if (!deps.toolRegistry.has(toolName)) {
        const response: APIResponse = {
          success: false,
          error: `Tool "${toolName}" not found`,
        };
        return c.json(response, 404);
      }

      const config = deps.toolRegistry.getToolConfig(toolName);
      const response: APIResponse = {
        success: true,
        data: {
          tool: toolName,
          enabled: config?.enabled ?? true,
          scope: config?.scope ?? "always",
        },
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return c.json(response, 500);
    }
  });

  // Get tools for a specific module
  app.get("/:module", (c) => {
    try {
      const moduleName = c.req.param("module");
      const allTools = deps.toolRegistry.getAll();
      const toolMap = new Map(allTools.map((t) => [t.name, t]));

      const moduleToolNames = deps.toolRegistry.getModuleTools(moduleName);

      const toolsInfo: ToolInfo[] = moduleToolNames
        .map((toolEntry) => {
          const tool = toolMap.get(toolEntry.name);
          if (!tool) return null;

          const config = deps.toolRegistry.getToolConfig(toolEntry.name);
          return {
            name: tool.name,
            description: tool.description || "",
            module: moduleName,
            scope: config?.scope ?? toolEntry.scope,
            category: deps.toolRegistry.getToolCategory(tool.name),
            enabled: config?.enabled ?? true,
          } as ToolInfo;
        })
        .filter((t) => t !== null) as ToolInfo[];

      const response: APIResponse<ToolInfo[]> = {
        success: true,
        data: toolsInfo,
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return c.json(response, 500);
    }
  });

  return app;
}
