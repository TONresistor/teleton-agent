import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
  taskStore: {
    getTask: vi.fn(),
    canExecute: vi.fn(() => true),
    startTask: vi.fn(),
    getParentResults: vi.fn(() => []),
    completeTask: vi.fn(),
    failTask: vi.fn(),
  },
  executeScheduledTask: vi.fn(async () => "task complete"),
}));

vi.mock("../../memory/index.js", () => ({
  getDatabase: () => ({ getDb: () => mocks.db }),
}));

vi.mock("../../memory/agent/tasks.js", () => ({
  getTaskStore: () => mocks.taskStore,
}));

vi.mock("../task-executor.js", () => ({
  executeScheduledTask: mocks.executeScheduledTask,
}));

vi.mock("../task-dependency-resolver.js", () => ({
  TaskDependencyResolver: class {
    async onTaskComplete() {}
    async onTaskFail() {}
  },
}));

import { ScheduledTaskHandler } from "../../scheduled-tasks.js";

describe("ScheduledTaskHandler authority", () => {
  const registry = {};
  const bridge = {
    sendMessage: vi.fn(async () => ({ id: 1, date: new Date() })),
  };
  const agent = {
    getToolRegistry: vi.fn(() => registry),
    processMessage: vi.fn(async () => ({ content: "done" })),
  };
  const config = { telegram: { admin_ids: [999] } };
  const savedMessage = {
    id: 77,
    chatId: "999",
    senderId: 999,
    text: "[TASK:task-1] run",
    isGroup: false,
    timestamp: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.taskStore.canExecute.mockReturnValue(true);
    mocks.taskStore.getParentResults.mockReturnValue([]);
  });

  it("executes with the persisted creator authority, not the Saved Messages sender", async () => {
    const task = {
      id: "task-1",
      description: "run",
      status: "pending",
      priority: 0,
      createdAt: new Date(),
      originSenderId: 12345,
      originChatId: "telegram:group:-10042",
      originIsGroup: true,
    };
    mocks.taskStore.getTask.mockReturnValue(task);

    const handler = new ScheduledTaskHandler(agent as never, bridge as never, config as never);
    await handler.execute(savedMessage as never);

    expect(mocks.executeScheduledTask).toHaveBeenCalledWith(
      task,
      agent,
      expect.objectContaining({
        senderId: 12345,
        chatId: "telegram:group:-10042",
        isGroup: true,
      }),
      registry,
      []
    );
    expect(agent.processMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "telegram:group:-10042",
        isGroup: true,
        toolContext: expect.objectContaining({ senderId: 12345 }),
      })
    );
  });

  it("fails closed for legacy tasks that have no creator authority", async () => {
    mocks.taskStore.getTask.mockReturnValue({
      id: "task-1",
      description: "legacy",
      status: "pending",
      priority: 0,
      createdAt: new Date(),
    });

    const handler = new ScheduledTaskHandler(agent as never, bridge as never, config as never);
    await handler.execute(savedMessage as never);

    expect(mocks.taskStore.failTask).toHaveBeenCalledWith(
      "task-1",
      expect.stringMatching(/missing creator authority/i)
    );
    expect(mocks.executeScheduledTask).not.toHaveBeenCalled();
    expect(agent.processMessage).not.toHaveBeenCalled();
  });
});
