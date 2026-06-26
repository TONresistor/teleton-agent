import { telegramGetFoldersTool, telegramGetFoldersExecutor } from "./get-folders.js";
import { telegramCreateFolderTool, telegramCreateFolderExecutor } from "./create-folder.js";
import {
  telegramAddChatToFolderTool,
  telegramAddChatToFolderExecutor,
} from "./add-chat-to-folder.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramGetFoldersTool,
    executor: telegramGetFoldersExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramCreateFolderTool,
    executor: telegramCreateFolderExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramAddChatToFolderTool,
    executor: telegramAddChatToFolderExecutor,
    mode: "user",
    tags: ["social"],
  },
];
