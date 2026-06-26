// src/agent/tools/workspace/rename.ts

import { Type } from "@sinclair/typebox";
import { renameSync, existsSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";
import type { Tool, ToolExecutor } from "../types.js";
import { validatePath } from "../../../workspace/index.js";

interface WorkspaceRenameParams {
  from: string;
  to: string;
  overwrite?: boolean;
}

export const workspaceRenameTool: Tool = {
  name: "workspace_rename",
  description:
    "Rename or relocate a file within the workspace (files only, not directories). Creates missing parent directories automatically. Use workspace_delete to remove files.",

  parameters: Type.Object({
    from: Type.String({
      description: "Current path of the file (relative to workspace)",
    }),
    to: Type.String({
      description: "New path for the file (relative to workspace)",
    }),
    overwrite: Type.Optional(
      Type.Boolean({
        description: "Overwrite if destination exists (default: false)",
      })
    ),
  }),
};

export const workspaceRenameExecutor: ToolExecutor<WorkspaceRenameParams> = async (params) => {
  const { from, to, overwrite = false } = params;

  // Validate source path (must exist)
  const validatedFrom = validatePath(from, false);

  if (validatedFrom.isDirectory) {
    return {
      success: false,
      error: "Cannot rename directories. Use this tool for files only.",
    };
  }

  // Validate destination path (may not exist yet)
  const validatedTo = validatePath(to, true);

  // Check if destination already exists
  if (validatedTo.exists && !overwrite) {
    return {
      success: false,
      error: `Destination already exists: '${to}'. Use overwrite=true to replace.`,
    };
  }

  // Create parent directory if needed
  const parentDir = dirname(validatedTo.absolutePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Perform the rename/move
  renameSync(validatedFrom.absolutePath, validatedTo.absolutePath);

  return {
    success: true,
    data: {
      from: validatedFrom.relativePath,
      to: validatedTo.relativePath,
      message: `File renamed successfully`,
    },
  };
};
