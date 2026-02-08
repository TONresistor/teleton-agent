/**
 * Plugin loader - discovers and registers external tools from ~/.teleton/plugins/
 *
 * Plugin format (JS module):
 *
 *   export const tools = [
 *     {
 *       name: "my_tool",
 *       description: "What this tool does",
 *       parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
 *       execute: async (params, context) => {
 *         return { success: true, data: { result: "hello" } };
 *       }
 *     }
 *   ];
 *
 * Plugins are loaded from:
 *   ~/.teleton/plugins/my-plugin.js       (single file)
 *   ~/.teleton/plugins/my-plugin/index.js (folder)
 */

import { readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import type { ToolRegistry } from "./registry.js";

interface PluginToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    params: unknown,
    context: unknown
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  category?: "data-bearing" | "action";
}

interface PluginModule {
  tools?: PluginToolDef[];
}

/**
 * Load plugins from ~/.teleton/plugins/ and register their tools
 * Returns the number of tools registered from plugins
 */
export async function loadPlugins(registry: ToolRegistry): Promise<number> {
  const pluginsDir = WORKSPACE_PATHS.PLUGINS_DIR;

  if (!existsSync(pluginsDir)) {
    return 0;
  }

  const entries = readdirSync(pluginsDir);
  let totalRegistered = 0;

  for (const entry of entries) {
    const entryPath = join(pluginsDir, entry);
    let modulePath: string | null = null;

    // Determine module path: file.js or folder/index.js
    const stat = statSync(entryPath);
    if (stat.isFile() && entry.endsWith(".js")) {
      modulePath = entryPath;
    } else if (stat.isDirectory()) {
      const indexPath = join(entryPath, "index.js");
      if (existsSync(indexPath)) {
        modulePath = indexPath;
      }
    }

    if (!modulePath) continue;

    try {
      // Dynamic import requires file:// URL on all platforms
      const moduleUrl = pathToFileURL(modulePath).href;
      const mod = (await import(moduleUrl)) as PluginModule;

      if (!mod.tools || !Array.isArray(mod.tools)) {
        console.warn(`⚠️  Plugin "${entry}": no 'tools' array exported, skipping`);
        continue;
      }

      let registered = 0;
      for (const toolDef of mod.tools) {
        // Validate required fields
        if (!toolDef.name || typeof toolDef.name !== "string") {
          console.warn(`⚠️  Plugin "${entry}": tool missing 'name', skipping`);
          continue;
        }
        if (!toolDef.description || typeof toolDef.description !== "string") {
          console.warn(
            `⚠️  Plugin "${entry}": tool "${toolDef.name}" missing 'description', skipping`
          );
          continue;
        }
        if (!toolDef.execute || typeof toolDef.execute !== "function") {
          console.warn(
            `⚠️  Plugin "${entry}": tool "${toolDef.name}" missing 'execute' function, skipping`
          );
          continue;
        }
        if (registry.has(toolDef.name)) {
          console.warn(
            `⚠️  Plugin "${entry}": tool "${toolDef.name}" already registered, skipping`
          );
          continue;
        }

        // Build the Tool object (pi-ai compatible)
        const tool = {
          name: toolDef.name,
          description: toolDef.description,
          parameters: toolDef.parameters || { type: "object" as const, properties: {} },
          ...(toolDef.category ? { category: toolDef.category } : {}),
        };

        // Wrap execute as ToolExecutor
        const executor = toolDef.execute;

        registry.register(tool as any, executor as any);
        registered++;
      }

      if (registered > 0) {
        console.log(
          `🔌 Plugin "${entry}": ${registered} tool${registered > 1 ? "s" : ""} registered`
        );
      }
      totalRegistered += registered;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Plugin "${entry}" failed to load: ${msg}`);
    }
  }

  return totalRegistered;
}
