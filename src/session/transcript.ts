import {
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  renameSync,
  readdirSync,
  statSync,
} from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { Message, AssistantMessage } from "@earendil-works/pi-ai";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Session");

const SESSIONS_DIR = join(TELETON_ROOT, "sessions");

// ── In-memory transcript cache ──────────────────────────────────
// Avoids re-reading + re-parsing JSONL from disk on every message.
// Invalidated on delete/archive; updated on append.
const transcriptCache = new Map<string, (Message | AssistantMessage)[]>();
const transcriptWriteQueues = new Map<string, Promise<void>>();
const transcriptWriteErrors = new Map<string, unknown>();

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

  const previous = transcriptWriteQueues.get(sessionId) ?? Promise.resolve();
  const queuedWrite = previous
    .then(() => appendFile(transcriptPath, line, { encoding: "utf-8", mode: 0o600 }))
    .catch((error) => {
      transcriptWriteErrors.set(sessionId, error);
      log.error({ err: error }, `Failed to append to transcript ${sessionId}`);
    });
  transcriptWriteQueues.set(sessionId, queuedWrite);
  void queuedWrite.finally(() => {
    if (transcriptWriteQueues.get(sessionId) === queuedWrite) {
      transcriptWriteQueues.delete(sessionId);
    }
  });

  // Update in-memory cache immediately (callers read from cache, not disk)
  const cached = transcriptCache.get(sessionId) ?? readTranscript(sessionId);
  transcriptCache.set(sessionId, cached);
  cached.push(message);
}

export async function flushTranscript(sessionId: string): Promise<void> {
  await transcriptWriteQueues.get(sessionId);
  const error = transcriptWriteErrors.get(sessionId);
  if (error !== undefined) {
    transcriptWriteErrors.delete(sessionId);
    throw error;
  }
}

export async function flushAllTranscripts(): Promise<void> {
  const sessionIds = new Set([...transcriptWriteQueues.keys(), ...transcriptWriteErrors.keys()]);
  const results = await Promise.allSettled(
    [...sessionIds].map((sessionId) => flushTranscript(sessionId))
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => (failure as PromiseRejectedResult).reason),
      `Failed to flush ${failures.length} transcript(s)`
    );
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
export function sanitizeTranscriptMessages(
  messages: (Message | AssistantMessage)[]
): (Message | AssistantMessage)[] {
  const sanitized: (Message | AssistantMessage)[] = [];
  let pendingBatch:
    | { messages: (Message | AssistantMessage)[]; toolCallIds: Set<string> }
    | undefined;
  let removedCount = 0;

  const discardPendingBatch = (): void => {
    if (!pendingBatch) return;
    removedCount += pendingBatch.messages.length;
    log.warn(
      `Removing incomplete tool-call batch with ${pendingBatch.toolCallIds.size} missing result(s)`
    );
    pendingBatch = undefined;
  };

  for (const msg of messages) {
    if (pendingBatch) {
      if (
        msg.role === "toolResult" &&
        typeof msg.toolCallId === "string" &&
        pendingBatch.toolCallIds.has(msg.toolCallId)
      ) {
        pendingBatch.messages.push(msg);
        pendingBatch.toolCallIds.delete(msg.toolCallId);
        if (pendingBatch.toolCallIds.size === 0) {
          sanitized.push(...pendingBatch.messages);
          pendingBatch = undefined;
        }
        continue;
      }
      discardPendingBatch();
    }

    if (msg.role === "assistant") {
      const toolCallIds = extractToolCallIds(msg);
      if (toolCallIds.size > 0) {
        pendingBatch = { messages: [msg], toolCallIds };
      } else {
        sanitized.push(msg);
      }
      continue;
    }

    if (msg.role === "toolResult") {
      removedCount++;
      const id = typeof msg.toolCallId === "string" ? msg.toolCallId : "invalid";
      log.warn(`Removing orphaned toolResult: ${id.slice(0, 20)}...`);
      continue;
    }

    sanitized.push(msg);
  }

  discardPendingBatch();

  if (removedCount > 0) {
    log.info(`Sanitized ${removedCount} orphaned/out-of-order toolResult(s) from transcript`);
  }

  return sanitized;
}

export function readTranscript(sessionId: string): (Message | AssistantMessage)[] {
  // Return shallow copy of cached array (callers may mutate via push)
  const cached = transcriptCache.get(sessionId);
  if (cached) return [...cached];

  const transcriptPath = getTranscriptPath(sessionId);

  if (!existsSync(transcriptPath)) {
    transcriptCache.set(sessionId, []);
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

    const sanitized = sanitizeTranscriptMessages(messages);
    transcriptCache.set(sessionId, sanitized);
    return sanitized;
  } catch (error) {
    log.error({ err: error }, `Failed to read transcript ${sessionId}`);
    return [];
  }
}

export function transcriptExists(sessionId: string): boolean {
  return (
    (transcriptCache.get(sessionId)?.length ?? 0) > 0 ||
    transcriptWriteQueues.has(sessionId) ||
    existsSync(getTranscriptPath(sessionId))
  );
}

/**
 * Archive a transcript (rename with timestamped .archived suffix).
 */
export async function archiveTranscript(sessionId: string): Promise<boolean> {
  const transcriptPath = getTranscriptPath(sessionId);
  const timestamp = Date.now();
  const archivePath = `${transcriptPath}.${timestamp}.archived`;

  try {
    await flushTranscript(sessionId);
    if (!existsSync(transcriptPath)) return false;
    renameSync(transcriptPath, archivePath);
    transcriptCache.delete(sessionId);
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
