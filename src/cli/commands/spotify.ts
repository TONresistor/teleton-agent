import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse, stringify } from "yaml";
import { expandPath, getDefaultConfigPath } from "../../config/loader.js";

const execFileAsync = promisify(execFile);
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = ["user-read-currently-playing", "user-read-recently-played"];

interface SpotifyPluginConfig {
  spotifyMusic?: { clientId?: string; clientSecret?: string; refreshToken?: string };
}

function credentials(configPath: string): { clientId: string; clientSecret: string } {
  const raw = parse(readFileSync(configPath, "utf-8")) as {
    plugins?: { teleton_music_share?: SpotifyPluginConfig };
  };
  const spotify = raw.plugins?.teleton_music_share?.spotifyMusic;
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? spotify?.clientId;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? spotify?.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Spotify Client ID and Client Secret are required in config or environment variables."
    );
  }
  return { clientId, clientSecret };
}

async function openBrowser(url: string): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url]);
  } else if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
  } else {
    await execFileAsync("xdg-open", [url]);
  }
}

function saveRefreshToken(configPath: string, refreshToken: string): void {
  const raw = parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  const plugins = (raw.plugins ?? {}) as Record<string, unknown>;
  const music = (plugins.teleton_music_share ?? {}) as SpotifyPluginConfig;
  music.spotifyMusic = { ...music.spotifyMusic, refreshToken };
  plugins.teleton_music_share = music;
  raw.plugins = plugins;
  writeFileSync(configPath, stringify(raw), { encoding: "utf-8", mode: 0o600 });
}

export async function spotifyConnectCommand(config = getDefaultConfigPath()): Promise<void> {
  const configPath = expandPath(config);
  const { clientId, clientSecret } = credentials(configPath);
  const state = randomBytes(24).toString("hex");
  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("state", state);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback" || url.searchParams.get("state") !== state) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Spotify authorization failed. You may close this window.");
        return;
      }
      const authCode = url.searchParams.get("code");
      if (!authCode) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Spotify did not return an authorization code. You may close this window.");
        reject(new Error(url.searchParams.get("error") ?? "Spotify authorization was denied"));
        server.close();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<h1>Spotify connected</h1><p>You may close this window and return to Teleton.</p>"
      );
      resolve(authCode);
      server.close();
    });
    server.once("error", reject);
    server.listen(8888, "127.0.0.1", () => {
      console.log("Opening Spotify authorization in your browser...");
      console.log(`If it does not open, visit: ${authUrl.toString()}`);
      openBrowser(authUrl.toString()).catch(() => {
        // The printed URL is sufficient when a browser cannot be opened automatically.
      });
    });
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!response.ok) throw new Error(`Spotify token exchange failed: ${response.status}`);
  const data = (await response.json()) as { refresh_token?: string };
  if (!data.refresh_token)
    throw new Error("Spotify did not return a refresh token. Revoke app access and try again.");
  saveRefreshToken(configPath, data.refresh_token);
  console.log("Spotify connected. The refresh token was saved to the local Teleton config.");
}
