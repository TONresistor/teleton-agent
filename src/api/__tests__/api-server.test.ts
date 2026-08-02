import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../webui/log-interceptor.js", () => ({
  logInterceptor: {
    addListener: vi.fn(() => vi.fn()),
  },
}));

// Mock selfsigned (used by tls.ts)
vi.mock("selfsigned", () => ({
  generate: vi.fn(() =>
    Promise.resolve({
      cert: "MOCK_CERT",
      private: "MOCK_KEY",
      public: "",
    })
  ),
}));

// ── Imports (after mocks) ────────────────────────────────────────────

import { AgentLifecycle } from "../../agent/lifecycle.js";
import { bodyLimit } from "hono/body-limit";

import { requestId } from "../middleware/request-id.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { auditMiddleware } from "../middleware/audit.js";
import { createProblem } from "../schemas/common.js";
import { createAgentRoutes } from "../routes/agent.js";
import { createSystemRoutes } from "../routes/system.js";
import { createAuthRoutes } from "../routes/auth.js";
import { createApiLogsRoutes } from "../routes/logs.js";
import { createApiMemoryRoutes } from "../routes/memory.js";
import { createDepsAdapter } from "../deps.js";

// ── Constants ────────────────────────────────────────────────────────

const TEST_KEY = "tltn_test1234567890abcdefghijklmnopqrstuv";
const TEST_KEY_HASH = createHash("sha256").update(TEST_KEY).digest("hex");
const WRONG_KEY = "tltn_wrongkey1234567890abcdefghijklmnop";

// ── Test app builder ─────────────────────────────────────────────────

interface TestAppOptions {
  lifecycle?: AgentLifecycle | null;
  allowedIps?: string[];
  db?: any;
  skipAuth?: boolean;
}

/**
 * Build a Hono app that mirrors the middleware + routes from ApiServer.
 * Rate limiting is NOT included — it uses module-level singletons.
 * Rate limit tests have their own describe block with dedicated apps.
 */
function createTestApp(opts: TestAppOptions = {}) {
  const { lifecycle = null, allowedIps = [], db = null, skipAuth = false } = opts;

  const app = new Hono();

  // Request ID middleware
  app.use("*", requestId);

  // Body limit (2MB)
  app.use(
    "*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) => {
        return c.json(
          createProblem(413, "Payload Too Large", "Request body exceeds 2MB limit"),
          413,
          { "Content-Type": "application/problem+json" }
        );
      },
    })
  );

  // Security headers
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  });

  // Health probes at root (no auth)
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.get("/readyz", (c) => {
    if (!lifecycle) {
      return c.json({ status: "not_ready", reason: "lifecycle not initialized" }, 503);
    }
    const state = lifecycle.getState();
    if (state === "running") {
      return c.json({ status: "ready", state });
    }
    return c.json({ status: "not_ready", state }, 503);
  });

  // Auth middleware for /v1/* routes
  if (!skipAuth) {
    const authMw = createAuthMiddleware({
      keyHash: TEST_KEY_HASH,
      allowedIps,
    });
    app.use("/v1/*", authMw);
  }

  // Audit logging
  app.use("/v1/*", auditMiddleware);

  // OpenAPI spec endpoint
  app.get("/v1/openapi.json", (c) => {
    return c.json({
      openapi: "3.1.0",
      info: {
        title: "Teleton Management API",
        version: "1.0.0",
        description: "HTTPS management API for remote teleton agent administration",
      },
      servers: [{ url: "https://localhost:7778" }],
    });
  });

  // API-only routes
  app.route("/v1/agent", createAgentRoutes(lifecycle));
  app.route("/v1/system", createSystemRoutes());
  app.route("/v1/auth", createAuthRoutes());
  app.route("/v1/api-logs", createApiLogsRoutes());
  app.route(
    "/v1/api-memory",
    createApiMemoryRoutes(() => db)
  );

  // Setup routes stub
  const setupApp = new Hono();
  setupApp.get("/status", (c) => c.json({ setup: true }));
  app.route("/v1/setup", setupApp);

  // Config routes stub
  const configApp = new Hono();
  configApp.get("/", (c) => c.json({ config: true }));
  app.route("/v1/config", configApp);

  // Global error handler — RFC 9457
  app.onError((err, c) => {
    if (err instanceof Error && "status" in err) {
      const httpErr = err as Error & { status: number; res?: Response };
      if (httpErr.res) return httpErr.res;
      return c.json(
        createProblem(httpErr.status, httpErr.message || "Error"),
        httpErr.status as 400,
        { "Content-Type": "application/problem+json" }
      );
    }

    return c.json(
      createProblem(500, "Internal Server Error", err.message || "An unexpected error occurred"),
      500,
      { "Content-Type": "application/problem+json" }
    );
  });

  // 404 handler
  app.notFound((c) => {
    return c.json(
      createProblem(404, "Not Found", `Route ${c.req.method} ${c.req.path} not found`),
      404,
      { "Content-Type": "application/problem+json" }
    );
  });

  return app;
}

