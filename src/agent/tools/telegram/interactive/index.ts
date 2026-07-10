import { telegramCreatePollTool, telegramCreatePollExecutor } from "./create-poll.js";
import { telegramCreateQuizTool, telegramCreateQuizExecutor } from "./create-quiz.js";
import { telegramReplyKeyboardTool, telegramReplyKeyboardExecutor } from "./reply-keyboard.js";
import { telegramReactTool, telegramReactExecutor } from "./react.js";
import { telegramSendDiceTool, telegramSendDiceExecutor } from "./send-dice.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramCreatePollTool,
    executor: telegramCreatePollExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramCreateQuizTool,
    executor: telegramCreateQuizExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramReplyKeyboardTool,
    executor: telegramReplyKeyboardExecutor,
    mode: "user",
    tags: ["social"],
  },
  {
    tool: telegramReactTool,
    executor: telegramReactExecutor,
    mode: "both",
    tags: ["social"],
  },
  {
    tool: telegramSendDiceTool,
    executor: telegramSendDiceExecutor,
    mode: "both",
    tags: ["media"],
  },
];
