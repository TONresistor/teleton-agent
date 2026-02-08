// src/agent/tools/workspace/read.ts

import { Type } from "@sinclair/typebox";
import { readFileSync, lstatSync } from "fs";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../workspace/index.js";

interface WorkspaceReadParams {
  path: string;
  encoding?: "utf-8" | "base64";
  maxSize?: number;
}

export const workspaceReadTool: Tool = {
  name: "workspace_read",
  description: `Read a file from your workspace.

You can ONLY read files within ~/.teleton/workspace/. Protected files like config.yaml, wallet.json, and telegram_session.txt are NOT accessible.

Supported files:
- Text files (.md, .txt, .json, .csv)
- Use encoding="base64" for binary files

Examples:
- Read your memory: path="MEMORY.md"
- Read today's log: path="memory/2024-01-15.md"
- Read downloaded image info: path="downloads/image.jpg" (will return metadata only)`,

  parameters: Type.Object({
    path: Type.String({
      description: "Path to file (relative to workspace root)",
    }),
    encoding: Type.Optional(
      Type.String({
        description: "File encoding: 'utf-8' (default) or 'base64'",
        enum: ["utf-8", "base64"],
      })
    ),
    maxSize: Type.Optional(
      Type.Number({
        description: "Max file size to read in bytes (default: 1MB)",
      })
    ),
  }),
};

export const workspaceReadExecutor: ToolExecutor<WorkspaceReadParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { path, encoding = "utf-8", maxSize = 1024 * 1024 } = params;

    // Validate the path
    const validated = validateReadPath(path);

    // Check file size
    const stats = lstatSync(validated.absolutePath);

    if (stats.size > maxSize) {
      return {
        success: false,
        error: `File too large: ${stats.size} bytes exceeds limit of ${maxSize} bytes`,
      };
    }

    // Check if it's a text file or binary
    const textExtensions = [
      ".md",
      ".txt",
      ".json",
      ".csv",
      ".yaml",
      ".yml",
      ".xml",
      ".html",
      ".css",
      ".js",
      ".ts",
      ".py",
      ".sh",
    ];
    const isTextFile = textExtensions.includes(validated.extension);

    if (!isTextFile && encoding === "utf-8") {
      // Return metadata only for binary files
      return {
        success: true,
        data: {
          path: validated.relativePath,
          type: "binary",
          extension: validated.extension,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          message:
            "Binary file - use encoding='base64' to read content, or this is media that can be sent directly",
        },
      };
    }

    // Read the file
    const content = readFileSync(
      validated.absolutePath,
      encoding === "base64" ? "base64" : "utf-8"
    );

    return {
      success: true,
      data: {
        path: validated.relativePath,
        content,
        encoding,
        size: stats.size,
        modified: stats.mtime.toISOString(),
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
