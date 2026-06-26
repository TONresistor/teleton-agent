import {
  telegramGetAvailableGiftsTool,
  telegramGetAvailableGiftsExecutor,
} from "./get-available-gifts.js";
import { telegramGetMyGiftsTool, telegramGetMyGiftsExecutor } from "./get-my-gifts.js";
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
import { getUserGiftsEntry } from "./get-user-gifts.js";
import { getAvailableGiftsBotEntry } from "./get-available-gifts-bot.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramGetAvailableGiftsTool,
    executor: telegramGetAvailableGiftsExecutor,
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramGetMyGiftsTool,
    executor: telegramGetMyGiftsExecutor,
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramSetCollectiblePriceTool,
    executor: telegramSetCollectiblePriceExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramGetResaleGiftsTool,
    executor: telegramGetResaleGiftsExecutor,
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramBuyResaleGiftTool,
    executor: telegramBuyResaleGiftExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramSetGiftStatusTool,
    executor: telegramSetGiftStatusExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramGetCollectibleInfoTool,
    executor: telegramGetCollectibleInfoExecutor,
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramGetUniqueGiftTool,
    executor: telegramGetUniqueGiftExecutor,
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramGetUniqueGiftValueTool,
    executor: telegramGetUniqueGiftValueExecutor,
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramSendGiftOfferTool,
    executor: telegramSendGiftOfferExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: telegramResolveGiftOfferTool,
    executor: telegramResolveGiftOfferExecutor,
    scope: "dm-only",
    mode: "user",
    tags: ["finance"],
  },
  getUserGiftsEntry,
  getAvailableGiftsBotEntry,
];
