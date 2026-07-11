import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { apiError } from "../http.js";

export function createConversationRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // List all chats
  app.get("/", (c) => {
    try {
      const chats = deps.memory.db
        .prepare(
          `
          SELECT c.id, c.type, c.title, c.username,
            (SELECT COUNT(*) FROM tg_messages m WHERE m.chat_id = c.id) as message_count,
            (SELECT MAX(timestamp) FROM tg_messages m WHERE m.chat_id = c.id) as last_message_at,
            (SELECT text FROM tg_messages m WHERE m.chat_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message
          FROM tg_chats c
          ORDER BY last_message_at DESC NULLS LAST
        `
        )
        .all();

      const response: APIResponse<typeof chats> = {
        success: true,
        data: chats,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
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
