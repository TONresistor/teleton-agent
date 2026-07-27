import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "../schema.js";
import { createToolResultArtifact, readToolResultArtifact } from "../tool-result-artifacts.js";

describe("tool result artifacts", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => db.close());

  it("pages large results and isolates them by chat", () => {
    const artifact = createToolResultArtifact(db, {
      sessionId: "session-1",
      chatId: "chat-1",
      toolName: "large_tool",
      content: "abcdefghij",
    });

    expect(readToolResultArtifact(db, artifact.id, "chat-2", 0, 4)).toBeNull();
    expect(readToolResultArtifact(db, artifact.id, "chat-1", 0, 4)).toEqual({
      content: "abcd",
      offset: 0,
      nextOffset: 4,
      sizeBytes: 10,
    });
    expect(readToolResultArtifact(db, artifact.id, "chat-1", 4, 20)).toEqual({
      content: "efghij",
      offset: 4,
      nextOffset: null,
      sizeBytes: 10,
    });
  });

  it("rejects unbounded artifact payloads", () => {
    expect(() =>
      createToolResultArtifact(db, {
        sessionId: "session-1",
        chatId: "chat-1",
        toolName: "large_tool",
        content: "x".repeat(5 * 1024 * 1024 + 1),
      })
    ).toThrow("exceeds");
  });
});
