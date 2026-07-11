import { Hono } from "hono";
import type { ServerType } from "@hono/node-server";
import { cors } from "hono/cors";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import type { WebUIServerDeps } from "./types.js";
import { createLifecycleSSE } from "./lifecycle-sse.js";
import { applySecurityMiddleware, sharedBodyLimit } from "./http-common.js";
import { findWebDist, createStaticHandler } from "./static-serving.js";
import { startHonoServer, stopHonoServer } from "../utils/http-server.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("WebUI");
import { generateToken, safeCompare, COOKIE_NAME, COOKIE_MAX_AGE } from "./middleware/auth.js";
import { logInterceptor } from "./log-interceptor.js";
import { SHARED_ROUTE_FACTORIES } from "./routes/shared.js";
import { createAgentRoutes } from "../api/routes/agent.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createWalletRoutes } from "./routes/wallet.js";
import { readRawConfig, writeRawConfig } from "../config/configurable-keys.js";

export class WebUIServer {
  private app: Hono;
  private server: ServerType | null = null;
  private deps: WebUIServerDeps;
  private authToken: string;

  constructor(deps: WebUIServerDeps) {
    this.deps = deps;
    this.app = new Hono();

    // Generate or use configured auth token
    this.authToken = deps.config.auth_token || generateToken();

    this.setupMiddleware();
    this.setupRoutes();
  }

  /** Set an HttpOnly session cookie */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono context type
  private setSessionCookie(c: any): void {
    setCookie(c, COOKIE_NAME, this.authToken, {
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
      secure: false, // localhost is HTTP
      maxAge: COOKIE_MAX_AGE,
    });
  }

