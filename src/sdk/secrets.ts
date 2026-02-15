/**
 * Plugin secrets service — secure access to API keys, tokens, and credentials.
 *
 * Resolution order:
 *   1. Environment variable  (PLUGINNAME_KEY)  — Docker/CI
 *   2. Secrets store file    (via /plugin set)  — Admin via Telegram
 *   3. pluginConfig          (config.yaml)      — legacy/manual
 *
 * Secrets store: ~/.teleton/plugins/data/<plugin-name>.secrets.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";
import { PluginSDKError } from "@teleton-agent/sdk";
import type { SecretsSDK, PluginLogger } from "@teleton-agent/sdk";

const SECRETS_DIR = join(TELETON_ROOT, "plugins", "data");

function getSecretsPath(pluginName: string): string {
  return join(SECRETS_DIR, `${pluginName}.secrets.json`);
}

/** Read persisted secrets from the JSON file */
function readSecretsFile(pluginName: string): Record<string, string> {
  const filePath = getSecretsPath(pluginName);
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Write a secret to the persisted secrets file.
 * Used by admin commands (/plugin set).
 */
export function writePluginSecret(pluginName: string, key: string, value: string): void {
  mkdirSync(SECRETS_DIR, { recursive: true });
  const filePath = getSecretsPath(pluginName);
  const existing = readSecretsFile(pluginName);
  existing[key] = value;
  writeFileSync(filePath, JSON.stringify(existing, null, 2), { mode: 0o600 });
}

/**
 * Delete a secret from the persisted secrets file.
 * Used by admin commands (/plugin unset).
 */
export function deletePluginSecret(pluginName: string, key: string): boolean {
  const existing = readSecretsFile(pluginName);
  if (!(key in existing)) return false;
  delete existing[key];
  const filePath = getSecretsPath(pluginName);
  writeFileSync(filePath, JSON.stringify(existing, null, 2), { mode: 0o600 });
  return true;
}

/** List all persisted secret keys for a plugin (values NOT returned for security). */
export function listPluginSecretKeys(pluginName: string): string[] {
  return Object.keys(readSecretsFile(pluginName));
}

/**
 * Create a SecretsSDK instance for a plugin.
 */
export function createSecretsSDK(
  pluginName: string,
  pluginConfig: Record<string, unknown>,
  log: PluginLogger
): SecretsSDK {
  const envPrefix = pluginName.replace(/-/g, "_").toUpperCase();

  function get(key: string): string | undefined {
    // 1. Environment variable (highest priority — Docker/CI)
    const envKey = `${envPrefix}_${key.toUpperCase()}`;
    const envValue = process.env[envKey];
    if (envValue) {
      log.debug(`Secret "${key}" resolved from env var ${envKey}`);
      return envValue;
    }

    // 2. Persisted secrets store (set via /plugin set)
    const stored = readSecretsFile(pluginName);
    if (key in stored && stored[key]) {
      log.debug(`Secret "${key}" resolved from secrets store`);
      return stored[key];
    }

    // 3. pluginConfig from config.yaml (legacy/manual)
    const configValue = pluginConfig[key];
    if (configValue !== undefined && configValue !== null) {
      log.debug(`Secret "${key}" resolved from pluginConfig`);
      return String(configValue);
    }

    return undefined;
  }

  return {
    get,

    require(key: string): string {
      const value = get(key);
      if (!value) {
        throw new PluginSDKError(
          `Missing required secret "${key}". Set it via: /plugin set ${pluginName} ${key} <value>`,
          "SECRET_NOT_FOUND"
        );
      }
      return value;
    },

    has(key: string): boolean {
      return get(key) !== undefined;
    },
  };
}
