/**
 * Grok Build CLI credential reader.
 *
 * Reads the browser/OIDC session maintained by the Grok CLI from:
 *   $GROK_HOME/auth.json (default: ~/.grok/auth.json)
 *
 * The session token is never persisted in Teleton configuration. On a 401,
 * `grok models` is invoked to let the official CLI perform its own silent
 * OAuth refresh, then the credential file is read again.
 */

import { execFile, execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";
import { createLogger } from "../utils/logger.js";
import { extractJwtExpiry } from "../utils/jwt.js";
import { createTokenCache } from "./token-cache.js";

const log = createLogger("GrokBuildCreds");
const execFileAsync = promisify(execFile);
const tokenCache = createTokenCache();
const REFRESH_SKEW_MS = 5 * 60 * 1000;
export const MINIMUM_GROK_BUILD_CLI_VERSION = "0.2.77";

interface GrokAuthEntry {
  key?: string;
  expires_at?: string;
  auth_mode?: string;
}

type GrokAuthFile = Record<string, unknown>;
const GROK_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function parseVersion(version: string): [number, number, number] {
  const [major, minor, patch] = version.split(/[+-]/, 1)[0].split(".").map(Number);
  return [major, minor, patch];
}

function isVersionAtLeast(version: string, minimum: string): boolean {
  const current = parseVersion(version);
  const required = parseVersion(minimum);
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== required[index]) return current[index] > required[index];
  }
  return true;
}

function validateCliVersion(version: string): string {
  if (!GROK_VERSION_RE.test(version)) {
    throw new Error(`Invalid Grok CLI version: ${version}`);
  }
  if (!isVersionAtLeast(version, MINIMUM_GROK_BUILD_CLI_VERSION)) {
    throw new Error(
      `Grok CLI ${version} is unsupported; install ${MINIMUM_GROK_BUILD_CLI_VERSION} or newer`
    );
  }
  return version;
}

function getGrokHome(): string {
  return process.env.GROK_HOME || join(homedir(), ".grok");
}

function getAuthFilePath(): string {
  return join(getGrokHome(), "auth.json");
}

export function getGrokBuildCliVersion(): string {
  const override = process.env.GROK_CLIENT_VERSION?.trim();
  if (override) return validateCliVersion(override);

  const candidates: Array<{ path: string; key: string }> = [
    { path: join(getGrokHome(), "version.json"), key: "version" },
    { path: join(getGrokHome(), "models_cache.json"), key: "grok_version" },
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(candidate.path, "utf-8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const version = parsed[candidate.key];
    if (typeof version === "string" && GROK_VERSION_RE.test(version)) {
      return validateCliVersion(version);
    }
  }

  let output = "";
  try {
    output = execFileSync(process.env.GROK_BIN || "grok", ["--version"], {
      encoding: "utf8",
      timeout: 3_000,
      env: { ...process.env, GROK_HOME: getGrokHome() },
    });
  } catch {
    // The actionable error below covers a missing or unusable CLI.
  }
  const match = /\bgrok\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i.exec(output);
  if (match) return validateCliVersion(match[1]);

  throw new Error(
    "Could not detect the Grok CLI version. Run 'grok update' or set GROK_CLIENT_VERSION."
  );
}

function isGrokAuthScope(scope: string): boolean {
  const issuer = scope.split("::", 1)[0];
  try {
    const url = new URL(issuer);
    return (
      url.protocol === "https:" &&
      (url.hostname === "auth.x.ai" || url.hostname === "accounts.x.ai")
    );
  } catch {
    return false;
  }
}

function readAuthFile(): GrokAuthFile | null {
  const filePath = getAuthFilePath();
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as GrokAuthFile;
  } catch (error) {
    log.warn({ err: error, path: filePath }, "Failed to parse Grok auth file");
    return null;
  }
}

function extractToken(auth: GrokAuthFile): { token: string; expiresAt: number } | null {
  const candidates = Object.entries(auth)
    .filter(([scope, value]) => isGrokAuthScope(scope) && value && typeof value === "object")
    .map(([, value]) => value as GrokAuthEntry)
    .filter((entry) => typeof entry.key === "string" && entry.key.length > 0)
    .map((entry) => {
      const parsedExpiry = entry.expires_at ? Date.parse(entry.expires_at) : Number.NaN;
      const jwtExpiry = extractJwtExpiry(entry.key as string);
      return {
        token: entry.key as string,
        expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : jwtExpiry,
      };
    })
    .filter((entry) => entry.expiresAt > 0)
    .sort((a, b) => b.expiresAt - a.expiresAt);

  return candidates[0] ?? null;
}

/**
 * Resolve the current Grok Build session token.
 *
 * Expired tokens are returned once so the provider can receive a 401 and use
 * the standard refresh-and-retry path. Valid tokens are cached with the same
 * five-minute early invalidation window used by the Grok CLI.
 */
export function getGrokBuildApiKey(): string {
  if (tokenCache.isValid()) {
    return tokenCache.get() as string;
  }

  const auth = readAuthFile();
  const extracted = auth ? extractToken(auth) : null;
  if (extracted) {
    tokenCache.set(extracted.token, extracted.expiresAt - REFRESH_SKEW_MS);
    return extracted.token;
  }

  throw new Error("No Grok Build credentials found. Run 'grok login' to authenticate.");
}

/**
 * Ask the official Grok CLI to silently refresh its OIDC session, then reload
 * the resulting token from disk. No inference request is made by this command.
 */
export async function refreshGrokBuildApiKey(): Promise<string | null> {
  tokenCache.reset();

  try {
    await execFileAsync(process.env.GROK_BIN || "grok", ["models"], {
      cwd: getGrokHome(),
      env: { ...process.env, GROK_HOME: getGrokHome() },
      timeout: 30_000,
    });
  } catch (error) {
    log.warn({ err: error }, "Grok CLI credential refresh failed");
    return null;
  }

  const auth = readAuthFile();
  const extracted = auth ? extractToken(auth) : null;
  if (!extracted || extracted.expiresAt <= Date.now()) {
    log.warn("Grok CLI refresh completed without a valid session token");
    return null;
  }

  tokenCache.set(extracted.token, extracted.expiresAt - REFRESH_SKEW_MS);
  log.info("Grok Build credentials refreshed by Grok CLI");
  return extracted.token;
}

export function isGrokBuildTokenValid(): boolean {
  return tokenCache.isValid();
}

/** Validate the complete local Grok Build runtime before persisting a setup. */
export function assertGrokBuildReady(): string {
  const version = getGrokBuildCliVersion();
  getGrokBuildApiKey();
  if (!isGrokBuildTokenValid()) {
    throw new Error("Grok Build CLI session is expired. Run 'grok login' to re-authenticate.");
  }
  return version;
}
