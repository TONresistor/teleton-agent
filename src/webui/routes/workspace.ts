import { Hono } from "hono";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  renameSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { WORKSPACE_ROOT } from "../../workspace/paths.js";
import {
  validatePath,
  validateReadPath,
  validateWritePath,
  validateDirectory,
  WorkspaceSecurityError,
} from "../../workspace/validator.js";
import { getErrorMessage } from "../../utils/errors.js";

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

interface WorkspaceInfo {
  root: string;
  totalFiles: number;
  totalSize: number;
}

function errorResponse(c: any, error: unknown, status: number = 500) {
  const message = getErrorMessage(error);
  const code = error instanceof WorkspaceSecurityError ? 403 : status;
  const response: APIResponse = { success: false, error: message };
  return c.json(response, code);
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/** Recursively count files and total size */
function getWorkspaceStats(dir: string): { files: number; size: number } {
  let files = 0;
  let size = 0;

  if (!existsSync(dir)) return { files, size };

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = getWorkspaceStats(fullPath);
      files += sub.files;
      size += sub.size;
    } else if (entry.isFile()) {
      files++;
      try {
        size += statSync(fullPath).size;
      } catch {
        // skip inaccessible files
      }
    }
  }

  return { files, size };
}

/** List entries in a directory, optionally recursive */
function listDir(absPath: string, recursive: boolean): FileEntry[] {
  if (!existsSync(absPath)) return [];

  const entries: FileEntry[] = [];

  for (const entry of readdirSync(absPath, { withFileTypes: true })) {
    const fullPath = join(absPath, entry.name);
    const relPath = relative(WORKSPACE_ROOT, fullPath);

    try {
      const stats = statSync(fullPath);
      entries.push({
        name: entry.name,
        path: relPath,
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : stats.size,
        mtime: stats.mtime.toISOString(),
      });

      if (recursive && entry.isDirectory()) {
        entries.push(...listDir(fullPath, true));
      }
    } catch {
      // skip inaccessible entries
    }
  }

  return entries;
}

