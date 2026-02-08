// src/agent/tools/workspace/delete.ts

import { Type } from "@sinclair/typebox";
import { unlinkSync, rmdirSync, readdirSync, rmSync } from "fs";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { validatePath, WorkspaceSecurityError } from "../../../workspace/index.js";

interface WorkspaceDeleteParams {
  path: string;
  recursive?: boolean;
}

// Files that cannot be deleted (core workspace files)
const PROTECTED_WORKSPACE_FILES = [
  "SOUL.md",
  "STRATEGY.md",
  "SECURITY.md",
  "MEMORY.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "USER.md",
];

export const workspaceDeleteTool: Tool = {
  name: "workspace_delete",
  description: `Delete a file or directory from your workspace.

PROTECTED FILES (cannot delete):
- SOUL.md, MEMORY.md, BOOTSTRAP.md, IDENTITY.md, USER.md

You CAN delete:
- Files in memory/, downloads/, uploads/, temp/
- Custom files you've created

Use recursive=true to delete non-empty directories.`,

  parameters: Type.Object({
    path: Type.String({
      description: "Path to file or directory to delete",
    }),
    recursive: Type.Optional(
      Type.Boolean({
        description: "Delete directory recursively (default: false)",
      })
    ),
  }),
};

export const workspaceDeleteExecutor: ToolExecutor<WorkspaceDeleteParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { path, recursive = false } = params;

    // Validate the path
    const validated = validatePath(path, false);

    // Check if it's a protected file
    if (PROTECTED_WORKSPACE_FILES.includes(validated.filename)) {
      return {
        success: false,
        error:
          `Cannot delete protected file: ${validated.filename}. ` +
          `This file is essential for the agent's operation.`,
      };
    }

    if (validated.isDirectory) {
      const contents = readdirSync(validated.absolutePath);

      if (contents.length > 0 && !recursive) {
        return {
          success: false,
          error: `Directory is not empty. Use recursive=true to delete non-empty directories.`,
        };
      }

      if (recursive) {
        // Recursive delete
        rmSync(validated.absolutePath, { recursive: true, force: true });
      } else {
        rmdirSync(validated.absolutePath);
      }
    } else {
      unlinkSync(validated.absolutePath);
    }

    return {
      success: true,
      data: {
        path: validated.relativePath,
        type: validated.isDirectory ? "directory" : "file",
        message: `Successfully deleted ${validated.isDirectory ? "directory" : "file"}`,
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
