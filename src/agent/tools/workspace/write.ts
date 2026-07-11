// src/agent/tools/workspace/write.ts

import { Type } from "@sinclair/typebox";
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { MAX_WRITE_SIZE } from "../../../constants/limits.js";
import type { Tool, ToolExecutor } from "../types.js";
import { validateWritePath, MEMORY_SCAN_FILES } from "../../../workspace/index.js";
import { scanMemoryContent } from "../../../utils/memory-guard.js";

interface WorkspaceWriteParams {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
  append?: boolean;
  createDirs?: boolean;
}

export const workspaceWriteTool: Tool = {
  name: "workspace_write",
  description:
    "Create or overwrite a file in the agent's workspace. Supports append mode and base64 for binary. Protected files (SOUL.md, MEMORY.md, etc.) cannot be overwritten. To persist memory, use memory_write instead.",

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

export const workspaceWriteExecutor: ToolExecutor<WorkspaceWriteParams> = async (params) => {
  const { path, content, encoding = "utf-8", append = false, createDirs = true } = params;

  // Validate the path (no extension enforcement - fix from audit)
  const validated = validateWritePath(path);

  // Create parent directories if needed
  const parentDir = dirname(validated.absolutePath);
  if (createDirs && !existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // SECURITY: Scan memory-sensitive files (and anything under memory/) for injection
  const isMemoryFile =
    MEMORY_SCAN_FILES.includes(validated.relativePath) ||
    validated.relativePath.startsWith("memory/");
  if (isMemoryFile && encoding !== "base64") {
    const scan = scanMemoryContent(content);
    if (!scan.safe) {
      return {
        success: false,
        error: `Write blocked: suspicious content detected in ${validated.relativePath} (${scan.threats.join(", ")}).`,
      };
    }
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
  if (contentSize > MAX_WRITE_SIZE) {
    return {
      success: false,
      error: `File too large: ${contentSize} bytes exceeds maximum write size of ${MAX_WRITE_SIZE} bytes (50 MB)`,
    };
  }

  // Write or append
  if (append && validated.exists) {
    appendFileSync(validated.absolutePath, writeContent, { mode: 0o600 });
  } else {
    writeFileSync(validated.absolutePath, writeContent, { mode: 0o600 });
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
};
