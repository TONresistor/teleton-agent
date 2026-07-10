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

  async execute(message: TelegramMessage): Promise<void> {
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
      if (task.status === "cancelled" || task.status === "done" || task.status === "failed") {
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
        taskStore.failTask(taskId, reason);
        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: `⚠️ Task "${task.description}" was blocked: missing creator authority. Recreate the task.`,
          replyToId: message.id,
        });
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
      taskStore.startTask(taskId);

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
      };

      // Get tool registry from agent runtime
      const toolRegistry = this.agent.getToolRegistry();
      if (!toolRegistry) {
        log.warn(`Skipping scheduled task ${task.id}: tool registry not available`);
        return;
      }

      // Execute task and get prompt for agent (with parent context)
      const agentPrompt = await executeScheduledTask(
        task,
        this.agent,
        toolContext,
        toolRegistry,
        parentResults
      );

      // Feed prompt to agent (agent loop with full context)
      const response = await this.agent.processMessage({
        chatId: task.originChatId,
        userMessage: agentPrompt,
        userName: "self-scheduled-task",
        timestamp: message.timestamp.getTime(),
        isGroup: task.originIsGroup,
        toolContext,
        messageId: message.id,
      });

      // Send agent response
      if (response.content && response.content.trim().length > 0) {
        await this.bridge.sendMessage({
          chatId: message.chatId,
          text: response.content,
          replyToId: message.id,
        });
      }

      // Mark task as done if agent responded successfully
      taskStore.completeTask(taskId, response.content);

      log.info({ taskId }, "Executed scheduled task");

      // Initialize dependency resolver if needed
      if (!this.dependencyResolver) {
        this.dependencyResolver = new TaskDependencyResolver(taskStore, this.bridge, this.config);
      }

      // Trigger any dependent tasks
      await this.dependencyResolver.onTaskComplete(taskId);
    } catch (error) {
      log.error({ err: error }, "Error handling scheduled task");

      // Try to mark task as failed and cascade to dependents
      try {
        taskStore.failTask(taskId, getErrorMessage(error));

        // Initialize resolver if needed
        if (!this.dependencyResolver) {
          this.dependencyResolver = new TaskDependencyResolver(taskStore, this.bridge, this.config);
        }

        // Cascade failure to dependents
        await this.dependencyResolver.onTaskFail(taskId);
      } catch (innerError) {
        log.debug({ error: getErrorMessage(innerError) }, "Failed to update task status");
      }
    }
  }
}
