import { describe, it, expect } from "vitest";
import { validateStep, type WizardData } from "../validate-step.js";

function makeData(overrides: Partial<WizardData> = {}): WizardData {
  return {
    riskAccepted: false,
    agentName: "Nova",
    provider: "",
    apiKey: "",
    cocoonPort: 11435,
    localUrl: "http://localhost:11434/v1",
    apiId: 0,
    apiHash: "",
    phone: "",
    userId: 0,
    mode: "quick",
    model: "",
    customModel: "",
    dmPolicy: "open",
    groupPolicy: "allowlist",
    requireMention: true,
    maxIterations: 5,
    botToken: "",
    botUsername: "",
    tonapiKey: "",
    tavilyKey: "",
    customizeThresholds: false,
    buyMaxFloor: 100,
    sellMinFloor: 105,
    walletAction: "generate",
    mnemonic: "",
    walletAddress: "",
    mnemonicSaved: false,
    authSessionId: "",
    telegramUser: null,
    skipConnect: false,
    webuiEnabled: false,
    ...overrides,
  };
}

describe("validateStep", () => {
  // ── Step 0: Welcome ──────────────────────────────────────────────
  describe("step 0 — Welcome", () => {
    it("returns true when riskAccepted is true", () => {
      expect(validateStep(0, makeData({ riskAccepted: true }))).toBe(true);
    });

    it("returns false when riskAccepted is false", () => {
      expect(validateStep(0, makeData({ riskAccepted: false }))).toBe(false);
    });
  });

  // ── Step 1: Provider ─────────────────────────────────────────────
  describe("step 1 — Provider", () => {
    it("returns true with a provider and apiKey", () => {
      expect(validateStep(1, makeData({ provider: "anthropic", apiKey: "sk-abc" }))).toBe(true);
    });

    it("returns false when provider is empty", () => {
      expect(validateStep(1, makeData({ provider: "", apiKey: "sk-abc" }))).toBe(false);
    });

    it("returns false when apiKey is empty for standard provider", () => {
      expect(validateStep(1, makeData({ provider: "anthropic", apiKey: "" }))).toBe(false);
    });

    it("returns true for cocoon with valid port", () => {
      expect(validateStep(1, makeData({ provider: "cocoon", cocoonPort: 3000 }))).toBe(true);
    });

    it("returns true for cocoon with port 1 (lower bound)", () => {
      expect(validateStep(1, makeData({ provider: "cocoon", cocoonPort: 1 }))).toBe(true);
    });

    it("returns true for cocoon with port 65535 (upper bound)", () => {
      expect(validateStep(1, makeData({ provider: "cocoon", cocoonPort: 65535 }))).toBe(true);
    });

    it("returns false for cocoon with port 0", () => {
      expect(validateStep(1, makeData({ provider: "cocoon", cocoonPort: 0 }))).toBe(false);
    });

    it("returns false for cocoon with port exceeding 65535", () => {
      expect(validateStep(1, makeData({ provider: "cocoon", cocoonPort: 70000 }))).toBe(false);
    });

    it("returns true for local with valid URL", () => {
      expect(
        validateStep(1, makeData({ provider: "local", localUrl: "http://localhost:11434/v1" }))
      ).toBe(true);
    });

    it("returns false for local with invalid URL", () => {
      expect(validateStep(1, makeData({ provider: "local", localUrl: "not-a-url" }))).toBe(false);
    });

    it("returns true for local with empty localUrl (default is valid)", () => {
      // Default localUrl is http://localhost:11434/v1 which is valid
      expect(validateStep(1, makeData({ provider: "local" }))).toBe(true);
    });
  });

  // ── Step 2: Telegram ─────────────────────────────────────────────
  describe("step 2 — Telegram", () => {
    const validTelegram = {
      apiId: 123456,
      apiHash: "abcdef1234",
      phone: "+33612345678",
      userId: 456,
    };

    it("returns true with all valid Telegram fields", () => {
      expect(validateStep(2, makeData(validTelegram))).toBe(true);
    });

    it("returns false when apiId is 0", () => {
      expect(validateStep(2, makeData({ ...validTelegram, apiId: 0 }))).toBe(false);
    });

    it("returns false when apiHash is too short", () => {
      expect(validateStep(2, makeData({ ...validTelegram, apiHash: "short" }))).toBe(false);
    });

    it("returns true when apiHash is exactly 10 characters", () => {
      expect(validateStep(2, makeData({ ...validTelegram, apiHash: "1234567890" }))).toBe(true);
    });

    it("returns false when phone does not start with +", () => {
      expect(validateStep(2, makeData({ ...validTelegram, phone: "33612345678" }))).toBe(false);
    });

    it("returns false when userId is 0", () => {
      expect(validateStep(2, makeData({ ...validTelegram, userId: 0 }))).toBe(false);
    });

    it("returns true for +888 anonymous number with valid userId", () => {
      expect(
        validateStep(2, makeData({ ...validTelegram, phone: "+88812345678", userId: 789 }))
      ).toBe(true);
    });

    it("returns false for +888 anonymous number without userId", () => {
      expect(
        validateStep(2, makeData({ ...validTelegram, phone: "+88812345678", userId: 0 }))
      ).toBe(false);
    });
  });

  // ── Step 3: Config ───────────────────────────────────────────────
  describe("step 3 — Config", () => {
    it("returns true with a model selected", () => {
      expect(validateStep(3, makeData({ provider: "anthropic", model: "claude-sonnet" }))).toBe(
        true
      );
    });

    it("returns false with no model for standard provider", () => {
      expect(validateStep(3, makeData({ provider: "anthropic", model: "" }))).toBe(false);
    });

    it("returns true with __custom__ and customModel set", () => {
      expect(
        validateStep(
          3,
          makeData({ provider: "anthropic", model: "__custom__", customModel: "my-model" })
        )
      ).toBe(true);
    });

    it("returns false with __custom__ but empty customModel", () => {
      expect(
        validateStep(3, makeData({ provider: "anthropic", model: "__custom__", customModel: "" }))
      ).toBe(false);
    });

    it("returns true for cocoon without model (skips model check)", () => {
      expect(validateStep(3, makeData({ provider: "cocoon", model: "" }))).toBe(true);
    });

    it("returns true for local without model (skips model check)", () => {
      expect(validateStep(3, makeData({ provider: "local", model: "" }))).toBe(true);
    });

    it("returns false when maxIterations is 0", () => {
      expect(validateStep(3, makeData({ provider: "cocoon", maxIterations: 0 }))).toBe(false);
    });

    it("returns false when maxIterations exceeds 50", () => {
      expect(validateStep(3, makeData({ provider: "cocoon", maxIterations: 51 }))).toBe(false);
    });

    it("returns true when maxIterations is 1 (lower bound)", () => {
      expect(validateStep(3, makeData({ provider: "cocoon", maxIterations: 1 }))).toBe(true);
    });

    it("returns true when maxIterations is 50 (upper bound)", () => {
      expect(validateStep(3, makeData({ provider: "cocoon", maxIterations: 50 }))).toBe(true);
    });
  });

  // ── Step 4: Wallet ───────────────────────────────────────────────
  describe("step 4 — Wallet", () => {
    it("returns true when walletAction is keep", () => {
      expect(validateStep(4, makeData({ walletAction: "keep" }))).toBe(true);
    });

    it("returns false when no walletAddress after generate", () => {
      expect(validateStep(4, makeData({ walletAction: "generate", walletAddress: "" }))).toBe(
        false
      );
    });

    it("returns false when walletAddress set but mnemonicSaved is false", () => {
      expect(
        validateStep(
          4,
          makeData({ walletAction: "generate", walletAddress: "EQ...", mnemonicSaved: false })
        )
      ).toBe(false);
    });

    it("returns true when walletAddress set and mnemonicSaved is true", () => {
      expect(
        validateStep(
          4,
          makeData({ walletAction: "generate", walletAddress: "EQ...", mnemonicSaved: true })
        )
      ).toBe(true);
    });

    it("returns true for import with address and mnemonicSaved", () => {
      expect(
        validateStep(
          4,
          makeData({ walletAction: "import", walletAddress: "EQ...", mnemonicSaved: true })
        )
      ).toBe(true);
    });
  });

  // ── Step 5: Connect ──────────────────────────────────────────────
  describe("step 5 — Connect", () => {
    it("returns true when telegramUser is set", () => {
      expect(
        validateStep(
          5,
          makeData({ telegramUser: { id: 1, firstName: "Alice", username: "alice" } })
        )
      ).toBe(true);
    });

    it("returns true when skipConnect is true", () => {
      expect(validateStep(5, makeData({ skipConnect: true }))).toBe(true);
    });

    it("returns false when telegramUser is null and skipConnect is false", () => {
      expect(validateStep(5, makeData({ telegramUser: null, skipConnect: false }))).toBe(false);
    });
  });

  // ── Default: unknown step ────────────────────────────────────────
  describe("unknown step", () => {
    it("returns false for step 99", () => {
      expect(validateStep(99, makeData())).toBe(false);
    });

    it("returns false for negative step", () => {
      expect(validateStep(-1, makeData())).toBe(false);
    });
  });
});
