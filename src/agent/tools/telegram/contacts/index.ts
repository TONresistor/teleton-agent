import { telegramBlockUserTool, telegramBlockUserExecutor } from "./block-user.js";
import { telegramGetBlockedTool, telegramGetBlockedExecutor } from "./get-blocked.js";
import { telegramGetCommonChatsTool, telegramGetCommonChatsExecutor } from "./get-common-chats.js";
import { telegramGetUserInfoTool, telegramGetUserInfoExecutor } from "./get-user-info.js";
import { telegramCheckUsernameTool, telegramCheckUsernameExecutor } from "./check-username.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramBlockUserTool,
    executor: telegramBlockUserExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramGetBlockedTool,
    executor: telegramGetBlockedExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramGetCommonChatsTool,
    executor: telegramGetCommonChatsExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramGetUserInfoTool,
    executor: telegramGetUserInfoExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramCheckUsernameTool,
    executor: telegramCheckUsernameExecutor,
    mode: "user",
    tags: ["social"],
  },
];
