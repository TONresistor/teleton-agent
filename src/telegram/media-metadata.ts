import { open, type FileHandle } from "node:fs/promises";
import mediaInfoFactory, {
  isTrackType,
  type AudioTrack,
  type GeneralTrack,
  type MediaInfo,
  type VideoTrack,
} from "mediainfo.js";
import type { RichMessageMediaType } from "./bridge-interface.js";

export interface RichDocumentMetadata {
  duration: number;
  width?: number;
  height?: number;
}

function requirePositiveNumber(value: number | undefined, field: string, filePath: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Cannot read a valid ${field} from media file "${filePath}"`);
  }
  return value;
}

/**
 * Read the metadata Telegram needs to render an uploaded Rich Message document.
 * GramJS only infers the MIME type from the filename and otherwise emits 0s/1x1
 * placeholder attributes, which Telegram accepts but clients cannot play.
 */
export async function readRichDocumentMetadata(
  filePath: string,
  type: Exclude<RichMessageMediaType, "photo">
): Promise<RichDocumentMetadata> {
  let fileHandle: FileHandle | undefined;
  let mediaInfo: MediaInfo<"object"> | undefined;

  try {
    const openedFile = await open(filePath, "r");
    fileHandle = openedFile;
    const fileSize = (await openedFile.stat()).size;
    mediaInfo = await mediaInfoFactory({ format: "object" });
    const result = await mediaInfo.analyzeData(fileSize, async (size, offset) => {
      const buffer = new Uint8Array(size);
      const { bytesRead } = await openedFile.read(buffer, 0, size, offset);
      return bytesRead === size ? buffer : buffer.subarray(0, bytesRead);
    });

    const generalTrack = result.media?.track.find((track): track is GeneralTrack =>
      isTrackType(track, "General")
    );
    if (type === "audio") {
      const audioTrack = result.media?.track.find((track): track is AudioTrack =>
        isTrackType(track, "Audio")
      );
      if (!audioTrack) {
        throw new Error(`Media file "${filePath}" does not contain an audio track`);
      }
      return {
        duration: requirePositiveNumber(
          audioTrack.Duration ?? generalTrack?.Duration,
          "audio duration",
          filePath
        ),
      };
    }

    const videoTrack = result.media?.track.find((track): track is VideoTrack =>
      isTrackType(track, "Video")
    );
    if (!videoTrack) {
      throw new Error(`Media file "${filePath}" does not contain a video track`);
    }

    let width = requirePositiveNumber(videoTrack.Width, "video width", filePath);
    let height = requirePositiveNumber(videoTrack.Height, "video height", filePath);
    const rotation = Number.parseFloat(videoTrack.Rotation ?? "0");
    const normalizedRotation = Number.isFinite(rotation) ? ((rotation % 360) + 360) % 360 : 0;
    if (normalizedRotation >= 45 && normalizedRotation < 135) {
      [width, height] = [height, width];
    } else if (normalizedRotation >= 225 && normalizedRotation < 315) {
      [width, height] = [height, width];
    }

    return {
      duration: requirePositiveNumber(
        generalTrack?.Duration ?? videoTrack.Duration,
        "video duration",
        filePath
      ),
      width: Math.round(width),
      height: Math.round(height),
    };
  } finally {
    await fileHandle?.close();
    mediaInfo?.close();
  }
}
