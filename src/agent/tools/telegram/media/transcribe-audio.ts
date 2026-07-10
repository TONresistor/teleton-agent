import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { transcribeAudio } from "../../../../sdk/telegram-utils.js";

const log = createLogger("Tools");

interface TranscribeAudioParams {
  chatId: string;
  messageId: number;
}

export const telegramTranscribeAudioTool: Tool = {
  name: "telegram_transcribe_audio",
  description:
    "Transcribe a voice or audio message to text using native server-side speech recognition. Target message must be a voice or audio type. May require Telegram Premium. Polls automatically until transcription completes.",
  category: "data-bearing",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the voice/audio message is",
    }),
    messageId: Type.Number({
      description: "The message ID of the voice/audio message to transcribe",
    }),
  }),
};

export const telegramTranscribeAudioExecutor: ToolExecutor<TranscribeAudioParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const result = await transcribeAudio(context.bridge, params.chatId, params.messageId);

    if (result.pending) {
      log.warn(`Transcription still pending after polling`);
      return {
        success: true,
        data: {
          transcriptionId: result.transcriptionId,
          text: result.text,
          pending: true,
          message: "Transcription is still processing. Try again later.",
        },
      };
    }

    log.info(
      { messageId: params.messageId, transcriptLength: result.text?.length ?? 0 },
      "Audio message transcribed"
    );

    return { success: true, data: result };
  } catch (error: unknown) {
    // Handle specific Telegram errors
    const errMsg = getErrorMessage(error);
    if (errMsg.includes("PREMIUM_ACCOUNT_REQUIRED")) {
      return {
        success: false,
        error: "Telegram Premium is required to transcribe audio messages.",
      };
    }
    if (errMsg.includes("MSG_ID_INVALID")) {
      return {
        success: false,
        error: "Invalid message ID — the message may not exist or is not a voice/audio message.",
      };
    }

    log.error({ err: error }, "Error transcribing audio");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
