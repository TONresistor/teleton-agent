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
import type { ToolEntry } from "../../types.js";

export { telegramSendMessageTool, telegramSendMessageExecutor };
export { telegramEditMessageTool, telegramEditMessageExecutor };
export { telegramDeleteMessageTool, telegramDeleteMessageExecutor };
export { telegramForwardMessageTool, telegramForwardMessageExecutor };
export { telegramScheduleMessageTool, telegramScheduleMessageExecutor };
export { telegramSearchMessagesTool, telegramSearchMessagesExecutor };
export {
  telegramPinMessageTool,
  telegramPinMessageExecutor,
  telegramUnpinMessageTool,
  telegramUnpinMessageExecutor,
};
export { telegramQuoteReplyTool, telegramQuoteReplyExecutor };
export { telegramGetRepliesTool, telegramGetRepliesExecutor };
export { telegramGetScheduledMessagesTool, telegramGetScheduledMessagesExecutor };
export { telegramDeleteScheduledMessageTool, telegramDeleteScheduledMessageExecutor };
export { telegramSendScheduledNowTool, telegramSendScheduledNowExecutor };

export const tools: ToolEntry[] = [
  { tool: telegramSendMessageTool, executor: telegramSendMessageExecutor },
  { tool: telegramQuoteReplyTool, executor: telegramQuoteReplyExecutor },
  { tool: telegramGetRepliesTool, executor: telegramGetRepliesExecutor },
  { tool: telegramEditMessageTool, executor: telegramEditMessageExecutor },
  { tool: telegramScheduleMessageTool, executor: telegramScheduleMessageExecutor },
  { tool: telegramGetScheduledMessagesTool, executor: telegramGetScheduledMessagesExecutor },
  { tool: telegramDeleteScheduledMessageTool, executor: telegramDeleteScheduledMessageExecutor },
  { tool: telegramSendScheduledNowTool, executor: telegramSendScheduledNowExecutor },
  { tool: telegramSearchMessagesTool, executor: telegramSearchMessagesExecutor },
  { tool: telegramPinMessageTool, executor: telegramPinMessageExecutor },
  { tool: telegramUnpinMessageTool, executor: telegramUnpinMessageExecutor },
  { tool: telegramForwardMessageTool, executor: telegramForwardMessageExecutor },
  { tool: telegramDeleteMessageTool, executor: telegramDeleteMessageExecutor },
];
