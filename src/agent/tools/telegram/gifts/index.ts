import {
  telegramGetAvailableGiftsTool,
  telegramGetAvailableGiftsExecutor,
} from "./get-available-gifts.js";
import { telegramSendGiftTool, telegramSendGiftExecutor } from "./send-gift.js";
import { telegramGetMyGiftsTool, telegramGetMyGiftsExecutor } from "./get-my-gifts.js";
import {
  telegramTransferCollectibleTool,
  telegramTransferCollectibleExecutor,
} from "./transfer-collectible.js";
import {
  telegramSetCollectiblePriceTool,
  telegramSetCollectiblePriceExecutor,
} from "./set-collectible-price.js";
import { telegramGetResaleGiftsTool, telegramGetResaleGiftsExecutor } from "./get-resale-gifts.js";
import { telegramBuyResaleGiftTool, telegramBuyResaleGiftExecutor } from "./buy-resale-gift.js";
import { telegramSetGiftStatusTool, telegramSetGiftStatusExecutor } from "./set-gift-status.js";
import {
  telegramGetCollectibleInfoTool,
  telegramGetCollectibleInfoExecutor,
} from "./get-collectible-info.js";
import type { ToolEntry } from "../../types.js";

export { telegramGetAvailableGiftsTool, telegramGetAvailableGiftsExecutor };
export { telegramSendGiftTool, telegramSendGiftExecutor };
export { telegramGetMyGiftsTool, telegramGetMyGiftsExecutor };
export { telegramTransferCollectibleTool, telegramTransferCollectibleExecutor };
export { telegramSetCollectiblePriceTool, telegramSetCollectiblePriceExecutor };
export { telegramGetResaleGiftsTool, telegramGetResaleGiftsExecutor };
export { telegramBuyResaleGiftTool, telegramBuyResaleGiftExecutor };
export { telegramSetGiftStatusTool, telegramSetGiftStatusExecutor };
export { telegramGetCollectibleInfoTool, telegramGetCollectibleInfoExecutor };

export const tools: ToolEntry[] = [
  { tool: telegramGetAvailableGiftsTool, executor: telegramGetAvailableGiftsExecutor },
  { tool: telegramSendGiftTool, executor: telegramSendGiftExecutor, scope: "dm-only" },
  { tool: telegramGetMyGiftsTool, executor: telegramGetMyGiftsExecutor },
  {
    tool: telegramTransferCollectibleTool,
    executor: telegramTransferCollectibleExecutor,
    scope: "dm-only",
  },
  {
    tool: telegramSetCollectiblePriceTool,
    executor: telegramSetCollectiblePriceExecutor,
    scope: "dm-only",
  },
  { tool: telegramGetResaleGiftsTool, executor: telegramGetResaleGiftsExecutor },
  { tool: telegramBuyResaleGiftTool, executor: telegramBuyResaleGiftExecutor, scope: "dm-only" },
  { tool: telegramSetGiftStatusTool, executor: telegramSetGiftStatusExecutor, scope: "dm-only" },
  { tool: telegramGetCollectibleInfoTool, executor: telegramGetCollectibleInfoExecutor },
];
