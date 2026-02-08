/**
 * Media utilities for Telegram
 * Handles downloading and encoding media for Claude vision
 */

import type { TelegramClient, Api } from "telegram";

export interface EncodedMedia {
  base64: string;
  mimeType: string;
  size: number;
}

// Maximum image size for Claude API (5MB)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

// Supported image MIME types for Claude
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/**
 * Download media from a Telegram message and encode it as base64
 * Returns null if media is not a supported image type or too large
 */
export async function downloadAndEncodeMedia(
  client: TelegramClient,
  message: Api.Message
): Promise<EncodedMedia | null> {
  try {
    // Determine MIME type
    let mimeType = "image/jpeg"; // Default for photos

    if (message.photo) {
      mimeType = "image/jpeg";
    } else if (message.document) {
      const doc = message.document as Api.Document;
      mimeType = doc.mimeType || "application/octet-stream";

      // Check if it's a supported image type
      if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
        console.log(`📷 Skipping unsupported media type: ${mimeType}`);
        return null;
      }

      // Check file size
      const size = Number(doc.size);
      if (size > MAX_IMAGE_SIZE) {
        console.log(`📷 Skipping large file: ${(size / 1024 / 1024).toFixed(2)}MB > 5MB limit`);
        return null;
      }
    } else if (message.video || message.audio || message.voice || message.sticker) {
      // Video, audio, voice, sticker - not supported for vision
      console.log(`📷 Skipping non-image media type`);
      return null;
    } else {
      return null;
    }

    // Download the media
    const buffer = await client.downloadMedia(message, {});

    if (!buffer) {
      console.log(`📷 Failed to download media`);
      return null;
    }

    // Convert to Buffer if needed
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    // Check size after download
    if (data.length > MAX_IMAGE_SIZE) {
      console.log(`📷 Downloaded file too large: ${(data.length / 1024 / 1024).toFixed(2)}MB`);
      return null;
    }

    // Encode as base64
    const base64 = data.toString("base64");

    console.log(`📷 Encoded ${mimeType} image: ${(data.length / 1024).toFixed(1)}KB`);

    return {
      base64,
      mimeType,
      size: data.length,
    };
  } catch (error) {
    console.error(`📷 Error downloading media:`, error);
    return null;
  }
}

/**
 * Check if a media type is a supported image for Claude vision
 */
export function isSupportedImageType(mediaType: string | undefined): boolean {
  if (!mediaType) return false;
  return mediaType === "photo" || mediaType === "document";
  // Documents need further MIME type checking during download
}
