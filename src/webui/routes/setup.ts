/**
 * Setup WebUI API Routes
 *
 * 15 endpoints for the setup wizard. All responses use
 * { success: boolean, data?: T, error?: string } envelope.
 * No auth middleware — localhost-only setup server.
 */

import { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import YAML from "yaml";
import {
  getSupportedProviders,
  getProviderMetadata,
  validateApiKeyFormat,
  type SupportedProvider,
} from "../../config/providers.js";
import { ConfigSchema, DEFAULT_TOOL_RAG_ALWAYS_INCLUDE } from "../../config/schema.js";
import { ensureWorkspace, isNewWorkspace } from "../../workspace/manager.js";
import { TELETON_ROOT } from "../../workspace/paths.js";
import {
  walletExists,
  getWalletAddress,
  generateWallet,
  importWallet,
  saveWallet,
} from "../../ton/wallet-service.js";
import { fetchWithTimeout } from "../../utils/fetch.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../constants/limits.js";
import { TelegramAuthManager } from "../setup-auth.js";
import { createLogger } from "../../utils/logger.js";
import { apiError, telegramAuthError } from "../http.js";
import { assertGrokBuildReady } from "../../providers/grok-build-credentials.js";

const log = createLogger("Setup");

import { getModelsForProvider } from "../../config/model-catalog.js";

// ── Helpers ────────────────────────────────────────────────────────────

function maskKey(key: string): string {
  if (key.length <= 10) return "***";
  return key.slice(0, 6) + "..." + key.slice(-4);
}

// ── Route factory ─────────────────────────────────────────────────────

export function createSetupRoutes(options?: { keyHash?: string }): Hono {
  const app = new Hono();
  const authManager = new TelegramAuthManager();

  // ── GET /status ───────────────────────────────────────────────────
  app.get("/status", async (c) => {
    try {
      const configPath = join(TELETON_ROOT, "config.yaml");
      const sessionPath = join(TELETON_ROOT, "telegram_session.txt");

      const envApiKey = process.env.TELETON_API_KEY;
      const envApiId = process.env.TELETON_TG_API_ID;
      const envApiHash = process.env.TELETON_TG_API_HASH;
      const envPhone = process.env.TELETON_TG_PHONE;

      return c.json({
        success: true,
        data: {
          workspaceExists: existsSync(join(TELETON_ROOT, "workspace")),
          configExists: existsSync(configPath),
          walletExists: walletExists(),
          walletAddress: getWalletAddress(),
          sessionExists: existsSync(sessionPath),
          envVars: {
            apiKey: envApiKey ? maskKey(envApiKey) : null,
            apiKeyRaw: !!envApiKey,
            telegramApiId: envApiId ?? null,
            telegramApiHash: envApiHash ? maskKey(envApiHash) : null,
            telegramPhone: envPhone ?? null,
          },
        },
      });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  // ── GET /providers ────────────────────────────────────────────────
  app.get("/providers", (c) => {
    const providers = getSupportedProviders().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      defaultModel: p.defaultModel,
      utilityModel: p.utilityModel,
      toolLimit: p.toolLimit,
      keyPrefix: p.keyPrefix,
      consoleUrl: p.consoleUrl,
      credentialMode: p.credentialMode,
      requiresApiKey: p.credentialMode === "api-key",
      requiresBaseUrl: p.id === "local",
    }));
    return c.json({ success: true, data: providers });
  });

  // ── GET /models/:provider ─────────────────────────────────────────
  app.get("/models/:provider", (c) => {
    const provider = c.req.param("provider");
    const models = getModelsForProvider(provider);
    const result = [
      ...models,
      {
        value: "__custom__",
        name: "Custom",
        description: "Enter a model ID manually",
        isCustom: true,
      },
    ];
    return c.json({ success: true, data: result });
  });

  // ── POST /validate/api-key ────────────────────────────────────────
  app.post("/validate/api-key", async (c) => {
    try {
      const body = await c.req.json<{ provider: string; apiKey: string }>();
      const error = validateApiKeyFormat(body.provider as SupportedProvider, body.apiKey);
      return c.json({ success: true, data: { valid: !error, error } });
    } catch (error: unknown) {
      return apiError(c, error, 400);
    }
  });

  // ── POST /validate/bot-token ──────────────────────────────────────
  app.post("/validate/bot-token", async (c) => {
    try {
      const body = await c.req.json<{ token: string }>();
      if (!body.token || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(body.token)) {
        return c.json({
          success: true,
          data: { valid: false, networkError: false, error: "Invalid format (expected id:hash)" },
        });
      }

      try {
        const res = await fetchWithTimeout(`https://api.telegram.org/bot${body.token}/getMe`);
        const data = await res.json();
        if (!data.ok) {
          return c.json({
            success: true,
            data: { valid: false, networkError: false, error: "Bot token is invalid" },
          });
        }
        return c.json({
          success: true,
          data: {
            valid: true,
            networkError: false,
            bot: { username: data.result.username, firstName: data.result.first_name },
          },
        });
      } catch {
        return c.json({
          success: true,
          data: { valid: false, networkError: true, error: "Could not reach Telegram API" },
        });
      }
    } catch (error: unknown) {
      return apiError(c, error, 400);
    }
  });

  // ── POST /workspace/init ──────────────────────────────────────────
  app.post("/workspace/init", async (c) => {
    try {
      const body = await c.req
        .json<{ agentName?: string; workspaceDir?: string }>()
        .catch(() => ({ agentName: undefined, workspaceDir: undefined }));
      const workspace = await ensureWorkspace({
        workspaceDir: body.workspaceDir,
        ensureTemplates: true,
      });

      // Replace agent name placeholder in IDENTITY.md
      if (body.agentName?.trim() && existsSync(workspace.identityPath)) {
        const identity = readFileSync(workspace.identityPath, "utf-8");
        const updated = identity.replace(
          "[Your name - pick one or ask your human]",
          body.agentName.trim()
        );
        writeFileSync(workspace.identityPath, updated, "utf-8");
      }

      return c.json({
        success: true,
        data: { created: !isNewWorkspace(workspace) === false, path: workspace.root },
      });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  // ── GET /wallet/status ────────────────────────────────────────────
  app.get("/wallet/status", (c) => {
    const exists = walletExists();
    const address = exists ? getWalletAddress() : undefined;
    return c.json({ success: true, data: { exists, address } });
  });

  // ── POST /wallet/generate ─────────────────────────────────────────
  app.post("/wallet/generate", async (c) => {
    try {
      const wallet = await generateWallet();
      saveWallet(wallet);
      log.info("New TON wallet generated via setup UI");
      return c.json({
        success: true,
        data: { address: wallet.address, mnemonic: wallet.mnemonic },
      });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  // ── POST /wallet/import ───────────────────────────────────────────
  app.post("/wallet/import", async (c) => {
    try {
      const body = await c.req.json<{ mnemonic: string }>();
      const words = body.mnemonic.trim().split(/\s+/);
      if (words.length !== 24) {
        return c.json({ success: false, error: `Expected 24 words, got ${words.length}` }, 400);
      }

      const wallet = await importWallet(words);
      saveWallet(wallet);
      log.info("TON wallet imported via setup UI");
      return c.json({ success: true, data: { address: wallet.address } });
    } catch (error: unknown) {
      return apiError(c, error, 400);
    }
  });

  // ── POST /telegram/send-code ──────────────────────────────────────
  app.post("/telegram/send-code", async (c) => {
    try {
      const body = await c.req.json<{
        apiId: number;
        apiHash: string;
        phone: string;
      }>();

      if (!body.apiId || !body.apiHash || !body.phone) {
        return c.json({ success: false, error: "Missing apiId, apiHash, or phone" }, 400);
      }

      const result = await authManager.sendCode(body.apiId, body.apiHash, body.phone);
      return c.json({ success: true, data: result });
    } catch (error: unknown) {
      return telegramAuthError(c, error);
    }
  });

  // ── POST /telegram/verify-code ────────────────────────────────────
  app.post("/telegram/verify-code", async (c) => {
    try {
      const body = await c.req.json<{ authSessionId: string; code: string }>();
      if (!body.authSessionId || !body.code) {
        return c.json({ success: false, error: "Missing authSessionId or code" }, 400);
      }

      const result = await authManager.verifyCode(body.authSessionId, body.code);
      return c.json({ success: true, data: result });
    } catch (error: unknown) {
      return telegramAuthError(c, error);
    }
  });

  // ── POST /telegram/verify-password ────────────────────────────────
  app.post("/telegram/verify-password", async (c) => {
    try {
      const body = await c.req.json<{ authSessionId: string; password: string }>();
      if (!body.authSessionId || !body.password) {
        return c.json({ success: false, error: "Missing authSessionId or password" }, 400);
      }

      const result = await authManager.verifyPassword(body.authSessionId, body.password);
      return c.json({ success: true, data: result });
    } catch (error: unknown) {
      return telegramAuthError(c, error);
    }
  });

  // ── POST /telegram/resend-code ────────────────────────────────────
  app.post("/telegram/resend-code", async (c) => {
    try {
      const body = await c.req.json<{ authSessionId: string }>();
      if (!body.authSessionId) {
        return c.json({ success: false, error: "Missing authSessionId" }, 400);
      }

      const result = await authManager.resendCode(body.authSessionId);
      if (!result) {
        return c.json({ success: false, error: "Session expired or invalid" }, 400);
      }
      return c.json({ success: true, data: result });
    } catch (error: unknown) {
      return telegramAuthError(c, error);
    }
  });

  // ── POST /telegram/qr-start ────────────────────────────────────
  app.post("/telegram/qr-start", async (c) => {
    try {
      const body = await c.req.json<{ apiId: number; apiHash: string }>();
      if (!body.apiId || !body.apiHash) {
        return c.json({ success: false, error: "Missing apiId or apiHash" }, 400);
      }

      const result = await authManager.startQrSession(body.apiId, body.apiHash);
      return c.json({ success: true, data: result });
    } catch (error: unknown) {
      return telegramAuthError(c, error);
    }
  });

  // ── POST /telegram/qr-refresh ─────────────────────────────────
  app.post("/telegram/qr-refresh", async (c) => {
    try {
      const body = await c.req.json<{ authSessionId: string }>();
      if (!body.authSessionId) {
        return c.json({ success: false, error: "Missing authSessionId" }, 400);
      }

      const result = await authManager.refreshQrToken(body.authSessionId);
      return c.json({ success: true, data: result });
    } catch (error: unknown) {
      return telegramAuthError(c, error);
    }
  });

  // ── DELETE /telegram/session ──────────────────────────────────────
  app.delete("/telegram/session", async (c) => {
    try {
      const body = await c.req
        .json<{ authSessionId: string }>()
        .catch(() => ({ authSessionId: "" }));
      await authManager.cancelSession(body.authSessionId);
      return c.json({ success: true });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  // ── POST /embeddings/warmup ──────────────────────────────────────
  app.post("/embeddings/warmup", async (c) => {
    try {
      const { LocalEmbeddingProvider } = await import("../../memory/embeddings/local.js");
      const provider = new LocalEmbeddingProvider({});
      const success = await provider.warmup();
      return c.json({
        success,
        model: provider.model,
        dimensions: provider.dimensions,
      });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  // ── GET /embeddings/status ─────────────────────────────────────
  app.get("/embeddings/status", (c) => {
    const model = "Xenova/all-MiniLM-L6-v2";
    const modelPath = join(TELETON_ROOT, "models", model, "onnx", "model.onnx");
    try {
      const stats = statSync(modelPath);
      return c.json({ cached: true, model, modelPath, sizeBytes: stats.size });
    } catch {
      return c.json({ cached: false, model, modelPath });
    }
  });

  // ── POST /config/save ─────────────────────────────────────────────
  app.post("/config/save", async (c) => {
    try {
      const input = await c.req.json();
      if (input?.agent?.provider === "grok-build") assertGrokBuildReady();
      const workspace = await ensureWorkspace({ ensureTemplates: true });

      // Resolve provider default model (same as CLI)
      const providerMeta = getProviderMetadata(input.agent.provider as SupportedProvider);

      const config = {
        meta: {
          version: "1.0.0",
          created_at: new Date().toISOString(),
          onboard_command: "teleton setup --ui",
        },
        agent: {
          provider: input.agent.provider,
          api_key: input.agent.api_key ?? "",
          ...(input.agent.base_url ? { base_url: input.agent.base_url } : {}),
          model: input.agent.model || providerMeta.defaultModel,
          max_tokens: 4096,
          temperature: 0.7,
          system_prompt: null,
          max_agentic_iterations: input.agent.max_agentic_iterations ?? 5,
          session_reset_policy: {
            daily_reset_enabled: true,
            daily_reset_hour: 4,
            idle_expiry_enabled: true,
            idle_expiry_minutes: 1440,
          },
        },
        telegram: {
          ...(input.telegram.mode === "bot" ? { mode: "bot" as const } : {}),
          api_id: input.telegram.api_id,
          api_hash: input.telegram.api_hash,
          phone: input.telegram.phone,
          session_name: "teleton_session",
          session_path: workspace.sessionPath,
          dm_policy: input.telegram.dm_policy ?? "open",
          allow_from: [],
          group_policy: input.telegram.group_policy ?? "open",
          group_allow_from: [],
          require_mention: input.telegram.require_mention ?? true,
          max_message_length: TELEGRAM_MAX_MESSAGE_LENGTH,
          typing_simulation: true,
          rate_limit_messages_per_second: 1.0,
          rate_limit_groups_per_minute: 20,
          admin_ids: [input.telegram.owner_id],
          owner_id: input.telegram.owner_id,
          agent_channel: null,
          debounce_ms: 1500,
          bot_token: input.telegram.bot_token,
          bot_username: input.telegram.bot_username,
        },
        storage: {
          sessions_file: `${workspace.root}/sessions.json`,
          memory_file: `${workspace.root}/memory.json`,
          history_limit: 100,
        },
        embedding: { provider: "local" as const },
        webui: {
          enabled: input.webui?.enabled ?? false,
          port: 7777,
          host: "127.0.0.1",
          cors_origins: ["http://localhost:5173", "http://localhost:7777"],
          log_requests: false,
        },
        logging: { level: "info" as const, pretty: true },
        dev: { hot_reload: false },
        tool_rag: {
          enabled: false,
          top_k: 25,
          always_include: [...DEFAULT_TOOL_RAG_ALWAYS_INCLUDE],
          skip_unlimited_providers: false,
        },
        capabilities: {
          exec: {
            mode: input.capabilities?.exec?.mode ?? "off",
            scope: "admin-only",
            allowlist: [],
            limits: { timeout: 120, max_output: 50000 },
            audit: { log_commands: true },
          },
        },
        mcp: { servers: {} },
        plugins: {},
        ...(input.gocoon ? { gocoon: input.gocoon } : {}),
        ...(input.tonapi_key ? { tonapi_key: input.tonapi_key } : {}),
        ...(input.toncenter_api_key ? { toncenter_api_key: input.toncenter_api_key } : {}),
        ...(input.tavily_api_key ? { tavily_api_key: input.tavily_api_key } : {}),
        // Persist Management API key hash so it survives reboots
        api: {
          enabled: true,
          port: 7778,
          host: "0.0.0.0",
          ...(options?.keyHash ? { key_hash: options.keyHash } : {}),
        },
      };

      // Validate with Zod
      ConfigSchema.parse(config);

      // Write with restricted permissions
      const configPath = workspace.configPath;
      writeFileSync(configPath, YAML.stringify(config), { encoding: "utf-8", mode: 0o600 });

      log.info(`Configuration saved: ${configPath}`);
      return c.json({ success: true, data: { path: configPath } });
    } catch (error: unknown) {
      return apiError(c, error, 400);
    }
  });

  return app;
}
