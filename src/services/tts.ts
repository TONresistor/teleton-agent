/**
 * TTS Service - Text-to-Speech generation
 *
 * Providers:
 * - piper: Offline neural TTS with custom voices (default - Trump voice)
 * - edge: Free Microsoft Edge TTS (fallback)
 * - openai: OpenAI TTS API
 * - elevenlabs: ElevenLabs API
 */

import { spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { TELETON_ROOT } from "../workspace/paths.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { TTS_TIMEOUT_MS } from "../constants/timeouts.js";
import { OPENAI_TTS_URL, ELEVENLABS_TTS_URL } from "../constants/api-endpoints.js";

export type TTSProvider = "piper" | "edge" | "openai" | "elevenlabs";

// Piper voices directory and venv
const PIPER_VOICES_DIR = join(TELETON_ROOT, "piper-voices");
const PIPER_VENV = join(TELETON_ROOT, "rvc-env");

// Available Piper voices
export const PIPER_VOICES: Record<string, string> = {
  trump: "en_US-trump-high.onnx", // Trump voice (default) ⭐
  "en-us": "en_US-trump-high.onnx", // Alias
  lessac: "en_US-lessac-medium.onnx", // Standard US male
  "ru-ru": "ru_RU-dmitri-medium.onnx", // Russian male
  dmitri: "ru_RU-dmitri-medium.onnx", // Alias
};

export interface TTSOptions {
  text: string;
  provider?: TTSProvider;
  voice?: string;
  rate?: string; // e.g., "+10%", "-20%"
  pitch?: string; // e.g., "+5Hz", "-10Hz"
}

export interface TTSResult {
  filePath: string;
  duration?: number;
  provider: TTSProvider;
  voice: string;
}

// Default voices per provider
const DEFAULT_VOICES: Record<TTSProvider, string> = {
  piper: "trump", // Trump voice - agent default ⭐
  edge: "en-US-BrianNeural", // Casual, sincere - fallback
  openai: "onyx", // Deep male voice
  elevenlabs: "21m00Tcm4TlvDq8ikWAM", // Rachel
};

// Popular Edge TTS voices
export const EDGE_VOICES: Record<string, string> = {
  // English US
  "en-us-male": "en-US-BrianNeural", // Casual, sincere ⭐
  "en-us-female": "en-US-AvaNeural", // Expressive, friendly
  brian: "en-US-BrianNeural",
  ava: "en-US-AvaNeural",
  andrew: "en-US-AndrewNeural", // Warm, confident
  emma: "en-US-EmmaNeural", // Cheerful
  guy: "en-US-GuyNeural", // Passion
  // English UK
  "en-gb-male": "en-GB-RyanNeural",
  "en-gb-female": "en-GB-SoniaNeural",
  ryan: "en-GB-RyanNeural",
  sonia: "en-GB-SoniaNeural",
  // English AU
  "en-au-male": "en-AU-WilliamMultilingualNeural",
  "en-au-female": "en-AU-NatashaNeural",
  // French
  "fr-fr-male": "fr-FR-HenriNeural",
  "fr-fr-female": "fr-FR-VivienneMultilingualNeural",
  henri: "fr-FR-HenriNeural",
  vivienne: "fr-FR-VivienneMultilingualNeural",
  // Russian
  "ru-ru-male": "ru-RU-DmitryNeural",
  "ru-ru-female": "ru-RU-SvetlanaNeural",
  dmitry: "ru-RU-DmitryNeural",
  svetlana: "ru-RU-SvetlanaNeural",
  // German
  "de-de-male": "de-DE-ConradNeural",
  "de-de-female": "de-DE-KatjaNeural",
  // Spanish
  "es-es-male": "es-ES-AlvaroNeural",
  "es-es-female": "es-ES-ElviraNeural",
  // Chinese
  "zh-cn-male": "zh-CN-YunxiNeural",
  "zh-cn-female": "zh-CN-XiaoxiaoNeural",
  // Italian
  "it-it-male": "it-IT-DiegoNeural",
  "it-it-female": "it-IT-ElsaNeural",
  // Portuguese
  "pt-br-male": "pt-BR-AntonioNeural",
  "pt-br-female": "pt-BR-FranciscaNeural",
  // Japanese
  "ja-jp-male": "ja-JP-KeitaNeural",
  "ja-jp-female": "ja-JP-NanamiNeural",
  // Korean
  "ko-kr-male": "ko-KR-InJoonNeural",
  "ko-kr-female": "ko-KR-SunHiNeural",
};

/**
 * Generate speech from text
 */
export async function generateSpeech(options: TTSOptions): Promise<TTSResult> {
  const provider = options.provider ?? "piper";
  const voice = options.voice ?? DEFAULT_VOICES[provider];

  switch (provider) {
    case "piper":
      return generatePiperTTS(options.text, voice);
    case "edge":
      return generateEdgeTTS(options.text, voice, options.rate, options.pitch);
    case "openai":
      return generateOpenAITTS(options.text, voice);
    case "elevenlabs":
      return generateElevenLabsTTS(options.text, voice);
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

/**
 * Generate TTS using Piper (offline neural TTS)
 * Uses custom voices from ~/.teleton/piper-voices/
 * Converts WAV to OGG/Opus for Telegram voice messages
 */
async function generatePiperTTS(text: string, voice: string): Promise<TTSResult> {
  const tempDir = join(tmpdir(), "tonnet-tts");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const id = randomUUID();
  const wavPath = join(tempDir, `${id}.wav`);
  const oggPath = join(tempDir, `${id}.ogg`);

  // Resolve voice shorthand to model file
  const modelFile = PIPER_VOICES[voice.toLowerCase()] ?? voice;
  const modelPath = modelFile.includes("/") ? modelFile : join(PIPER_VOICES_DIR, modelFile);

  if (!existsSync(modelPath)) {
    throw new Error(
      `Piper voice not found: ${modelPath}. Available: ${Object.keys(PIPER_VOICES).join(", ")}`
    );
  }

  // Run piper from the Python venv
  const piperBin = join(PIPER_VENV, "bin", "piper");

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      piperBin,
      [
        "--model",
        modelPath,
        "--output_file",
        wavPath,
        "--sentence_silence",
        "0.5", // 500ms pause between sentences
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Send text via stdin
    proc.stdin?.write(text);
    proc.stdin?.end();

    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && existsSync(wavPath)) {
        resolve();
      } else {
        reject(new Error(`Piper TTS failed (code ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Piper spawn error: ${err.message}. Is Piper installed in ${PIPER_VENV}?`));
    });
  });

  // Convert WAV to OGG/Opus for Telegram voice messages
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", [
        "-y",
        "-i",
        wavPath,
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        "-application",
        "voip",
        oggPath,
      ]);

      let stderr = "";
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg failed (code ${code}): ${stderr}`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });
    });

    // Cleanup WAV
    unlinkSync(wavPath);
  } catch (err) {
    // If ffmpeg fails, fallback to WAV
    return {
      filePath: wavPath,
      provider: "piper",
      voice: modelFile,
    };
  }

  return {
    filePath: oggPath,
    provider: "piper",
    voice: modelFile,
  };
}

/**
 * Generate TTS using Microsoft Edge TTS (free)
 */
async function generateEdgeTTS(
  text: string,
  voice: string,
  rate?: string,
  pitch?: string
): Promise<TTSResult> {
  const tempDir = join(tmpdir(), "tonnet-tts");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const outputPath = join(tempDir, `${randomUUID()}.mp3`);

  // Build edge-tts command
  const args = ["--text", text, "--voice", voice, "--write-media", outputPath];

  if (rate) {
    args.push("--rate", rate);
  }
  if (pitch) {
    args.push("--pitch", pitch);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("edge-tts", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({
          filePath: outputPath,
          provider: "edge",
          voice,
        });
      } else {
        reject(new Error(`edge-tts failed: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`edge-tts spawn error: ${err.message}`));
    });
  });
}

