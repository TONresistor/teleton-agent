import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { parse, stringify } from "yaml";
import { homedir } from "os";
import { dirname, join } from "path";
import { ConfigSchema, type Config } from "./schema.js";
import { getProviderMetadata, type SupportedProvider } from "./providers.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Config");

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

  let content: string;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch (error) {
    throw new Error(`Cannot read config file ${fullPath}: ${(error as Error).message}`);
  }

  let raw: unknown;
  try {
    raw = parse(content);
  } catch (error) {
    throw new Error(`Invalid YAML in ${fullPath}: ${(error as Error).message}`);
  }

  // Backward compatibility: remove deprecated market key before parsing
  if (raw && typeof raw === "object" && "market" in (raw as Record<string, unknown>)) {
    log.warn("config.market is deprecated and ignored. Use market-api plugin instead.");
    delete (raw as Record<string, unknown>).market;
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config: ${result.error.message}`);
  }

  const config = result.data;
  const provider = config.agent.provider as SupportedProvider;
  if (
    provider !== "anthropic" &&
    provider !== "claude-code" &&
    !(raw as Record<string, Record<string, unknown>>).agent?.model
  ) {
    const meta = getProviderMetadata(provider);
    config.agent.model = meta.defaultModel;
  }

  config.telegram.session_path = expandPath(config.telegram.session_path);
  config.storage.sessions_file = expandPath(config.storage.sessions_file);
  config.storage.memory_file = expandPath(config.storage.memory_file);

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

  // WebUI environment variable overrides
  if (process.env.TELETON_WEBUI_ENABLED) {
    config.webui.enabled = process.env.TELETON_WEBUI_ENABLED === "true";
  }
  if (process.env.TELETON_WEBUI_PORT) {
    const port = parseInt(process.env.TELETON_WEBUI_PORT, 10);
    if (!isNaN(port) && port >= 1024 && port <= 65535) {
      config.webui.port = port;
    }
  }
  if (process.env.TELETON_WEBUI_HOST) {
    config.webui.host = process.env.TELETON_WEBUI_HOST;
    if (!["127.0.0.1", "localhost", "::1"].includes(config.webui.host)) {
      log.warn(
        { host: config.webui.host },
        "WebUI bound to non-loopback address — ensure auth_token is set"
      );
    }
  }

  // Local LLM base URL override
  if (process.env.TELETON_BASE_URL) {
    try {
      new URL(process.env.TELETON_BASE_URL);
      config.agent.base_url = process.env.TELETON_BASE_URL;
    } catch {
      throw new Error(
        `Invalid TELETON_BASE_URL: "${process.env.TELETON_BASE_URL}" is not a valid URL`
      );
    }
  }

  // Optional API key overrides
  if (process.env.TELETON_TAVILY_API_KEY) {
    config.tavily_api_key = process.env.TELETON_TAVILY_API_KEY;
  }
  if (process.env.TELETON_TONAPI_KEY) {
    config.tonapi_key = process.env.TELETON_TONAPI_KEY;
  }

  return config;
}

export function saveConfig(config: Config, configPath: string = DEFAULT_CONFIG_PATH): void {
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Refusing to save invalid config: ${result.error.message}`);
  }

  const fullPath = expandPath(configPath);
  const dir = dirname(fullPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  config.meta.last_modified_at = new Date().toISOString();
  writeFileSync(fullPath, stringify(config), { encoding: "utf-8", mode: 0o600 });
}

export function configExists(configPath: string = DEFAULT_CONFIG_PATH): boolean {
  return existsSync(expandPath(configPath));
}

export function getDefaultConfigPath(): string {
  return DEFAULT_CONFIG_PATH;
}
