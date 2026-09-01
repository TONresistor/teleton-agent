import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../../../memory/schema.js";
import { getTaskStore } from "../../../../../memory/agent/tasks.js";
import {
  telegramListScheduledTasksExecutor,
  telegramCancelScheduledTaskExecutor,
} from "../manage-scheduled-tasks.js";

describe("scheduled task management tools", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => db.close());

  function context() {
    return { db, senderId: 850958167, chatId: "850958167", isGroup: false } as never;
  }

  it("lists tasks including scheduled time", async () => {
    const store = getTaskStore(db);
    const future = new Date(Date.now() + 3600_000);
    store.createTask({
      description: "завтра 09:00",
      priority: 0,
      createdBy: "telegram:850958167",
      scheduledFor: future,
      originSenderId: 850958167,
      originChatId: "850958167",
      originIsGroup: false,
    });

    const result = await telegramListScheduledTasksExecutor({}, context());
    expect(result.success).toBe(true);
    const data = result.data as { tasks: Array<{ id: string; description: string }> };
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].description).toBe("завтра 09:00");
  });

  it("cancels a task by id", async () => {
    const store = getTaskStore(db);
    const created = store.createTask({
      description: "cancel me",
      priority: 0,
      createdBy: "telegram:850958167",
      originSenderId: 850958167,
      originChatId: "850958167",
      originIsGroup: false,
    });

    const result = await telegramCancelScheduledTaskExecutor({ taskId: created.id }, context());
    expect(result.success).toBe(true);
    expect(store.getTask(created.id)?.status).toBe("cancelled");
  });

  it("fails to cancel unknown task", async () => {
    const result = await telegramCancelScheduledTaskExecutor({ taskId: "nope" }, context());
    expect(result.success).toBe(false);
  });
});
