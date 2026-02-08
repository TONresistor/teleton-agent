import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { WORKSPACE_PATHS } from "../../../../workspace/index.js";

const MEMORY_DIR = WORKSPACE_PATHS.MEMORY_DIR;
const MEMORY_FILE = WORKSPACE_PATHS.MEMORY;

/**
 * Parameters for memory_read tool
 */
interface MemoryReadParams {
  target: "persistent" | "daily" | "recent" | "list";
  date?: string; // YYYY-MM-DD for specific daily log
}

/**
 * Tool definition for reading agent memory
 */
export const memoryReadTool: Tool = {
  name: "memory_read",
  description:
    "Read your memory files. Use 'persistent' for MEMORY.md, 'daily' for today's log, 'recent' for today+yesterday, or 'list' to see all available memory files.",
  parameters: Type.Object({
    target: Type.String({
      description:
        "'persistent' (MEMORY.md), 'daily' (today's log), 'recent' (today+yesterday), 'list' (show all files)",
      enum: ["persistent", "daily", "recent", "list"],
    }),
    date: Type.Optional(
      Type.String({
        description:
          "Specific date for daily log (YYYY-MM-DD format). Only used with target='daily'",
      })
    ),
  }),
};

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Executor for memory_read tool
 */
export const memoryReadExecutor: ToolExecutor<MemoryReadParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { target, date } = params;

    if (target === "list") {
      // List all memory files
      const files: string[] = [];

      if (existsSync(MEMORY_FILE)) {
        files.push("MEMORY.md (persistent)");
      }

      if (existsSync(MEMORY_DIR)) {
        const dailyLogs = readdirSync(MEMORY_DIR)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .reverse();
        files.push(...dailyLogs.map((f) => `memory/${f}`));
      }

      return {
        success: true,
        data: {
          files,
          count: files.length,
        },
      };
    }

    if (target === "persistent") {
      // Read MEMORY.md
      if (!existsSync(MEMORY_FILE)) {
        return {
          success: true,
          data: {
            content: null,
            message: "No persistent memory file exists yet. Use memory_write to create one.",
          },
        };
      }

      const content = readFileSync(MEMORY_FILE, "utf-8");
      return {
        success: true,
        data: {
          target: "persistent",
          file: "MEMORY.md",
          content,
          size: content.length,
        },
      };
    }

    if (target === "daily") {
      // Read specific daily log
      const targetDate = date || formatDate(new Date());
      const logPath = join(MEMORY_DIR, `${targetDate}.md`);

      if (!existsSync(logPath)) {
        return {
          success: true,
          data: {
            content: null,
            date: targetDate,
            message: `No daily log exists for ${targetDate}.`,
          },
        };
      }

      const content = readFileSync(logPath, "utf-8");
      return {
        success: true,
        data: {
          target: "daily",
          date: targetDate,
          file: `memory/${targetDate}.md`,
          content,
          size: content.length,
        },
      };
    }

    if (target === "recent") {
      // Read today + yesterday
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const todayStr = formatDate(today);
      const yesterdayStr = formatDate(yesterday);

      const result: Record<string, string | null> = {};

      // Yesterday
      const yesterdayPath = join(MEMORY_DIR, `${yesterdayStr}.md`);
      if (existsSync(yesterdayPath)) {
        result[yesterdayStr] = readFileSync(yesterdayPath, "utf-8");
      } else {
        result[yesterdayStr] = null;
      }

      // Today
      const todayPath = join(MEMORY_DIR, `${todayStr}.md`);
      if (existsSync(todayPath)) {
        result[todayStr] = readFileSync(todayPath, "utf-8");
      } else {
        result[todayStr] = null;
      }

      return {
        success: true,
        data: {
          target: "recent",
          logs: result,
        },
      };
    }

    return {
      success: false,
      error: `Unknown target: ${target}`,
    };
  } catch (error) {
    console.error("Error reading memory:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
