import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";
import { WORKSPACE_PATHS } from "../workspace/index.js";

const MEMORY_DIR = WORKSPACE_PATHS.MEMORY_DIR;

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
 * Get path for daily log file
 */
export function getDailyLogPath(date: Date = new Date()): string {
  return join(MEMORY_DIR, `${formatDate(date)}.md`);
}

/**
 * Ensure memory directory exists
 */
function ensureMemoryDir(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

/**
 * Append entry to daily log
 */
export function appendToDailyLog(content: string, date: Date = new Date()): void {
  ensureMemoryDir();

  const logPath = getDailyLogPath(date);
  const timestamp = date.toLocaleTimeString("en-US", { hour12: false });

  // Create header if file doesn't exist
  if (!existsSync(logPath)) {
    const header = `# Daily Log - ${formatDate(date)}\n\n`;
    appendFileSync(logPath, header, "utf-8");
  }

  // Append timestamped entry
  const entry = `## ${timestamp}\n\n${content}\n\n---\n\n`;
  appendFileSync(logPath, entry, "utf-8");

  console.log(`📅 Daily log updated: ${logPath}`);
}

/**
 * Read daily log content
 */
export function readDailyLog(date: Date = new Date()): string | null {
  const logPath = getDailyLogPath(date);

  if (!existsSync(logPath)) {
    return null;
  }

  return readFileSync(logPath, "utf-8");
}

/**
 * Read recent daily logs (today + yesterday) for memory context
 * OpenClaw-style: provides continuity across session resets
 */
export function readRecentMemory(): string | null {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const parts: string[] = [];

  // Read yesterday's log (if exists)
  const yesterdayLog = readDailyLog(yesterday);
  if (yesterdayLog) {
    parts.push(`## Yesterday (${formatDate(yesterday)})\n\n${yesterdayLog}`);
  }

  // Read today's log (if exists)
  const todayLog = readDailyLog(today);
  if (todayLog) {
    parts.push(`## Today (${formatDate(today)})\n\n${todayLog}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return `# Recent Memory\n\n${parts.join("\n\n---\n\n")}`;
}

/**
 * Write session end summary before daily reset
 */
export function writeSessionEndSummary(summary: string, reason: string): void {
  const content = `### Session End (${reason})\n\n${summary}`;
  appendToDailyLog(content);
}

/**
 * Write summary to daily log (used before compaction)
 */
export function writeSummaryToDailyLog(summary: string): void {
  appendToDailyLog(`### Memory Flush (Pre-Compaction)\n\n${summary}`);
}

/**
 * Write conversation milestone to daily log
 */
export function writeConversationMilestone(chatId: string, topic: string, details: string): void {
  const content = `### Conversation Milestone\n\n**Chat**: ${chatId}\n**Topic**: ${topic}\n\n${details}`;
  appendToDailyLog(content);
}
