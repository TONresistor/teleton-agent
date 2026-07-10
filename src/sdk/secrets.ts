/**
 * Plugin secrets service — secure access to API keys, tokens, and credentials.
 *
 * Resolution order:
 *   1. Environment variable  (TELETON_PLUGIN_PLUGINNAME_KEY)  — Docker/CI
 *   2. Secrets store file    (via /plugin set)  — Admin via Telegram
 *   3. pluginConfig          (config.yaml)      — legacy/manual
 *
 * Secrets store: ~/.teleton/plugins/data/<plugin-name>.secrets.json
 */

import { chmodSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";
import { PluginSDKError } from "@teleton-agent/sdk";
import type { SecretsSDK, PluginLogger, SecretDeclaration } from "@teleton-agent/sdk";

const SECRETS_DIR = join(TELETON_ROOT, "plugins", "data");
const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SECRET_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

function validatePluginName(pluginName: string): void {
  if (!PLUGIN_NAME_RE.test(pluginName)) {
    throw new PluginSDKError("Invalid plugin name for secret storage", "INVALID_INPUT");
  }
}

function validateSecretKey(key: string): void {
  if (!SECRET_KEY_RE.test(key)) {
    throw new PluginSDKError("Invalid plugin secret key", "INVALID_INPUT");
  }
}

function getSecretsPath(pluginName: string): string {
  validatePluginName(pluginName);
  return join(SECRETS_DIR, `${pluginName}.secrets.json`);
}

function writeSecretsFile(pluginName: string, secrets: Record<string, string>): void {
  mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  chmodSync(SECRETS_DIR, 0o700);
  const filePath = getSecretsPath(pluginName);
  writeFileSync(filePath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

/** Read persisted secrets from the JSON file */
function readSecretsFile(pluginName: string): Record<string, string> {
  const filePath = getSecretsPath(pluginName);
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const secrets: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(parsed)) {
      if (SECRET_KEY_RE.test(key) && typeof value === "string") secrets[key] = value;
    }
    return secrets;
  } catch {
    return {};
  }
}

/**
 * Write a secret to the persisted secrets file.
 * Used by admin commands (/plugin set).
 */
export function writePluginSecret(pluginName: string, key: string, value: string): void {
  validateSecretKey(key);
  const existing = readSecretsFile(pluginName);
  existing[key] = value;
  writeSecretsFile(pluginName, existing);
}

/**
 * Delete a secret from the persisted secrets file.
 * Used by admin commands (/plugin unset).
 */
export function deletePluginSecret(pluginName: string, key: string): boolean {
  validateSecretKey(key);
  const existing = readSecretsFile(pluginName);
  if (!Object.hasOwn(existing, key)) return false;
  delete existing[key];
  writeSecretsFile(pluginName, existing);
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
  log: PluginLogger,
  declarations: Readonly<Record<string, SecretDeclaration>> = {}
): SecretsSDK {
  const envPrefix = `TELETON_PLUGIN_${pluginName.replace(/-/g, "_").toUpperCase()}`;
  for (const [key, declaration] of Object.entries(declarations)) {
    if (declaration.env && !declaration.env.startsWith(`${envPrefix}_`)) {
      throw new PluginSDKError(
        `Secret "${key}" environment override must start with ${envPrefix}_`,
        "INVALID_INPUT"
      );
    }
  }

  function get(key: string): string | undefined {
    // 1. Environment variable (highest priority — Docker/CI)
    const envKey = declarations[key]?.env ?? `${envPrefix}_${key.toUpperCase()}`;
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
