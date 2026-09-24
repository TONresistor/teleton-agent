/**
 * Setup WebUI Server
 *
 * Lightweight Hono server for the setup wizard.
 * Runs on port 7777 (localhost-only), no auth needed.
 * Pattern: simplified version of src/webui/server.ts.
 */

import { Hono } from "hono";
import type { ServerType } from "@hono/node-server";
import { cors } from "hono/cors";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSetupRoutes } from "./routes/setup.js";
import { applySecurityMiddleware, sharedBodyLimit } from "./http-common.js";
import { findWebDist, createStaticHandler } from "./static-serving.js";
import { startHonoServer, stopHonoServer } from "../utils/http-server.js";
import { randomBytes } from "node:crypto";
import YAML from "yaml";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/errors.js";
import { openBrowser } from "../utils/open-browser.js";

const log = createLogger("Setup");

export class SetupServer {
  private app: Hono;
  private server: ServerType | null = null;
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
      sharedBodyLimit((c) =>
        c.json({ success: false, error: "Request body too large (max 2MB)" }, 413)
      )
    );

    // Security headers
    applySecurityMiddleware(this.app, { referrerPolicy: "strict-origin-when-cross-origin" });

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
        const raw = readFileSync(configPath, "utf-8");
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
      } catch (error: unknown) {
        return c.json({ success: false, error: getErrorMessage(error) }, 500);
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
    this.app.get("*", createStaticHandler(webDist, { async: false }));
  }

  async start(): Promise<void> {
    this.server = await startHonoServer({
      fetch: this.app.fetch,
      hostname: "127.0.0.1",
      port: this.port,
      onListen: () => {
        const url = `http://localhost:${this.port}/setup`;
        log.info(`Setup wizard: ${url}`);
        openBrowser(url, () => log.info(`Open this URL in your browser: ${url}`));
      },
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await stopHonoServer(this.server);
      log.info("Setup server stopped");
    }
  }
}
