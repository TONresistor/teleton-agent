/**
 * Setup WebUI API Routes
 *
 * 15 endpoints for the setup wizard. All responses use
 * { success: boolean, data?: T, error?: string } envelope.
 * No auth middleware — localhost-only setup server.
 */

import { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import YAML from "yaml";
import {
  getSupportedProviders,
  getProviderMetadata,
  validateApiKeyFormat,
  type SupportedProvider,
} from "../../config/providers.js";
import {
  getClaudeCodeApiKey,
  isClaudeCodeTokenValid,
} from "../../providers/claude-code-credentials.js";
import { ConfigSchema, DealsConfigSchema } from "../../config/schema.js";
import { ensureWorkspace, isNewWorkspace } from "../../workspace/manager.js";
import { TELETON_ROOT } from "../../workspace/paths.js";
import {
  walletExists,
  loadWallet,
  getWalletAddress,
  generateWallet,
  importWallet,
  saveWallet,
} from "../../ton/wallet-service.js";
import { fetchWithTimeout } from "../../utils/fetch.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../constants/limits.js";
import { TelegramAuthManager } from "../setup-auth.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("Setup");

import { getModelsForProvider } from "../../config/model-catalog.js";

// ── Helpers ────────────────────────────────────────────────────────────

function maskKey(key: string): string {
  if (key.length <= 10) return "***";
  return key.slice(0, 6) + "..." + key.slice(-4);
}

// ── Route factory ─────────────────────────────────────────────────────

export function createSetupRoutes(): Hono {
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
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
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
      requiresApiKey: p.id !== "cocoon" && p.id !== "local" && p.id !== "claude-code",
      autoDetectsKey: p.id === "claude-code",
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

  // ── GET /detect-claude-code-key ───────────────────────────────────
  app.get("/detect-claude-code-key", (c) => {
    try {
      const key = getClaudeCodeApiKey();
      // TODO: revert to masked key after testing
      // const masked = key.slice(0, 12) + "****" + key.slice(-4);
      const masked = key; // TEMP: show full key for testing
      return c.json({
        success: true,
        data: {
          found: true,
          maskedKey: masked,
          valid: isClaudeCodeTokenValid(),
        },
      });
    } catch {
      return c.json({
        success: true,
        data: { found: false, maskedKey: null, valid: false },
      });
    }
  });

  // ── POST /validate/api-key ────────────────────────────────────────
  app.post("/validate/api-key", async (c) => {
    try {
      const body = await c.req.json<{ provider: string; apiKey: string }>();
      const error = validateApiKeyFormat(body.provider as SupportedProvider, body.apiKey);
      return c.json({ success: true, data: { valid: !error, error } });
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        400
      );
    }
  });

  // ── POST /validate/bot-token ──────────────────────────────────────
  app.post("/validate/bot-token", async (c) => {
    try {
      const body = await c.req.json<{ token: string }>();
      if (!body.token || !body.token.includes(":")) {
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
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        400
      );
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
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
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
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
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
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        400
      );
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
    } catch (err: unknown) {
      const error = err as { errorMessage?: string; seconds?: number; message?: string };
      if (error.seconds) {
        return c.json(
          {
            success: false,
            error: `Rate limited. Please wait ${error.seconds} seconds.`,
          },
          429
        );
      }
      return c.json(
        { success: false, error: error.errorMessage || error.message || String(err) },
        500
      );
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
    } catch (err: unknown) {
      const error = err as { errorMessage?: string; seconds?: number; message?: string };
      if (error.seconds) {
        return c.json(
          {
            success: false,
            error: `Rate limited. Please wait ${error.seconds} seconds.`,
          },
          429
        );
      }
      return c.json(
        { success: false, error: error.errorMessage || error.message || String(err) },
        500
      );
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
    } catch (err: unknown) {
      const error = err as { errorMessage?: string; seconds?: number; message?: string };
      if (error.seconds) {
        return c.json(
          {
            success: false,
            error: `Rate limited. Please wait ${error.seconds} seconds.`,
          },
          429
        );
      }
      return c.json(
        { success: false, error: error.errorMessage || error.message || String(err) },
        500
      );
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
    } catch (err: unknown) {
      const error = err as { errorMessage?: string; seconds?: number; message?: string };
      if (error.seconds) {
        return c.json(
          {
            success: false,
            error: `Rate limited. Please wait ${error.seconds} seconds.`,
          },
          429
        );
      }
      return c.json(
        { success: false, error: error.errorMessage || error.message || String(err) },
        500
      );
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
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // ── POST /config/save ─────────────────────────────────────────────
  app.post("/config/save", async (c) => {
    try {
      const input = await c.req.json();
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
        deals: DealsConfigSchema.parse({
          enabled: true,
          ...(input.deals ?? {}),
        }),
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
          always_include: [
            "telegram_send_message",
            "telegram_reply_message",
            "telegram_send_photo",
            "telegram_send_document",
            "journal_*",
            "workspace_*",
            "web_*",
          ],
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
        ...(input.cocoon ? { cocoon: input.cocoon } : {}),
        ...(input.tonapi_key ? { tonapi_key: input.tonapi_key } : {}),
        ...(input.toncenter_api_key ? { toncenter_api_key: input.toncenter_api_key } : {}),
        ...(input.tavily_api_key ? { tavily_api_key: input.tavily_api_key } : {}),
      };

      // Validate with Zod
      ConfigSchema.parse(config);

      // Write with restricted permissions
      const configPath = workspace.configPath;
      writeFileSync(configPath, YAML.stringify(config), { encoding: "utf-8", mode: 0o600 });

      log.info(`Configuration saved: ${configPath}`);
      return c.json({ success: true, data: { path: configPath } });
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        400
      );
    }
  });

  return app;
}
