import type {
  AuthCodeResult,
  AuthVerifyResult,
  BotValidation,
  SetupConfig,
  SetupModelOption,
  SetupProvider,
  SetupStatusResponse,
  WalletResult,
  WalletStatus,
} from "./api-types";
import { fetchSetupAPI } from "./http-client";

// ── Setup API (no auth required) ────────────────────────────────────

export const setup = {
  getStatus: () => fetchSetupAPI<SetupStatusResponse>("/setup/status"),

  getProviders: () => fetchSetupAPI<SetupProvider[]>("/setup/providers"),

  getModels: (_provider: string) =>
    fetchSetupAPI<SetupModelOption[]>(`/setup/models/${encodeURIComponent(_provider)}`),

  validateApiKey: (provider: string, apiKey: string) =>
    fetchSetupAPI<{ valid: boolean; error?: string }>("/setup/validate/api-key", {
      method: "POST",
      body: JSON.stringify({ provider, apiKey }),
    }),

  validateBotToken: (token: string) =>
    fetchSetupAPI<BotValidation>("/setup/validate/bot-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  initWorkspace: (agentName?: string) =>
    fetchSetupAPI<{ created: boolean; path: string }>("/setup/workspace/init", {
      method: "POST",
      body: JSON.stringify({ agentName }),
    }),

  getWalletStatus: () => fetchSetupAPI<WalletStatus>("/setup/wallet/status"),

  generateWallet: () => fetchSetupAPI<WalletResult>("/setup/wallet/generate", { method: "POST" }),

  importWallet: (mnemonic: string) =>
    fetchSetupAPI<{ address: string }>("/setup/wallet/import", {
      method: "POST",
      body: JSON.stringify({ mnemonic }),
    }),

  sendCode: (apiId: number, apiHash: string, phone: string) =>
    fetchSetupAPI<AuthCodeResult>("/setup/telegram/send-code", {
      method: "POST",
      body: JSON.stringify({ apiId, apiHash, phone }),
    }),

  verifyCode: (authSessionId: string, code: string) =>
    fetchSetupAPI<AuthVerifyResult>("/setup/telegram/verify-code", {
      method: "POST",
      body: JSON.stringify({ authSessionId, code }),
    }),

  verifyPassword: (authSessionId: string, password: string) =>
    fetchSetupAPI<AuthVerifyResult>("/setup/telegram/verify-password", {
      method: "POST",
      body: JSON.stringify({ authSessionId, password }),
    }),

  resendCode: (authSessionId: string) =>
    fetchSetupAPI<{
      codeDelivery: "app" | "sms" | "fragment";
      fragmentUrl?: string;
      codeLength?: number;
    }>("/setup/telegram/resend-code", {
      method: "POST",
      body: JSON.stringify({ authSessionId }),
    }),

  startQr: (apiId: number, apiHash: string) =>
    fetchSetupAPI<{ authSessionId: string; token: string; expires: number; expiresAt: number }>(
      "/setup/telegram/qr-start",
      {
        method: "POST",
        body: JSON.stringify({ apiId, apiHash }),
      }
    ),

  refreshQr: (authSessionId: string) =>
    fetchSetupAPI<{
      status: "waiting" | "authenticated" | "2fa_required" | "expired";
      token?: string;
      expires?: number;
      user?: { id: number; firstName: string; username?: string };
      passwordHint?: string;
    }>("/setup/telegram/qr-refresh", {
      method: "POST",
      body: JSON.stringify({ authSessionId }),
    }),

  cancelSession: (authSessionId: string) =>
    fetchSetupAPI<void>("/setup/telegram/session", {
      method: "DELETE",
      body: JSON.stringify({ authSessionId }),
    }),

  saveConfig: (config: SetupConfig) =>
    fetchSetupAPI<{ path: string }>("/setup/config/save", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  launch: () => fetchSetupAPI<{ token: string }>("/setup/launch", { method: "POST" }),

  pollHealth: async (timeoutMs = 30000): Promise<void> => {
    const start = Date.now();
    const interval = 1000;
    // Wait a beat for the server to restart
    await new Promise((r) => setTimeout(r, 1500));

    while (Date.now() - start < timeoutMs) {
      try {
        const authRes = await fetch("/auth/check", { signal: AbortSignal.timeout(2000) });
        if (authRes.ok) {
          const json = await authRes.json();
          // The setup server returns { data: { setup: true } } — reject it.
          // The agent WebUI returns { data: { authenticated: bool } } without setup flag.
          if (json.success && json.data && !json.data.setup) return;
        }
      } catch {
        // Server not up yet (connection refused, timeout, etc.)
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error("Agent did not start within the expected time");
  },
};
