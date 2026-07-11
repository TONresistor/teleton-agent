import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function jwtWithExpiry(expiresAtMs: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp: Math.floor(expiresAtMs / 1000) })}.signature`;
}

describe("Grok Build credentials", () => {
  let grokHome: string;

  beforeEach(() => {
    grokHome = mkdtempSync(join(tmpdir(), "teleton-grok-auth-"));
    process.env.GROK_HOME = grokHome;
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("child_process");
    vi.resetModules();
    delete process.env.GROK_HOME;
    delete process.env.GROK_CLIENT_VERSION;
    rmSync(grokHome, { recursive: true, force: true });
  });

  function writeAuth(auth: object): void {
    writeFileSync(join(grokHome, "auth.json"), JSON.stringify(auth), { mode: 0o600 });
  }

  it("reads the current dynamic auth.x.ai scope", async () => {
    const token = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    writeAuth({
      "https://auth.x.ai::client-id": {
        key: token,
        auth_mode: "oidc",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });

    const credentials = await import("../grok-build-credentials.js");

    expect(credentials.getGrokBuildApiKey()).toBe(token);
    expect(credentials.isGrokBuildTokenValid()).toBe(true);
  });

  it("supports the legacy accounts.x.ai sign-in scope", async () => {
    const token = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    writeAuth({
      "https://accounts.x.ai/sign-in": {
        key: token,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });

    const credentials = await import("../grok-build-credentials.js");

    expect(credentials.getGrokBuildApiKey()).toBe(token);
  });

  it("ignores credentials outside the xAI auth hosts", async () => {
    const validToken = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    const maliciousToken = jwtWithExpiry(Date.now() + 24 * 60 * 60 * 1000);
    writeAuth({
      "https://auth.x.ai::client-id": {
        key: validToken,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      "https://auth.x.ai.evil.example::client-id": {
        key: maliciousToken,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    const credentials = await import("../grok-build-credentials.js");

    expect(credentials.getGrokBuildApiKey()).toBe(validToken);
  });

  it("marks an expired token invalid while returning it for the 401 refresh path", async () => {
    const token = jwtWithExpiry(Date.now() - 60 * 1000);
    writeAuth({
      "https://auth.x.ai::client-id": {
        key: token,
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      },
    });

    const credentials = await import("../grok-build-credentials.js");

    expect(credentials.getGrokBuildApiKey()).toBe(token);
    expect(credentials.isGrokBuildTokenValid()).toBe(false);
  });

  it("fails with an actionable error when no CLI session exists", async () => {
    const credentials = await import("../grok-build-credentials.js");

    expect(() => credentials.getGrokBuildApiKey()).toThrow(
      "No Grok Build credentials found. Run 'grok login' to authenticate."
    );
  });

  it("delegates refresh to the Grok CLI and reloads the updated token", async () => {
    const expiredToken = jwtWithExpiry(Date.now() - 60 * 1000);
    const refreshedToken = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    writeAuth({
      "https://auth.x.ai::client-id": {
        key: expiredToken,
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      },
    });

    vi.doMock("child_process", () => ({
      execFileSync: vi.fn(),
      execFile: (
        command: string,
        args: string[],
        _options: object,
        callback: (error: null, stdout: string, stderr: string) => void
      ) => {
        expect(command).toBe("grok");
        expect(args).toEqual(["models"]);
        writeAuth({
          "https://auth.x.ai::client-id": {
            key: refreshedToken,
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        });
        callback(null, "", "");
      },
    }));
    vi.resetModules();

    const credentials = await import("../grok-build-credentials.js");

    await expect(credentials.refreshGrokBuildApiKey()).resolves.toBe(refreshedToken);
    expect(credentials.isGrokBuildTokenValid()).toBe(true);
  });

  it("rejects a Grok CLI version older than the supported protocol", async () => {
    process.env.GROK_CLIENT_VERSION = "0.2.76";
    const credentials = await import("../grok-build-credentials.js");

    expect(() => credentials.getGrokBuildCliVersion()).toThrow(
      "Grok CLI 0.2.76 is unsupported; install 0.2.77 or newer"
    );
  });

  it("accepts the minimum supported Grok CLI version", async () => {
    process.env.GROK_CLIENT_VERSION = "0.2.77";
    const credentials = await import("../grok-build-credentials.js");

    expect(credentials.getGrokBuildCliVersion()).toBe("0.2.77");
  });

  it("rejects an outdated version discovered from the Grok installation", async () => {
    writeFileSync(join(grokHome, "version.json"), JSON.stringify({ version: "0.2.10" }));
    const credentials = await import("../grok-build-credentials.js");

    expect(() => credentials.getGrokBuildCliVersion()).toThrow(
      "Grok CLI 0.2.10 is unsupported; install 0.2.77 or newer"
    );
  });

  it("falls back to the installed Grok binary when version metadata is absent", async () => {
    vi.doMock("child_process", () => ({
      execFile: vi.fn(),
      execFileSync: vi.fn(() => "grok 0.2.93 (f00f96316d4b) [stable]\n"),
    }));
    vi.resetModules();
    const credentials = await import("../grok-build-credentials.js");

    expect(credentials.getGrokBuildCliVersion()).toBe("0.2.93");
  });
});
