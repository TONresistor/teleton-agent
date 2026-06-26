import { telegramSearchStickersTool, telegramSearchStickersExecutor } from "./search-stickers.js";
import { telegramSearchGifsTool, telegramSearchGifsExecutor } from "./search-gifs.js";
import { telegramGetMyStickersTool, telegramGetMyStickersExecutor } from "./get-my-stickers.js";
import { telegramAddStickerSetTool, telegramAddStickerSetExecutor } from "./add-sticker-set.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramSearchStickersTool,
    executor: telegramSearchStickersExecutor,
    mode: "user",
    tags: ["media"],
  },
  {
    tool: telegramSearchGifsTool,
    executor: telegramSearchGifsExecutor,
    mode: "user",
    tags: ["media"],
  },
  {
    tool: telegramGetMyStickersTool,
    executor: telegramGetMyStickersExecutor,
    mode: "user",
    tags: ["media"],
  },
  {
    tool: telegramAddStickerSetTool,
    executor: telegramAddStickerSetExecutor,
    mode: "user",
    tags: ["media"],
  },
];
