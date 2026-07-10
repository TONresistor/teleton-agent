import type { TaskStore } from "../memory/agent/tasks.js";
import type { ITelegramBridge } from "./bridge-interface.js";
import type { Config } from "../config/schema.js";
import { BATCH_TRIGGER_DELAY_MS } from "../constants/timeouts.js";
import { MAX_DEPENDENTS_PER_TASK } from "../constants/limits.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");

/**
 * Resolves task dependencies and triggers dependent tasks when parents complete
 *
 * When a task completes:
 * 1. Find all tasks that depend on it
 * 2. Check if all their dependencies are satisfied
 * 3. If yes, trigger them by sending a [TASK:uuid] message to Saved Messages
 *
 * Security: Limited to MAX_DEPENDENTS_PER_TASK to prevent DoS attacks
 */
export class TaskDependencyResolver {
  constructor(
    private taskStore: TaskStore,
    private bridge: ITelegramBridge,
    private config?: Config
  ) {}

  /**
   * Called when a task completes successfully
   * Triggers any dependent tasks that are now ready to execute
   *
   * Security: Processes at most MAX_DEPENDENTS_PER_TASK dependents
   * to prevent DoS via mass dependency chains
   */
  async onTaskComplete(completedTaskId: string): Promise<void> {
    try {
      // Find all tasks that depend on this one
      const allDependentIds = this.taskStore.getDependents(completedTaskId);

      if (allDependentIds.length === 0) {
        return; // No dependents
      }

      // Security: Limit number of dependents processed
      const dependentIds = allDependentIds.slice(0, MAX_DEPENDENTS_PER_TASK);
      const truncated = allDependentIds.length > MAX_DEPENDENTS_PER_TASK;

      if (truncated) {
        log.warn(
          `⚠️ Task ${completedTaskId} has ${allDependentIds.length} dependents, ` +
            `only processing first ${MAX_DEPENDENTS_PER_TASK} (security limit)`
        );
      }

      log.info(
        `📊 Task ${completedTaskId} completed. Checking ${dependentIds.length} dependent task(s)...`
      );

      // Collect tasks ready to trigger
      const tasksToTrigger: string[] = [];

      // For each dependent, check if all dependencies are satisfied
      for (const depId of dependentIds) {
        const task = this.taskStore.getTask(depId);

        if (!task) {
          log.warn(`Dependent task ${depId} not found`);
          continue;
        }

        // Skip if already started/completed
        if (task.status !== "pending") {
          continue;
        }

        // Check if all dependencies are satisfied
        if (!this.taskStore.canExecute(depId)) {
          log.info(`⏳ Task ${depId} still waiting for dependencies`);
          continue;
        }

        tasksToTrigger.push(task.id);
      }

      // Trigger tasks with delay between each to avoid rate limits
      for (let i = 0; i < tasksToTrigger.length; i++) {
        if (i > 0) {
          await this.delay(BATCH_TRIGGER_DELAY_MS);
        }
        await this.triggerTask(tasksToTrigger[i]);
      }
    } catch (error) {
      log.error({ err: error }, "Error in dependency resolver");
    }
  }

  /**
   * Utility: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Called when a task fails
   * Cancels all dependent tasks (unless they have skipOnParentFailure flag)
   *
   * Security: Processes at most MAX_DEPENDENTS_PER_TASK dependents
   * Cancellation is less risky than triggering but still limited for consistency
   */
  async onTaskFail(failedTaskId: string): Promise<void> {
    try {
      const allDependentIds = this.taskStore.getDependents(failedTaskId);

      if (allDependentIds.length === 0) {
        return;
      }

      // Security: Limit cascade depth
      const dependentIds = allDependentIds.slice(0, MAX_DEPENDENTS_PER_TASK);
      const truncated = allDependentIds.length > MAX_DEPENDENTS_PER_TASK;

      if (truncated) {
        log.warn(
          `⚠️ Task ${failedTaskId} has ${allDependentIds.length} dependents, ` +
            `only cancelling first ${MAX_DEPENDENTS_PER_TASK} (security limit)`
        );
      }

      log.info(
        `❌ Task ${failedTaskId} failed. Cancelling ${dependentIds.length} dependent task(s)...`
      );

      for (const depId of dependentIds) {
        const task = this.taskStore.getTask(depId);

        if (!task || task.status !== "pending") {
          continue;
        }

        // Check if task should skip on parent failure
        let skipOnFailure = true;
        if (task.payload) {
          try {
            const payload = JSON.parse(task.payload);
            skipOnFailure = payload.skipOnParentFailure !== false; // Default true
          } catch {
            // Invalid JSON, use default
          }
        }

        if (skipOnFailure) {
          this.taskStore.cancelTask(depId);
          log.info({ taskId: depId }, "Cancelled dependent task");

          // Recursively cancel dependents
          await this.onTaskFail(depId);
        }
      }
    } catch (error) {
      log.error({ err: error }, "Error handling task failure cascade");
    }
  }

  /**
   * Trigger a task by sending [TASK:uuid] message to Saved Messages
   */
  private async triggerTask(taskId: string): Promise<void> {
    try {
      const task = this.taskStore.getTask(taskId);
      if (!task) {
        log.warn(`Cannot trigger task ${taskId}: not found`);
        return;
      }

      log.info({ taskId }, "Triggering dependent task");

      if (this.bridge.getMode() === "bot") {
        // Bot mode: send to first admin via bridge
        const adminId = this.config?.telegram?.admin_ids?.[0];
        if (adminId) {
          await this.bridge.sendMessage({
            chatId: String(adminId),
            text: `[TASK:${taskId}] ${task.description}`,
          });
          log.info(`↳ Sent [TASK:${taskId}] to admin ${adminId}`);
        } else {
          log.warn(`↳ Cannot trigger [TASK:${taskId}]: no admin_id configured in bot mode`);
        }
      } else {
        // User mode: send to Saved Messages (the agent's own chat)
        const ownId = this.bridge.getOwnUserId();
        if (ownId) {
          await this.bridge.sendMessage({
            chatId: String(ownId),
            text: `[TASK:${taskId}] ${task.description}`,
          });
          log.info(`↳ Sent [TASK:${taskId}] to Saved Messages`);
        } else {
          log.warn(`↳ Cannot trigger [TASK:${taskId}]: own user id unavailable`);
        }
      }
    } catch (error) {
      log.error({ err: error }, `Error triggering task ${taskId}`);

      // Mark task as failed if we can't trigger it
      this.taskStore.failTask(taskId, `Failed to trigger: ${error}`);
    }
  }
}
