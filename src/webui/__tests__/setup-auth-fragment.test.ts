import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (before imports) ───────────────────────────────────────────────

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockInvoke = vi.fn();
const mockSessionSave = vi.fn(() => "session-string");

vi.mock("telegram", () => {
  class TelegramClient {
    session = { save: mockSessionSave };
    connected = true;
    connect = mockConnect;
    disconnect = mockDisconnect;
    invoke = mockInvoke;
  }

  // Minimal Api stubs
  const Api = {
    auth: {
      SendCode: class {
        constructor(public args: unknown) {}
      },
      SignIn: class {
        constructor(public args: unknown) {}
      },
      ResendCode: class {
        constructor(public args: unknown) {}
      },
      SentCode: class SentCode {
        phoneCodeHash: string;
        type: unknown;
        constructor(args: { phoneCodeHash: string; type: unknown }) {
          this.phoneCodeHash = args.phoneCodeHash;
          this.type = args.type;
        }
      },
      SentCodeSuccess: class SentCodeSuccess {},
      SentCodeTypeApp: class SentCodeTypeApp {
        length: number;
        constructor(args: { length: number }) {
          this.length = args.length;
        }
      },
      SentCodeTypeFragmentSms: class SentCodeTypeFragmentSms {
        url: string;
        length: number;
        constructor(args: { url: string; length: number }) {
          this.url = args.url;
          this.length = args.length;
        }
      },
      SentCodeTypeSms: class SentCodeTypeSms {
        length: number;
        constructor(args: { length: number }) {
          this.length = args.length;
        }
      },
      Authorization: class Authorization {
        user: unknown;
        constructor(args: { user: unknown }) {
          this.user = args.user;
        }
      },
    },
    CodeSettings: class {
      constructor(_args?: unknown) {}
    },
    User: class User {
      id: bigint;
      firstName: string;
      username?: string;
      constructor(args: { id: bigint; firstName: string; username?: string }) {
        this.id = args.id;
        this.firstName = args.firstName;
        this.username = args.username;
      }
    },
    account: {
      GetPassword: class {
        constructor() {}
      },
    },
  };

  return { TelegramClient, Api };
});

vi.mock("telegram/sessions/index.js", () => ({
  StringSession: class {
    constructor(_s?: string) {}
  },
}));

vi.mock("telegram/Password.js", () => ({
  computeCheck: vi.fn(),
}));

vi.mock("telegram/extensions/Logger.js", () => ({
  Logger: class {
    constructor(_level: unknown) {}
  },
  LogLevel: { NONE: 0 },
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

vi.mock("../../workspace/paths.js", () => ({
  TELETON_ROOT: "/tmp/teleton-test",
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import { TelegramAuthManager } from "../setup-auth.js";
import { Api } from "telegram";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeSentCode(type: unknown, phoneCodeHash = "hash-abc") {
  const result = new Api.auth.SentCode({ phoneCodeHash, type });
  return result;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("TelegramAuthManager — Fragment support", () => {
  let manager: TelegramAuthManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TelegramAuthManager();
  });

  afterEach(async () => {
    await manager.cleanup();
  });

  describe("sendCode", () => {
    it("detects SentCodeTypeFragmentSms and returns codeDelivery 'fragment' with url", async () => {
      const fragmentType = new Api.auth.SentCodeTypeFragmentSms({
        url: "https://fragment.com/number/88812345678",
        length: 5,
      });
      mockInvoke.mockResolvedValue(makeSentCode(fragmentType));

      const result = await manager.sendCode(12345, "abcdef", "+88812345678");

      expect(result.codeDelivery).toBe("fragment");
      expect(result.fragmentUrl).toBe("https://fragment.com/number/88812345678");
      expect(result.codeLength).toBe(5);
      expect(result.authSessionId).toBeTruthy();
    });

    it("detects SentCodeTypeApp and returns codeDelivery 'app'", async () => {
      const appType = new Api.auth.SentCodeTypeApp({ length: 5 });
      mockInvoke.mockResolvedValue(makeSentCode(appType));

      const result = await manager.sendCode(12345, "abcdef", "+1234567890");

      expect(result.codeDelivery).toBe("app");
      expect(result.fragmentUrl).toBeUndefined();
      expect(result.codeLength).toBe(5);
    });

    it("detects SentCodeTypeSms and returns codeDelivery 'sms'", async () => {
      const smsType = new Api.auth.SentCodeTypeSms({ length: 5 });
      mockInvoke.mockResolvedValue(makeSentCode(smsType));

      const result = await manager.sendCode(12345, "abcdef", "+1234567890");

      expect(result.codeDelivery).toBe("sms");
      expect(result.fragmentUrl).toBeUndefined();
      expect(result.codeLength).toBe(5);
    });
  });

  describe("resendCode", () => {
    it("detects Fragment on resend and returns codeDelivery 'fragment'", async () => {
      // First, sendCode to create a session
      const smsType = new Api.auth.SentCodeTypeSms({ length: 5 });
      mockInvoke.mockResolvedValueOnce(makeSentCode(smsType));
      const sendResult = await manager.sendCode(12345, "abcdef", "+88812345678");

      // Now resendCode returns Fragment
      const fragmentType = new Api.auth.SentCodeTypeFragmentSms({
        url: "https://fragment.com/number/88812345678",
        length: 5,
      });
      mockInvoke.mockResolvedValueOnce(makeSentCode(fragmentType, "hash-new"));

      const result = await manager.resendCode(sendResult.authSessionId);

      expect(result).not.toBeNull();
      expect(result!.codeDelivery).toBe("fragment");
      expect(result!.fragmentUrl).toBe("https://fragment.com/number/88812345678");
      expect(result!.codeLength).toBe(5);
    });
  });

  describe("verifyCode", () => {
    it("verifies code for Fragment number (same path as regular)", async () => {
      // Send code first
      const fragmentType = new Api.auth.SentCodeTypeFragmentSms({
        url: "https://fragment.com/number/88812345678",
        length: 5,
      });
      mockInvoke.mockResolvedValueOnce(makeSentCode(fragmentType));
      const sendResult = await manager.sendCode(12345, "abcdef", "+88812345678");

      // Verify code — SignIn returns Authorization
      const mockUser = new Api.User({
        id: BigInt(123),
        firstName: "Fragment",
        username: "fraguser",
      });
      const authResult = new Api.auth.Authorization({ user: mockUser });
      mockInvoke.mockResolvedValueOnce(authResult);

      const result = await manager.verifyCode(sendResult.authSessionId, "12345");

      expect(result.status).toBe("authenticated");
      expect(result.user).toBeDefined();
      expect(result.user!.firstName).toBe("Fragment");
      expect(result.user!.username).toBe("fraguser");
    });
  });
});
