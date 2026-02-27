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
import { telegramGetUniqueGiftTool, telegramGetUniqueGiftExecutor } from "./get-unique-gift.js";
import {
  telegramGetUniqueGiftValueTool,
  telegramGetUniqueGiftValueExecutor,
} from "./get-unique-gift-value.js";
import { telegramSendGiftOfferTool, telegramSendGiftOfferExecutor } from "./send-gift-offer.js";
import {
  telegramResolveGiftOfferTool,
  telegramResolveGiftOfferExecutor,
} from "./resolve-gift-offer.js";
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
export { telegramGetUniqueGiftTool, telegramGetUniqueGiftExecutor };
export { telegramGetUniqueGiftValueTool, telegramGetUniqueGiftValueExecutor };
export { telegramSendGiftOfferTool, telegramSendGiftOfferExecutor };
export { telegramResolveGiftOfferTool, telegramResolveGiftOfferExecutor };

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
  { tool: telegramGetUniqueGiftTool, executor: telegramGetUniqueGiftExecutor },
  { tool: telegramGetUniqueGiftValueTool, executor: telegramGetUniqueGiftValueExecutor },
  { tool: telegramSendGiftOfferTool, executor: telegramSendGiftOfferExecutor, scope: "dm-only" },
  {
    tool: telegramResolveGiftOfferTool,
    executor: telegramResolveGiftOfferExecutor,
    scope: "dm-only",
  },
];
