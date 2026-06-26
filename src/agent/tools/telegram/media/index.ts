import { telegramSendPhotoTool, telegramSendPhotoExecutor } from "./send-photo.js";
import { telegramSendVoiceTool, telegramSendVoiceExecutor } from "./send-voice.js";
import { telegramSendStickerTool, telegramSendStickerExecutor } from "./send-sticker.js";
import { telegramSendGifTool, telegramSendGifExecutor } from "./send-gif.js";
import { telegramDownloadMediaTool, telegramDownloadMediaExecutor } from "./download-media.js";
import { visionAnalyzeTool, visionAnalyzeExecutor } from "./vision-analyze.js";
import {
  telegramTranscribeAudioTool,
  telegramTranscribeAudioExecutor,
} from "./transcribe-audio.js";
import type { ToolEntry } from "../../types.js";

export const tools: ToolEntry[] = [
  {
    tool: telegramSendPhotoTool,
    executor: telegramSendPhotoExecutor,
    mode: "both",
    tags: ["media"],
  },
  {
    tool: telegramSendVoiceTool,
    executor: telegramSendVoiceExecutor,
    mode: "user",
    tags: ["media"],
  },
  {
    tool: telegramSendStickerTool,
    executor: telegramSendStickerExecutor,
    mode: "user",
    tags: ["media"],
  },
  {
    tool: telegramSendGifTool,
    executor: telegramSendGifExecutor,
    mode: "user",
    tags: ["media"],
  },
  {
    tool: telegramDownloadMediaTool,
    executor: telegramDownloadMediaExecutor,
    mode: "user",
    tags: ["media"],
  },
  {
    tool: visionAnalyzeTool,
    executor: visionAnalyzeExecutor,
    mode: "user",
    tags: ["media"],
  },
  {
    tool: telegramTranscribeAudioTool,
    executor: telegramTranscribeAudioExecutor,
    mode: "user",
    tags: ["media"],
  },
];
