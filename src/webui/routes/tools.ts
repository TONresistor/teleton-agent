import { Hono } from "hono";
import type { WebUIServerDeps, ToolInfo, ModuleInfo, APIResponse } from "../types.js";
import type { ToolScope } from "../../agent/tools/types.js";
import {
  scopeToLevel,
  levelToScope,
  isToolAccessLevel,
  type ToolAccessLevel,
} from "../../agent/tools/scope.js";
import { apiError } from "../http.js";
import { readRawConfig, setNestedValue, writeRawConfig } from "../../config/configurable-keys.js";

const VALID_SCOPES: readonly ToolScope[] = [
  "always",
  "dm-only",
  "group-only",
  "admin-only",
  "open",
  "allowlist",
  "disabled",
];

export function createToolsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // Build the API view of a single tool from its effective access level.
  const buildToolInfo = (toolName: string, moduleName: string): ToolInfo | null => {
    const tool = deps.toolRegistry.getAll().find((t) => t.name === toolName);
    if (!tool) return null;
    const level = deps.toolRegistry.getToolConfig(toolName)?.level ?? "all";
    return {
      name: tool.name,
      description: tool.description || "",
      module: moduleName,
      level,
      category: deps.toolRegistry.getToolCategory(tool.name),
      scope: levelToScope(level),
      enabled: level !== "off",
    };
  };

  const buildModuleTools = (moduleName: string): ToolInfo[] =>
    deps.toolRegistry
      .getModuleTools(moduleName)
      .map((entry) => buildToolInfo(entry.name, moduleName))
      .filter((t): t is ToolInfo => t !== null);

  // Get all tools grouped by module
  app.get("/", (c) => {
    try {
      const modules = deps.toolRegistry.getAvailableModules();

      const moduleData: ModuleInfo[] = modules.map((moduleName) => {
        const tools = buildModuleTools(moduleName);
        return {
          name: moduleName,
          toolCount: tools.length,
          tools,
          isPlugin: deps.toolRegistry.isPluginModule(moduleName),
        };
      });

      const response: APIResponse<ModuleInfo[]> = {
        success: true,
        data: moduleData,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // ── Tool RAG (must be before /:name wildcard) ──────────────────────

  // Get Tool RAG status
  app.get("/rag", (c) => {
    try {
      const config = deps.agent.getConfig();
      const toolIndex = deps.toolRegistry.getToolIndex();
      const response: APIResponse = {
        success: true,
        data: {
          enabled: config.tool_rag.enabled,
          indexed: toolIndex?.isIndexed ?? false,
          topK: config.tool_rag.top_k,
          totalTools: deps.toolRegistry.count,
          alwaysInclude: config.tool_rag.always_include,
          skipUnlimitedProviders: config.tool_rag.skip_unlimited_providers,
        },
      };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Toggle Tool RAG or update settings
  app.put("/rag", async (c) => {
    try {
      const config = deps.agent.getConfig();
      const body = await c.req.json();
      const { enabled, topK, alwaysInclude, skipUnlimitedProviders } = body as {
        enabled?: boolean;
        topK?: number;
        alwaysInclude?: string[];
        skipUnlimitedProviders?: boolean;
      };

      if (enabled !== undefined) {
        config.tool_rag.enabled = enabled;
      }
      if (topK !== undefined) {
        if (topK < 5 || topK > 200) {
          return c.json({ success: false, error: "topK must be between 5 and 200" }, 400);
        }
        config.tool_rag.top_k = topK;
      }
      if (alwaysInclude !== undefined) {
        if (
          !Array.isArray(alwaysInclude) ||
          alwaysInclude.some((s) => typeof s !== "string" || s.length === 0)
        ) {
          return c.json(
            { success: false, error: "alwaysInclude must be an array of non-empty strings" },
            400
          );
        }
        config.tool_rag.always_include = alwaysInclude;
      }
      if (skipUnlimitedProviders !== undefined) {
        config.tool_rag.skip_unlimited_providers = skipUnlimitedProviders;
      }

      // Persist to YAML
      const raw = readRawConfig(deps.configPath);
      setNestedValue(raw, "tool_rag.enabled", config.tool_rag.enabled);
      setNestedValue(raw, "tool_rag.top_k", config.tool_rag.top_k);
      setNestedValue(raw, "tool_rag.always_include", config.tool_rag.always_include);
      setNestedValue(
        raw,
        "tool_rag.skip_unlimited_providers",
        config.tool_rag.skip_unlimited_providers
      );
      writeRawConfig(raw, deps.configPath);

      const toolIndex = deps.toolRegistry.getToolIndex();
      const response: APIResponse = {
        success: true,
        data: {
          enabled: config.tool_rag.enabled,
          indexed: toolIndex?.isIndexed ?? false,
          topK: config.tool_rag.top_k,
          totalTools: deps.toolRegistry.count,
          alwaysInclude: config.tool_rag.always_include,
          skipUnlimitedProviders: config.tool_rag.skip_unlimited_providers,
        },
      };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // ── Per-tool routes (wildcard) ─────────────────────────────────────

  // Update tool configuration. Accepts the access-level model { level } and, for
  // backward compatibility, the legacy { enabled?, scope? } shape.
  app.put("/:name", async (c) => {
    try {
      const toolName = c.req.param("name");
      const body = (await c.req.json()) as {
        enabled?: boolean;
        scope?: string;
        level?: string;
      };

      if (!deps.toolRegistry.has(toolName)) {
        return c.json({ success: false, error: `Tool "${toolName}" not found` }, 404);
      }

      // Validate provided values up front.
      if (body.scope !== undefined && !(VALID_SCOPES as readonly string[]).includes(body.scope)) {
        return c.json(
          {
            success: false,
            error: `Invalid scope "${body.scope}". Must be one of: ${VALID_SCOPES.join(", ")}`,
          },
          400
        );
      }
      if (body.level !== undefined && !isToolAccessLevel(body.level)) {
        return c.json(
          {
            success: false,
            error: `Invalid level "${body.level}". Must be one of: all, allowlist, admin, off`,
          },
          400
        );
      }

      // Resolve the next level, layering each provided field.
      let next: ToolAccessLevel = deps.toolRegistry.getToolConfig(toolName)?.level ?? "all";
      if (body.scope !== undefined) next = scopeToLevel(body.scope as ToolScope);
      if (body.enabled === false) next = "off";
      else if (body.enabled === true && next === "off") {
        next = "all";
      }
      if (isToolAccessLevel(body.level)) next = body.level;

      const ok = deps.toolRegistry.updateToolLevel(toolName, next);
      if (!ok) {
        return c.json({ success: false, error: "Failed to update tool access" }, 500);
      }

      const level = deps.toolRegistry.getToolConfig(toolName)?.level ?? next;
      return c.json({
        success: true,
        data: {
          tool: toolName,
          level,
          scope: levelToScope(level),
          enabled: level !== "off",
        },
      });
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Get tool configuration
  app.get("/:name/config", (c) => {
    try {
      const toolName = c.req.param("name");

      if (!deps.toolRegistry.has(toolName)) {
        return c.json({ success: false, error: `Tool "${toolName}" not found` }, 404);
      }

      const level = deps.toolRegistry.getToolConfig(toolName)?.level ?? "all";
      return c.json({
        success: true,
        data: {
          tool: toolName,
          level,
          scope: levelToScope(level),
          enabled: level !== "off",
        },
      });
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Get tools for a specific module
  app.get("/:module", (c) => {
    try {
      const moduleName = c.req.param("module");
      const response: APIResponse<ToolInfo[]> = {
        success: true,
        data: buildModuleTools(moduleName),
      };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
