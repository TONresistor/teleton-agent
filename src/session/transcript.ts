import { appendFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from "fs";
import { join, dirname } from "path";
import type { Message, AssistantMessage } from "@mariozechner/pi-ai";
import { TELETON_ROOT } from "../workspace/paths.js";

const SESSIONS_DIR = join(TELETON_ROOT, "sessions");

/**
 * Get transcript file path for a session
 */
export function getTranscriptPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

/**
 * Ensure sessions directory exists
 */
function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * Append a message to the transcript
 */
export function appendToTranscript(sessionId: string, message: Message | AssistantMessage): void {
  ensureSessionsDir();

  const transcriptPath = getTranscriptPath(sessionId);
  const line = JSON.stringify(message) + "\n";

  try {
    appendFileSync(transcriptPath, line, "utf-8");
  } catch (error) {
    console.error(`Failed to append to transcript ${sessionId}:`, error);
  }
}

/**
 * Extract tool call IDs from an assistant message
 */
function extractToolCallIds(msg: Message | AssistantMessage): Set<string> {
  const ids = new Set<string>();
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      const blockType = (block as any).type;
      if (blockType === "toolCall" || blockType === "tool_use") {
        const id = (block as any).id || (block as any).toolCallId || (block as any).tool_use_id;
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * Sanitize messages to remove orphaned or out-of-order toolResults
 *
 * The Anthropic API requires that tool_results IMMEDIATELY follow their
 * corresponding tool_use in the assistant message. This function:
 * 1. Removes tool_results that reference non-existent tool_uses
 * 2. Removes tool_results that are out of order (separated by user messages)
 *
 * Valid structure: [assistant tool_use A,B] → [tool_result A] → [tool_result B] → [next msg]
 * Invalid: [assistant tool_use A,B] → [user] → [tool_result A] (out of order!)
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
      // New assistant message - extract any tool call IDs
      const newToolIds = extractToolCallIds(msg);

      // If we still have pending tool calls from a PREVIOUS assistant message,
      // and this assistant has NO tool calls, that's okay (final response)
      // But if there are still pending IDs when we get a new tool-calling assistant,
      // the old ones are orphaned
      if (pendingToolCallIds.size > 0 && newToolIds.size > 0) {
        console.warn(
          `⚠️ Found ${pendingToolCallIds.size} pending tool results that were never received`
        );
      }

      // Start tracking new tool calls
      pendingToolCallIds = newToolIds;
      sanitized.push(msg);
    } else if (msg.role === "toolResult" || (msg as any).role === "tool_result") {
      // Tool result - check if it matches a pending tool call
      const toolCallId =
        (msg as any).toolCallId || (msg as any).tool_use_id || (msg as any).tool_call_id;

      if (toolCallId && pendingToolCallIds.has(toolCallId)) {
        // Valid tool result - matches a pending call
        pendingToolCallIds.delete(toolCallId);
        sanitized.push(msg);
      } else {
        // Invalid - either orphaned or out of order
        removedCount++;
        console.warn(
          `🧹 Removing out-of-order/orphaned toolResult: ${toolCallId?.slice(0, 20)}...`
        );
        continue; // Skip this message
      }
    } else if (msg.role === "user") {
      // User message interrupts the tool call flow
      // Any pending tool calls are now orphaned (their results would be out of order)
      if (pendingToolCallIds.size > 0) {
        console.warn(
          `⚠️ User message arrived while ${pendingToolCallIds.size} tool results pending - marking them as orphaned`
        );
        pendingToolCallIds.clear(); // Clear pending - any late results will be removed
      }
      sanitized.push(msg);
    } else {
      // Other message types (system, etc.)
      sanitized.push(msg);
    }
  }

  if (removedCount > 0) {
    console.log(`🧹 Sanitized ${removedCount} orphaned/out-of-order toolResult(s) from transcript`);
  }

  return sanitized;
}

/**
 * Read entire transcript for a session
 */
export function readTranscript(sessionId: string): (Message | AssistantMessage)[] {
  const transcriptPath = getTranscriptPath(sessionId);

  if (!existsSync(transcriptPath)) {
    return [];
  }

  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    const messages = lines.map((line) => JSON.parse(line));

    // Sanitize to remove orphaned toolResults
    return sanitizeMessages(messages);
  } catch (error) {
    console.error(`Failed to read transcript ${sessionId}:`, error);
    return [];
  }
}

/**
 * Check if transcript exists for session
 */
export function transcriptExists(sessionId: string): boolean {
  return existsSync(getTranscriptPath(sessionId));
}

/**
 * Get transcript line count (approximate message count)
 */
export function getTranscriptSize(sessionId: string): number {
  try {
    const messages = readTranscript(sessionId);
    return messages.length;
  } catch {
    return 0;
  }
}

/**
 * Delete a transcript file
 */
export function deleteTranscript(sessionId: string): boolean {
  const transcriptPath = getTranscriptPath(sessionId);

  if (!existsSync(transcriptPath)) {
    return false;
  }

  try {
    unlinkSync(transcriptPath);
    console.log(`🗑️ Deleted transcript: ${sessionId}`);
    return true;
  } catch (error) {
    console.error(`Failed to delete transcript ${sessionId}:`, error);
    return false;
  }
}

/**
 * Archive a transcript (rename with timestamped .archived suffix) before deletion
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
    console.log(`📦 Archived transcript: ${sessionId} → ${timestamp}.archived`);
    return true;
  } catch (error) {
    console.error(`Failed to archive transcript ${sessionId}:`, error);
    return false;
  }
}
