import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  renameSync,
  readdirSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import type { Message, AssistantMessage } from "@mariozechner/pi-ai";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Session");

const SESSIONS_DIR = join(TELETON_ROOT, "sessions");

export function getTranscriptPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  }
}

export function appendToTranscript(sessionId: string, message: Message | AssistantMessage): void {
  ensureSessionsDir();

  const transcriptPath = getTranscriptPath(sessionId);
  const line = JSON.stringify(message) + "\n";

  try {
    appendFileSync(transcriptPath, line, { encoding: "utf-8", mode: 0o600 });
  } catch (error) {
    log.error({ err: error }, `Failed to append to transcript ${sessionId}`);
  }
}

function extractToolCallIds(msg: Message | AssistantMessage): Set<string> {
  const ids = new Set<string>();
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "toolCall") {
        if (block.id) ids.add(block.id);
      }
    }
  }
  return ids;
}

/**
 * Sanitize messages to remove orphaned or out-of-order toolResults.
 * Anthropic API requires tool_results IMMEDIATELY follow their corresponding tool_use.
 * Removes: 1) tool_results referencing non-existent tool_uses, 2) out-of-order tool_results.
 */
function sanitizeMessages(
  messages: (Message | AssistantMessage)[]
): (Message | AssistantMessage)[] {
  const sanitized: (Message | AssistantMessage)[] = [];
  let pendingToolCallIds = new Set<string>(); // IDs waiting for their results
  let removedCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "assistant") {
      const newToolIds = extractToolCallIds(msg);

      if (pendingToolCallIds.size > 0 && newToolIds.size > 0) {
        log.warn(`Found ${pendingToolCallIds.size} pending tool results that were never received`);
      }

      pendingToolCallIds = newToolIds;
      sanitized.push(msg);
    } else if (msg.role === "toolResult") {
      const toolCallId = msg.toolCallId;

      if (!toolCallId || typeof toolCallId !== "string") {
        removedCount++;
        log.warn(`Removing toolResult with missing/invalid toolCallId`);
        continue;
      }

      if (pendingToolCallIds.has(toolCallId)) {
        pendingToolCallIds.delete(toolCallId);
        sanitized.push(msg);
      } else {
        removedCount++;
        log.warn(`Removing orphaned toolResult: ${toolCallId.slice(0, 20)}...`);
        continue;
      }
    } else if (msg.role === "user") {
      if (pendingToolCallIds.size > 0) {
        log.warn(
          `User message arrived while ${pendingToolCallIds.size} tool results pending - marking them as orphaned`
        );
        pendingToolCallIds.clear();
      }
      sanitized.push(msg);
    } else {
      sanitized.push(msg);
    }
  }

  if (removedCount > 0) {
    log.info(`Sanitized ${removedCount} orphaned/out-of-order toolResult(s) from transcript`);
  }

  return sanitized;
}

export function readTranscript(sessionId: string): (Message | AssistantMessage)[] {
  const transcriptPath = getTranscriptPath(sessionId);

  if (!existsSync(transcriptPath)) {
    return [];
  }

  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    let corruptCount = 0;
    const messages = lines
      .map((line, i) => {
        try {
          return JSON.parse(line);
        } catch {
          corruptCount++;
          log.warn(`Skipping corrupt line ${i + 1} in transcript ${sessionId}`);
          return null;
        }
      })
      .filter(Boolean);

    if (corruptCount > 0) {
      log.warn(`${corruptCount} corrupt line(s) skipped in transcript ${sessionId}`);
    }

    return sanitizeMessages(messages);
  } catch (error) {
    log.error({ err: error }, `Failed to read transcript ${sessionId}`);
    return [];
  }
}

export function transcriptExists(sessionId: string): boolean {
  return existsSync(getTranscriptPath(sessionId));
}

export function getTranscriptSize(sessionId: string): number {
  try {
    const messages = readTranscript(sessionId);
    return messages.length;
  } catch {
    return 0;
  }
}

export function deleteTranscript(sessionId: string): boolean {
  const transcriptPath = getTranscriptPath(sessionId);

  if (!existsSync(transcriptPath)) {
    return false;
  }

  try {
    unlinkSync(transcriptPath);
    log.info(`Deleted transcript: ${sessionId}`);
    return true;
  } catch (error) {
    log.error({ err: error }, `Failed to delete transcript ${sessionId}`);
    return false;
  }
}

/**
 * Archive a transcript (rename with timestamped .archived suffix).
 */
export function archiveTranscript(sessionId: string): boolean {
  const transcriptPath = getTranscriptPath(sessionId);
  const timestamp = Date.now();
  const archivePath = `${transcriptPath}.${timestamp}.archived`;

  if (!existsSync(transcriptPath)) {
    return false;
  }

  try {
    renameSync(transcriptPath, archivePath);
    log.info(`Archived transcript: ${sessionId} → ${timestamp}.archived`);
    return true;
  } catch (error) {
    log.error({ err: error }, `Failed to archive transcript ${sessionId}`);
    return false;
  }
}

/**
 * Delete transcript and archived files older than maxAgeDays.
 */
export function cleanupOldTranscripts(maxAgeDays: number = 30): number {
  if (!existsSync(SESSIONS_DIR)) return 0;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  try {
    for (const file of readdirSync(SESSIONS_DIR)) {
      if (!file.endsWith(".jsonl") && !file.endsWith(".archived")) continue;
      const filePath = join(SESSIONS_DIR, file);
      try {
        const mtime = statSync(filePath).mtimeMs;
        if (mtime < cutoff) {
          unlinkSync(filePath);
          deleted++;
        }
      } catch {}
    }
  } catch (error) {
    log.error({ err: error }, "Failed to cleanup old transcripts");
  }

  if (deleted > 0) {
    log.info(`Cleaned up ${deleted} transcript(s) older than ${maxAgeDays} days`);
  }

  return deleted;
}
