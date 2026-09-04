import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fetchWithTimeout } from "../utils/fetch.js";

const execFileAsync = promisify(execFile);

export interface AudioPreviewAnalysis {
  durationSeconds: number;
  meanVolumeDb?: number;
  maxVolumeDb?: number;
  sampleRateHz?: number;
  channels?: number;
  source: "spotify_preview" | "telegram_audio";
}

function numberAfter(output: string, label: string): number | undefined {
  const match = output.match(new RegExp(`${label}\\s*:\\s*(-?[0-9.]+)`));
  return match ? Number(match[1]) : undefined;
}

export async function analyzePreview(previewUrl: string): Promise<AudioPreviewAnalysis> {
  const response = await fetchWithTimeout(previewUrl);
  if (!response.ok) throw new Error(`Spotify preview download error: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return analyzeAudioBuffer(bytes, "spotify_preview");
}

export async function analyzeAudioBuffer(
  bytes: Buffer,
  source: AudioPreviewAnalysis["source"] = "spotify_preview"
): Promise<AudioPreviewAnalysis> {
  const dir = await mkdtemp(join(tmpdir(), "teleton-spotify-"));
  const input = join(dir, "preview.mp3");
  try {
    await writeFile(input, bytes);
    const { stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-i",
        input,
        "-af",
        "volumedetect",
        "-f",
        "null",
        process.platform === "win32" ? "NUL" : "/dev/null",
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    const durationMatch = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const durationSeconds = durationMatch
      ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      : 30;
    return {
      durationSeconds,
      meanVolumeDb: numberAfter(stderr, "mean_volume"),
      maxVolumeDb: numberAfter(stderr, "max_volume"),
      source,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
