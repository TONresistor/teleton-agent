import { telegramSendStoryTool, telegramSendStoryExecutor } from "./send-story.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramSendStoryTool,
    executor: telegramSendStoryExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["social"],
  },
];
