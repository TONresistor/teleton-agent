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

export { telegramSendPhotoTool, telegramSendPhotoExecutor };
export { telegramSendVoiceTool, telegramSendVoiceExecutor };
export { telegramSendStickerTool, telegramSendStickerExecutor };
export { telegramSendGifTool, telegramSendGifExecutor };
export { telegramDownloadMediaTool, telegramDownloadMediaExecutor };
export { visionAnalyzeTool, visionAnalyzeExecutor };
export { telegramTranscribeAudioTool, telegramTranscribeAudioExecutor };

export const tools: ToolEntry[] = [
  { tool: telegramSendPhotoTool, executor: telegramSendPhotoExecutor },
  { tool: telegramSendVoiceTool, executor: telegramSendVoiceExecutor },
  { tool: telegramSendStickerTool, executor: telegramSendStickerExecutor },
  { tool: telegramSendGifTool, executor: telegramSendGifExecutor },
  { tool: telegramDownloadMediaTool, executor: telegramDownloadMediaExecutor },
  { tool: visionAnalyzeTool, executor: visionAnalyzeExecutor },
  { tool: telegramTranscribeAudioTool, executor: telegramTranscribeAudioExecutor },
];
