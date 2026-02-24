import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { WORKSPACE_PATHS } from "../../../../workspace/index.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

const MEMORY_DIR = WORKSPACE_PATHS.MEMORY_DIR;
const MEMORY_FILE = WORKSPACE_PATHS.MEMORY;

/** Soft warning threshold for MEMORY.md line count */
const MEMORY_SOFT_LIMIT = 80;

/**
 * Count lines in MEMORY.md (returns 0 if file doesn't exist)
 */
function getMemoryLineCount(): number {
  if (!existsSync(MEMORY_FILE)) return 0;
  return readFileSync(MEMORY_FILE, "utf-8").split("\n").length;
}

/**
 * Parameters for memory_write tool
 */
interface MemoryWriteParams {
  content: string;
  target: "persistent" | "daily";
  section?: string;
}

/**
 * Tool definition for writing to agent memory
 */
export const memoryWriteTool: Tool = {
  name: "memory_write",
  description:
    "Save to agent memory. Use 'persistent' for long-term facts, preferences, contacts, rules → MEMORY.md. Use 'daily' for session notes, events, temporary context → today's log. Disabled in group chats.",
  parameters: Type.Object({
    content: Type.String({
      description: "The content to write to memory. Be concise but complete.",
    }),
    target: Type.String({
      description:
        "'persistent' for MEMORY.md (long-term facts), 'daily' for today's log (notes, events)",
      enum: ["persistent", "daily"],
    }),
    section: Type.Optional(
      Type.String({
        description:
          "Optional section header to organize the content (e.g., 'Lessons Learned', 'Contacts', 'Trades')",
      })
    ),
  }),
};

/**
 * Ensure memory directory exists
 */
function ensureMemoryDir(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

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
 * Get today's daily log path
 */
function getDailyLogPath(): string {
  return join(MEMORY_DIR, `${formatDate(new Date())}.md`);
}

/**
 * Executor for memory_write tool
 */
export const memoryWriteExecutor: ToolExecutor<MemoryWriteParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { content, target, section } = params;

    // SECURITY: Block memory writes in group chats to prevent memory poisoning
    if (context.isGroup) {
      return {
        success: false,
        error: "Memory writes are disabled in group chats for security reasons.",
      };
    }

    // SECURITY: Content length limit to prevent memory flooding
    if (content.length > 2000) {
      return {
        success: false,
        error: "Memory entry too long. Maximum 2000 characters.",
      };
    }

    ensureMemoryDir();

    const now = new Date();
    const timestamp = now.toLocaleTimeString("en-US", { hour12: false });

    if (target === "persistent") {
      // Write to MEMORY.md
      let entry = "\n";
      if (section) {
        entry += `### ${section}\n\n`;
      }
      entry += `${content}\n`;
      entry += `\n_Added: ${now.toISOString()}_\n`;

      // Append to MEMORY.md
      if (!existsSync(MEMORY_FILE)) {
        writeFileSync(MEMORY_FILE, "# MEMORY.md - Persistent Memory\n\n", "utf-8");
      }
      appendFileSync(MEMORY_FILE, entry, "utf-8");

      log.info(`📝 Memory written to MEMORY.md${section ? ` (section: ${section})` : ""}`);

      // Check memory size and warn if approaching limit
      const lineCount = getMemoryLineCount();
      const sizeWarning =
        lineCount > MEMORY_SOFT_LIMIT
          ? ` ⚠️ MEMORY.md is now ${lineCount} lines (recommended max: ~100). Consider consolidating old entries, removing outdated info, or archiving less relevant content to keep your memory efficient and fast to load.`
          : undefined;

      return {
        success: true,
        data: {
          target: "persistent",
          file: MEMORY_FILE,
          section: section || null,
          timestamp: now.toISOString(),
          lineCount,
          ...(sizeWarning && { warning: sizeWarning }),
        },
      };
    } else {
      // Write to daily log
      const logPath = getDailyLogPath();

      // Create header if file doesn't exist
      if (!existsSync(logPath)) {
        const header = `# Daily Log - ${formatDate(now)}\n\n`;
        writeFileSync(logPath, header, "utf-8");
      }

      let entry = `## ${timestamp}`;
      if (section) {
        entry += ` - ${section}`;
      }
      entry += `\n\n${content}\n\n---\n\n`;

      appendFileSync(logPath, entry, "utf-8");

      log.info(`📅 Memory written to daily log${section ? ` (${section})` : ""}`);

      return {
        success: true,
        data: {
          target: "daily",
          file: logPath,
          section: section || null,
          timestamp: now.toISOString(),
        },
      };
    }
  } catch (error) {
    log.error({ err: error }, "Error writing to memory");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
