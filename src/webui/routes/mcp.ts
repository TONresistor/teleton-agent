import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse, McpServerInfo } from "../types.js";
import { readRawConfig, writeRawConfig } from "../../config/configurable-keys.js";

/** Strict validation for package names and args — blocks shell metacharacters */
const SAFE_PACKAGE_RE = /^[@a-zA-Z0-9._\/-]+$/;
const SAFE_ARG_RE = /^[a-zA-Z0-9._\/:=@-]+$/;

export function createMcpRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // List all MCP servers with their connection status and tools
  app.get("/", (c) => {
    const response: APIResponse<McpServerInfo[]> = {
      success: true,
      data: deps.mcpServers,
    };
    return c.json(response);
  });

  // Add a new MCP server to config.yaml (takes effect on restart)
  app.post("/", async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        package?: string;
        args?: string[];
        url?: string;
        scope?: string;
        env?: Record<string, string>;
      }>();

      if (!body.package && !body.url) {
        return c.json(
          { success: false, error: "Either 'package' or 'url' is required" } as APIResponse<never>,
          400
        );
      }

      // Validate package name and args against strict regex
      if (body.package && !SAFE_PACKAGE_RE.test(body.package)) {
        return c.json(
          {
            success: false,
            error: "Invalid package name — only alphanumeric, @, /, ., - allowed",
          } as APIResponse<never>,
          400
        );
      }
      if (body.args) {
        for (const arg of body.args) {
          if (!SAFE_ARG_RE.test(arg)) {
            return c.json(
              {
                success: false,
                error: `Invalid argument "${arg}" — only alphanumeric, ., /, :, =, @, - allowed`,
              } as APIResponse<never>,
              400
            );
          }
        }
      }

      const raw = readRawConfig(deps.configPath);
      if (!raw.mcp || typeof raw.mcp !== "object") raw.mcp = { servers: {} };
      const mcp = raw.mcp as Record<string, unknown>;
      if (!mcp.servers || typeof mcp.servers !== "object") mcp.servers = {};
      const servers = mcp.servers as Record<string, Record<string, unknown>>;

      // Derive server name
      const serverName = body.name || deriveServerName(body.package || body.url || "unknown");

      if (servers[serverName]) {
        return c.json(
          { success: false, error: `Server "${serverName}" already exists` } as APIResponse<never>,
          409
        );
      }

      const entry: Record<string, unknown> = {};
      if (body.url) {
        entry.url = body.url;
      } else {
        entry.command = "npx";
        entry.args = ["-y", body.package!, ...(body.args || [])];
      }
      if (body.scope && body.scope !== "always") entry.scope = body.scope;
      if (body.env && Object.keys(body.env).length > 0) entry.env = body.env;

      servers[serverName] = entry;
      writeRawConfig(raw, deps.configPath);

      return c.json({
        success: true,
        data: { name: serverName, message: "Server added. Restart teleton to connect." },
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        } as APIResponse<never>,
        500
      );
    }
  });

  // Remove an MCP server from config.yaml
  app.delete("/:name", (c) => {
    try {
      const name = c.req.param("name");

      const raw = readRawConfig(deps.configPath);
      const mcp = (raw.mcp || {}) as Record<string, unknown>;
      const servers = (mcp.servers || {}) as Record<string, unknown>;

      if (!servers[name]) {
        return c.json(
          { success: false, error: `Server "${name}" not found` } as APIResponse<never>,
          404
        );
      }

      delete servers[name];
      writeRawConfig(raw, deps.configPath);

      return c.json({
        success: true,
        data: { name, message: "Server removed. Restart teleton to apply." },
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        } as APIResponse<never>,
        500
      );
    }
  });

  return app;
}

function deriveServerName(pkg: string): string {
  const unscoped = pkg.includes("/") ? pkg.split("/").pop()! : pkg;
  return unscoped
    .replace(/^server-/, "")
    .replace(/^mcp-server-/, "")
    .replace(/^mcp-/, "");
}
