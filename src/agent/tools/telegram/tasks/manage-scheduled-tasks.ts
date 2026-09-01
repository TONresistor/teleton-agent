import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface ListScheduledTasksParams {
  status?: "pending" | "in_progress" | "done" | "failed" | "cancelled";
  limit?: number;
}

interface CancelScheduledTaskParams {
  taskId: string;
}

function formatDue(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  return isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

export const telegramListScheduledTasksTool: Tool = {
  name: "telegram_list_scheduled_tasks",
  description:
    "List scheduled tasks (reminders and timed actions) stored by telegram_create_scheduled_task. Optionally filter by status. Use before cancelling to find task IDs.",
  category: "data-bearing",
  parameters: Type.Object({
    status: Type.Optional(
      Type.Union(
        [
          Type.Literal("pending"),
          Type.Literal("in_progress"),
          Type.Literal("done"),
          Type.Literal("failed"),
          Type.Literal("cancelled"),
        ],
        { description: "Filter tasks by status (default: all)" }
      )
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Max tasks to return (default 20, max 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

export const telegramListScheduledTasksExecutor: ToolExecutor<ListScheduledTasksParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    if (!context.db) {
      return { success: false, error: "Database not available" };
    }
    const { getTaskStore } = await import("../../../../memory/agent/tasks.js");
    const taskStore = getTaskStore(context.db);
    const tasks = taskStore.listTasks(params.status ? { status: params.status } : undefined);
    const limit = params.limit ?? 20;
    const limited = tasks.slice(0, limit);

    if (limited.length === 0) {
      return { success: true, data: { tasks: [], message: "No scheduled tasks found." } };
    }

    return {
      success: true,
      data: {
        tasks: limited.map((task) => ({
          id: task.id,
          description: task.description,
          status: task.status,
          scheduledFor: task.scheduledFor?.toISOString(),
          scheduledForLocal: formatDue(task.scheduledFor?.toISOString()),
          repeatEverySeconds: task.repeatEveryMs
            ? Math.floor(task.repeatEveryMs / 1000)
            : undefined,
        })),
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error listing scheduled tasks");
    return { success: false, error: getErrorMessage(error) };
  }
};

export const telegramCancelScheduledTaskTool: Tool = {
  name: "telegram_cancel_scheduled_task",
  description:
    "Cancel a scheduled task (reminder or timed action) by its task ID so it will not execute. Get IDs from telegram_list_scheduled_tasks.",
  category: "action",
  parameters: Type.Object({
    taskId: Type.String({
      description: "ID of the scheduled task to cancel (from telegram_list_scheduled_tasks)",
    }),
  }),
};

export const telegramCancelScheduledTaskExecutor: ToolExecutor<CancelScheduledTaskParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    if (!context.db) {
      return { success: false, error: "Database not available" };
    }
    const { getTaskStore } = await import("../../../../memory/agent/tasks.js");
    const taskStore = getTaskStore(context.db);
    const task = taskStore.cancelTask(params.taskId);
    if (!task) {
      return {
        success: false,
        error: `Task ${params.taskId} not found or already cancelled`,
      };
    }
    return {
      success: true,
      data: {
        taskId: task.id,
        description: task.description,
        message: `Task cancelled: "${task.description}"`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error cancelling scheduled task");
    return { success: false, error: getErrorMessage(error) };
  }
};
