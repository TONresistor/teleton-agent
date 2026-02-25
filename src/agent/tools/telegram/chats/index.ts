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

export { telegramGetDialogsTool, telegramGetDialogsExecutor };
export { telegramGetHistoryTool, telegramGetHistoryExecutor };
export { telegramGetChatInfoTool, telegramGetChatInfoExecutor };
export { telegramMarkAsReadTool, telegramMarkAsReadExecutor };
export { telegramJoinChannelTool, telegramJoinChannelExecutor };
export { telegramLeaveChannelTool, telegramLeaveChannelExecutor };
export { telegramCreateChannelTool, telegramCreateChannelExecutor };
export { telegramEditChannelInfoTool, telegramEditChannelInfoExecutor };
export { telegramInviteToChannelTool, telegramInviteToChannelExecutor };
export { telegramGetAdminedChannelsTool, telegramGetAdminedChannelsExecutor };
export { telegramCheckChannelUsernameTool, telegramCheckChannelUsernameExecutor };
export { telegramSetChannelUsernameTool, telegramSetChannelUsernameExecutor };

export const tools: ToolEntry[] = [
  { tool: telegramGetDialogsTool, executor: telegramGetDialogsExecutor },
  { tool: telegramGetHistoryTool, executor: telegramGetHistoryExecutor },
  { tool: telegramGetChatInfoTool, executor: telegramGetChatInfoExecutor },
  { tool: telegramMarkAsReadTool, executor: telegramMarkAsReadExecutor },
  { tool: telegramJoinChannelTool, executor: telegramJoinChannelExecutor, scope: "dm-only" },
  { tool: telegramLeaveChannelTool, executor: telegramLeaveChannelExecutor, scope: "dm-only" },
  { tool: telegramCreateChannelTool, executor: telegramCreateChannelExecutor, scope: "dm-only" },
  {
    tool: telegramEditChannelInfoTool,
    executor: telegramEditChannelInfoExecutor,
    scope: "dm-only",
  },
  {
    tool: telegramInviteToChannelTool,
    executor: telegramInviteToChannelExecutor,
    scope: "dm-only",
  },
  {
    tool: telegramGetAdminedChannelsTool,
    executor: telegramGetAdminedChannelsExecutor,
    scope: "dm-only",
  },
  {
    tool: telegramCheckChannelUsernameTool,
    executor: telegramCheckChannelUsernameExecutor,
    scope: "dm-only",
  },
  {
    tool: telegramSetChannelUsernameTool,
    executor: telegramSetChannelUsernameExecutor,
    scope: "dm-only",
  },
];
