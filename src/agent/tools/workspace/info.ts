// src/agent/tools/workspace/info.ts

import { Type } from "@sinclair/typebox";
import { lstatSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { WORKSPACE_ROOT, WORKSPACE_PATHS, MAX_FILE_SIZES } from "../../../workspace/index.js";

const MEMES_DIR = WORKSPACE_PATHS.MEMES_DIR;

interface WorkspaceInfoParams {
  detailed?: boolean;
}

export const workspaceInfoTool: Tool = {
  name: "workspace_info",
  description: `Get information about your workspace structure and usage.

Returns:
- Workspace root path
- Directory structure
- File counts and sizes
- Usage limits`,

  parameters: Type.Object({
    detailed: Type.Optional(
      Type.Boolean({
        description: "Include detailed file listing (default: false)",
      })
    ),
  }),
};

function getDirSize(dirPath: string): { count: number; size: number } {
  let count = 0;
  let size = 0;

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const subStats = getDirSize(fullPath);
        count += subStats.count;
        size += subStats.size;
      } else {
        count++;
        try {
          size += lstatSync(fullPath).size;
        } catch {}
      }
    }
  } catch {}

  return { count, size };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export const workspaceInfoExecutor: ToolExecutor<WorkspaceInfoParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { detailed = false } = params;

    // Get directory stats
    const memoryStats = existsSync(WORKSPACE_PATHS.MEMORY_DIR)
      ? getDirSize(WORKSPACE_PATHS.MEMORY_DIR)
      : { count: 0, size: 0 };
    const downloadsStats = existsSync(WORKSPACE_PATHS.DOWNLOADS_DIR)
      ? getDirSize(WORKSPACE_PATHS.DOWNLOADS_DIR)
      : { count: 0, size: 0 };
    const uploadsStats = existsSync(WORKSPACE_PATHS.UPLOADS_DIR)
      ? getDirSize(WORKSPACE_PATHS.UPLOADS_DIR)
      : { count: 0, size: 0 };
    const tempStats = existsSync(WORKSPACE_PATHS.TEMP_DIR)
      ? getDirSize(WORKSPACE_PATHS.TEMP_DIR)
      : { count: 0, size: 0 };
    const memesStats = existsSync(MEMES_DIR) ? getDirSize(MEMES_DIR) : { count: 0, size: 0 };

    const totalSize =
      memoryStats.size + downloadsStats.size + uploadsStats.size + tempStats.size + memesStats.size;

    const info: any = {
      workspaceRoot: WORKSPACE_ROOT,
      structure: {
        "SOUL.md": "Your personality and behavior guidelines",
        "MEMORY.md": "Persistent memory (long-term facts)",
        "BOOTSTRAP.md": "Startup instructions",
        "IDENTITY.md": "Your identity information",
        "USER.md": "User configuration",
        "STRATEGY.md": "Business strategy (if exists)",
        "memory/": `Daily logs (${memoryStats.count} files, ${formatBytes(memoryStats.size)})`,
        "downloads/": `Downloaded media (${downloadsStats.count} files, ${formatBytes(downloadsStats.size)})`,
        "uploads/": `Files to send (${uploadsStats.count} files, ${formatBytes(uploadsStats.size)})`,
        "temp/": `Temporary files (${tempStats.count} files, ${formatBytes(tempStats.size)})`,
        "memes/": `Meme collection (${memesStats.count} files, ${formatBytes(memesStats.size)})`,
      },
      usage: {
        totalFiles:
          memoryStats.count +
          downloadsStats.count +
          uploadsStats.count +
          tempStats.count +
          memesStats.count,
        totalSize: formatBytes(totalSize),
        totalSizeBytes: totalSize,
        limit: formatBytes(MAX_FILE_SIZES.total_workspace),
        limitBytes: MAX_FILE_SIZES.total_workspace,
        usagePercent: ((totalSize / MAX_FILE_SIZES.total_workspace) * 100).toFixed(1) + "%",
      },
      security: {
        note: "You can ONLY access files within this workspace.",
        protectedFiles: [
          "~/.teleton/config.yaml (API keys)",
          "~/.teleton/wallet.json (TON mnemonic)",
          "~/.teleton/telegram_session.txt (session)",
          "~/.teleton/memory.db (database)",
        ],
      },
    };

    if (detailed) {
      // Add file listings
      info.files = {
        memory: existsSync(WORKSPACE_PATHS.MEMORY_DIR)
          ? readdirSync(WORKSPACE_PATHS.MEMORY_DIR)
          : [],
        downloads: existsSync(WORKSPACE_PATHS.DOWNLOADS_DIR)
          ? readdirSync(WORKSPACE_PATHS.DOWNLOADS_DIR)
          : [],
        uploads: existsSync(WORKSPACE_PATHS.UPLOADS_DIR)
          ? readdirSync(WORKSPACE_PATHS.UPLOADS_DIR)
          : [],
        temp: existsSync(WORKSPACE_PATHS.TEMP_DIR) ? readdirSync(WORKSPACE_PATHS.TEMP_DIR) : [],
        memes: existsSync(MEMES_DIR) ? readdirSync(MEMES_DIR) : [],
      };
    }

    return {
      success: true,
      data: info,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
