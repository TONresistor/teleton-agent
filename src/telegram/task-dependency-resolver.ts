import type { TaskStore } from "../memory/agent/tasks.js";
import type { TelegramBridge } from "./bridge.js";
import { BATCH_TRIGGER_DELAY_MS } from "../constants/timeouts.js";

/**
 * Maximum number of dependent tasks allowed per parent task.
 * Prevents DoS via mass dependencies that would trigger
 * excessive Telegram messages simultaneously.
 */
const MAX_DEPENDENTS_PER_TASK = 10;

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
    private bridge: TelegramBridge
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
        console.warn(
          `⚠️ Task ${completedTaskId} has ${allDependentIds.length} dependents, ` +
            `only processing first ${MAX_DEPENDENTS_PER_TASK} (security limit)`
        );
      }

      console.log(
        `📊 Task ${completedTaskId} completed. Checking ${dependentIds.length} dependent task(s)...`
      );

      // Collect tasks ready to trigger
      const tasksToTrigger: string[] = [];

      // For each dependent, check if all dependencies are satisfied
      for (const depId of dependentIds) {
        const task = this.taskStore.getTask(depId);

        if (!task) {
          console.warn(`Dependent task ${depId} not found`);
          continue;
        }

        // Skip if already started/completed
        if (task.status !== "pending") {
          continue;
        }

        // Check if all dependencies are satisfied
        if (!this.taskStore.canExecute(depId)) {
          console.log(`⏳ Task ${depId} still waiting for dependencies`);
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
      console.error("Error in dependency resolver:", error);
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
        console.warn(
          `⚠️ Task ${failedTaskId} has ${allDependentIds.length} dependents, ` +
            `only cancelling first ${MAX_DEPENDENTS_PER_TASK} (security limit)`
        );
      }

      console.log(
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
          } catch (e) {
            // Invalid JSON, use default
          }
        }

        if (skipOnFailure) {
          this.taskStore.cancelTask(depId);
          console.log(`  ↳ Cancelled task ${depId}: ${task.description}`);

          // Recursively cancel dependents
          await this.onTaskFail(depId);
        }
      }
    } catch (error) {
      console.error("Error handling task failure cascade:", error);
    }
  }

  /**
   * Trigger a task by sending [TASK:uuid] message to Saved Messages
   */
  private async triggerTask(taskId: string): Promise<void> {
    try {
      const task = this.taskStore.getTask(taskId);
      if (!task) {
        console.warn(`Cannot trigger task ${taskId}: not found`);
        return;
      }

      console.log(`🚀 Triggering dependent task: ${task.description}`);

      // Get "me" entity for Saved Messages
      const gramJsClient = this.bridge.getClient().getClient();
      const me = await gramJsClient.getMe();

      // Send task message immediately (no scheduling)
      await gramJsClient.sendMessage(me, {
        message: `[TASK:${taskId}] ${task.description}`,
      });

      console.log(`  ↳ Sent [TASK:${taskId}] to Saved Messages`);
    } catch (error) {
      console.error(`Error triggering task ${taskId}:`, error);

      // Mark task as failed if we can't trigger it
      this.taskStore.failTask(taskId, `Failed to trigger: ${error}`);
    }
  }
}
