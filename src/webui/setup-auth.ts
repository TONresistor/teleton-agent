/**
 * Telegram Authentication State Machine for Setup WebUI
 *
 * Manages GramJS client lifecycle across HTTP requests.
 * Uses direct API invoke (NOT client.start()) for HTTP-compatible auth.
 */

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { computeCheck } from "telegram/Password.js";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Setup");

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CODE_ATTEMPTS = 5;
const MAX_PASSWORD_ATTEMPTS = 3;

interface AuthSession {
  id: string;
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string; // NEVER sent to frontend
  state: "code_sent" | "2fa_required" | "authenticated" | "failed";
  passwordHint?: string;
  fragmentUrl?: string;
  codeLength?: number;
  codeAttempts: number;
  passwordAttempts: number;
  createdAt: number;
  apiId: number;
  apiHash: string;
  timer: ReturnType<typeof setTimeout>;
}

export class TelegramAuthManager {
  private session: AuthSession | null = null;

  /**
   * Send verification code to phone number
   */
  async sendCode(
    apiId: number,
    apiHash: string,
    phone: string
  ): Promise<{
    authSessionId: string;
    codeDelivery: "app" | "sms" | "fragment";
    fragmentUrl?: string;
    codeLength?: number;
    expiresAt: number;
  }> {
    // Clean up any existing session
    await this.cleanup();

    const gramLogger = new Logger(LogLevel.NONE);
    const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 3,
      floodSleepThreshold: 0,
      baseLogger: gramLogger,
    });

    await client.connect();

    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      })
    );

    if (result instanceof Api.auth.SentCodeSuccess) {
      await client.disconnect();
      throw new Error("Account already authenticated (SentCodeSuccess)");
    }

    // Detect code delivery method
    let codeDelivery: "app" | "sms" | "fragment" = "sms";
    let fragmentUrl: string | undefined;
    let codeLength: number | undefined;

    if (result.type instanceof Api.auth.SentCodeTypeApp) {
      codeDelivery = "app";
      codeLength = result.type.length;
    } else if (result.type instanceof Api.auth.SentCodeTypeFragmentSms) {
      codeDelivery = "fragment";
      fragmentUrl = result.type.url;
      codeLength = result.type.length;
    } else if ("length" in result.type) {
      codeLength = result.type.length as number;
    }

    const id = randomBytes(16).toString("hex");
    const expiresAt = Date.now() + SESSION_TTL_MS;

    this.session = {
      id,
      client,
      phone,
      phoneCodeHash: result.phoneCodeHash,
      state: "code_sent",
      fragmentUrl,
      codeLength,
      codeAttempts: 0,
      passwordAttempts: 0,
      createdAt: Date.now(),
      apiId,
      apiHash,
      timer: setTimeout(() => this.cleanup(), SESSION_TTL_MS),
    };

    log.info("Telegram verification code sent");
    return { authSessionId: id, codeDelivery, fragmentUrl, codeLength, expiresAt };
  }

  /**
   * Verify the code entered by the user
   */
  async verifyCode(
    authSessionId: string,
    code: string
  ): Promise<{
    status: "authenticated" | "2fa_required" | "invalid_code" | "expired" | "too_many_attempts";
    user?: { id: number; firstName: string; username?: string };
    passwordHint?: string;
  }> {
    const session = this.getSession(authSessionId);
    if (!session) return { status: "expired" };

    if (session.codeAttempts >= MAX_CODE_ATTEMPTS) {
      return { status: "too_many_attempts" };
    }

    session.codeAttempts++;

    try {
      const result = await session.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: session.phone,
          phoneCodeHash: session.phoneCodeHash,
          phoneCode: code,
        })
      );

      // Success - save session
      session.state = "authenticated";
      const user = this.extractUser(result);
      await this.saveSession(session);
      log.info("Telegram authentication successful");
      return { status: "authenticated", user };
    } catch (err: unknown) {
      const error = err as { errorMessage?: string };

      if (error.errorMessage === "SESSION_PASSWORD_NEEDED") {
        session.state = "2fa_required";
        // Get password hint
        try {
          const passwordResult = await session.client.invoke(new Api.account.GetPassword());
          session.passwordHint = passwordResult.hint ?? undefined;
        } catch {
          // No hint available
        }
        return { status: "2fa_required", passwordHint: session.passwordHint };
      }

      if (error.errorMessage === "PHONE_CODE_INVALID") {
        return { status: "invalid_code" };
      }

      if (error.errorMessage === "PHONE_CODE_EXPIRED") {
        session.state = "failed";
        return { status: "expired" };
      }

      throw err;
    }
  }

  /**
   * Verify 2FA password
   */
  async verifyPassword(
    authSessionId: string,
    password: string
  ): Promise<{
    status: "authenticated" | "invalid_password" | "expired" | "too_many_attempts";
    user?: { id: number; firstName: string; username?: string };
  }> {
    const session = this.getSession(authSessionId);
    if (!session) return { status: "expired" };
    if (session.state !== "2fa_required") return { status: "expired" };

    if (session.passwordAttempts >= MAX_PASSWORD_ATTEMPTS) {
      return { status: "too_many_attempts" };
    }

    session.passwordAttempts++;

    try {
      const srpResult = await session.client.invoke(new Api.account.GetPassword());
      const srpCheck = await computeCheck(srpResult, password);
      const result = await session.client.invoke(
        new Api.auth.CheckPassword({ password: srpCheck })
      );

      session.state = "authenticated";
      const user = this.extractUser(result);
      await this.saveSession(session);
      log.info("Telegram 2FA authentication successful");
      return { status: "authenticated", user };
    } catch (err: unknown) {
      const error = err as { errorMessage?: string };

      if (error.errorMessage === "PASSWORD_HASH_INVALID") {
        return { status: "invalid_password" };
      }

      throw err;
    }
  }

  /**
   * Resend verification code
   */
  async resendCode(authSessionId: string): Promise<{
    codeDelivery: "app" | "sms" | "fragment";
    fragmentUrl?: string;
    codeLength?: number;
  } | null> {
    const session = this.getSession(authSessionId);
    if (!session || session.state !== "code_sent") return null;

    const result = await session.client.invoke(
      new Api.auth.ResendCode({
        phoneNumber: session.phone,
        phoneCodeHash: session.phoneCodeHash,
      })
    );

    // ResendCode returns TypeSentCode (SentCode | SentCodeSuccess)
    if (result instanceof Api.auth.SentCode) {
      session.phoneCodeHash = result.phoneCodeHash;
      session.codeAttempts = 0;

      let codeDelivery: "app" | "sms" | "fragment" = "sms";
      let fragmentUrl: string | undefined;
      let codeLength: number | undefined;

      if (result.type instanceof Api.auth.SentCodeTypeApp) {
        codeDelivery = "app";
        codeLength = result.type.length;
      } else if (result.type instanceof Api.auth.SentCodeTypeFragmentSms) {
        codeDelivery = "fragment";
        fragmentUrl = result.type.url;
        codeLength = result.type.length;
      } else if ("length" in result.type) {
        codeLength = result.type.length as number;
      }

      session.fragmentUrl = fragmentUrl;
      session.codeLength = codeLength;

      return { codeDelivery, fragmentUrl, codeLength };
    }

    // SentCodeSuccess means already authenticated
    return { codeDelivery: "sms" };
  }

  /**
   * Cancel and clean up session
   */
  async cancelSession(authSessionId: string): Promise<void> {
    if (this.session?.id === authSessionId) {
      await this.cleanup();
    }
  }

  /**
   * Clean up: disconnect client, clear timer, remove session
   */
  async cleanup(): Promise<void> {
    if (!this.session) return;

    clearTimeout(this.session.timer);

    try {
      if (this.session.client.connected) {
        await this.session.client.disconnect();
      }
    } catch (err) {
      log.warn({ err }, "Error disconnecting auth client");
    }

    this.session = null;
  }

  private getSession(id: string): AuthSession | null {
    if (!this.session || this.session.id !== id) return null;
    // Check TTL
    if (Date.now() - this.session.createdAt > SESSION_TTL_MS) {
      this.cleanup();
      return null;
    }
    return this.session;
  }

  private extractUser(
    result: Api.auth.TypeAuthorization
  ): { id: number; firstName: string; username?: string } | undefined {
    if (result instanceof Api.auth.Authorization && result.user instanceof Api.User) {
      return {
        id: Number(result.user.id),
        firstName: result.user.firstName ?? "",
        username: result.user.username ?? undefined,
      };
    }
    return undefined;
  }

  private async saveSession(session: AuthSession): Promise<void> {
    const sessionString = session.client.session.save() as unknown as string;
    const sessionPath = join(TELETON_ROOT, "telegram_session.txt");

    const dir = dirname(sessionPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(sessionPath, sessionString, { mode: 0o600 });
    log.info("Telegram session saved");
  }
}
