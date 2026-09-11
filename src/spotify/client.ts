import { fetchWithTimeout } from "../utils/fetch.js";
import { getDefaultConfigPath, loadConfig } from "../config/loader.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";

let cachedToken: { value: string; expiresAt: number } | undefined;
let cachedUserToken: { value: string; expiresAt: number } | undefined;

function credentials(): { id: string; secret: string } {
  const pluginConfig = loadConfig(getDefaultConfigPath()).plugins?.teleton_music_share as
    | { spotifyMusic?: { clientId?: string; clientSecret?: string } }
    | undefined;
  const id = process.env.SPOTIFY_CLIENT_ID ?? pluginConfig?.spotifyMusic?.clientId;
  const secret = process.env.SPOTIFY_CLIENT_SECRET ?? pluginConfig?.spotifyMusic?.clientSecret;
  if (!id || !secret) {
    throw new Error(
      "Spotify is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, or configure plugins.teleton_music_share.spotifyMusic."
    );
  }
  return { id, secret };
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const { id, secret } = credentials();
  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`Spotify token error: ${response.status}`);
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Spotify did not return an access token");
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

async function userAccessToken(): Promise<string> {
  if (cachedUserToken && cachedUserToken.expiresAt > Date.now() + 30_000) {
    return cachedUserToken.value;
  }
  const { id, secret } = credentials();
  const config = loadConfig(getDefaultConfigPath());
  const refreshToken = (
    config.plugins?.teleton_music_share as { spotifyMusic?: { refreshToken?: string } } | undefined
  )?.spotifyMusic?.refreshToken;
  if (!refreshToken) {
    throw new Error("Spotify user authorization is not configured. Run `teleton spotify connect`.");
  }
  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!response.ok) throw new Error(`Spotify user token error: ${response.status}`);
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Spotify did not return a user access token");
  cachedUserToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  album: string;
  releaseDate?: string;
  durationMs: number;
  popularity?: number;
  previewUrl?: string;
  spotifyUrl?: string;
  imageUrl?: string;
}

function mapTrack(track: Record<string, unknown>): SpotifyTrack {
  const album = (track.album ?? {}) as Record<string, unknown>;
  const images = (album.images ?? []) as Array<Record<string, unknown>>;
  const external = (track.external_urls ?? {}) as Record<string, unknown>;
  return {
    id: String(track.id),
    name: String(track.name),
    artists: ((track.artists ?? []) as Array<Record<string, unknown>>).map((a) => String(a.name)),
    album: String(album.name ?? ""),
    releaseDate: album.release_date ? String(album.release_date) : undefined,
    durationMs: Number(track.duration_ms ?? 0),
    popularity: track.popularity === undefined ? undefined : Number(track.popularity),
    previewUrl: track.preview_url ? String(track.preview_url) : undefined,
    spotifyUrl: external.spotify ? String(external.spotify) : undefined,
    imageUrl: images[0]?.url ? String(images[0].url) : undefined,
  };
}

export async function searchTracks(query: string, limit = 5): Promise<SpotifyTrack[]> {
  const token = await accessToken();
  const url = `${API_URL}/search?type=track&limit=${Math.min(Math.max(limit, 1), 20)}&q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Spotify search error: ${response.status}`);
  const data = (await response.json()) as { tracks?: { items?: Array<Record<string, unknown>> } };
  return (data.tracks?.items ?? []).map(mapTrack);
}

export async function getTrack(trackId: string): Promise<SpotifyTrack> {
  const token = await accessToken();
  const response = await fetchWithTimeout(`${API_URL}/tracks/${encodeURIComponent(trackId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Spotify track error: ${response.status}`);
  return mapTrack((await response.json()) as Record<string, unknown>);
}

export async function getCurrentlyPlaying(): Promise<SpotifyTrack | null> {
  const token = await userAccessToken();
  const response = await fetchWithTimeout(`${API_URL}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`Spotify currently playing error: ${response.status}`);
  const data = (await response.json()) as {
    item?: Record<string, unknown>;
    currently_playing_type?: string;
  };
  if (data.currently_playing_type !== "track" || !data.item) return null;
  return mapTrack(data.item);
}

export async function getRecentlyPlayed(limit = 10): Promise<SpotifyTrack[]> {
  const token = await userAccessToken();
  const url = `${API_URL}/me/player/recently-played?limit=${Math.min(Math.max(limit, 1), 50)}`;
  const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Spotify recently played error: ${response.status}`);
  const data = (await response.json()) as { items?: Array<{ track?: Record<string, unknown> }> };
  return (data.items ?? []).flatMap((item) => (item.track ? [mapTrack(item.track)] : []));
}
