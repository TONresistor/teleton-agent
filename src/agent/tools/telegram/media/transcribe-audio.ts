import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface TranscribeAudioParams {
  chatId: string;
  messageId: number;
}

export const telegramTranscribeAudioTool: Tool = {
  name: "telegram_transcribe_audio",
  description:
    "Transcribe a voice or audio message to text using Telegram's native transcription. Requires the message to be a voice/audio type. May require Telegram Premium.",
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

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_RETRIES = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const telegramTranscribeAudioExecutor: ToolExecutor<TranscribeAudioParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageId } = params;

    const gramJsClient = context.bridge.getClient().getClient();
    const entity = await gramJsClient.getEntity(chatId);

    let result = await gramJsClient.invoke(
      new Api.messages.TranscribeAudio({
        peer: entity,
        msgId: messageId,
      })
    );

    // Poll if transcription is still pending
    let retries = 0;
    while (result.pending && retries < MAX_POLL_RETRIES) {
      retries++;
      log.debug(`⏳ Transcription pending, polling (${retries}/${MAX_POLL_RETRIES})...`);
      await sleep(POLL_INTERVAL_MS);

      try {
        result = await gramJsClient.invoke(
          new Api.messages.TranscribeAudio({
            peer: entity,
            msgId: messageId,
          })
        );
      } catch (pollError: any) {
        // On transient errors (FLOOD_WAIT, network), keep polling
        log.warn(
          `⚠️ Transcription poll ${retries} failed: ${pollError.errorMessage || pollError.message}`
        );
        continue;
      }
    }

    if (result.pending) {
      log.warn(`Transcription still pending after ${MAX_POLL_RETRIES} retries`);
      return {
        success: true,
        data: {
          transcriptionId: result.transcriptionId?.toString(),
          text: result.text || null,
          pending: true,
          message: "Transcription is still processing. Try again later.",
        },
      };
    }

    log.info(`🎤 transcribe_audio: msg ${messageId} → "${result.text?.substring(0, 50)}..."`);

    return {
      success: true,
      data: {
        transcriptionId: result.transcriptionId?.toString(),
        text: result.text,
        pending: false,
        ...(result.trialRemainsNum !== undefined && {
          trialRemainsNum: result.trialRemainsNum,
          trialRemainsUntilDate: result.trialRemainsUntilDate,
        }),
      },
    };
  } catch (error: any) {
    // Handle specific Telegram errors
    if (error.errorMessage === "PREMIUM_ACCOUNT_REQUIRED") {
      return {
        success: false,
        error: "Telegram Premium is required to transcribe audio messages.",
      };
    }
    if (error.errorMessage === "MSG_ID_INVALID") {
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
