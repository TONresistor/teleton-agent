import { PluginSDKError } from "@teleton-agent/sdk";

export function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new PluginSDKError(`${label} must not be empty`, "INVALID_INPUT");
  }
  return normalized;
}

export function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PluginSDKError(`${label} must be a positive integer`, "INVALID_INPUT");
  }
  return value;
}

export function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PluginSDKError(`${label} must be a non-negative integer`, "INVALID_INPUT");
  }
  return value;
}

export function requirePositiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new PluginSDKError(`${label} must be a positive number`, "INVALID_INPUT");
  }
  return value;
}

export function boundedLimit(limit: number | undefined, fallback: number, maximum: number): number {
  return Math.min(limit === undefined ? fallback : requirePositiveInteger(limit, "Limit"), maximum);
}
