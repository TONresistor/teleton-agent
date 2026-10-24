import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
  taskStore: {
    getTask: vi.fn(),
    canExecute: vi.fn(() => true),
    startTask: vi.fn(),
    getParentResults: vi.fn(() => []),
    completeTask: vi.fn(),
    finishTask: vi.fn(),
    updateTask: vi.fn(),
    blockUnfinishedDependents: vi.fn(),
    recordNotificationError: vi.fn(),
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
    processMessage: vi.fn(async () => ({
      content: "done",
      outcome: { status: "completed", reason: "completed" },
      delivery: { state: "not_requested" },
    })),
  };
  const config = {
    agent: { max_turn_duration_ms: 60_000 },
    telegram: { admin_ids: [999], allow_from: [12345], group_policy: "open", dm_policy: "open" },
  };
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
      runId: "run-one",
      revision: 1,
      createdAt: new Date(),
      originSenderId: 12345,
      originChatId: "telegram:group:-10042",
      originIsGroup: true,
    };
    mocks.taskStore.getTask.mockReturnValue(task);
    mocks.taskStore.startTask.mockReturnValue(task);

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

    expect(mocks.taskStore.updateTask).toHaveBeenCalledWith("task-1", {
      status: "blocked",
      error: expect.stringMatching(/missing creator authority/i),
    });
    expect(mocks.executeScheduledTask).not.toHaveBeenCalled();
    expect(agent.processMessage).not.toHaveBeenCalled();
  });
  it.each([
    ["completed", "done"],
    ["incomplete", "incomplete"],
    ["unknown", "unknown"],
    ["interrupted", "incomplete"],
    ["blocked", "blocked"],
    ["failed", "failed"],
  ])("persists %s as %s using the claimed run revision", async (outcome, status) => {
    const task = {
      id: "task-1",
      description: "run",
      status: "pending",
      priority: 0,
      createdAt: new Date(),
      originSenderId: 12345,
      originChatId: "12345",
      originIsGroup: false,
      revision: 1,
      runId: "run-one",
    };
    mocks.taskStore.getTask.mockReturnValue(task);
    mocks.taskStore.startTask.mockReturnValue(task);
    mocks.taskStore.finishTask.mockReturnValue({ ...task, status });
    agent.processMessage.mockResolvedValue({
      content: "partial result",
      outcome: { status: outcome, reason: "iteration_budget" },
      delivery: { state: "not_requested" },
    });
    await new ScheduledTaskHandler(agent as never, bridge as never, config as never).execute(
      savedMessage as never
    );
    expect(mocks.taskStore.finishTask).toHaveBeenCalledWith(
      "task-1",
      "run-one",
      1,
      status,
      "partial result",
      status === "done" ? undefined : "iteration_budget",
      { turnId: undefined, outcomeReason: "iteration_budget" }
    );
  });

  it("records notification failure separately from a confirmed task outcome", async () => {
    const task = {
      id: "task-1",
      description: "run",
      status: "pending",
      priority: 0,
      createdAt: new Date(),
      originSenderId: 12345,
      originChatId: "12345",
      originIsGroup: false,
      revision: 1,
      runId: "run-one",
    };
    mocks.taskStore.getTask.mockReturnValue(task);
    mocks.taskStore.startTask.mockReturnValue(task);
    mocks.taskStore.finishTask.mockReturnValue({ ...task, status: "done" });
    agent.processMessage.mockResolvedValue({
      content: "confirmed",
      outcome: { status: "completed", reason: "completed" },
      delivery: { state: "not_requested" },
    });
    bridge.sendMessage.mockRejectedValueOnce(new Error("notification unavailable"));
    await new ScheduledTaskHandler(agent as never, bridge as never, config as never).execute(
      savedMessage as never
    );
    expect(mocks.taskStore.finishTask).toHaveBeenCalledTimes(1);
    expect(mocks.taskStore.finishTask).toHaveBeenCalledWith(
      "task-1",
      "run-one",
      1,
      "done",
      "confirmed",
      undefined,
      { turnId: undefined, outcomeReason: "completed" }
    );
    expect(mocks.taskStore.recordNotificationError).toHaveBeenCalledWith(
      "task-1",
      "notification unavailable"
    );
  });

  it("rechecks revoked authority before claims, parent results, or direct tools", async () => {
    mocks.taskStore.getTask.mockReturnValue({
      id: "task-1",
      description: "revoked",
      status: "pending",
      originSenderId: 222,
      originChatId: "222",
      originIsGroup: false,
    });
    await new ScheduledTaskHandler(agent as never, bridge as never, config as never).execute(
      savedMessage as never
    );
    expect(mocks.taskStore.startTask).not.toHaveBeenCalled();
    expect(mocks.taskStore.getParentResults).not.toHaveBeenCalled();
    expect(mocks.executeScheduledTask).not.toHaveBeenCalled();
    expect(agent.processMessage).not.toHaveBeenCalled();
    expect(mocks.taskStore.updateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "blocked" })
    );
  });
});
