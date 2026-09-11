import {
  telegramCreateScheduledTaskTool,
  telegramCreateScheduledTaskExecutor,
} from "./create-scheduled-task.js";
import {
  telegramListScheduledTasksTool,
  telegramListScheduledTasksExecutor,
  telegramCancelScheduledTaskTool,
  telegramCancelScheduledTaskExecutor,
} from "./manage-scheduled-tasks.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramCreateScheduledTaskTool,
    executor: telegramCreateScheduledTaskExecutor,
    mode: "user",
    tags: ["core", "automation"],
  },
  {
    tool: telegramListScheduledTasksTool,
    executor: telegramListScheduledTasksExecutor,
    mode: "user",
    tags: ["core", "automation"],
  },
  {
    tool: telegramCancelScheduledTaskTool,
    executor: telegramCancelScheduledTaskExecutor,
    mode: "user",
    tags: ["automation"],
  },
];
