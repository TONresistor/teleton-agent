/**
 * Setup WebUI Server
 *
 * Lightweight Hono server for the setup wizard.
 * Runs on port 7777 (localhost-only), no auth needed.
 * Pattern: simplified version of src/webui/server.ts.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { platform } from "node:os";
import { createSetupRoutes } from "./routes/setup.js";
import { randomBytes } from "node:crypto";
import { readFileSync as readYaml, writeFileSync } from "node:fs";
import YAML from "yaml";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Setup");

function findWebDist(): string | null {
  const candidates = [resolve("dist/web"), resolve("web")];
  const __dirname = dirname(fileURLToPath(import.meta.url));
  candidates.push(resolve(__dirname, "web"), resolve(__dirname, "../dist/web"));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

function autoOpenBrowser(url: string): void {
  const os = platform();
  let cmd: string;

  if (os === "darwin") {
    cmd = `open "${url}"`;
  } else if (os === "win32") {
    cmd = `start "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      log.info(`Open this URL in your browser: ${url}`);
    }
  });
}

export class SetupServer {
  private app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private launchResolve: ((token: string) => void) | null = null;
  private launchPromise: Promise<string>;

  constructor(private port: number = 7777) {
    this.app = new Hono();
    this.launchPromise = new Promise<string>((resolve) => {
      this.launchResolve = resolve;
    });
    this.setupMiddleware();
    this.setupRoutes();
    this.setupStaticServing();
  }

  /** Returns a promise that resolves with the auth token when the user clicks "Start Agent" */
  waitForLaunch(): Promise<string> {
    return this.launchPromise;
  }

  private setupMiddleware(): void {
    // CORS for localhost
    this.app.use(
      "*",
      cors({
        origin: [
          "http://localhost:5173",
          `http://localhost:${this.port}`,
          "http://127.0.0.1:5173",
          `http://127.0.0.1:${this.port}`,
        ],
        credentials: true,
        allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
        allowHeaders: ["Content-Type"],
        maxAge: 3600,
      })
    );

    // Body size limit
    this.app.use(
      "*",
      bodyLimit({
        maxSize: 2 * 1024 * 1024,
        onError: (c) => c.json({ success: false, error: "Request body too large (max 2MB)" }, 413),
      })
    );

    // Security headers
    this.app.use("*", async (c, next) => {
      await next();
      c.res.headers.set("X-Content-Type-Options", "nosniff");
      c.res.headers.set("X-Frame-Options", "DENY");
      c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    });

    // No auth middleware — localhost-only setup server
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (c) => c.json({ status: "ok" }));

    // Mount setup routes
    this.app.route("/api/setup", createSetupRoutes());

    // Auth check — setup server is NOT authenticated, return a distinguishable response
    // so pollHealth can tell setup server apart from the real agent WebUI
    this.app.get("/auth/check", (c) =>
      c.json({ success: true, data: { authenticated: false, setup: true } })
    );

    // Launch endpoint — generates auth token and resolves the launch promise
    this.app.post("/api/setup/launch", async (c) => {
      try {
        // Generate auth token
        const token = randomBytes(32).toString("hex");

        // Persist token into config.yaml so the agent WebUI can validate it
        const configPath = join(TELETON_ROOT, "config.yaml");
        const raw = readYaml(configPath, "utf-8");
        const config = YAML.parse(raw);
        config.webui = { ...(config.webui || {}), enabled: true, auth_token: token };
        writeFileSync(configPath, YAML.stringify(config), { encoding: "utf-8", mode: 0o600 });

        log.info("Launch requested — auth token generated");

        // Resolve the launch promise AFTER the response is sent — otherwise
        // server.stop() kills the connection before the client gets the token
        const resolve = this.launchResolve;
        this.launchResolve = null;
        if (resolve) {
          setTimeout(() => resolve(token), 500);
        }

        return c.json({ success: true, data: { token } });
      } catch (err) {
        return c.json(
          { success: false, error: err instanceof Error ? err.message : String(err) },
          500
        );
      }
    });

    // Error handler
    this.app.onError((err, c) => {
      log.error({ err }, "Setup server error");
      return c.json({ success: false, error: err.message || "Internal server error" }, 500);
    });
  }

  private setupStaticServing(): void {
    const webDist = findWebDist();
    if (!webDist) return;

    const indexHtml = readFileSync(join(webDist, "index.html"), "utf-8");

    const mimeTypes: Record<string, string> = {
      js: "application/javascript",
      css: "text/css",
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      ico: "image/x-icon",
      json: "application/json",
      woff2: "font/woff2",
      woff: "font/woff",
    };

    this.app.get("*", (c) => {
      const filePath = resolve(join(webDist, c.req.path));
      // Prevent path traversal
      const rel = relative(webDist, filePath);
      if (rel.startsWith("..") || resolve(filePath) !== filePath) {
        return c.html(indexHtml);
      }

      try {
        const content = readFileSync(filePath);
        const ext = filePath.split(".").pop() || "";
        if (mimeTypes[ext]) {
          const immutable = c.req.path.startsWith("/assets/");
          return c.body(content, 200, {
            "Content-Type": mimeTypes[ext],
            "Cache-Control": immutable
              ? "public, max-age=31536000, immutable"
              : "public, max-age=3600",
          });
        }
      } catch {
        // File not found — fall through to SPA
      }

      // SPA fallback
      return c.html(indexHtml);
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = serve(
          {
            fetch: this.app.fetch,
            hostname: "127.0.0.1",
            port: this.port,
          },
          () => {
            const url = `http://localhost:${this.port}/setup`;
            log.info(`Setup wizard: ${url}`);
            autoOpenBrowser(url);
            resolve();
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        // Force-close keep-alive connections so we don't wait ~30s for them to expire
        (this.server as unknown as import("node:http").Server).closeAllConnections();
        this.server!.close(() => {
          log.info("Setup server stopped");
          resolve();
        });
      });
    }
  }
}
