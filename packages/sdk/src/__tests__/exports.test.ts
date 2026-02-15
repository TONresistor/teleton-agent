import { describe, it, expect } from "vitest";
import { PluginSDKError, SDK_VERSION } from "../index.js";

// ─── SDK_VERSION ──────────────────────────────────────────────────

describe("SDK_VERSION", () => {
  it("is exported and is a string", () => {
    expect(SDK_VERSION).toBeDefined();
    expect(typeof SDK_VERSION).toBe("string");
  });

  it("is a valid semver string", () => {
    // Matches major.minor.patch with optional pre-release and build metadata
    const semverRegex =
      /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
    expect(SDK_VERSION).toMatch(semverRegex);
  });

  it("equals '1.0.0'", () => {
    expect(SDK_VERSION).toBe("1.0.0");
  });
});

// ─── PluginSDKError ───────────────────────────────────────────────

describe("PluginSDKError", () => {
  it("is exported and is a function (class)", () => {
    expect(PluginSDKError).toBeDefined();
    expect(typeof PluginSDKError).toBe("function");
  });

  it("is a subclass of Error", () => {
    const err = new PluginSDKError("test message", "OPERATION_FAILED");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PluginSDKError);
  });

  it("has correct name, code, and message properties", () => {
    const err = new PluginSDKError("something broke", "OPERATION_FAILED");
    expect(err.name).toBe("PluginSDKError");
    expect(err.code).toBe("OPERATION_FAILED");
    expect(err.message).toBe("something broke");
  });

  it("has a stack trace", () => {
    const err = new PluginSDKError("trace test", "OPERATION_FAILED");
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe("string");
    expect(err.stack).toContain("trace test");
  });

  // ─── Each error code ─────────────────────────────────────────

  const errorCodes = [
    "BRIDGE_NOT_CONNECTED",
    "WALLET_NOT_INITIALIZED",
    "INVALID_ADDRESS",
    "OPERATION_FAILED",
    "SECRET_NOT_FOUND",
  ] as const;

  describe.each(errorCodes)("error code: %s", (code) => {
    it("can be constructed with this code", () => {
      const err = new PluginSDKError(`Error with code ${code}`, code);
      expect(err.code).toBe(code);
      expect(err.message).toBe(`Error with code ${code}`);
      expect(err.name).toBe("PluginSDKError");
    });

    it("instanceof checks pass correctly", () => {
      const err = new PluginSDKError("test", code);
      expect(err instanceof PluginSDKError).toBe(true);
      expect(err instanceof Error).toBe(true);
    });
  });

  // ─── instanceof behavior ─────────────────────────────────────

  it("is not instanceof other error types", () => {
    const err = new PluginSDKError("test", "OPERATION_FAILED");
    expect(err instanceof TypeError).toBe(false);
    expect(err instanceof RangeError).toBe(false);
    expect(err instanceof SyntaxError).toBe(false);
  });

  it("can be caught as Error in try/catch", () => {
    let caught: Error | undefined;
    try {
      throw new PluginSDKError("catch test", "WALLET_NOT_INITIALIZED");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(PluginSDKError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as PluginSDKError).code).toBe("WALLET_NOT_INITIALIZED");
  });

  // ─── Serialization ───────────────────────────────────────────

  it("serializes to JSON preserving code and message", () => {
    const err = new PluginSDKError("json test", "INVALID_ADDRESS");
    const serialized = JSON.stringify(err);
    const parsed = JSON.parse(serialized);

    // code is an own enumerable property via constructor shorthand
    expect(parsed.code).toBe("INVALID_ADDRESS");
  });

  it("serializes message when explicitly included", () => {
    const err = new PluginSDKError("serialize me", "SECRET_NOT_FOUND");
    const serialized = JSON.stringify({
      name: err.name,
      code: err.code,
      message: err.message,
    });
    const parsed = JSON.parse(serialized);

    expect(parsed.name).toBe("PluginSDKError");
    expect(parsed.code).toBe("SECRET_NOT_FOUND");
    expect(parsed.message).toBe("serialize me");
  });

  it("name property is readonly 'PluginSDKError'", () => {
    const err = new PluginSDKError("readonly test", "OPERATION_FAILED");
    // name is set as a readonly class field with `as const`
    expect(err.name).toBe("PluginSDKError");
  });

  it("code property is readonly", () => {
    const err = new PluginSDKError("readonly code test", "BRIDGE_NOT_CONNECTED");
    // Verify the property descriptor shows it is readonly (via constructor parameter property)
    expect(err.code).toBe("BRIDGE_NOT_CONNECTED");
  });
});

// ─── Named exports existence ──────────────────────────────────────

describe("named exports", () => {
  it("exports PluginSDKError as a class", () => {
    expect(PluginSDKError).toBeDefined();
    expect(PluginSDKError.prototype).toBeDefined();
    expect(PluginSDKError.prototype.constructor).toBe(PluginSDKError);
  });

  it("exports SDK_VERSION as a string constant", () => {
    expect(SDK_VERSION).toBeDefined();
    expect(typeof SDK_VERSION).toBe("string");
  });

  it("module has exactly the expected runtime exports", async () => {
    const mod = await import("../index.js");
    const exportedKeys = Object.keys(mod);
    // Only runtime exports (types are erased at runtime)
    expect(exportedKeys).toContain("PluginSDKError");
    expect(exportedKeys).toContain("SDK_VERSION");
    // These are the only two runtime exports
    const runtimeExports = exportedKeys.filter(
      (k) => typeof (mod as Record<string, unknown>)[k] !== "undefined"
    );
    expect(runtimeExports).toHaveLength(2);
  });
});