  private setupMiddleware() {
    // CORS - must be first
    this.app.use(
      "*",
      cors({
        origin: this.deps.config.cors_origins,
        credentials: true,
        allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: 3600,
      })
    );

    // Request logging (if enabled)
    if (this.deps.config.log_requests) {
      this.app.use("*", async (c, next) => {
        const start = Date.now();
        await next();
        const duration = Date.now() - start;
        log.info(`${c.req.method} ${c.req.path} → ${c.res.status} (${duration}ms)`);
      });
    }

    // Body size limit (defense-in-depth against oversized payloads)
    this.app.use(
      "*",
      sharedBodyLimit((c) =>
        c.json({ success: false, error: "Request body too large (max 2MB)" }, 413)
      )
    );

    // Security headers for all responses
    applySecurityMiddleware(this.app, { referrerPolicy: "strict-origin-when-cross-origin" });

    // Auth for all /api/* routes
    // Accepts: HttpOnly cookie > Bearer header > ?token= query param (fallback)
    this.app.use("/api/*", async (c, next) => {
      // 1. Check HttpOnly session cookie (primary — browser)
      const cookieToken = getCookie(c, COOKIE_NAME);
      if (cookieToken && safeCompare(cookieToken, this.authToken)) {
        return next();
      }

      // 2. Check Authorization header (secondary — API/curl)
      const authHeader = c.req.header("Authorization");
      if (authHeader) {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match && safeCompare(match[1], this.authToken)) {
          return next();
        }
      }

      // 3. Check ?token= query param (fallback — backward compat)
      const queryToken = c.req.query("token");
      if (queryToken && safeCompare(queryToken, this.authToken)) {
        return next();
      }

      return c.json({ success: false, error: "Unauthorized" }, 401);
    });
  }

  private setupRoutes() {
    // Health check (no auth)
    this.app.get("/health", (c) => c.json({ status: "ok" }));

    // === Auth routes (no auth required) ===

    // Token exchange: browser opens with ?token=, gets HttpOnly cookie, redirects to /
    this.app.get("/auth/exchange", (c) => {
      const token = c.req.query("token");
      if (!token || !safeCompare(token, this.authToken)) {
        return c.json({ success: false, error: "Invalid token" }, 401);
      }

      this.setSessionCookie(c);
      return c.redirect("/");
    });

    // Manual login: POST with token, get cookie
    this.app.post("/auth/login", async (c) => {
      try {
        const body = await c.req.json<{ token: string }>();
        if (!body.token || !safeCompare(body.token, this.authToken)) {
          return c.json({ success: false, error: "Invalid token" }, 401);
        }

        this.setSessionCookie(c);
        return c.json({ success: true });
      } catch {
        return c.json({ success: false, error: "Invalid request body" }, 400);
      }
    });

    // Logout: clear cookie
    this.app.post("/auth/logout", (c) => {
      deleteCookie(c, COOKIE_NAME, { path: "/" });
      return c.json({ success: true });
    });

    // Check auth status (no auth required — returns whether cookie is valid)
    this.app.get("/auth/check", (c) => {
      const cookieToken = getCookie(c, COOKIE_NAME);
      const authenticated = !!(cookieToken && safeCompare(cookieToken, this.authToken));
      return c.json({ success: true, data: { authenticated } });
    });

    // API routes (all require auth via middleware above)
    for (const [seg, make] of SHARED_ROUTE_FACTORIES) {
      this.app.route(`/api/${seg}`, make(this.deps));
    }
    this.app.route("/api/conversations", createConversationRoutes(this.deps));
    this.app.route("/api/wallet", createWalletRoutes(this.deps));

    // Agent lifecycle routes (start/stop/status/restart) with WebUI error envelope
    this.app.route(
      "/api/agent",
      createAgentRoutes(this.deps.lifecycle, {
        errorResponse: (c, status, _title, detail) => c.json({ error: detail }, status as 503),
      })
    );

    this.app.get("/api/agent/mode", (c) => {
      const raw = readRawConfig(this.deps.configPath);
      const telegram = raw?.telegram || {};

      const currentMode = telegram.mode || "user";
      const hasBotToken = !!telegram.bot_token;
      const hasUserCredentials = !!(telegram.api_id && telegram.api_hash && telegram.phone);

      return c.json({
        mode: currentMode,
        canSwitchToBot: hasBotToken,
        canSwitchToUser: hasUserCredentials,
      });
    });

    this.app.post("/api/agent/mode", async (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json({ error: "Agent lifecycle not available" }, 503);
      }

      const body = await c.req.json<{
        mode: "user" | "bot";
        botToken?: string;
        userCredentials?: { apiId: number; apiHash: string; phone: string };
      }>();

      if (body.mode !== "user" && body.mode !== "bot") {
        return c.json({ error: "Invalid mode" }, 400);
      }

      const raw = readRawConfig(this.deps.configPath);
      if (!raw?.telegram) {
        return c.json({ error: "No telegram config found" }, 400);
      }

      if (body.mode === "bot") {
        const token = body.botToken || raw.telegram.bot_token;
        if (!token) {
          return c.json({ error: "Bot token required" }, 400);
        }

        // Validate token via Telegram API
        if (body.botToken) {
          try {
            const resp = await fetch(`https://api.telegram.org/bot${body.botToken}/getMe`);
            const result = (await resp.json()) as { ok: boolean; description?: string };
            if (!result.ok) {
              return c.json(
                { error: `Invalid bot token: ${result.description || "validation failed"}` },
                400
              );
            }
          } catch {
            return c.json({ error: "Failed to validate bot token (network error)" }, 400);
          }
          raw.telegram.bot_token = body.botToken;
        }
      } else {
        // Accept new user credentials or use existing ones
        if (body.userCredentials) {
          raw.telegram.api_id = body.userCredentials.apiId;
          raw.telegram.api_hash = body.userCredentials.apiHash;
          raw.telegram.phone = body.userCredentials.phone;
        }
        if (!raw.telegram.api_id || !raw.telegram.api_hash || !raw.telegram.phone) {
          return c.json({ error: "User credentials (api_id, api_hash, phone) required" }, 400);
        }
      }

      raw.telegram.mode = body.mode;
      writeRawConfig(raw, this.deps.configPath);

      // Fire-and-forget: restart to apply new mode
      lifecycle
        .stop()
        .then(() => lifecycle.start())
        .catch((err: Error) => {
          log.error({ err }, "Mode switch restart failed");
        });

      return c.json({ success: true, mode: body.mode, restarting: true });
    });

    this.app.get("/api/agent/events", (c) => {
      const lifecycle = this.deps.lifecycle;
      if (!lifecycle) {
        return c.json({ error: "Agent lifecycle not available" }, 503);
      }

      return createLifecycleSSE(c, lifecycle);
    });

    // Serve static files in production (if built) with SPA fallback
    const webDist = findWebDist();
    if (webDist) {
      this.app.get("*", createStaticHandler(webDist, { async: true }));
    }

    // Error handler
    this.app.onError((err, c) => {
      log.error({ err }, "WebUI error");
      return c.json(
        {
          success: false,
          error: err.message || "Internal server error",
        },
        500
      );
    });
  }

  async start(): Promise<void> {
    // Install log interceptor
    logInterceptor.install();

    try {
      this.server = await startHonoServer({
        fetch: this.app.fetch,
        hostname: this.deps.config.host,
        port: this.deps.config.port,
        onListen: (info) => {
          const url = `http://${info.address}:${info.port}`;

          log.info(`WebUI server running`);
          log.info(`URL: ${url}`);
          log.info("Authentication token loaded; use the configured Bearer token for API access");
        },
      });
    } catch (error) {
      logInterceptor.uninstall();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await stopHonoServer(this.server);
      logInterceptor.uninstall();
      log.info("WebUI server stopped");
    }
  }

  getToken(): string {
    return this.authToken;
  }
}
