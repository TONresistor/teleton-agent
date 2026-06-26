import { memoryWriteTool, memoryWriteExecutor } from "./memory-write.js";
import { memoryReadTool, memoryReadExecutor } from "./memory-read.js";
import { memorySearchTool, memorySearchExecutor } from "./memory-search.js";
import { sessionSearchTool, sessionSearchExecutor } from "./session-search.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: memoryWriteTool,
    executor: memoryWriteExecutor,
    scope: "dm-only",
    mode: "both",
    tags: ["core"],
  },
  { tool: memoryReadTool, executor: memoryReadExecutor, mode: "both", tags: ["core"] },
  {
    tool: memorySearchTool,
    executor: memorySearchExecutor,
    scope: "dm-only",
    mode: "both",
    tags: ["core"],
  },
  {
    tool: sessionSearchTool,
    executor: sessionSearchExecutor,
    scope: "dm-only",
    mode: "both",
    tags: ["core"],
  },
];
