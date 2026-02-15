/** Error codes thrown by SDK methods */
export type SDKErrorCode =
  | "BRIDGE_NOT_CONNECTED"
  | "WALLET_NOT_INITIALIZED"
  | "INVALID_ADDRESS"
  | "OPERATION_FAILED"
  | "SECRET_NOT_FOUND";

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

  constructor(
    message: string,
    public readonly code: SDKErrorCode
  ) {
    super(message);
  }
}
