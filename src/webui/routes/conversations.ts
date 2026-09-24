import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { apiError } from "../http.js";

export function createConversationRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const retryAfter = new Map<string, number>();
  const CHAT_INFO_TTL_MS = 30 * 60 * 1000;
  const CHAT_INFO_RETRY_MS = 5 * 60 * 1000;
  const CHAT_INFO_TIMEOUT_MS = 5 * 1000;
  const PHOTO_TTL_SECONDS = 7 * 24 * 60 * 60;
  const MISSING_PHOTO_TTL_SECONDS = 24 * 60 * 60;
  const photoCache = new Map<string, { photo?: Buffer; expiresAt: number }>();

  // List all chats
  app.get("/", async (c) => {
    try {
      const chats = deps.memory.db
        .prepare(
          `
          SELECT c.id, c.type,
            COALESCE(c.title, NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '')) as title,
            COALESCE(c.username, u.username) as username,
            (SELECT COUNT(*) FROM tg_messages m WHERE m.chat_id = c.id) as message_count,
            (SELECT MAX(timestamp) FROM tg_messages m WHERE m.chat_id = c.id) as last_message_at,
            (SELECT text FROM tg_messages m WHERE m.chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message
          FROM tg_chats c
          LEFT JOIN tg_users u ON c.type = 'dm' AND u.id = c.id
          ORDER BY last_message_at DESC NULLS LAST
        `
        )
        .all() as Array<{
        id: string;
        title: string | null;
        username: string | null;
      }>;

      // Resolve only the dashboard's visible conversations. Persist the result so
      // older chats keep their names when Telegram is temporarily unavailable.
      await Promise.all(
        chats.slice(0, 7).map(async (chat) => {
          if (Date.now() < (retryAfter.get(chat.id) ?? 0)) return;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            const info = await Promise.race([
              deps.bridge.getChatInfo(chat.id),
              new Promise<never>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error("Chat info timed out")),
                  CHAT_INFO_TIMEOUT_MS
                );
              }),
            ]);
            if (!info.title && !info.username) {
              retryAfter.set(chat.id, Date.now() + CHAT_INFO_RETRY_MS);
              return;
            }
            chat.title = info.title ?? chat.title;
            chat.username = info.username ?? chat.username;
            deps.memory.db
              .prepare(
                `UPDATE tg_chats SET title = COALESCE(?, title),
                   username = COALESCE(?, username), updated_at = unixepoch()
                 WHERE id = ?`
              )
              .run(info.title ?? null, info.username ?? null, chat.id);
            retryAfter.set(chat.id, Date.now() + CHAT_INFO_TTL_MS);
          } catch {
            // A deleted or inaccessible Telegram chat keeps its stored name or ID.
            retryAfter.set(chat.id, Date.now() + CHAT_INFO_RETRY_MS);
          } finally {
            if (timeout) clearTimeout(timeout);
          }
        })
      );

      const response: APIResponse<typeof chats> = {
        success: true,
        data: chats,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // The image stays on the authenticated WebUI origin; no Telegram token reaches the browser.
  app.get("/:chatId/photo", async (c) => {
    const chatId = c.req.param("chatId");
    const chat = deps.memory.db.prepare("SELECT id FROM tg_chats WHERE id = ?").get(chatId);
    if (!chat) return c.body(null, 404);
    const cached = photoCache.get(chatId);
    let photo = cached && cached.expiresAt > Date.now() ? cached.photo : undefined;
    if (!cached || cached.expiresAt <= Date.now()) {
      try {
        photo = await deps.bridge.getChatPhoto(chatId);
      } catch {
        return c.body(null, 404);
      }
      photoCache.delete(chatId);
      const oldest = photoCache.keys().next().value;
      if (photoCache.size >= 256 && oldest !== undefined) photoCache.delete(oldest);
      photoCache.set(chatId, {
        photo,
        expiresAt: Date.now() + (photo ? PHOTO_TTL_SECONDS : MISSING_PHOTO_TTL_SECONDS) * 1000,
      });
    }
    if (!photo) {
      return c.body(null, 404, {
        "Cache-Control": `private, max-age=${MISSING_PHOTO_TTL_SECONDS}`,
        Vary: "Cookie",
      });
    }
    return c.body(new Uint8Array(photo), 200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": `private, max-age=${PHOTO_TTL_SECONDS}`,
      Vary: "Cookie",
    });
  });

  // Get messages for a specific chat
  app.get("/:chatId/messages", (c) => {
    try {
      const chatId = c.req.param("chatId");
      const limit = Number(c.req.query("limit") || "50");
      const offset = Number(c.req.query("offset") || "0");

      const messages = deps.memory.db
        .prepare(
          `
          SELECT id, chat_id, sender_id, text, is_from_agent, has_media, media_type, timestamp
          FROM tg_messages
          WHERE chat_id = ?
          ORDER BY timestamp DESC
          LIMIT ? OFFSET ?
        `
        )
        .all(chatId, limit, offset);

      const response: APIResponse<typeof messages> = {
        success: true,
        data: messages,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
