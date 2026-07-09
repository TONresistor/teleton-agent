import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { TaskStore } from "../agent/tasks.js";

describe("TaskStore origin authority", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => db.close());

  it("persists and restores the Telegram authority that created a task", () => {
    const store = new TaskStore(db);
    const created = store.createTask({
      description: "check later",
      originSenderId: 12345,
      originChatId: "telegram:group:-10042",
      originIsGroup: true,
    } as never);

    expect(created).toMatchObject({
      originSenderId: 12345,
      originChatId: "telegram:group:-10042",
      originIsGroup: true,
    });
    expect(store.getTask(created.id)).toMatchObject({
      originSenderId: 12345,
      originChatId: "telegram:group:-10042",
      originIsGroup: true,
    });
  });
});
