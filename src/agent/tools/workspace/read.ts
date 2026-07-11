// src/agent/tools/workspace/read.ts

import { Type } from "@sinclair/typebox";
import { readFileSync, lstatSync } from "fs";
import type { Tool, ToolExecutor } from "../types.js";
import { validateReadPath, TEXT_FILE_EXTENSIONS } from "../../../workspace/index.js";

interface WorkspaceReadParams {
  path: string;
  encoding?: "utf-8" | "base64";
  maxSize?: number;
}

export const workspaceReadTool: Tool = {
  name: "workspace_read",
  description:
    "Read the contents of a file in the agent's workspace. Supports text (utf-8) and binary (base64) encodings. Only ~/.teleton/workspace/ is accessible — not system files. To list available files, use workspace_list first.",
  category: "data-bearing",
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

export const workspaceReadExecutor: ToolExecutor<WorkspaceReadParams> = async (params) => {
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
  const isTextFile = TEXT_FILE_EXTENSIONS.includes(validated.extension);

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
  const content = readFileSync(validated.absolutePath, encoding === "base64" ? "base64" : "utf-8");

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
};
