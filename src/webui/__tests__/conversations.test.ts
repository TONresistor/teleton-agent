import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ensureSchema } from "../../memory/schema.js";
import { createConversationRoutes } from "../routes/conversations.js";
import type { WebUIServerDeps } from "../types.js";

describe("WebUI conversation identities", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    db.prepare("INSERT INTO tg_chats (id, type) VALUES (?, ?)").run("-100123", "group");
  });

  afterEach(() => db.close());

  it("resolves and stores the Telegram title for recent chats", async () => {
    const getChatInfo = vi.fn().mockResolvedValue({
      id: "-100123",
      type: "supergroup",
      title: "Telegram Group",
      username: "telegram_group",
    });
    const deps = { memory: { db }, bridge: { getChatInfo } } as unknown as WebUIServerDeps;
    const app = new Hono();
    app.route("/conversations", createConversationRoutes(deps));

    const response = await app.request("/conversations");
    expect(response.status).toBe(200);
    expect((await response.json()).data[0]).toMatchObject({
      id: "-100123",
      title: "Telegram Group",
      username: "telegram_group",
    });
    expect(db.prepare("SELECT title FROM tg_chats WHERE id = ?").get("-100123")).toEqual({
      title: "Telegram Group",
    });
    await app.request("/conversations");
    expect(getChatInfo).toHaveBeenCalledOnce();
  });

  it("keeps a stored name when Telegram cannot resolve the chat", async () => {
    db.prepare("UPDATE tg_chats SET title = ? WHERE id = ?").run("Saved name", "-100123");
    const deps = {
      memory: { db },
      bridge: { getChatInfo: vi.fn().mockRejectedValue(new Error("Unavailable")) },
    } as unknown as WebUIServerDeps;
    const app = new Hono();
    app.route("/conversations", createConversationRoutes(deps));

    expect((await (await app.request("/conversations")).json()).data[0].title).toBe("Saved name");
  });

  it("uses the locally recorded Telegram name for a DM when lookup fails", async () => {
    db.prepare("INSERT INTO tg_chats (id, type) VALUES (?, ?)").run("42", "dm");
    db.prepare("INSERT INTO tg_users (id, first_name, last_name) VALUES (?, ?, ?)").run(
      "42",
      "Ada",
      "Lovelace"
    );
    const deps = {
      memory: { db },
      bridge: { getChatInfo: vi.fn().mockRejectedValue(new Error("Unavailable")) },
    } as unknown as WebUIServerDeps;
    const app = new Hono();
    app.route("/conversations", createConversationRoutes(deps));

    const chats = (await (await app.request("/conversations")).json()).data;
    expect(chats.find((chat: { id: string }) => chat.id === "42").title).toBe("Ada Lovelace");
  });

  it("serves a stored chat's photo without exposing Telegram credentials", async () => {
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const getChatPhoto = vi.fn().mockResolvedValue(photo);
    const deps = { memory: { db }, bridge: { getChatPhoto } } as unknown as WebUIServerDeps;
    const app = new Hono();
    app.route("/conversations", createConversationRoutes(deps));

    const response = await app.request("/conversations/-100123/photo");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, max-age=604800");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(photo);
    expect((await app.request("/conversations/-100123/photo")).status).toBe(200);
    expect((await app.request("/conversations/unknown/photo")).status).toBe(404);
    expect(getChatPhoto).toHaveBeenCalledOnce();
  });

  it("caches missing photos for one day", async () => {
    const getChatPhoto = vi.fn().mockResolvedValue(undefined);
    const deps = { memory: { db }, bridge: { getChatPhoto } } as unknown as WebUIServerDeps;
    const app = new Hono();
    app.route("/conversations", createConversationRoutes(deps));

    const response = await app.request("/conversations/-100123/photo");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
    await app.request("/conversations/-100123/photo");
    expect(getChatPhoto).toHaveBeenCalledOnce();
  });
});
