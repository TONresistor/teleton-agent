// src/agent/tools/workspace/rename.ts

import { Type } from "@sinclair/typebox";
import { renameSync, existsSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { validatePath, WorkspaceSecurityError } from "../../../workspace/index.js";

interface WorkspaceRenameParams {
  from: string;
  to: string;
  overwrite?: boolean;
}

export const workspaceRenameTool: Tool = {
  name: "workspace_rename",
  description: `Rename or move a file within your workspace.

Use this to:
- Give meaningful names to downloaded files
- Organize files into subdirectories
- Rename Telegram downloads (default names like "123_456_789.jpg" are hard to track)

Examples:
- Rename: from="downloads/123_456_789.jpg", to="downloads/alice_profile.jpg"
- Move: from="downloads/photo.jpg", to="uploads/photo.jpg"
- Organize: from="downloads/doc.pdf", to="downloads/contracts/2026/lease.pdf"

CANNOT move/rename files outside workspace or to protected locations.`,

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

export const workspaceRenameExecutor: ToolExecutor<WorkspaceRenameParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
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
