// src/agent/tools/workspace/delete.ts

import { Type } from "@sinclair/typebox";
import { unlinkSync, rmdirSync, readdirSync, rmSync } from "fs";
import type { Tool, ToolExecutor } from "../types.js";
import {
  assertDeletablePath,
  validatePath,
  WorkspaceSecurityError,
} from "../../../workspace/index.js";

interface WorkspaceDeleteParams {
  path: string;
  recursive?: boolean;
}

export const workspaceDeleteTool: Tool = {
  name: "workspace_delete",
  description:
    "Delete a file or directory from the workspace. Use recursive=true for non-empty directories. Cannot delete core agent files (SOUL.md, MEMORY.md, etc.). Permanent — no undo.",

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

export const workspaceDeleteExecutor: ToolExecutor<WorkspaceDeleteParams> = async (params) => {
  const { path, recursive = false } = params;

  // Validate the path
  const validated = validatePath(path, false);

  // Check the entire target before removing any part of a directory tree.
  try {
    assertDeletablePath(validated, path, recursive);
  } catch (error) {
    if (error instanceof WorkspaceSecurityError) {
      return { success: false, error: error.message };
    }
    throw error;
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
};
