import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { parse, stringify } from "yaml";
import { homedir } from "os";
import { dirname, join } from "path";
import { ConfigSchema, type Config } from "./schema.js";
import { getProviderMetadata, type SupportedProvider } from "./providers.js";
import { TELETON_ROOT } from "../workspace/paths.js";

const DEFAULT_CONFIG_PATH = join(TELETON_ROOT, "config.yaml");

export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): Config {
  const fullPath = expandPath(configPath);

  if (!existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}\nRun 'teleton setup' to create one.`);
  }

  const content = readFileSync(fullPath, "utf-8");
  const raw = parse(content);

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config: ${result.error.message}`);
  }

  // Resolve provider-aware model default
  // If user didn't specify a model (Zod applied "claude-opus-4-5-20251101" default),
  // override with the correct default for their chosen provider
  const config = result.data;
  const provider = config.agent.provider as SupportedProvider;
  if (provider !== "anthropic" && !raw.agent?.model) {
    const meta = getProviderMetadata(provider);
    config.agent.model = meta.defaultModel;
  }

  // Expand paths
  config.telegram.session_path = expandPath(config.telegram.session_path);
  config.storage.sessions_file = expandPath(config.storage.sessions_file);
  config.storage.pairing_file = expandPath(config.storage.pairing_file);
  config.storage.memory_file = expandPath(config.storage.memory_file);

  // Allow environment variable overrides for secrets (useful for CI/CD and containers)
  // Priority: ENV > CONFIG FILE
  if (process.env.TELETON_API_KEY) {
    config.agent.api_key = process.env.TELETON_API_KEY;
  }
  if (process.env.TELETON_TG_API_ID) {
    const apiId = parseInt(process.env.TELETON_TG_API_ID, 10);
    if (isNaN(apiId)) {
      throw new Error(
        `Invalid TELETON_TG_API_ID environment variable: "${process.env.TELETON_TG_API_ID}" is not a valid integer`
      );
    }
    config.telegram.api_id = apiId;
  }
  if (process.env.TELETON_TG_API_HASH) {
    config.telegram.api_hash = process.env.TELETON_TG_API_HASH;
  }
  if (process.env.TELETON_TG_PHONE) {
    config.telegram.phone = process.env.TELETON_TG_PHONE;
  }

  return config;
}

export function saveConfig(config: Config, configPath: string = DEFAULT_CONFIG_PATH): void {
  const fullPath = expandPath(configPath);
  const dir = dirname(fullPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  config.meta.last_modified_at = new Date().toISOString();
  writeFileSync(fullPath, stringify(config), "utf-8");
}

export function configExists(configPath: string = DEFAULT_CONFIG_PATH): boolean {
  return existsSync(expandPath(configPath));
}

export function getDefaultConfigPath(): string {
  return DEFAULT_CONFIG_PATH;
}
