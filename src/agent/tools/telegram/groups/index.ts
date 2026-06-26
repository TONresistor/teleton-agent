import { telegramGetMeTool, telegramGetMeExecutor } from "./get-me.js";
import {
  telegramGetParticipantsTool,
  telegramGetParticipantsExecutor,
} from "./get-participants.js";
import {
  telegramKickUserTool,
  telegramKickUserExecutor,
  telegramBanUserTool,
  telegramBanUserExecutor,
  telegramUnbanUserTool,
  telegramUnbanUserExecutor,
} from "./moderation.js";
import { telegramCreateGroupTool, telegramCreateGroupExecutor } from "./create-group.js";
import { telegramSetChatPhotoTool, telegramSetChatPhotoExecutor } from "./set-chat-photo.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramGetMeTool,
    executor: telegramGetMeExecutor,
    mode: "both",
    tags: ["social"],
  },
  {
    tool: telegramGetParticipantsTool,
    executor: telegramGetParticipantsExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramKickUserTool,
    executor: telegramKickUserExecutor,
    scope: "group-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramBanUserTool,
    executor: telegramBanUserExecutor,
    scope: "group-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramUnbanUserTool,
    executor: telegramUnbanUserExecutor,
    scope: "group-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramCreateGroupTool,
    executor: telegramCreateGroupExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramSetChatPhotoTool,
    executor: telegramSetChatPhotoExecutor,
    scope: "group-only",
    mode: "user",
    tags: ["admin"],
  },
];
