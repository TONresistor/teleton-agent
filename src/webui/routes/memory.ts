import { Hono } from "hono";
import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MAX_FILE_SIZES, TELETON_ROOT } from "../../workspace/paths.js";
import type {
  WebUIServerDeps,
  MemorySearchResult,
  MemorySourceFile,
  SessionInfo,
  APIResponse,
} from "../types.js";
import { apiError } from "../http.js";

function resolveMemoryFile(sourceKey: string): string | undefined {
  if (sourceKey !== "MEMORY.md" && !/^memory\/[^/\\]+\.md$/i.test(sourceKey)) return undefined;

  const root = realpathSync(TELETON_ROOT);
  const candidates = [sourceKey];
  if (sourceKey.startsWith("memory/")) {
    candidates.push(`memory/archived/${sourceKey.slice("memory/".length)}`);
  }

  for (const candidate of candidates) {
    const expected = resolve(root, candidate);
    try {
      const actual = realpathSync(expected);
      if (actual !== expected) return undefined;
      if (statSync(actual).isFile()) return actual;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

export function createMemoryRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // Search knowledge base
  app.get("/search", async (c) => {
    try {
      const query = c.req.query("q") || "";
      const limit = parseInt(c.req.query("limit") || "10", 10);
      const filesOnly = c.req.query("files") === "true";

      if (!query) {
        const response: APIResponse = {
          success: false,
          error: "Query parameter 'q' is required",
        };
        return c.json(response, 400);
      }

      // Sanitize FTS5 query: wrap in double-quotes to treat as phrase literal
      const sanitizedQuery = '"' + query.replace(/"/g, '""') + '"';

      const results = deps.memory.db
        .prepare(
          `
          SELECT
            k.id,
            k.text,
            k.source,
            k.path,
            bm25(knowledge_fts) as score
          FROM knowledge_fts
          JOIN knowledge k ON knowledge_fts.rowid = k.rowid
          WHERE knowledge_fts MATCH ?
          ${filesOnly ? "AND k.source = 'memory' AND k.path LIKE '%.md'" : ""}
          ORDER BY score DESC
          LIMIT ?
        `
        )
        .all(sanitizedQuery, limit) as Array<{
        id: string;
        text: string;
        source: string;
        path: string | null;
        score: number;
      }>;

      const searchResults: MemorySearchResult[] = results.map((row) => ({
        id: row.id,
        text: row.text,
        source: row.path || row.source,
        score: Math.max(0, 1 - row.score / 10), // Normalize BM25 score to 0-1 range
        keywordScore: Math.max(0, 1 - row.score / 10),
      }));

      const response: APIResponse<MemorySearchResult[]> = {
        success: true,
        data: searchResults,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Get active sessions
  app.get("/sessions", (c) => {
    try {
      const rows = deps.memory.db
        .prepare(
          `
          SELECT
            chat_id,
            id,
            message_count,
            context_tokens,
            updated_at
          FROM sessions
          ORDER BY updated_at DESC
        `
        )
        .all() as Array<{
        chat_id: string;
        id: string;
        message_count: number;
        context_tokens: number;
        updated_at: number;
      }>;

      const sessions: SessionInfo[] = rows.map((row) => ({
        chatId: row.chat_id,
        sessionId: row.id,
        messageCount: row.message_count,
        contextTokens: row.context_tokens,
        lastActivity: row.updated_at,
      }));

      const response: APIResponse<SessionInfo[]> = {
        success: true,
        data: sessions,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Get memory stats
  app.get("/stats", (c) => {
    try {
      const stats = {
        knowledge: (
          deps.memory.db.prepare("SELECT COUNT(*) as count FROM knowledge").get() as {
            count: number;
          }
        ).count,
        sessions: (
          deps.memory.db.prepare("SELECT COUNT(*) as count FROM sessions").get() as {
            count: number;
          }
        ).count,
        messages: (
          deps.memory.db.prepare("SELECT COUNT(*) as count FROM tg_messages").get() as {
            count: number;
          }
        ).count,
        chats: (
          deps.memory.db.prepare("SELECT COUNT(*) as count FROM tg_chats").get() as {
            count: number;
          }
        ).count,
      };

      const response: APIResponse<typeof stats> = {
        success: true,
        data: stats,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Read an entire indexed Markdown file. The knowledge table grants access only
  // to known memory paths; realpath rejects links to files outside that path.
  app.get("/files/:sourceKey", async (c) => {
    try {
      const sourceKey = c.req.param("sourceKey");
      const indexed = deps.memory.db
        .prepare("SELECT 1 FROM knowledge WHERE source = 'memory' AND path = ? LIMIT 1")
        .get(sourceKey);
      if (!indexed) return c.json({ success: false, error: "Memory file not found" }, 404);

      const filePath = resolveMemoryFile(sourceKey);
      if (!filePath) return c.json({ success: false, error: "Memory file not found" }, 404);
      if (statSync(filePath).size > MAX_FILE_SIZES.document) {
        return c.json({ success: false, error: "Memory file is too large to display" }, 413);
      }

      const content = await readFile(filePath, "utf8");
      return c.json({ success: true, data: { content } } satisfies APIResponse<{
        content: string;
      }>);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Get chunks for a specific source (retained for existing API consumers)
  app.get("/sources/:sourceKey", (c) => {
    try {
      const sourceKey = decodeURIComponent(c.req.param("sourceKey"));

      const rows = deps.memory.db
        .prepare(
          `
          SELECT id, text, source, path, start_line, end_line, updated_at
          FROM knowledge
          WHERE COALESCE(path, source) = ?
          ORDER BY start_line ASC, updated_at DESC
        `
        )
        .all(sourceKey) as Array<{
        id: string;
        text: string;
        source: string;
        path: string | null;
        start_line: number | null;
        end_line: number | null;
        updated_at: number;
      }>;

      const chunks = rows.map((row) => ({
        id: row.id,
        text: row.text,
        source: row.path || row.source,
        startLine: row.start_line,
        endLine: row.end_line,
        updatedAt: row.updated_at,
      }));

      const response: APIResponse<typeof chunks> = {
        success: true,
        data: chunks,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // List indexed sources (grouped by file/source category)
  app.get("/sources", (c) => {
    try {
      const filesOnly = c.req.query("files") === "true";
      const rows = deps.memory.db
        .prepare(
          `
          SELECT
            COALESCE(path, source) AS source_key,
            COUNT(*) AS entry_count,
            MAX(updated_at) AS last_updated
          FROM knowledge
          ${filesOnly ? "WHERE source = 'memory' AND path LIKE '%.md'" : ""}
          GROUP BY source_key
          ORDER BY last_updated DESC
        `
        )
        .all() as Array<{
        source_key: string;
        entry_count: number;
        last_updated: number;
      }>;

      const sources: MemorySourceFile[] = rows.map((row) => ({
        source: row.source_key,
        entryCount: row.entry_count,
        lastUpdated: row.last_updated,
      }));

      const response: APIResponse<MemorySourceFile[]> = {
        success: true,
        data: sources,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
