import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startQrSession: vi.fn(),
  refreshQrToken: vi.fn(),
  cleanup: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("../../../../webui/setup-auth.js", () => ({
  TelegramAuthManager: class {
    startQrSession = mocks.startQrSession;
    refreshQrToken = mocks.refreshQrToken;
    cleanup = mocks.cleanup;
  },
}));
vi.mock("qrcode-terminal", () => ({ generate: mocks.generate }));

import { authenticateWithQr } from "../qr-auth.js";

describe("CLI QR authentication", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("shows the Telegram login token and returns the account after scanning", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.startQrSession.mockResolvedValue({ authSessionId: "session", token: "token" });
    mocks.refreshQrToken.mockResolvedValue({
      status: "authenticated",
      user: { id: 123, firstName: "Ada", phone: "+123456789" },
    });
    mocks.cleanup.mockResolvedValue(undefined);

    const authentication = authenticateWithQr(123, "hash");
    await vi.advanceTimersByTimeAsync(5000);

    await expect(authentication).resolves.toMatchObject({ id: 123, phone: "+123456789" });
    expect(mocks.startQrSession).toHaveBeenCalledWith(123, "hash");
    expect(mocks.generate).toHaveBeenCalledWith(
      "tg://login?token=token",
      { small: true },
      expect.any(Function)
    );
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });
});