export function createWorkspaceRoutes(_deps: WebUIServerDeps) {
  const app = new Hono();

  // List directory
  app.get("/", (c) => {
    try {
      const subpath = c.req.query("path") || "";
      const recursive = c.req.query("recursive") === "true";

      // Validate directory path (allow root)
      const validated = subpath
        ? validateDirectory(subpath)
        : {
            absolutePath: WORKSPACE_ROOT,
            relativePath: "",
            exists: existsSync(WORKSPACE_ROOT),
            isDirectory: true,
            extension: "",
            filename: "",
          };

      if (!validated.exists) {
        const response: APIResponse<FileEntry[]> = { success: true, data: [] };
        return c.json(response);
      }

      const entries = listDir(validated.absolutePath, recursive);

      // Sort: directories first, then alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const response: APIResponse<FileEntry[]> = { success: true, data: entries };
      return c.json(response);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // Serve raw image file with correct MIME type
  app.get("/raw", (c) => {
    try {
      const path = c.req.query("path");
      if (!path) {
        const response: APIResponse = { success: false, error: "Missing 'path' query parameter" };
        return c.json(response, 400);
      }

      const validated = validateReadPath(path);
      const mime = IMAGE_MIME_TYPES[validated.extension];

      if (!mime) {
        const response: APIResponse = {
          success: false,
          error: "Unsupported file type for raw preview",
        };
        return c.json(response, 415);
      }

      const stats = statSync(validated.absolutePath);

      // 5MB limit for image preview
      if (stats.size > 5 * 1024 * 1024) {
        const response: APIResponse = {
          success: false,
          error: "Image too large for preview (max 5MB)",
        };
        return c.json(response, 413);
      }

      const buffer = readFileSync(validated.absolutePath);

      const headers: Record<string, string> = {
        "Content-Type": mime,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=60",
      };

      // SVG security: sandbox to prevent script execution if opened directly
      if (validated.extension === ".svg") {
        headers["Content-Security-Policy"] = "sandbox";
      }

      return c.body(buffer, 200, headers);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // Read file content
  app.get("/read", (c) => {
    try {
      const path = c.req.query("path");
      if (!path) {
        const response: APIResponse = { success: false, error: "Missing 'path' query parameter" };
        return c.json(response, 400);
      }

      const validated = validateReadPath(path);
      const stats = statSync(validated.absolutePath);

      // Limit read size to 1MB for safety
      if (stats.size > 1024 * 1024) {
        const response: APIResponse = { success: false, error: "File too large to read (max 1MB)" };
        return c.json(response, 413);
      }

      const content = readFileSync(validated.absolutePath, "utf-8");

      const response: APIResponse<{ content: string; size: number }> = {
        success: true,
        data: { content, size: stats.size },
      };
      return c.json(response);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // Write file
  app.post("/write", async (c) => {
    try {
      const body = await c.req.json<{ path: string; content: string }>();

      if (!body.path || typeof body.content !== "string") {
        const response: APIResponse = {
          success: false,
          error: "Request body must contain 'path' and 'content'",
        };
        return c.json(response, 400);
      }

      const validated = validateWritePath(body.path);

      // Ensure parent directory exists
      const parentDir = join(validated.absolutePath, "..");
      mkdirSync(parentDir, { recursive: true });

      writeFileSync(validated.absolutePath, body.content, "utf-8");

      const response: APIResponse<{ message: string }> = {
        success: true,
        data: { message: `File saved: ${validated.relativePath}` },
      };
      return c.json(response);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // Create directory
  app.post("/mkdir", async (c) => {
    try {
      const body = await c.req.json<{ path: string }>();

      if (!body.path) {
        const response: APIResponse = { success: false, error: "Request body must contain 'path'" };
        return c.json(response, 400);
      }

      const validated = validateDirectory(body.path);
      mkdirSync(validated.absolutePath, { recursive: true });

      const response: APIResponse<{ message: string }> = {
        success: true,
        data: { message: `Directory created: ${validated.relativePath}` },
      };
      return c.json(response);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // Delete file or directory
  app.delete("/", async (c) => {
    try {
      const body = await c.req.json<{ path: string; recursive?: boolean }>();

      if (!body.path) {
        const response: APIResponse = { success: false, error: "Request body must contain 'path'" };
        return c.json(response, 400);
      }

      const validated = validatePath(body.path, false);

      if (validated.isDirectory && !body.recursive) {
        // Check if directory is empty
        const contents = readdirSync(validated.absolutePath);
        if (contents.length > 0) {
          const response: APIResponse = {
            success: false,
            error: "Directory is not empty. Set recursive=true to delete recursively.",
          };
          return c.json(response, 400);
        }
      }

      rmSync(validated.absolutePath, { recursive: !!body.recursive });

      const response: APIResponse<{ message: string }> = {
        success: true,
        data: { message: `Deleted: ${validated.relativePath}` },
      };
      return c.json(response);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // Rename / move
  app.post("/rename", async (c) => {
    try {
      const body = await c.req.json<{ from: string; to: string }>();

      if (!body.from || !body.to) {
        const response: APIResponse = {
          success: false,
          error: "Request body must contain 'from' and 'to'",
        };
        return c.json(response, 400);
      }

      const fromValidated = validatePath(body.from, false);
      const toValidated = validatePath(body.to, true);

      // Ensure target parent directory exists
      const parentDir = join(toValidated.absolutePath, "..");
      mkdirSync(parentDir, { recursive: true });

      renameSync(fromValidated.absolutePath, toValidated.absolutePath);

      const response: APIResponse<{ message: string }> = {
        success: true,
        data: { message: `Renamed: ${fromValidated.relativePath} → ${toValidated.relativePath}` },
      };
      return c.json(response);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // Workspace info / stats
  app.get("/info", (c) => {
    try {
      const stats = getWorkspaceStats(WORKSPACE_ROOT);

      const response: APIResponse<WorkspaceInfo> = {
        success: true,
        data: {
          root: WORKSPACE_ROOT,
          totalFiles: stats.files,
          totalSize: stats.size,
        },
      };
      return c.json(response);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}
