import Database from "better-sqlite3";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ensureSchema } from "../../memory/schema.js";
import { createMemoryRoutes } from "../routes/memory.js";
import type { WebUIServerDeps } from "../types.js";

const memoryRoot = vi.hoisted(
  () => `/tmp/teleton-memory-files-${process.pid}-${Math.random().toString(36).slice(2)}`
);
vi.mock("../../workspace/paths.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  TELETON_ROOT: memoryRoot,
}));

describe("WebUI memory files", () => {
  let db: Database.Database;
  let app: Hono;

  beforeEach(() => {
    mkdirSync(join(memoryRoot, "memory", "archived"), { recursive: true });
    db = new Database(":memory:");
    ensureSchema(db);
    app = new Hono();
    app.route("/memory", createMemoryRoutes({ memory: { db } } as unknown as WebUIServerDeps));
  });

  afterEach(() => {
    db.close();
    rmSync(memoryRoot, { recursive: true, force: true });
  });

  function index(path: string) {
    db.prepare(
      "INSERT INTO knowledge (id, source, path, text, hash) VALUES (?, 'memory', ?, ?, ?)"
    ).run(path, path, "indexed excerpt", "hash");
  }

  it("returns the complete Markdown file instead of its indexed excerpt", async () => {
    const content = "# Full document\n\nFirst section.\n\n## Second section\nComplete ending.\n";
    writeFileSync(join(memoryRoot, "memory", "notes.md"), content);
    index("memory/notes.md");

    const response = await app.request("/memory/files/memory%2Fnotes.md");
    expect(response.status).toBe(200);
    expect((await response.json()).data.content).toBe(content);
  });

  it("lists and searches Markdown files without unrelated knowledge sources", async () => {
    writeFileSync(join(memoryRoot, "memory", "notes.md"), "# Notes\n");
    index("memory/notes.md");
    db.prepare("INSERT INTO knowledge (id, source, path, text, hash) VALUES (?, ?, ?, ?, ?)").run(
      "learned",
      "learned",
      "memory/learned.md",
      "indexed excerpt",
      "hash"
    );

    const sources = (await (await app.request("/memory/sources?files=true")).json()).data;
    expect(sources.map((source: { source: string }) => source.source)).toEqual(["memory/notes.md"]);
    const matches = (
      await (await app.request("/memory/search?q=indexed%20excerpt&files=true")).json()
    ).data;
    expect(matches.map((match: { source: string }) => match.source)).toEqual(["memory/notes.md"]);
  });

  it("reads an archived indexed Markdown file", async () => {
    writeFileSync(join(memoryRoot, "memory", "archived", "old.md"), "# Archived\nFull text.\n");
    index("memory/old.md");

    const response = await app.request("/memory/files/memory%2Fold.md");
    expect(response.status).toBe(200);
    expect((await response.json()).data.content).toBe("# Archived\nFull text.\n");
  });

  it("rejects unindexed paths and links to other Teleton files", async () => {
    writeFileSync(join(memoryRoot, "config.md"), "secret");
    symlinkSync("../config.md", join(memoryRoot, "memory", "leak.md"));
    index("memory/leak.md");

    expect((await app.request("/memory/files/MEMORY.md")).status).toBe(404);
    expect((await app.request("/memory/files/memory%2Fleak.md")).status).toBe(404);
    expect((await app.request("/memory/files/memory%2F..%2Fconfig.md")).status).toBe(404);
  });
});
