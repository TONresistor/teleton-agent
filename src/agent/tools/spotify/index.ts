import { Type } from "@sinclair/typebox";
import type { ToolEntry, ToolExecutor } from "../types.js";
import type { ToolResult } from "../types.js";
import { getErrorMessage } from "../../../utils/errors.js";
import {
  getCurrentlyPlaying,
  getRecentlyPlayed,
  getTrack,
  searchTracks,
} from "../../../spotify/client.js";
import { analyzePreview } from "../../../spotify/preview-analysis.js";

interface SearchParams {
  query: string;
  limit?: number;
}
interface TrackParams {
  trackId: string;
}
interface RateParams {
  trackId: string;
  rating: number;
  note?: string;
}
interface AnalyzeParams {
  trackId: string;
}

const searchTool = {
  name: "spotify_search_tracks",
  description: "Search Spotify tracks and return metadata and an optional 30-second preview URL.",
  parameters: Type.Object({
    query: Type.String({ description: "Track, artist, album, or mood to search for." }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  }),
};

const getTool = {
  name: "spotify_get_track",
  description: "Get Spotify metadata and an optional preview URL for a track ID.",
  parameters: Type.Object({ trackId: Type.String() }),
};

const rateTool = {
  name: "spotify_rate_track",
  description: "Save a personal 1-10 rating and optional note for a Spotify track.",
  parameters: Type.Object({
    trackId: Type.String(),
    rating: Type.Integer({ minimum: 1, maximum: 10 }),
    note: Type.Optional(Type.String({ maxLength: 500 })),
  }),
};

const getRatingTool = {
  name: "spotify_get_rating",
  description: "Read the saved personal rating for a Spotify track.",
  parameters: Type.Object({ trackId: Type.String() }),
};

const analyzeTool = {
  name: "spotify_analyze_preview",
  description:
    "Download and analyze a Spotify 30-second preview with ffmpeg. Use the returned audio profile to form an honest personal impression, then save it with spotify_rate_track. This is audio-signal analysis, not full-track listening.",
  parameters: Type.Object({ trackId: Type.String() }),
};

const currentTool = {
  name: "spotify_currently_playing",
  description: "Get the track currently playing on the authorized Spotify account.",
  parameters: Type.Object({}),
};

const recentTool = {
  name: "spotify_recently_played",
  description: "Get tracks recently played on the authorized Spotify account.",
  parameters: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }),
};

const searchExecutor: ToolExecutor<SearchParams> = async (params): Promise<ToolResult> => {
  try {
    return { success: true, data: { tracks: await searchTracks(params.query, params.limit) } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
};

const getExecutor: ToolExecutor<TrackParams> = async (params): Promise<ToolResult> => {
  try {
    return { success: true, data: await getTrack(params.trackId) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
};

const analyzeExecutor: ToolExecutor<AnalyzeParams> = async (params): Promise<ToolResult> => {
  try {
    const track = await getTrack(params.trackId);
    if (!track.previewUrl) {
      return { success: false, error: "This Spotify track has no available 30-second preview." };
    }
    return {
      success: true,
      data: {
        track,
        analysis: await analyzePreview(track.previewUrl),
        instruction:
          "Base any rating on this preview analysis and metadata; say clearly that it is not a full-track listen.",
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
};

const currentExecutor: ToolExecutor<Record<string, never>> = async (): Promise<ToolResult> => {
  try {
    return { success: true, data: { track: await getCurrentlyPlaying() } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
};

const recentExecutor: ToolExecutor<{ limit?: number }> = async (params): Promise<ToolResult> => {
  try {
    return { success: true, data: { tracks: await getRecentlyPlayed(params.limit) } };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
};

const rateExecutor: ToolExecutor<RateParams> = async (params, context): Promise<ToolResult> => {
  context.db.exec(`CREATE TABLE IF NOT EXISTS spotify_ratings (
    chat_id TEXT NOT NULL, track_id TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
    note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, track_id)
  )`);
  const now = Math.floor(Date.now() / 1000);
  context.db
    .prepare(
      `INSERT INTO spotify_ratings (chat_id, track_id, rating, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id, track_id) DO UPDATE SET rating=excluded.rating,
    note=excluded.note, updated_at=excluded.updated_at`
    )
    .run(context.chatId, params.trackId, params.rating, params.note ?? null, now, now);
  return {
    success: true,
    data: { trackId: params.trackId, rating: params.rating, note: params.note },
  };
};

const getRatingExecutor: ToolExecutor<TrackParams> = async (
  params,
  context
): Promise<ToolResult> => {
  context.db.exec(`CREATE TABLE IF NOT EXISTS spotify_ratings (
    chat_id TEXT NOT NULL, track_id TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
    note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, track_id)
  )`);
  const row = context.db
    .prepare(
      "SELECT track_id, rating, note, updated_at FROM spotify_ratings WHERE chat_id = ? AND track_id = ?"
    )
    .get(context.chatId, params.trackId);
  return { success: true, data: row ?? null };
};

export const tools: ToolEntry[] = [
  { tool: searchTool, executor: searchExecutor, scope: "open", mode: "both", tags: ["social"] },
  { tool: getTool, executor: getExecutor, scope: "open", mode: "both", tags: ["social"] },
  { tool: analyzeTool, executor: analyzeExecutor, scope: "open", mode: "both", tags: ["social"] },
  {
    tool: currentTool,
    executor: currentExecutor,
    scope: "dm-only",
    mode: "both",
    tags: ["social"],
  },
  { tool: recentTool, executor: recentExecutor, scope: "dm-only", mode: "both", tags: ["social"] },
  { tool: rateTool, executor: rateExecutor, scope: "dm-only", mode: "both", tags: ["social"] },
  {
    tool: getRatingTool,
    executor: getRatingExecutor,
    scope: "dm-only",
    mode: "both",
    tags: ["social"],
  },
];