/**
 * Generate TTS using OpenAI API
 */
async function generateOpenAITTS(text: string, voice: string): Promise<TTSResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set. Use Edge TTS (free) or set API key.");
  }

  const tempDir = join(tmpdir(), "tonnet-tts");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const outputPath = join(tempDir, `${randomUUID()}.mp3`);

  const response = await fetchWithTimeout(OPENAI_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice: voice, // alloy, echo, fable, onyx, nova, shimmer
      response_format: "mp3",
    }),
    timeoutMs: TTS_TIMEOUT_MS,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI TTS error: ${error}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);

  return {
    filePath: outputPath,
    provider: "openai",
    voice,
  };
}

/**
 * Generate TTS using ElevenLabs API
 */
async function generateElevenLabsTTS(text: string, voiceId: string): Promise<TTSResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY not set. Use Edge TTS (free) or set API key.");
  }

  const tempDir = join(tmpdir(), "tonnet-tts");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const outputPath = join(tempDir, `${randomUUID()}.mp3`);

  const response = await fetchWithTimeout(`${ELEVENLABS_TTS_URL}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_monolingual_v1",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
    timeoutMs: TTS_TIMEOUT_MS,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs TTS error: ${error}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);

  return {
    filePath: outputPath,
    provider: "elevenlabs",
    voice: voiceId,
  };
}

/**
 * List available Edge TTS voices (runs edge-tts --list-voices)
 */
export async function listEdgeVoices(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("edge-tts", ["--list-voices"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        // Parse voice names from output
        const voices = stdout
          .split("\n")
          .filter((line) => line.startsWith("Name:"))
          .map((line) => line.replace("Name: ", "").trim());
        resolve(voices);
      } else {
        reject(new Error("Failed to list voices"));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}
