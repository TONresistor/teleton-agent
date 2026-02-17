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

interface ConfigKeyData {
  key: string;
  set: boolean;
  value: string | null;
  sensitive: boolean;
  type: ConfigKeyType;
  category: ConfigCategory;
  description: string;
  options?: string[];
}

export function createConfigRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // List all configurable keys with masked values
  app.get("/", (c) => {
    try {
      const raw = readRawConfig(deps.configPath);

      const data: ConfigKeyData[] = Object.entries(CONFIGURABLE_KEYS).map(([key, meta]) => {
        const value = getNestedValue(raw, key);
        const isSet = value != null && value !== "";
        return {
          key,
          set: isSet,
          value: isSet ? meta.mask(String(value)) : null,
          sensitive: meta.sensitive,
          type: meta.type,
          category: meta.category,
          description: meta.description,
          ...(meta.options ? { options: meta.options } : {}),
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

    let body: { value?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" } as APIResponse, 400);
    }

    const value = body.value;
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
      writeRawConfig(raw, deps.configPath);

      // Update runtime config for immediate effect
      const runtimeConfig = deps.agent.getConfig() as Record<string, any>;
      setNestedValue(runtimeConfig, key, parsed);

      const result: ConfigKeyData = {
        key,
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
        set: false,
        value: null,
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

  return app;
}
