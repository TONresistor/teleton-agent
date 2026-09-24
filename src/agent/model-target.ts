import { createHash } from "node:crypto";
import type { SupportedProvider } from "../config/providers.js";
import { getProviderModel } from "./client.js";

export function resolveModelTarget(
  provider: SupportedProvider,
  requestedModel: string,
  baseUrl?: string
): { resolvedModel: string; endpointFingerprint: string } {
  const model = getProviderModel(provider, requestedModel, baseUrl);
  return {
    resolvedModel: model.id,
    endpointFingerprint: createHash("sha256")
      .update(model.baseUrl ?? `${model.provider}:${model.api}`)
      .digest("hex")
      .slice(0, 16),
  };
}
