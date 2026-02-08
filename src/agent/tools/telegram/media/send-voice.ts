/**
 * telegram_send_voice - Send voice messages with optional TTS
 *
 * Two modes:
 * 1. voicePath: Send existing audio file
 * 2. text: Generate speech using TTS, then send
 */

import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import { unlinkSync } from "fs";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import {
  generateSpeech,
  EDGE_VOICES,
  PIPER_VOICES,
  type TTSProvider,
} from "../../../../services/tts.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";

interface SendVoiceParams {
  chatId: string;
  voicePath?: string;
  text?: string;
  voice?: string;
  ttsProvider?: TTSProvider;
  rate?: string;
  duration?: number;
  waveform?: number[];
  caption?: string;
  replyToId?: number;
}

export const telegramSendVoiceTool: Tool = {
  name: "telegram_send_voice",
  description: `Send a voice message to a Telegram chat.

**Two modes:**
1. **File mode**: Provide \`voicePath\` to send an existing audio file
2. **TTS mode**: Provide \`text\` to generate speech and send as voice note

**TTS Providers:**
- \`piper\` (default): Offline neural TTS with Trump voice
- \`edge\`: Free Microsoft Edge TTS - cloud, many voices
- \`openai\`: OpenAI TTS API (requires OPENAI_API_KEY)
- \`elevenlabs\`: ElevenLabs API (requires ELEVENLABS_API_KEY)

**Piper voices (default):**
- \`trump\`: Trump voice (default, en-US)
- \`dmitri\` / \`ru-ru\`: Russian male

**Edge voices (fallback):**
- English: en-us-male, en-us-female, en-gb-male
- Russian: ru-ru-male, ru-ru-female

**Examples:**
- Default Trump voice: text="This is tremendous, believe me!"
- Russian: text="Привет!", voice="dmitri", ttsProvider="piper"
- Edge fallback: text="Hello!", ttsProvider="edge"`,

  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the voice message to",
    }),
    voicePath: Type.Optional(
      Type.String({
        description: "Local file path to voice/audio file (OGG, MP3). Use this OR text.",
      })
    ),
    text: Type.Optional(
      Type.String({
        description: "Text to convert to speech using TTS. Use this OR voicePath.",
      })
    ),
    voice: Type.Optional(
      Type.String({
        description: "TTS voice (e.g., 'en-us-male', 'fr-fr-female', or full voice name)",
      })
    ),
    ttsProvider: Type.Optional(
      Type.String({
        description:
          "TTS provider: 'piper' (default, Trump voice), 'edge', 'openai', or 'elevenlabs'",
        enum: ["piper", "edge", "openai", "elevenlabs"],
      })
    ),
    rate: Type.Optional(
      Type.String({
        description: "Speech rate adjustment (e.g., '+20%' faster, '-10%' slower). Edge TTS only.",
      })
    ),
    duration: Type.Optional(
      Type.Number({
        description: "Duration in seconds (optional, auto-detected)",
      })
    ),
    waveform: Type.Optional(
      Type.Array(Type.Number(), {
        description: "Voice waveform visualization data (optional)",
      })
    ),
    caption: Type.Optional(
      Type.String({
        description: "Optional caption/text to accompany the voice message",
      })
    ),
    replyToId: Type.Optional(
      Type.Number({
        description: "Optional message ID to reply to",
      })
    ),
  }),
};

export const telegramSendVoiceExecutor: ToolExecutor<SendVoiceParams> = async (
  params,
  context
): Promise<ToolResult> => {
  let generatedFile: string | null = null;

  try {
    const {
      chatId,
      voicePath,
      text,
      voice,
      ttsProvider,
      rate,
      duration,
      waveform,
      caption,
      replyToId,
    } = params;

    // Validate: need either voicePath or text
    if (!voicePath && !text) {
      return {
        success: false,
        error: "Must provide either 'voicePath' (audio file) or 'text' (for TTS)",
      };
    }

    let audioPath = voicePath;
    let usedVoice = voice;
    let usedProvider = ttsProvider;

    // Validate voicePath if provided (before TTS)
    if (voicePath) {
      try {
        const validatedPath = validateReadPath(voicePath);
        audioPath = validatedPath.absolutePath;
      } catch (error) {
        if (error instanceof WorkspaceSecurityError) {
          return {
            success: false,
            error: `Security Error: ${error.message}. Voice files must be in your workspace (downloads/ or uploads/).`,
          };
        }
        throw error;
      }
    }

    // TTS mode: generate speech from text
    if (text && !voicePath) {
      // Resolve voice shorthand based on provider
      let resolvedVoice = voice;
      const provider = ttsProvider ?? "piper";

      if (voice) {
        // Check Piper voices first (if using piper or no provider specified)
        if (provider === "piper" && voice.toLowerCase() in PIPER_VOICES) {
          resolvedVoice = voice.toLowerCase();
        }
        // Then check Edge voices
        else if (voice in EDGE_VOICES) {
          resolvedVoice = EDGE_VOICES[voice as keyof typeof EDGE_VOICES];
        }
      }

      const ttsResult = await generateSpeech({
        text,
        provider: ttsProvider,
        voice: resolvedVoice,
        rate,
      });

      audioPath = ttsResult.filePath;
      generatedFile = audioPath; // Mark for cleanup
      usedVoice = ttsResult.voice;
      usedProvider = ttsResult.provider;
    }

    if (!audioPath) {
      return {
        success: false,
        error: "No audio file available",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Send voice message using GramJS sendFile with voice attributes
    const attrs: any = {
      voice: true,
    };
    if (duration !== undefined) attrs.duration = duration;
    if (waveform) attrs.waveform = Buffer.from(waveform);

    const result = await gramJsClient.sendFile(chatId, {
      file: audioPath,
      caption: caption,
      replyTo: replyToId,
      attributes: [new Api.DocumentAttributeAudio(attrs)],
    });

    // Build response
    const responseData: any = {
      messageId: result.id,
      date: result.date,
    };

    if (text) {
      responseData.tts = true;
      responseData.provider = usedProvider;
      responseData.voice = usedVoice;
      responseData.textLength = text.length;
      responseData.message = `🎙️ Voice message sent (TTS: ${usedProvider})`;
    } else {
      responseData.message = `🎙️ Voice message sent`;
    }

    return {
      success: true,
      data: responseData,
    };
  } catch (error) {
    console.error("Error sending voice message:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Cleanup generated TTS file
    if (generatedFile) {
      try {
        unlinkSync(generatedFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
};
