import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getClient } from "../../../../sdk/telegram-utils.js";
import { getErrorMessage } from "../../../../utils/errors.js";

const execFileAsync = promisify(execFile);
const MAX_DURATION_SECONDS = 45;
const AUDIO_MODEL = "openai/gpt-audio-mini";

interface AnalyzeMusicParams {
  chatId: string;
  messageId: number;
}

export const telegramAnalyzeMusicTool: Tool = {
  name: "telegram_analyze_music",
  description:
    "Analyze a user-supplied Telegram music/audio message with OpenRouter's audio model. Downloads the message and sends only its first 45 seconds as MP3 to the external model. Use only when the user explicitly asks to assess the song's sound, mood, genre, or quality.",
  category: "data-bearing",
  parameters: Type.Object({
    chatId: Type.String({ description: "Chat containing the music message" }),
    messageId: Type.Number({ description: "Telegram message ID containing the audio" }),
  }),
};

export const telegramAnalyzeMusicExecutor: ToolExecutor<AnalyzeMusicParams> = async (
  { chatId, messageId },
  context
): Promise<ToolResult> => {
  const config = context.config;
  if (!config || config.agent.provider !== "openrouter" || !config.agent.api_key) {
    return { success: false, error: "Music AI analysis requires an OpenRouter API key." };
  }
  const apiKey = config.agent.api_key;

  const client = getClient(context.bridge);
  const messages = await client.getMessages(chatId, { ids: [messageId] });
  const message = messages[0];
  if (!message?.media) {
    return { success: false, error: "Message does not contain downloadable audio." };
  }

  const buffer = await client.downloadMedia(message, {});
  if (!buffer) return { success: false, error: "Telegram returned an empty audio file." };

  const dir = await mkdtemp(join(tmpdir(), "teleton-audio-analysis-"));
  const input = join(dir, "source");
  const clip = join(dir, "clip.mp3");
  try {
    await writeFile(input, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        input,
        "-t",
        String(MAX_DURATION_SECONDS),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "24000",
        "-b:a",
        "64k",
        clip,
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    const audio = await readFile(clip);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AUDIO_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: { data: audio.toString("base64"), format: "mp3" },
              },
              {
                type: "text",
                text: "Analyze this music excerpt. Describe genre, mood, tempo/energy, vocals, production and notable musical traits. Then give a tentative 1-10 personal rating with brief reasons. Be honest that this is based on at most 45 seconds, not the complete track.",
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok)
      return { success: false, error: `OpenRouter audio analysis failed: ${response.status}` };
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const analysis = data.choices?.[0]?.message?.content;
    if (!analysis) return { success: false, error: "Audio model returned no analysis." };
    return {
      success: true,
      data: { analysis, model: AUDIO_MODEL, clipDurationSeconds: MAX_DURATION_SECONDS },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
