import { tools as reads } from "./reads.js";
import { telegramWalletSendTool, telegramWalletSendExecutor } from "./send-transfer.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  ...reads,
  {
    tool: telegramWalletSendTool,
    executor: telegramWalletSendExecutor,
    scope: "admin-only",
    mode: "user",
    tags: ["finance"],
  },
];
