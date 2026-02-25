import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import {
  CONFIGURABLE_KEYS,
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  readRawConfig,
  writeRawConfig,
} from "../../config/configurable-keys.js";
import type { ConfigKeyType, ConfigCategory } from "../../config/configurable-keys.js";
import { getModelsForProvider } from "../../config/model-catalog.js";
import {
  getProviderMetadata,
  validateApiKeyFormat,
  type SupportedProvider,
} from "../../config/providers.js";

interface ConfigKeyData {
  key: string;
  label: string;
  set: boolean;
  value: string | null;
  sensitive: boolean;
  type: ConfigKeyType;
  category: ConfigCategory;
  description: string;
  options?: string[];
  optionLabels?: Record<string, string>;
  itemType?: "string" | "number";
}

export function createConfigRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // List all configurable keys with masked values
  app.get("/", (c) => {
    try {
      const raw = readRawConfig(deps.configPath);

      const data: ConfigKeyData[] = Object.entries(CONFIGURABLE_KEYS).map(([key, meta]) => {
        const rawValue = getNestedValue(raw, key);
        const isSet =
          rawValue != null &&
          rawValue !== "" &&
          !(Array.isArray(rawValue) && rawValue.length === 0);
        const displayValue = isSet
          ? meta.type === "array"
            ? JSON.stringify(rawValue)
            : meta.mask(String(rawValue))
          : null;
        return {
          key,
          label: meta.label,
          set: isSet,
          value: displayValue,
          sensitive: meta.sensitive,
          type: meta.type,
          category: meta.category,
          description: meta.description,
          ...(meta.options ? { options: meta.options } : {}),
          ...(meta.optionLabels ? { optionLabels: meta.optionLabels } : {}),
          ...(meta.itemType ? { itemType: meta.itemType } : {}),
        };
      });

      const response: APIResponse<ConfigKeyData[]> = { success: true, data };
      return c.json(response);
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) } as APIResponse,
        500
      );
    }
  });

  // Set a configurable key
  app.put("/:key", async (c) => {
    const key = c.req.param("key");
    const meta = CONFIGURABLE_KEYS[key];
    if (!meta) {
      const allowed = Object.keys(CONFIGURABLE_KEYS).join(", ");
      return c.json(
        {
          success: false,
          error: `Key "${key}" is not configurable. Allowed: ${allowed}`,
        } as APIResponse,
        400
      );
    }

    let body: { value?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" } as APIResponse, 400);
    }

    const value = body.value;

    // ── Array keys ────────────────────────────────────────────────────
    if (meta.type === "array") {
      if (!Array.isArray(value)) {
        return c.json(
          { success: false, error: "Value must be an array for array keys" } as APIResponse,
          400
        );
      }

      // Validate each item
      for (let i = 0; i < value.length; i++) {
        const itemStr = String(value[i]);
        const itemErr = meta.validate(itemStr);
        if (itemErr) {
          return c.json(
            {
              success: false,
              error: `Invalid item at index ${i} for ${key}: ${itemErr}`,
            } as APIResponse,
            400
          );
        }
      }

      try {
        const parsed = value.map((item) => meta.parse(String(item)));
        const raw = readRawConfig(deps.configPath);
        setNestedValue(raw, key, parsed);
        writeRawConfig(raw, deps.configPath);

        const runtimeConfig = deps.agent.getConfig() as Record<string, any>;
        setNestedValue(runtimeConfig, key, parsed);

        const result: ConfigKeyData = {
          key,
          label: meta.label,
          set: parsed.length > 0,
          value: JSON.stringify(parsed),
          sensitive: meta.sensitive,
          type: meta.type,
          category: meta.category,
          description: meta.description,
          ...(meta.itemType ? { itemType: meta.itemType } : {}),
        };
        return c.json({ success: true, data: result } as APIResponse<ConfigKeyData>);
      } catch (err) {
        return c.json(
          {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          } as APIResponse,
          500
        );
      }
    }

    // ── Scalar keys ───────────────────────────────────────────────────
    if (value == null || typeof value !== "string") {
      return c.json(
        { success: false, error: "Missing or invalid 'value' field" } as APIResponse,
        400
      );
    }

    const validationErr = meta.validate(value);
    if (validationErr) {
      return c.json(
        { success: false, error: `Invalid value for ${key}: ${validationErr}` } as APIResponse,
        400
      );
    }

    try {
      const parsed = meta.parse(value);
      const raw = readRawConfig(deps.configPath);
      setNestedValue(raw, key, parsed);

      // Auto-sync: setting owner_id also adds it to admin_ids
      if (key === "telegram.owner_id" && typeof parsed === "number") {
        const adminIds: number[] = (getNestedValue(raw, "telegram.admin_ids") as number[]) ?? [];
        if (!adminIds.includes(parsed)) {
          setNestedValue(raw, "telegram.admin_ids", [...adminIds, parsed]);
        }
      }

      writeRawConfig(raw, deps.configPath);

      // Update runtime config for immediate effect
      const runtimeConfig = deps.agent.getConfig() as Record<string, any>;
      setNestedValue(runtimeConfig, key, parsed);

      // Sync runtime admin_ids too
      if (key === "telegram.owner_id" && typeof parsed === "number") {
        const rtAdminIds: number[] =
          (getNestedValue(runtimeConfig, "telegram.admin_ids") as number[]) ?? [];
        if (!rtAdminIds.includes(parsed)) {
          setNestedValue(runtimeConfig, "telegram.admin_ids", [...rtAdminIds, parsed]);
        }
      }

      const result: ConfigKeyData = {
        key,
        label: meta.label,
        set: true,
        value: meta.mask(value),
        sensitive: meta.sensitive,
        type: meta.type,
        category: meta.category,
        description: meta.description,
        ...(meta.options ? { options: meta.options } : {}),
      };
      return c.json({ success: true, data: result } as APIResponse<ConfigKeyData>);
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) } as APIResponse,
        500
      );
    }
  });

  // Unset a configurable key
  app.delete("/:key", (c) => {
    const key = c.req.param("key");
    const meta = CONFIGURABLE_KEYS[key];
    if (!meta) {
      const allowed = Object.keys(CONFIGURABLE_KEYS).join(", ");
      return c.json(
        {
          success: false,
          error: `Key "${key}" is not configurable. Allowed: ${allowed}`,
        } as APIResponse,
        400
      );
    }

    try {
      const raw = readRawConfig(deps.configPath);
      deleteNestedValue(raw, key);
      writeRawConfig(raw, deps.configPath);

      // Clear from runtime config
      const runtimeConfig = deps.agent.getConfig() as Record<string, any>;
      deleteNestedValue(runtimeConfig, key);

      const result: ConfigKeyData = {
        key,
        label: meta.label,
        set: false,
        value: null,
        sensitive: meta.sensitive,
        type: meta.type,
        category: meta.category,
        description: meta.description,
        ...(meta.options ? { options: meta.options } : {}),
        ...(meta.itemType ? { itemType: meta.itemType } : {}),
      };
      return c.json({ success: true, data: result } as APIResponse<ConfigKeyData>);
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) } as APIResponse,
        500
      );
    }
  });

  // Get model options for a provider
  app.get("/models/:provider", (c) => {
    const provider = c.req.param("provider");
    const models = getModelsForProvider(provider);
    return c.json({ success: true, data: models } as APIResponse);
  });

  // Get provider metadata (for API key UX)
  app.get("/provider-meta/:provider", (c) => {
    const provider = c.req.param("provider");
    try {
      const meta = getProviderMetadata(provider as SupportedProvider);
      const needsKey = provider !== "claude-code" && provider !== "cocoon" && provider !== "local";
      return c.json({
        success: true,
        data: {
          needsKey,
          keyHint: meta.keyHint,
          keyPrefix: meta.keyPrefix,
          consoleUrl: meta.consoleUrl,
          displayName: meta.displayName,
        },
      } as APIResponse);
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) } as APIResponse,
        400
      );
    }
  });

  // Validate an API key format for a provider
  app.post("/validate-api-key", async (c) => {
    try {
      const body = await c.req.json<{ provider: string; apiKey: string }>();
      if (!body.provider || !body.apiKey) {
        return c.json({ success: false, error: "Missing provider or apiKey" } as APIResponse, 400);
      }
      const error = validateApiKeyFormat(body.provider as SupportedProvider, body.apiKey);
      return c.json({
        success: true,
        data: { valid: !error, error: error ?? null },
      } as APIResponse);
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) } as APIResponse,
        400
      );
    }
  });

  return app;
}
