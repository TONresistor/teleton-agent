import { Hono } from "hono";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { WORKSPACE_ROOT } from "../../workspace/paths.js";
import { clearPromptCache } from "../../soul/loader.js";
import { apiError } from "../http.js";

const SOUL_FILES = ["SOUL.md", "SECURITY.md", "STRATEGY.md", "MEMORY.md", "HEARTBEAT.md"] as const;
type SoulFile = (typeof SOUL_FILES)[number];

function isSoulFile(filename: string): filename is SoulFile {
  return SOUL_FILES.includes(filename as SoulFile);
}

export function createSoulRoutes(_deps: WebUIServerDeps) {
  const app = new Hono();

  // Get soul file content
  app.get("/:file", (c) => {
    try {
      const filename = c.req.param("file");

      if (!isSoulFile(filename)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid soul file. Must be one of: ${SOUL_FILES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      const filePath = join(WORKSPACE_ROOT, filename);

      try {
        const content = readFileSync(filePath, "utf-8");
        const response: APIResponse<{ content: string }> = {
          success: true,
          data: { content },
        };
        return c.json(response);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          // File doesn't exist - return empty content
          const response: APIResponse<{ content: string }> = {
            success: true,
            data: { content: "" },
          };
          return c.json(response);
        }
        throw error;
      }
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Update soul file content
  app.put("/:file", async (c) => {
    try {
      const filename = c.req.param("file");

      if (!isSoulFile(filename)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid soul file. Must be one of: ${SOUL_FILES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      const body = await c.req.json<{ content: string }>();
      if (typeof body.content !== "string") {
        const response: APIResponse = {
          success: false,
          error: "Request body must contain 'content' field with string value",
        };
        return c.json(response, 400);
      }

      const MAX_SOUL_SIZE = 1024 * 1024; // 1MB
      if (Buffer.byteLength(body.content, "utf-8") > MAX_SOUL_SIZE) {
        const response: APIResponse = {
          success: false,
          error: "Soul file content exceeds 1MB limit",
        };
        return c.json(response, 413);
      }

      const filePath = join(WORKSPACE_ROOT, filename);
      writeFileSync(filePath, body.content, "utf-8");
      clearPromptCache();

      const response: APIResponse<{ message: string }> = {
        success: true,
        data: { message: `${filename} updated successfully` },
      };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
