import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebUIServerDeps } from "./types.js";
import {
  generateToken,
  maskToken,
  safeCompare,
  COOKIE_NAME,
  COOKIE_MAX_AGE,
} from "./middleware/auth.js";
import { logInterceptor } from "./log-interceptor.js";
import { createStatusRoutes } from "./routes/status.js";
import { createToolsRoutes } from "./routes/tools.js";
import { createLogsRoutes } from "./routes/logs.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { createSoulRoutes } from "./routes/soul.js";
import { createPluginsRoutes } from "./routes/plugins.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createWorkspaceRoutes } from "./routes/workspace.js";
import { createTasksRoutes } from "./routes/tasks.js";
import { createConfigRoutes } from "./routes/config.js";
import { createMarketplaceRoutes } from "./routes/marketplace.js";

function findWebDist(): string | null {
  // Try common locations relative to CWD (where teleton is launched from)
  const candidates = [
    resolve("dist/web"), // npm start / teleton start (from project root)
    resolve("web"), // fallback
  ];
  // Also try relative to the compiled file
  const __dirname = dirname(fileURLToPath(import.meta.url));
  candidates.push(
    resolve(__dirname, "web"), // dist/web when __dirname = dist/
    resolve(__dirname, "../dist/web") // when running with tsx from src/
  );

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

export class WebUIServer {
  private app: Hono;
  private server: ReturnType<typeof serve> | null = null;
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
        console.log(`📡 ${c.req.method} ${c.req.path} → ${c.res.status} (${duration}ms)`);
      });
    }

    // Body size limit (defense-in-depth against oversized payloads)
    this.app.use(
      "*",
      bodyLimit({
        maxSize: 2 * 1024 * 1024, // 2MB
        onError: (c) => c.json({ success: false, error: "Request body too large (max 2MB)" }, 413),
      })
    );

    // Security headers for all responses
    this.app.use("*", async (c, next) => {
      await next();
      c.res.headers.set("X-Content-Type-Options", "nosniff");
      c.res.headers.set("X-Frame-Options", "DENY");
      c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    });

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
    this.app.route("/api/status", createStatusRoutes(this.deps));
    this.app.route("/api/tools", createToolsRoutes(this.deps));
    this.app.route("/api/logs", createLogsRoutes(this.deps));
    this.app.route("/api/memory", createMemoryRoutes(this.deps));
    this.app.route("/api/soul", createSoulRoutes(this.deps));
    this.app.route("/api/plugins", createPluginsRoutes(this.deps));
    this.app.route("/api/mcp", createMcpRoutes(this.deps));
    this.app.route("/api/workspace", createWorkspaceRoutes(this.deps));
    this.app.route("/api/tasks", createTasksRoutes(this.deps));
    this.app.route("/api/config", createConfigRoutes(this.deps));
    this.app.route("/api/marketplace", createMarketplaceRoutes(this.deps));

    // Serve static files in production (if built)
    const webDist = findWebDist();
    if (webDist) {
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

      // Serve static files (assets, images, etc.) with SPA fallback
      this.app.get("*", (c) => {
        const filePath = resolve(join(webDist, c.req.path));
        // Prevent path traversal — resolved path must stay inside webDist
        const rel = relative(webDist, filePath);
        if (rel.startsWith("..") || resolve(filePath) !== filePath) {
          return c.html(indexHtml);
        }

        // Try serving the actual file
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

        // SPA fallback: serve index.html for all non-file routes
        return c.html(indexHtml);
      });
    }

    // Error handler
    this.app.onError((err, c) => {
      console.error("WebUI error:", err);
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
    return new Promise((resolve, reject) => {
      try {
        // Install log interceptor
        logInterceptor.install();

        // Start HTTP server
        this.server = serve(
          {
            fetch: this.app.fetch,
            hostname: this.deps.config.host,
            port: this.deps.config.port,
          },
          (info) => {
            const url = `http://${info.address}:${info.port}`;

            console.log(`\n🌐 WebUI server running`);
            console.log(`   URL: ${url}/auth/exchange?token=${this.authToken}`);
            console.log(
              `   Token: ${maskToken(this.authToken)} (use Bearer header for API access)\n`
            );
            resolve();
          }
        );
      } catch (error) {
        logInterceptor.uninstall();
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          logInterceptor.uninstall();
          console.log("🌐 WebUI server stopped");
          resolve();
        });
      });
    }
  }

  getToken(): string {
    return this.authToken;
  }
}
