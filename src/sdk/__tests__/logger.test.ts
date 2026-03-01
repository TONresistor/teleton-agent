import { vi, describe, it, expect, beforeEach } from "vitest";

const mockPino = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Mock pino logger so we don't need real logging infra
vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => mockPino),
}));

// Mock workspace paths (needed by secrets SDK)
vi.mock("../../workspace/paths.js", () => ({
  TELETON_ROOT: "/tmp/teleton-logger-test",
}));

import { createPluginSDK } from "../index.js";
import type { PluginSDK } from "@teleton-agent/sdk";

const mockBridge = {
  isAvailable: vi.fn(() => true),
  getClient: () => ({
    getClient: () => ({
      invoke: vi.fn(),
      sendMessage: vi.fn(),
      sendFile: vi.fn(),
      getEntity: vi.fn(),
      getInputEntity: vi.fn(),
      getMessages: vi.fn(),
      downloadMedia: vi.fn(),
      uploadFile: vi.fn(),
    }),
    getMe: vi.fn(),
    answerCallbackQuery: vi.fn(),
  }),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  sendReaction: vi.fn(),
  setTyping: vi.fn(),
  getMessages: vi.fn(),
} as any;

describe("SDK Logger wrapper", () => {
  let sdk: PluginSDK;

  beforeEach(() => {
    vi.clearAllMocks();
    sdk = createPluginSDK(
      { bridge: mockBridge },
      {
        pluginName: "logger-test",
        db: null,
        sanitizedConfig: {},
        pluginConfig: {},
      }
    );
  });

  describe("method existence", () => {
    it("has info, warn, error, debug methods", () => {
      expect(typeof sdk.log.info).toBe("function");
      expect(typeof sdk.log.warn).toBe("function");
      expect(typeof sdk.log.error).toBe("function");
      expect(typeof sdk.log.debug).toBe("function");
    });

    it("has no extra properties beyond the 4 log methods", () => {
      const keys = Object.keys(sdk.log).sort();
      expect(keys).toEqual(["debug", "error", "info", "warn"]);
    });
  });

  describe("delegates to pino with joined string args", () => {
    it("forwards single string to pino", () => {
      sdk.log.info("hello");
      expect(mockPino.info).toHaveBeenCalledWith("hello");
    });

    it("joins multiple arguments with space", () => {
      sdk.log.warn("a", "b", "c");
      expect(mockPino.warn).toHaveBeenCalledWith("a b c");
    });

    it("converts non-string arguments via String()", () => {
      sdk.log.error(42 as any, { key: "val" } as any);
      expect(mockPino.error).toHaveBeenCalledWith("42 [object Object]");
    });

    it("converts null and undefined", () => {
      sdk.log.debug(null as any, undefined as any);
      expect(mockPino.debug).toHaveBeenCalledWith("null undefined");
    });

    it("handles no arguments", () => {
      sdk.log.info();
      expect(mockPino.info).toHaveBeenCalledWith("");
    });

    it("routes to correct pino level", () => {
      sdk.log.info("i");
      sdk.log.warn("w");
      sdk.log.error("e");
      sdk.log.debug("d");
      expect(mockPino.info).toHaveBeenCalledWith("i");
      expect(mockPino.warn).toHaveBeenCalledWith("w");
      expect(mockPino.error).toHaveBeenCalledWith("e");
      expect(mockPino.debug).toHaveBeenCalledWith("d");
    });
  });

  describe("frozen", () => {
    it("sdk.log is frozen", () => {
      expect(Object.isFrozen(sdk.log)).toBe(true);
    });
  });
});
