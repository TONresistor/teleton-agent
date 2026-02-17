import { getDefaultConfigPath } from "../../config/loader.js";
import { createPrompter, CancelledError } from "../prompts.js";
import {
  CONFIGURABLE_KEYS,
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  readRawConfig,
  writeRawConfig,
} from "../../config/configurable-keys.js";
import type { ConfigKeyMeta } from "../../config/configurable-keys.js";

// ── Whitelist guard ────────────────────────────────────────────────────

function requireWhitelisted(key: string): ConfigKeyMeta {
  const meta = CONFIGURABLE_KEYS[key];
  if (!meta) {
    const allowed = Object.keys(CONFIGURABLE_KEYS).join(", ");
    console.error(`Key "${key}" is not configurable.\n   Allowed keys: ${allowed}`);
    process.exit(1);
  }
  return meta;
}

// ── Actions ────────────────────────────────────────────────────────────

async function actionSet(
  key: string,
  value: string | undefined,
  configPath: string
): Promise<void> {
  const meta = requireWhitelisted(key);

  if (!value) {
    const prompter = createPrompter();
    try {
      if (meta.sensitive) {
        value = await prompter.password({
          message: `Enter value for ${key}:`,
          validate: (v) => {
            if (!v) return "Value is required";
            const err = meta.validate(v);
            return err ? new Error(err) : undefined;
          },
        });
      } else {
        value = await prompter.text({
          message: `Enter value for ${key}:`,
          validate: (v) => {
            if (!v) return "Value is required";
            const err = meta.validate(v);
            return err ? new Error(err) : undefined;
          },
        });
      }
    } catch (e) {
      if (e instanceof CancelledError) {
        console.log("Cancelled.");
        return;
      }
      throw e;
    }
  }

  const err = meta.validate(value);
  if (err) {
    console.error(`Invalid value for ${key}: ${err}`);
    process.exit(1);
  }

  const raw = readRawConfig(configPath);
  setNestedValue(raw, key, meta.parse(value));
  writeRawConfig(raw, configPath);
  console.log(`✓ ${key} = ${meta.mask(value)}`);
}

function actionGet(key: string, configPath: string): void {
  const meta = requireWhitelisted(key);
  const raw = readRawConfig(configPath);
  const value = getNestedValue(raw, key);

  if (value == null || value === "") {
    console.log(`✗ ${key}  (not set)`);
  } else {
    const display = meta.sensitive ? meta.mask(String(value)) : String(value);
    console.log(`✓ ${key} = ${display}`);
  }
}

function actionList(configPath: string): void {
  const raw = readRawConfig(configPath);

  console.log("\nConfigurable keys:\n");
  for (const [key, meta] of Object.entries(CONFIGURABLE_KEYS)) {
    const value = getNestedValue(raw, key);
    if (value != null && value !== "") {
      const display = meta.sensitive ? meta.mask(String(value)) : String(value);
      console.log(`  ✓ ${key.padEnd(24)} = ${display}`);
    } else {
      console.log(`  ✗ ${key.padEnd(24)}   (not set)`);
    }
  }
  console.log();
}

function actionUnset(key: string, configPath: string): void {
  requireWhitelisted(key);
  const raw = readRawConfig(configPath);
  deleteNestedValue(raw, key);
  writeRawConfig(raw, configPath);
  console.log(`✓ ${key} unset`);
}

// ── Exported command handler ───────────────────────────────────────────

export async function configCommand(
  action: string,
  key: string | undefined,
  value: string | undefined,
  options: { config?: string }
): Promise<void> {
  const configPath = options.config ?? getDefaultConfigPath();

  switch (action) {
    case "list":
      actionList(configPath);
      break;

    case "get":
      if (!key) {
        console.error("Usage: teleton config get <key>");
        process.exit(1);
      }
      actionGet(key, configPath);
      break;

    case "set":
      if (!key) {
        console.error("Usage: teleton config set <key> [value]");
        process.exit(1);
      }
      await actionSet(key, value, configPath);
      break;

    case "unset":
      if (!key) {
        console.error("Usage: teleton config unset <key>");
        process.exit(1);
      }
      actionUnset(key, configPath);
      break;

    default:
      console.error(`Unknown action: ${action}\nAvailable: set, get, list, unset`);
      process.exit(1);
  }
}
