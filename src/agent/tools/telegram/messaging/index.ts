import { telegramSendMessageTool, telegramSendMessageExecutor } from "./send-message.js";
import { telegramEditMessageTool, telegramEditMessageExecutor } from "./edit-message.js";
import { telegramDeleteMessageTool, telegramDeleteMessageExecutor } from "./delete-message.js";
import { telegramForwardMessageTool, telegramForwardMessageExecutor } from "./forward-message.js";
import {
  telegramScheduleMessageTool,
  telegramScheduleMessageExecutor,
} from "./schedule-message.js";
import { telegramSearchMessagesTool, telegramSearchMessagesExecutor } from "./search-messages.js";
import {
  telegramPinMessageTool,
  telegramPinMessageExecutor,
  telegramUnpinMessageTool,
  telegramUnpinMessageExecutor,
} from "./pin.js";
import { telegramQuoteReplyTool, telegramQuoteReplyExecutor } from "./quote-reply.js";
import { telegramGetRepliesTool, telegramGetRepliesExecutor } from "./get-replies.js";
import {
  telegramGetScheduledMessagesTool,
  telegramGetScheduledMessagesExecutor,
} from "./get-scheduled-messages.js";
import {
  telegramDeleteScheduledMessageTool,
  telegramDeleteScheduledMessageExecutor,
} from "./delete-scheduled-message.js";
import {
  telegramSendScheduledNowTool,
  telegramSendScheduledNowExecutor,
} from "./send-scheduled-now.js";
import { botInlineSendTool, botInlineSendExecutor } from "./inline-send.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramSendMessageTool,
    executor: telegramSendMessageExecutor,
    mode: "both",
    tags: ["social"],
  },
  {
    tool: telegramQuoteReplyTool,
    executor: telegramQuoteReplyExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramGetRepliesTool,
    executor: telegramGetRepliesExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramEditMessageTool,
    executor: telegramEditMessageExecutor,
    mode: "both",
    tags: ["social"],
  },
  {
    tool: telegramScheduleMessageTool,
    executor: telegramScheduleMessageExecutor,
    mode: "user",
    tags: ["automation"],
  },
  {
    tool: telegramGetScheduledMessagesTool,
    executor: telegramGetScheduledMessagesExecutor,
    mode: "user",
    tags: ["automation"],
  },
  {
    tool: telegramDeleteScheduledMessageTool,
    executor: telegramDeleteScheduledMessageExecutor,
    mode: "user",
    tags: ["automation"],
  },
  {
    tool: telegramSendScheduledNowTool,
    executor: telegramSendScheduledNowExecutor,
    mode: "user",
    tags: ["automation"],
  },
  {
    tool: telegramSearchMessagesTool,
    executor: telegramSearchMessagesExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramPinMessageTool,
    executor: telegramPinMessageExecutor,
    mode: "both",
    tags: ["admin"],
  },
  {
    tool: telegramUnpinMessageTool,
    executor: telegramUnpinMessageExecutor,
    mode: "user",
    tags: ["admin"],
  },
  {
    tool: telegramForwardMessageTool,
    executor: telegramForwardMessageExecutor,
    mode: "both",
    tags: ["social"],
  },
  {
    tool: telegramDeleteMessageTool,
    executor: telegramDeleteMessageExecutor,
    mode: "both",
    tags: ["admin"],
  },
  {
    tool: botInlineSendTool,
    executor: botInlineSendExecutor,
    scope: "always",
    mode: "user",
    tags: ["bot"],
  },
];
