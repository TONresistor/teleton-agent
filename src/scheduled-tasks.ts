import type { TaskStatus } from "./memory/agent/tasks.js";
import { assertTurnBudget, TurnBudgetError } from "./agent/turn-budget.js";
import type { TurnAdmission } from "./agent/execution-types.js";
import { authorizeTurn } from "./agent/turn-authorization.js";
import type { AgentRuntime } from "./agent/runtime.js";
import type { ITelegramBridge } from "./telegram/bridge-interface.js";
import type { Config } from "./config/schema.js";
import type { TelegramMessage } from "./telegram/bridge.js";
import type { TaskDependencyResolver } from "./telegram/task-dependency-resolver.js";
import { getErrorMessage } from "./utils/errors.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("ScheduledTaskHandler");

export class ScheduledTaskHandler {
  private dependencyResolver: TaskDependencyResolver | null = null;

  constructor(
    private agent: AgentRuntime,
    private bridge: ITelegramBridge,
    private config: Config
  ) {}

  updateConfig(config: Config): void {
    this.config = config;
    this.dependencyResolver = null;
  }

  async execute(message: TelegramMessage): Promise<void> {
    const receivedAt = message.receivedAt ?? Date.now();
    message.receivedAt = receivedAt;
    const executionDeadline = Date.now() + this.config.agent.max_turn_duration_ms;
    const controller = new AbortController();
    const deadlineTimer = setTimeout(
      () => controller.abort(),
      Math.max(0, executionDeadline - Date.now())
    );
    deadlineTimer.unref?.();
    try {
      await this.executeAccepted(message, {
        receivedAt,
        queueDeadline: receivedAt + 60_000,
        executionDeadline,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  private async executeAccepted(
    message: TelegramMessage,
    admission: TurnAdmission & { executionDeadline: number }
  ): Promise<void> {
    // Hoist all dynamic imports to top of function
    const { getTaskStore } = await import("./memory/agent/tasks.js");
    const { executeScheduledTask } = await import("./telegram/task-executor.js");
    const { TaskDependencyResolver } = await import("./telegram/task-dependency-resolver.js");
    const { getDatabase } = await import("./memory/index.js");

    const db = getDatabase().getDb();
    const taskStore = getTaskStore(db);

    // Extract task ID from format: [TASK:uuid] description
    const match = message.text.match(/^\[TASK:([^\]]+)\]/);
    if (!match) {
      log.warn(
        { messageId: message.id, messageLength: message.text.length },
        "Invalid task format"
      );
      return;
    }

    const taskId = match[1];

    let claimed: ReturnType<typeof taskStore.startTask>;
    let invoked = false;
    try {
      const task = taskStore.getTask(taskId);

      if (!task) {
        log.warn(`Task ${taskId} not found in database`);
        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: `⚠️ Task ${taskId} not found. It may have been deleted.`,
          replyToId: message.id,
        });
        return;
      }

      // Skip cancelled tasks (e.g. cancelled via WebUI or admin)
      if (task.status !== "pending") {
        log.info(`Task ${taskId} already ${task.status}, skipping`);
        return;
      }

      // Legacy rows did not persist their creator. Never substitute the Saved
      // Messages sender (the owner account), because that elevates authority.
      if (
        task.originSenderId === undefined ||
        task.originChatId === undefined ||
        task.originIsGroup === undefined
      ) {
        const reason = "Scheduled task is missing creator authority; recreate it before execution";
        taskStore.updateTask(taskId, { status: "blocked", error: reason });
        taskStore.blockUnfinishedDependents();
        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: `⚠️ Task "${task.description}" was blocked: missing creator authority. Recreate the task.`,
          replyToId: message.id,
        });
        return;
      }

      const authority = authorizeTurn(this.config, {
        chatId: task.originChatId,
        isGroup: task.originIsGroup,
        toolContext: { senderId: task.originSenderId },
      });
      if (!authority.allowed) {
        taskStore.updateTask(taskId, { status: "blocked", error: authority.reason });
        taskStore.blockUnfinishedDependents();
        return;
      }

      // Check if all dependencies are satisfied
      if (!taskStore.canExecute(taskId)) {
        log.warn(`Task ${taskId} cannot execute yet - dependencies not satisfied`);
        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: `⏳ Task "${task.description}" is waiting for parent tasks to complete.`,
          replyToId: message.id,
        });
        return;
      }

      // Mark task as in_progress
      claimed = taskStore.startTask(taskId);
      if (!claimed?.runId) return;

      assertTurnBudget(
        Math.min(admission.executionDeadline, admission.queueDeadline),
        admission.signal
      );
      // Get parent task results for context
      const parentResults = taskStore.getParentResults(taskId);

      // Build tool context
      const toolContext = {
        bridge: this.bridge,
        db,
        chatId: task.originChatId,
        isGroup: task.originIsGroup,
        senderId: task.originSenderId,
        config: this.config,
        deadlineAt: admission.executionDeadline,
        signal: admission.signal,
      };
      const requiresDelivery = task.payload
        ? (JSON.parse(task.payload) as { requiresDelivery?: boolean }).requiresDelivery === true
        : false;

      // Get tool registry from agent runtime
      const toolRegistry = this.agent.getToolRegistry();
      if (!toolRegistry) {
        throw new Error("Tool registry not available");
      }

      // Execute task and get prompt for agent (with parent context)
      const agentPrompt = await executeScheduledTask(
        task,
        this.agent,
        toolContext,
        toolRegistry,
        parentResults
      );

      assertTurnBudget(
        Math.min(admission.executionDeadline, admission.queueDeadline),
        admission.signal
      );
      // Feed prompt to agent (agent loop with full context)
      invoked = true;
      const response = await this.agent.processMessage({
        chatId: task.originChatId,
        userMessage: agentPrompt,
        userName: "self-scheduled-task",
        timestamp: message.timestamp.getTime(),
        isGroup: task.originIsGroup,
        toolContext: { ...toolContext, signal: undefined },
        messageId: message.id,
        admission: {
          receivedAt: admission.receivedAt,
          queueDeadline: admission.queueDeadline,
          executionDeadline: admission.executionDeadline,
        },
        ingressKey: `task:${taskId}:${claimed.runId}`,
        turnId: `task:${taskId}:${claimed.runId}`,
        delivery: {
          kind: "telegram",
          bridge: this.bridge,
          chatId: message.chatId,
          replyToId: message.id,
        },
      });

      let status: Exclude<TaskStatus, "pending" | "in_progress"> =
        response.outcome.status === "completed"
          ? "done"
          : response.outcome.status === "interrupted"
            ? "incomplete"
            : response.outcome.status;
      let outcomeReason = response.outcome.reason;
      let outcomeError = status === "done" ? undefined : response.outcome.reason;
      if (status === "done" && requiresDelivery && response.delivery.state !== "delivered") {
        status = ["unknown", "sending"].includes(response.delivery.state)
          ? "unknown"
          : "incomplete";
        outcomeReason = "required_delivery";
        outcomeError = `Required delivery was not confirmed (${response.delivery.state})`;
      }
      const finished = taskStore.finishTask(
        taskId,
        claimed.runId,
        claimed.revision,
        status,
        response.content,
        outcomeError,
        { turnId: response.turnId, outcomeReason }
      );
      if (!finished) return; // A stale run may never overwrite an operator decision.

      if (["failed", "partial", "unknown"].includes(response.delivery.state)) {
        taskStore.recordNotificationError(
          taskId,
          response.delivery.reason ?? `Delivery ${response.delivery.state}`
        );
      }
      try {
        if (
          !requiresDelivery &&
          response.delivery.state === "not_requested" &&
          response.content &&
          response.content.trim().length > 0
        ) {
          await this.bridge.sendMessage({
            chatId: message.chatId,
            text: response.content,
            replyToId: message.id,
          });
        }
      } catch (error) {
        taskStore.recordNotificationError(taskId, getErrorMessage(error));
        log.error({ err: error, taskId }, "Task result notification failed");
      }

      if (finished.status === "done") {
        if (!this.dependencyResolver)
          this.dependencyResolver = new TaskDependencyResolver(taskStore, this.bridge, this.config);
        await this.dependencyResolver.onTaskComplete(taskId);
      }
    } catch (error) {
      log.error({ err: error }, "Error handling scheduled task");

      if (claimed?.runId) {
        try {
          taskStore.finishTask(
            taskId,
            claimed.runId,
            claimed.revision,
            error instanceof TurnBudgetError ? "incomplete" : invoked ? "unknown" : "failed",
            undefined,
            getErrorMessage(error),
            error instanceof TurnBudgetError ? { outcomeReason: error.reason } : undefined
          );
        } catch (innerError) {
          log.debug({ error: getErrorMessage(innerError) }, "Failed to update task status");
        }
      }
    }
  }
}
