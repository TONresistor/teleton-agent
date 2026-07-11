import { telegramGetDialogsTool, telegramGetDialogsExecutor } from "./get-dialogs.js";
import { telegramGetHistoryTool, telegramGetHistoryExecutor } from "./get-history.js";
import { telegramGetChatInfoTool, telegramGetChatInfoExecutor } from "./get-chat-info.js";
import { telegramMarkAsReadTool, telegramMarkAsReadExecutor } from "./mark-as-read.js";
import { telegramJoinChannelTool, telegramJoinChannelExecutor } from "./join-channel.js";
import { telegramLeaveChannelTool, telegramLeaveChannelExecutor } from "./leave-channel.js";
import { telegramCreateChannelTool, telegramCreateChannelExecutor } from "./create-channel.js";
import {
  telegramEditChannelInfoTool,
  telegramEditChannelInfoExecutor,
} from "./edit-channel-info.js";
import {
  telegramInviteToChannelTool,
  telegramInviteToChannelExecutor,
} from "./invite-to-channel.js";
import {
  telegramGetAdminedChannelsTool,
  telegramGetAdminedChannelsExecutor,
} from "./get-admined-channels.js";
import {
  telegramCheckChannelUsernameTool,
  telegramCheckChannelUsernameExecutor,
} from "./check-channel-username.js";
import {
  telegramSetChannelUsernameTool,
  telegramSetChannelUsernameExecutor,
} from "./set-channel-username.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramGetDialogsTool,
    executor: telegramGetDialogsExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramGetHistoryTool,
    executor: telegramGetHistoryExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramGetChatInfoTool,
    executor: telegramGetChatInfoExecutor,
    mode: "both",
    tags: ["social"],
  },
  {
    tool: telegramMarkAsReadTool,
    executor: telegramMarkAsReadExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramJoinChannelTool,
    executor: telegramJoinChannelExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramLeaveChannelTool,
    executor: telegramLeaveChannelExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramCreateChannelTool,
    executor: telegramCreateChannelExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramEditChannelInfoTool,
    executor: telegramEditChannelInfoExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramInviteToChannelTool,
    executor: telegramInviteToChannelExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramGetAdminedChannelsTool,
    executor: telegramGetAdminedChannelsExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramCheckChannelUsernameTool,
    executor: telegramCheckChannelUsernameExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramSetChannelUsernameTool,
    executor: telegramSetChannelUsernameExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["admin"],
  },
];
