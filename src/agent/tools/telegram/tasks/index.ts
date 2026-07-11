import {
  telegramCreateScheduledTaskTool,
  telegramCreateScheduledTaskExecutor,
} from "./create-scheduled-task.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramCreateScheduledTaskTool,
    executor: telegramCreateScheduledTaskExecutor,
    mode: "user",
    tags: ["automation"],
  },
];
