const SDK_ERROR_CODES = [
  "BRIDGE_NOT_CONNECTED",
  "WALLET_NOT_INITIALIZED",
  "INVALID_ADDRESS",
  "INVALID_INPUT",
  "NOT_AVAILABLE",
  "RATE_LIMITED",
  "TRANSACTION_FAILED",
  "PERMISSION_DENIED",
  "OPERATION_FAILED",
  "SECRET_NOT_FOUND",
] as const;

/** Error codes thrown by SDK methods */
export type SDKErrorCode = (typeof SDK_ERROR_CODES)[number];

/**
 * Error thrown by Plugin SDK operations.
 *
 * Use the `code` property for programmatic error handling:
 *
 * ```typescript
 * try {
 *   await sdk.ton.sendTON(address, amount);
 * } catch (err) {
 *   if (err instanceof PluginSDKError && err.code === "WALLET_NOT_INITIALIZED") {
 *     // Handle wallet not configured
 *   }
 * }
 * ```
 */
export class PluginSDKError extends Error {
  public readonly name = "PluginSDKError" as const;

  /** Recognize SDK errors across independently installed or bundled SDK copies. */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (super[Symbol.hasInstance](value)) return true;
    if (this !== PluginSDKError) return false;
    return (
      typeof value === "object" &&
      value !== null &&
      "name" in value &&
      value.name === "PluginSDKError" &&
      "message" in value &&
      typeof value.message === "string" &&
      "code" in value &&
      typeof value.code === "string" &&
      SDK_ERROR_CODES.includes(value.code as SDKErrorCode)
    );
  }

  constructor(
    message: string,
    public readonly code: SDKErrorCode
  ) {
    super(message);
  }
}
