// src/workspace/paths.ts

import { join } from "path";
import { homedir } from "os";

/**
 * Root directory for Teleton (agent CANNOT access this directly)
 * Configurable via TELETON_HOME env var (default: ~/.teleton)
 */
export const TELETON_ROOT = process.env.TELETON_HOME || join(homedir(), ".teleton");

/**
 * Workspace directory - ONLY location agent can access
 */
export const WORKSPACE_ROOT = join(TELETON_ROOT, "workspace");

/**
 * Workspace subdirectories
 */
export const WORKSPACE_PATHS = {
  // Root files
  SOUL: join(WORKSPACE_ROOT, "SOUL.md"),
  MEMORY: join(WORKSPACE_ROOT, "MEMORY.md"),
  BOOTSTRAP: join(WORKSPACE_ROOT, "BOOTSTRAP.md"),
  IDENTITY: join(WORKSPACE_ROOT, "IDENTITY.md"),
  USER: join(WORKSPACE_ROOT, "USER.md"),
  STRATEGY: join(WORKSPACE_ROOT, "STRATEGY.md"),
  SECURITY: join(WORKSPACE_ROOT, "SECURITY.md"),

  // Directories
  MEMORY_DIR: join(WORKSPACE_ROOT, "memory"),
  DOWNLOADS_DIR: join(WORKSPACE_ROOT, "downloads"),
  UPLOADS_DIR: join(WORKSPACE_ROOT, "uploads"),
  TEMP_DIR: join(WORKSPACE_ROOT, "temp"),
  MEMES_DIR: join(WORKSPACE_ROOT, "memes"),
  PLUGINS_DIR: join(TELETON_ROOT, "plugins"),
} as const;

/**
 * Allowed file extensions for different operations
 */
export const ALLOWED_EXTENSIONS = {
  // Images
  images: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"],
  // Audio
  audio: [".mp3", ".ogg", ".wav", ".m4a", ".opus"],
  // Video
  video: [".mp4", ".mov", ".avi", ".webm", ".mkv"],
  // Documents
  documents: [".md", ".txt", ".json", ".csv", ".pdf", ".yaml", ".yml"],
  // Code (for workspace files)
  code: [".ts", ".js", ".py", ".sh", ".sql"],
  // Stickers
  stickers: [".webp", ".tgs"],
  // All media
  media: [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".bmp",
    ".mp3",
    ".ogg",
    ".wav",
    ".m4a",
    ".opus",
    ".mp4",
    ".mov",
    ".avi",
    ".webm",
    ".mkv",
  ],
} as const;

/**
 * Maximum file sizes (in bytes)
 */
export const MAX_FILE_SIZES = {
  image: 10 * 1024 * 1024, // 10 MB
  audio: 50 * 1024 * 1024, // 50 MB
  video: 100 * 1024 * 1024, // 100 MB
  document: 50 * 1024 * 1024, // 50 MB
  total_workspace: 500 * 1024 * 1024, // 500 MB total
} as const;
