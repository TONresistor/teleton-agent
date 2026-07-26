import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

const ARTIFACT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

export interface ToolResultArtifact {
  id: string;
  sessionId: string;
  chatId: string;
  toolName: string;
  content: string;
  sizeBytes: number;
  createdAt: number;
  expiresAt: number;
}

export function createToolResultArtifact(
  db: Database.Database,
  input: Omit<ToolResultArtifact, "id" | "sizeBytes" | "createdAt" | "expiresAt">
): ToolResultArtifact {
  const createdAt = Date.now();
  const sizeBytes = Buffer.byteLength(input.content, "utf8");
  if (sizeBytes > MAX_ARTIFACT_BYTES) {
    throw new Error(`Tool result artifact exceeds ${MAX_ARTIFACT_BYTES} byte limit`);
  }
  const artifact: ToolResultArtifact = {
    ...input,
    id: randomUUID(),
    sizeBytes,
    createdAt,
    expiresAt: createdAt + ARTIFACT_TTL_MS,
  };
  db.prepare(
    `INSERT INTO tool_result_artifacts
       (id, session_id, chat_id, tool_name, content, size_bytes, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    artifact.id,
    artifact.sessionId,
    artifact.chatId,
    artifact.toolName,
    artifact.content,
    artifact.sizeBytes,
    artifact.createdAt,
    artifact.expiresAt
  );
  db.prepare("DELETE FROM tool_result_artifacts WHERE expires_at < ?").run(createdAt);
  return artifact;
}

export function readToolResultArtifact(
  db: Database.Database,
  artifactId: string,
  chatId: string,
  offset: number,
  limit: number
): { content: string; offset: number; nextOffset: number | null; sizeBytes: number } | null {
  const row = db
    .prepare(
      `SELECT content, size_bytes AS sizeBytes, expires_at AS expiresAt
       FROM tool_result_artifacts WHERE id = ? AND chat_id = ?`
    )
    .get(artifactId, chatId) as
    | { content: string; sizeBytes: number; expiresAt: number }
    | undefined;
  if (!row || row.expiresAt < Date.now()) return null;

  const safeOffset = Math.min(Math.max(0, offset), row.content.length);
  const content = row.content.slice(safeOffset, safeOffset + limit);
  const nextOffset =
    safeOffset + content.length < row.content.length ? safeOffset + content.length : null;
  return { content, offset: safeOffset, nextOffset, sizeBytes: row.sizeBytes };
}
