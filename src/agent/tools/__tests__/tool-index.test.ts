import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NoopEmbeddingProvider,
  type EmbeddingProvider,
} from "../../../memory/embeddings/provider.js";
import { ToolIndex } from "../tool-index.js";
import type { ToolNamespaceCatalogEntry } from "../tool-namespaces.js";

const CONFIG = { topK: 5, alwaysInclude: [], skipUnlimitedProviders: false };

describe("ToolIndex hierarchical search", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE tool_index (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        search_text TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
  });

  afterEach(() => db.close());

  it("ranks only tools from the selected namespace", async () => {
    const index = new ToolIndex(db, new NoopEmbeddingProvider(), false, CONFIG);
    await index.indexAll([
      { name: "exec_run", description: "Run a shell command", parameters: {} },
      { name: "exec_status", description: "Inspect a shell command", parameters: {} },
      { name: "web_search", description: "Search the web", parameters: {} },
    ]);

    const results = await index.searchWithin(
      "shell command",
      [],
      new Set(["exec_run", "exec_status"]),
      5
    );

    expect(results.map((result) => result.name)).toEqual(["exec_run", "exec_status"]);
    expect(results.map((result) => result.name)).not.toContain("web_search");
  });

  it("invalidates namespace embeddings when searchable tool metadata changes", async () => {
    const embedBatch = vi
      .fn<EmbeddingProvider["embedBatch"]>()
      .mockResolvedValueOnce([[1, 0]])
      .mockResolvedValueOnce([[1, 0]]);
    const embedder: EmbeddingProvider = {
      id: "test",
      model: "test",
      dimensions: 2,
      embedQuery: vi.fn(async () => [1, 0]),
      embedBatch,
    };
    const index = new ToolIndex(db, embedder, true, CONFIG);
    const catalog: ToolNamespaceCatalogEntry[] = [
      {
        name: "exec",
        description: "Run commands.",
        toolNames: ["exec_run"],
        searchText: "exec run shell commands",
      },
    ];

    await index.searchNamespaces("run", [1, 0], catalog, 1);
    await index.searchNamespaces("run", [1, 0], catalog, 1);
    await index.searchNamespaces(
      "run",
      [1, 0],
      [{ ...catalog[0], searchText: "exec run shell commands and inspect services" }],
      1
    );

    expect(embedBatch).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent hot reloads so the newest index state wins", async () => {
    db.exec(`CREATE TABLE tool_index_vec (name TEXT PRIMARY KEY, embedding BLOB NOT NULL)`);
    let releaseFirst: ((vectors: number[][]) => void) | undefined;
    const embedBatch = vi.fn((texts: string[]) => {
      if (texts[0].includes("Old description")) {
        return new Promise<number[][]>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve([[0, 1]]);
    });
    const embedder: EmbeddingProvider = {
      id: "test",
      model: "test",
      dimensions: 2,
      embedQuery: vi.fn(async () => [1, 0]),
      embedBatch,
    };
    const index = new ToolIndex(db, embedder, true, CONFIG);
    const parameters = {};
    await index.indexAll([]);
    expect(index.isIndexed).toBe(true);

    const first = index.reindexTools(
      [],
      [{ name: "plugin_tool", description: "Old description", parameters }]
    );
    await vi.waitFor(() => expect(embedBatch).toHaveBeenCalledTimes(1));
    expect(index.isIndexed).toBe(false);
    const second = index.reindexTools(
      [],
      [{ name: "plugin_tool", description: "New description", parameters }]
    );

    expect(embedBatch).toHaveBeenCalledTimes(1);
    releaseFirst?.([[1, 0]]);
    await Promise.all([first, second]);

    const row = db
      .prepare(`SELECT description FROM tool_index WHERE name = ?`)
      .get("plugin_tool") as {
      description: string;
    };
    expect(row.description).toBe("New description");
    expect(embedBatch).toHaveBeenCalledTimes(2);
    expect(index.isIndexed).toBe(true);
  });

  it("invalidates a stale index when a delta update fails", async () => {
    const index = new ToolIndex(db, new NoopEmbeddingProvider(), false, CONFIG);
    await index.indexAll([{ name: "stable_tool", description: "Stable tool", parameters: {} }]);
    db.exec(`
      CREATE TRIGGER reject_bad_tool
      BEFORE INSERT ON tool_index
      WHEN NEW.name = 'bad_tool'
      BEGIN
        SELECT RAISE(ABORT, 'reindex rejected');
      END
    `);

    await index.reindexTools(
      [],
      [{ name: "bad_tool", description: "Rejected tool", parameters: {} }]
    );

    expect(index.isIndexed).toBe(false);
  });
});
