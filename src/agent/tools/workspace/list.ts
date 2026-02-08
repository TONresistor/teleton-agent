// src/agent/tools/workspace/list.ts

import { Type } from "@sinclair/typebox";
import { readdirSync, lstatSync } from "fs";
import { join } from "path";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import {
  validateDirectory,
  WORKSPACE_ROOT,
  WorkspaceSecurityError,
} from "../../../workspace/index.js";

interface WorkspaceListParams {
  path?: string;
  recursive?: boolean;
  filter?: "all" | "files" | "directories";
}

export const workspaceListTool: Tool = {
  name: "workspace_list",
  description: `List files and directories in your workspace.

Your workspace is at ~/.teleton/workspace/ and contains:
- SOUL.md, MEMORY.md, BOOTSTRAP.md (config files)
- memory/ (daily logs)
- downloads/ (downloaded media)
- uploads/ (files to send)
- temp/ (temporary files)

You can ONLY access files within this workspace. Files outside (config.yaml, wallet.json, etc.) are protected.`,

  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Subdirectory to list (relative to workspace root). Leave empty for root.",
      })
    ),
    recursive: Type.Optional(
      Type.Boolean({
        description: "List files recursively (default: false)",
      })
    ),
    filter: Type.Optional(
      Type.String({
        description: "Filter by type: 'all' (default), 'files', or 'directories'",
        enum: ["all", "files", "directories"],
      })
    ),
  }),
};

interface FileInfo {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
}

function listDir(dirPath: string, recursive: boolean, filter: string): FileInfo[] {
  const results: FileInfo[] = [];

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stats = lstatSync(fullPath);
      const isDir = stats.isDirectory();

      // Apply filter
      if (filter === "files" && isDir) continue;
      if (filter === "directories" && !isDir) continue;

      const relativePath = fullPath.replace(WORKSPACE_ROOT + "/", "");

      results.push({
        name: entry,
        path: relativePath,
        type: isDir ? "directory" : "file",
        size: isDir ? undefined : stats.size,
        modified: stats.mtime.toISOString(),
      });

      // Recursive listing
      if (recursive && isDir) {
        results.push(...listDir(fullPath, recursive, filter));
      }
    }
  } catch (error) {
    // Ignore permission errors
  }

  return results;
}

export const workspaceListExecutor: ToolExecutor<WorkspaceListParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { path = "", recursive = false, filter = "all" } = params;

    // Validate the path
    const validated = validateDirectory(path || WORKSPACE_ROOT);

    if (!validated.exists) {
      return {
        success: true,
        data: {
          path: validated.relativePath || "/",
          files: [],
          message: "Directory does not exist",
        },
      };
    }

    const files = listDir(validated.absolutePath, recursive, filter);

    return {
      success: true,
      data: {
        path: validated.relativePath || "/",
        files,
        count: files.length,
        workspaceRoot: WORKSPACE_ROOT,
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceSecurityError) {
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
