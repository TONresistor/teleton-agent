import qrcode from "qrcode-terminal";
import { password, inquirerTheme } from "../../prompts.js";
import { TelegramAuthManager } from "../../../webui/setup-auth.js";

interface AuthenticatedUser {
  id: number;
  firstName: string;
  username?: string;
  phone?: string;
}

function showQr(token: string): void {
  console.clear();
  console.log("\n  Scan this QR code in Telegram: Settings → Devices → Link Desktop Device\n");
  qrcode.generate(`tg://login?token=${token}`, { small: true }, (code) => {
    console.log(code);
  });
  console.log("  Waiting for Telegram to confirm the login...\n");
}

export async function authenticateWithQr(
  apiId: number,
  apiHash: string
): Promise<AuthenticatedUser> {
  const manager = new TelegramAuthManager(false);
  try {
    const started = await manager.startQrSession(apiId, apiHash);
    let token = started.token;
    showQr(token);

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const result = await manager.refreshQrToken(started.authSessionId);

      if (result.status === "authenticated") {
        if (!result.user) throw new Error("Telegram authenticated but did not return an account");
        return result.user;
      }
      if (result.status === "expired")
        throw new Error("QR login expired. Run setup again to retry.");

      if (result.status === "2fa_required") {
        for (let attempt = 0; attempt < 3; attempt++) {
          const value = await password({
            message: result.passwordHint
              ? `Telegram 2FA password (hint: ${result.passwordHint})`
              : "Telegram 2FA password",
            theme: inquirerTheme,
          });
          const verified = await manager.verifyPassword(started.authSessionId, value);
          if (verified.status === "authenticated") {
            if (!verified.user)
              throw new Error("Telegram authenticated but did not return an account");
            return verified.user;
          }
          if (verified.status === "expired")
            throw new Error("QR login expired. Run setup again to retry.");
          if (verified.status === "too_many_attempts") break;
          console.log("  Invalid 2FA password. Try again.");
        }
        throw new Error("Too many invalid 2FA password attempts");
      }

      if (result.token && result.token !== token) {
        token = result.token;
        showQr(token);
      }
    }
  } finally {
    await manager.cleanup();
  }
}
