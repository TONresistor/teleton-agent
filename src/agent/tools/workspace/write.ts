// src/agent/tools/workspace/write.ts

import { Type } from "@sinclair/typebox";
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { validateWritePath, WorkspaceSecurityError } from "../../../workspace/index.js";

interface WorkspaceWriteParams {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
  append?: boolean;
  createDirs?: boolean;
}

export const workspaceWriteTool: Tool = {
  name: "workspace_write",
  description: `Write a file to your workspace.

You can ONLY write files within ~/.teleton/workspace/. This includes:
- memory/ - Daily logs and notes
- uploads/ - Files to send
- temp/ - Temporary files

You CANNOT write to protected locations like config.yaml, wallet.json, etc.

Examples:
- Save a note: path="memory/note.md", content="..."
- Prepare upload: path="uploads/message.txt", content="..."`,

  parameters: Type.Object({
    path: Type.String({
      description: "Path to file (relative to workspace root)",
    }),
    content: Type.String({
      description: "Content to write",
    }),
    encoding: Type.Optional(
      Type.String({
        description: "Content encoding: 'utf-8' (default) or 'base64'",
        enum: ["utf-8", "base64"],
      })
    ),
    append: Type.Optional(
      Type.Boolean({
        description: "Append to file instead of overwriting (default: false)",
      })
    ),
    createDirs: Type.Optional(
      Type.Boolean({
        description: "Create parent directories if they don't exist (default: true)",
      })
    ),
  }),
};

export const workspaceWriteExecutor: ToolExecutor<WorkspaceWriteParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { path, content, encoding = "utf-8", append = false, createDirs = true } = params;

    // Validate the path (no extension enforcement - fix from audit)
    const validated = validateWritePath(path);

    // Create parent directories if needed
    const parentDir = dirname(validated.absolutePath);
    if (createDirs && !existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Prepare content
    let writeContent: string | Buffer;
    if (encoding === "base64") {
      writeContent = Buffer.from(content, "base64");
    } else {
      writeContent = content;
    }

    // SECURITY: Enforce file size limits to prevent DoS attacks
    const contentSize = Buffer.byteLength(writeContent);
    const MAX_WRITE_SIZE = 50 * 1024 * 1024; // 50 MB max per file
    if (contentSize > MAX_WRITE_SIZE) {
      return {
        success: false,
        error: `File too large: ${contentSize} bytes exceeds maximum write size of ${MAX_WRITE_SIZE} bytes (50 MB)`,
      };
    }

    // Write or append
    if (append && validated.exists) {
      appendFileSync(validated.absolutePath, writeContent);
    } else {
      writeFileSync(validated.absolutePath, writeContent);
    }

    return {
      success: true,
      data: {
        path: validated.relativePath,
        absolutePath: validated.absolutePath,
        size: Buffer.byteLength(writeContent),
        append,
        message: `File ${append ? "appended" : "written"} successfully`,
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