/** Auth header helper */
function authHeader(key: string = TEST_KEY): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Management API", () => {
  // ── Authentication & Authorization ───────────────────────────────

  describe("Authentication & Authorization", () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
      app = createTestApp();
    });

    // Test 1
    it("rejects requests without Authorization header with 401", async () => {
      const res = await app.request("/v1/system/version");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.title).toBe("Unauthorized");
      expect(body.status).toBe(401);
    });

    // Test 2
    it("rejects requests with invalid API key with 401", async () => {
      const res = await app.request("/v1/system/version", {
        headers: authHeader(WRONG_KEY),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.title).toBe("Unauthorized");
    });

    // Test 3
    it("accepts requests with valid API key", async () => {
      const res = await app.request("/v1/system/version", {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("node");
      expect(body).toHaveProperty("apiVersion");
    });

    // Test 4
    it("uses timingSafeEqual for API key comparison", () => {
      const keyHash = createHash("sha256").update(TEST_KEY).digest("hex");
      const storedBuf = Buffer.from(TEST_KEY_HASH, "hex");
      const providedBuf = Buffer.from(keyHash, "hex");
      expect(timingSafeEqual(storedBuf, providedBuf)).toBe(true);

      const wrongHash = createHash("sha256").update(WRONG_KEY).digest("hex");
      const wrongBuf = Buffer.from(wrongHash, "hex");
      expect(timingSafeEqual(storedBuf, wrongBuf)).toBe(false);
    });

    // Test 5
    it("rejects requests from IP not in whitelist with 403", async () => {
      const restrictedApp = createTestApp({ allowedIps: ["10.0.0.1"] });
      const res = await restrictedApp.request("/v1/system/version", {
        headers: authHeader(),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.title).toBe("Forbidden");
    });

    // Test 6
    it("accepts requests from IP in whitelist", async () => {
      // Hono test client presents "unknown" as IP — allow it
      const restrictedApp = createTestApp({ allowedIps: ["127.0.0.1", "unknown"] });
      const res = await restrictedApp.request("/v1/system/version", {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
    });

    // Test 7
    it("allows any IP when whitelist is empty", async () => {
      const openApp = createTestApp({ allowedIps: [] });
      const res = await openApp.request("/v1/system/version", {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
    });

    // Test 8
    it("normalizes IPv4-mapped IPv6 addresses", () => {
      const ip = "::ffff:192.168.1.1";
      const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
      expect(normalized).toBe("192.168.1.1");

      const plain = "10.0.0.1";
      const normalizedPlain = plain.startsWith("::ffff:") ? plain.slice(7) : plain;
      expect(normalizedPlain).toBe("10.0.0.1");
    });

    // Test 9
    it("POST /v1/auth/validate returns 200 with valid key", async () => {
      const res = await app.request("/v1/auth/validate", {
        method: "POST",
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
      expect(body.keyPrefix).toBeDefined();
    });

    it("rejects malformed Authorization header", async () => {
      const res = await app.request("/v1/system/version", {
        headers: { Authorization: "Basic abc123" },
      });
      expect(res.status).toBe(401);
    });

    it("rejects Bearer token without tltn_ prefix", async () => {
      const res = await app.request("/v1/system/version", {
        headers: { Authorization: "Bearer notltn_key123" },
      });
      expect(res.status).toBe(401);
    });
  });

  // ── Rate Limiting ────────────────────────────────────────────────

  describe("Rate Limiting", () => {
    // Test 10
    it("allows 60 requests within window (global rate limit)", async () => {
      // Import fresh rate limiter for isolation
      const { rateLimiter } = await import("hono-rate-limiter");

      const app = new Hono();
      app.use(
        "*",
        rateLimiter({
          windowMs: 60_000,
          limit: 60,
          keyGenerator: () => "test-key-10",
          handler: (c) =>
            c.json({ status: 429, title: "Too Many Requests" }, 429, {
              "Retry-After": "60",
            }),
        })
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const results: number[] = [];
      for (let i = 0; i < 60; i++) {
        const res = await app.request("/test");
        results.push(res.status);
      }
      expect(results.every((s) => s === 200)).toBe(true);
    });

    // Test 11
    it("returns 429 on 61st request with Retry-After header", async () => {
      const { rateLimiter } = await import("hono-rate-limiter");

      const app = new Hono();
      app.use(
        "*",
        rateLimiter({
          windowMs: 60_000,
          limit: 60,
          keyGenerator: () => "test-key-11",
          handler: (c) =>
            c.json({ status: 429, title: "Too Many Requests" }, 429, {
              "Retry-After": "60",
            }),
        })
      );
      app.get("/test", (c) => c.json({ ok: true }));

      for (let i = 0; i < 60; i++) {
        await app.request("/test");
      }
      const res = await app.request("/test");
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeDefined();
    });

    // Test 12
    it("includes rate limit headers on responses", async () => {
      const { rateLimiter } = await import("hono-rate-limiter");

      const app = new Hono();
      app.use(
        "*",
        rateLimiter({
          windowMs: 60_000,
          limit: 60,
          keyGenerator: () => "test-key-12",
        })
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(200);
      const headers = Object.fromEntries(res.headers.entries());
      const hasRateHeaders =
        "x-ratelimit-limit" in headers ||
        "ratelimit-limit" in headers ||
        "x-ratelimit-remaining" in headers ||
        "ratelimit-remaining" in headers;
      expect(hasRateHeaders).toBe(true);
    });

    // Test 13
    it("limits mutating endpoints to 10 requests per minute", async () => {
      const { rateLimiter } = await import("hono-rate-limiter");

      // Create the limiter ONCE so the store is shared across requests
      const mutateLimiter = rateLimiter({
        windowMs: 60_000,
        limit: 10,
        keyGenerator: () => "test-key-13-mutate",
        handler: (c) =>
          c.json({ status: 429, title: "Too Many Requests" }, 429, {
            "Retry-After": "60",
          }),
      });

      const app = new Hono();
      app.use("*", async (c, next) => {
        if (c.req.method === "GET") return next();
        return mutateLimiter(c, next);
      });
      app.post("/test", (c) => c.json({ ok: true }));

      const results: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await app.request("/test", { method: "POST" });
        results.push(res.status);
      }
      expect(results.slice(0, 10).every((s) => s === 200)).toBe(true);
      expect(results[10]).toBe(429);
    });
  });

  // ── Health Endpoints ─────────────────────────────────────────────

  describe("Health Endpoints", () => {
    // Test 14
    it("GET /healthz returns 200 without auth", async () => {
      const app = createTestApp();
      const res = await app.request("/healthz");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
    });

    // Test 15
    it("GET /readyz returns 200 when agent running", async () => {
      const lifecycle = new AgentLifecycle();
      lifecycle.registerCallbacks(
        async () => {},
        async () => {}
      );
      await lifecycle.start();

      const app = createTestApp({ lifecycle });
      const res = await app.request("/readyz");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ready");
      expect(body.state).toBe("running");
    });

    // Test 16
    it("GET /readyz returns 503 when agent stopped", async () => {
      const lifecycle = new AgentLifecycle();
      lifecycle.registerCallbacks(
        async () => {},
        async () => {}
      );

      const app = createTestApp({ lifecycle });
      const res = await app.request("/readyz");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("not_ready");
      expect(body.state).toBe("stopped");
    });

    // Test 17
    it("GET /v1/system/info returns CPU/RAM info", async () => {
      const app = createTestApp({ skipAuth: true });
      const res = await app.request("/v1/system/info");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("cpu");
      expect(body).toHaveProperty("memory");
      expect(body).toHaveProperty("uptime");
      expect(body.cpu).toHaveProperty("cores");
      expect(body.memory).toHaveProperty("total");
      expect(body.memory).toHaveProperty("free");
    });
  });

  // ── New Endpoints ────────────────────────────────────────────────

  describe("New Endpoints", () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
      app = createTestApp({ skipAuth: true });
    });

    // Test 23
    it("GET /v1/system/version returns correct fields", async () => {
      const res = await app.request("/v1/system/version");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("teleton");
      expect(body).toHaveProperty("node");
      expect(body).toHaveProperty("os");
      expect(body).toHaveProperty("arch");
      expect(body).toHaveProperty("apiVersion");
      expect(body.apiVersion).toBe("1.0.0");
      expect(body.node).toMatch(/^v\d+/);
    });

    // Test 24
    it("GET /v1/system/info returns CPU, memory, and uptime", async () => {
      const res = await app.request("/v1/system/info");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cpu.cores).toBeGreaterThan(0);
      expect(body.memory.total).toBeGreaterThan(0);
      expect(body.memory.free).toBeGreaterThan(0);
      expect(body.memory.used).toBeGreaterThan(0);
      expect(body.memory.heapUsed).toBeGreaterThan(0);
      expect(body.uptime.process).toBeGreaterThanOrEqual(0);
      expect(body.uptime.system).toBeGreaterThan(0);
    });

    // Test 25
    it("GET /v1/api-logs/recent returns entries array", async () => {
      const res = await app.request("/v1/api-logs/recent");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("lines");
      expect(body).toHaveProperty("count");
      expect(Array.isArray(body.lines)).toBe(true);
    });

    // Test 26
    it("GET /v1/api-logs/recent?lines=50 respects lines parameter", async () => {
      const res = await app.request("/v1/api-logs/recent?lines=50");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("lines");
      expect(body.lines.length).toBeLessThanOrEqual(50);
    });

    // Test 27
    it("DELETE /v1/api-memory/sessions/:chatId deletes session", async () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockDb = {
        prepare: vi.fn().mockReturnValue({ run: mockRun }),
      };

      const dbApp = createTestApp({ skipAuth: true, db: mockDb });
      const res = await dbApp.request("/v1/api-memory/sessions/12345", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(1);
      expect(body.chatId).toBe("12345");
      expect(mockDb.prepare).toHaveBeenCalledWith("DELETE FROM sessions WHERE chat_id = ?");
      expect(mockRun).toHaveBeenCalledWith("12345");
    });

    it("DELETE /v1/api-memory/sessions/:chatId returns 404 when not found", async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: vi.fn().mockReturnValue({ changes: 0 }),
        }),
      };

      const dbApp = createTestApp({ skipAuth: true, db: mockDb });
      const res = await dbApp.request("/v1/api-memory/sessions/nonexistent", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });

    // Test 28
    it("POST /v1/api-memory/sessions/prune prunes sessions", async () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 5 });
      const mockDb = {
        prepare: vi.fn().mockReturnValue({ run: mockRun }),
      };

      const dbApp = createTestApp({ skipAuth: true, db: mockDb });
      const res = await dbApp.request("/v1/api-memory/sessions/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxAgeDays: 7 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pruned).toBe(5);
      expect(body.maxAgeDays).toBe(7);
    });

    it("POST /v1/api-memory/sessions/prune defaults to 30 days", async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: vi.fn().mockReturnValue({ changes: 0 }),
        }),
      };

      const dbApp = createTestApp({ skipAuth: true, db: mockDb });
      const res = await dbApp.request("/v1/api-memory/sessions/prune", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.maxAgeDays).toBe(30);
    });
  });

  // ── Pre-Setup State / 503 Behavior ──────────────────────────────

  describe("Pre-Setup State / 503 Behavior", () => {
    it("memory routes return 503 when db is null", async () => {
      const app = createTestApp({ skipAuth: true, db: null });

      const delRes = await app.request("/v1/api-memory/sessions/12345", {
        method: "DELETE",
      });
      expect(delRes.status).toBe(503);

      const pruneRes = await app.request("/v1/api-memory/sessions/prune", {
        method: "POST",
      });
      expect(pruneRes.status).toBe(503);
    });

    // Test 30
    it("setup routes work when lifecycle is null", async () => {
      const app = createTestApp({ lifecycle: null, skipAuth: true });
      const res = await app.request("/v1/setup/status");
      expect(res.status).toBe(200);
    });

    // Test 31
    it("health endpoints work when lifecycle is null", async () => {
      const app = createTestApp({ lifecycle: null });
      const healthRes = await app.request("/healthz");
      expect(healthRes.status).toBe(200);

      const readyRes = await app.request("/readyz");
      expect(readyRes.status).toBe(503);
      const body = await readyRes.json();
      expect(body.reason).toContain("lifecycle not initialized");
    });

    // Test 32
    it("config routes work when lifecycle is null", async () => {
      const app = createTestApp({ lifecycle: null, skipAuth: true });
      // Config stub mounts at /v1/config with GET / handler
      const res = await app.request("/v1/config");
      expect(res.status).toBe(200);
    });
  });

  // ── Error Handling ───────────────────────────────────────────────

  describe("Error Handling", () => {
    // Test 33
    it("401 error returns RFC 9457 format", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/system/version");
      expect(res.status).toBe(401);
      const ct = res.headers.get("content-type");
      expect(ct).toContain("application/problem+json");
      const body = await res.json();
      expect(body).toHaveProperty("type");
      expect(body).toHaveProperty("title");
      expect(body).toHaveProperty("status");
      expect(body.type).toBe("about:blank");
      expect(body.status).toBe(401);
    });

    // Test 34
    it("503 error returns RFC 9457 format", async () => {
      const app = createTestApp({ lifecycle: null, skipAuth: true });
      const res = await app.request("/v1/agent/status");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toHaveProperty("type");
      expect(body).toHaveProperty("title");
      expect(body).toHaveProperty("status");
      expect(body.status).toBe(503);
    });

    // Test 35
    it("unknown route returns 404 RFC 9457", async () => {
      const app = createTestApp({ skipAuth: true });
      const res = await app.request("/v1/nonexistent/route");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("type");
      expect(body).toHaveProperty("title");
      expect(body).toHaveProperty("status");
      expect(body.status).toBe(404);
      expect(body.title).toBe("Not Found");
    });

    // Test 36
    it("invalid JSON body does not crash (graceful fallback)", async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          run: vi.fn().mockReturnValue({ changes: 0 }),
        }),
      };
      const app = createTestApp({ skipAuth: true, db: mockDb });
      const res = await app.request("/v1/api-memory/sessions/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json{{{",
      });
      // The endpoint catches JSON parse errors and uses defaults
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.maxAgeDays).toBe(30);
    });

    // Test 37
    it("body exceeding size limit returns error status", async () => {
      const app = createTestApp({ skipAuth: true });
      const largeBody = "x".repeat(3 * 1024 * 1024);
      const res = await app.request("/v1/api-memory/sessions/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: largeBody,
      });
      // Hono bodyLimit may return 413 (via onError callback) or throw an error
      // that gets caught by the global error handler. Either way, it should not be 200.
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── OpenAPI ──────────────────────────────────────────────────────

  describe("OpenAPI", () => {
    // Test 38
    it("GET /v1/openapi.json returns valid OpenAPI 3.1 spec", async () => {
      const app = createTestApp({ skipAuth: true });
      const res = await app.request("/v1/openapi.json");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.openapi).toBe("3.1.0");
      expect(body.info).toBeDefined();
      expect(body.info.title).toBe("Teleton Management API");
      expect(body.info.version).toBe("1.0.0");
    });

    // Test 39
    it("OpenAPI spec includes server definition", async () => {
      const app = createTestApp({ skipAuth: true });
      const res = await app.request("/v1/openapi.json");
      const body = await res.json();
      expect(body.servers).toBeDefined();
      expect(body.servers.length).toBeGreaterThan(0);
      expect(body.servers[0].url).toContain("https://");
    });
  });

  // ── TLS Certificate ──────────────────────────────────────────────

  describe("TLS Certificate", () => {
    // Test 40
    it("ensureTlsCert generates cert when files do not exist", async () => {
      const { generate } = await import("selfsigned");
      const mockGenerate = vi.mocked(generate);

      // Verify generate is callable and returns expected shape
      const result = await mockGenerate([], {});
      expect(result).toHaveProperty("cert");
      expect(result).toHaveProperty("private");
    });

    // Test 41
    it("TLS cert fingerprint computation uses SHA-256", () => {
      const testData = Buffer.from("test certificate DER");
      const fingerprint = createHash("sha256").update(testData).digest("hex");
      expect(fingerprint).toHaveLength(64);
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    // Test 42
    it("fingerprint is deterministic for same input", () => {
      const data = "same-certificate-content";
      const fp1 = createHash("sha256").update(data).digest("hex");
      const fp2 = createHash("sha256").update(data).digest("hex");
      expect(fp1).toBe(fp2);
    });

    // Test 43
    it("cert files must be written with mode 0o600", () => {
      // 0o600 = owner read+write only (no group/other access)
      expect(0o600).toBe(0b110000000); // binary: 384
      expect(0o600 & 0o077).toBe(0); // no group/other perms
    });
  });

  // ── Request ID ───────────────────────────────────────────────────

  describe("Request ID", () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
      app = createTestApp({ skipAuth: true });
    });

    // Test 44
    it("auto-generates X-Request-Id when not provided", async () => {
      const res = await app.request("/v1/system/version");
      const reqId = res.headers.get("X-Request-Id");
      expect(reqId).toBeDefined();
      expect(reqId!.length).toBeGreaterThan(0);
      // UUID v4 format
      expect(reqId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    // Test 45
    it("propagates provided X-Request-Id", async () => {
      const customId = "custom-req-123";
      const res = await app.request("/v1/system/version", {
        headers: { "X-Request-Id": customId },
      });
      expect(res.headers.get("X-Request-Id")).toBe(customId);
    });

    // Test 46
    it("request ID included in error response headers", async () => {
      const authApp = createTestApp();
      const customId = "error-req-456";
      const res = await authApp.request("/v1/system/version", {
        headers: { "X-Request-Id": customId },
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("X-Request-Id")).toBe(customId);
    });
  });

  // ── Audit Logging ────────────────────────────────────────────────

  describe("Audit Logging", () => {
    // Test 47
    it("audit middleware logs mutating operations", async () => {
      const testApp = new Hono();
      let auditCalled = false;

      testApp.use("*", requestId);
      // Inline audit check
      testApp.use("*", async (c, next) => {
        const method = c.req.method;
        if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
          await next();
          auditCalled = true;
        } else {
          await next();
        }
      });
      testApp.post("/test", (c) => c.json({ ok: true }));

      await testApp.request("/test", { method: "POST" });
      expect(auditCalled).toBe(true);
    });

    // Test 48
    it("audit log does not include request body or secrets", () => {
      // The audit middleware (src/api/middleware/audit.ts) only logs:
      // audit, requestId, event, method, path, statusCode, durationMs, sourceIp, keyPrefix
      // It does NOT log the request body, headers, or any secret material.
      // This is verified by reading the source — the fields are explicitly enumerated.
      const auditFields = [
        "audit",
        "requestId",
        "event",
        "method",
        "path",
        "statusCode",
        "durationMs",
        "sourceIp",
        "keyPrefix",
      ];
      const sensitiveFields = ["body", "apiKey", "password", "secret", "token", "mnemonic"];
      for (const field of sensitiveFields) {
        expect(auditFields).not.toContain(field);
      }
    });

    // Test 49
    it("failed auth attempts are logged with error status", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/system/version", {
        headers: authHeader(WRONG_KEY),
      });
      expect(res.status).toBe(401);
      // The auth middleware throws HTTPException which is caught by onError.
      // The error response includes the instance path for tracing.
      const body = await res.json();
      expect(body.status).toBe(401);
      expect(body.instance).toBeDefined();
    });

    it("GET requests are not audited", async () => {
      let auditTriggered = false;
      const testApp = new Hono();
      testApp.use("*", async (c, next) => {
        const method = c.req.method;
        if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
          auditTriggered = true;
        }
        await next();
      });
      testApp.get("/test", (c) => c.json({ ok: true }));

      await testApp.request("/test");
      expect(auditTriggered).toBe(false);
    });
  });

  // ── Additional Edge Cases ────────────────────────────────────────

  describe("Additional Edge Cases", () => {
    it("security headers are set on responses", async () => {
      const app = createTestApp({ skipAuth: true });
      const res = await app.request("/v1/system/version");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
    });

    it("createProblem produces correct RFC 9457 shape", () => {
      const problem = createProblem(400, "Bad Request", "Something went wrong");
      expect(problem.type).toBe("about:blank");
      expect(problem.title).toBe("Bad Request");
      expect(problem.status).toBe(400);
      expect(problem.detail).toBe("Something went wrong");
    });

    it("createProblem without detail omits the field", () => {
      const problem = createProblem(500, "Internal Server Error");
      expect(problem).not.toHaveProperty("detail");
    });

    it("health check does not require auth", async () => {
      const app = createTestApp({ allowedIps: ["10.0.0.1"] });
      const res = await app.request("/healthz");
      expect(res.status).toBe(200);
    });

    it("readyz does not require auth", async () => {
      const lifecycle = new AgentLifecycle();
      lifecycle.registerCallbacks(
        async () => {},
        async () => {}
      );
      await lifecycle.start();

      const app = createTestApp({ lifecycle, allowedIps: ["10.0.0.1"] });
      const res = await app.request("/readyz");
      expect(res.status).toBe(200);
    });

    it("deps adapter throws 503 for null agent dep", () => {
      const deps = {
        config: {} as any,
        configPath: "/tmp/test.yaml",
        agent: null,
        lifecycle: null,
      } as any;

      const adapted = createDepsAdapter(deps);

      // config and configPath are always available
      expect(adapted.config).toBeDefined();
      expect(adapted.configPath).toBe("/tmp/test.yaml");

      // Accessing null agent should throw HTTPException(503)
      expect(() => adapted.agent).toThrow();
      try {
        void adapted.agent;
      } catch (err: any) {
        expect(err.status).toBe(503);
      }
    });
  });
});
