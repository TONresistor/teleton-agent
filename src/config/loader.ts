import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { parse, stringify } from "yaml";
import { homedir } from "os";
import { dirname, join } from "path";
import { ConfigSchema, type Config } from "./schema.js";
import { getProviderMetadata, type SupportedProvider } from "./providers.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "../utils/logger.js";
import { validateEnv } from "./env.js";

const log = createLogger("Config");

const DEFAULT_CONFIG_PATH = join(TELETON_ROOT, "config.yaml");

export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): Config {
  const env = validateEnv();
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

  // Backward compatibility: the 'claude-code' provider was removed. Migrate existing
  // configs to 'anthropic' so they keep loading instead of failing enum validation.
  // The old credential auto-detection is gone — users must supply an Anthropic key.
  const rawAgent = (raw as { agent?: { provider?: unknown } } | null)?.agent;
  if (rawAgent && rawAgent.provider === "claude-code") {
    log.warn(
      "Provider 'claude-code' was removed; migrating to 'anthropic'. Set agent.api_key " +
        "(or the TELETON_API_KEY env var) to your Anthropic key (sk-ant-...)."
    );
    rawAgent.provider = "anthropic";
  }

  // Backward compatibility: the 'cocoon' provider (a proxy to an external
  // cocoon-cli) was replaced by the native 'gocoon' provider in 0.9.0. Migrate
  // so existing configs keep loading. gocoon runs its own channel, so the user
  // must run `teleton gocoon init` and fund it before use.
  if (rawAgent && rawAgent.provider === "cocoon") {
    log.warn(
      "Provider 'cocoon' was removed in 0.9.0; migrating to the native 'gocoon' provider. " +
        "Run 'teleton gocoon init' and fund the channel before use."
    );
    rawAgent.provider = "gocoon";
    // Carry a custom port from the old top-level cocoon block (the schema is
    // non-strict and would otherwise drop it).
    const rawObj = raw as Record<string, unknown>;
    const oldCocoon = rawObj.cocoon as { port?: number } | undefined;
    if (oldCocoon?.port != null) {
      const gocoon = (rawObj.gocoon as Record<string, unknown> | undefined) ?? {};
      if (gocoon.port == null) gocoon.port = oldCocoon.port;
      rawObj.gocoon = gocoon;
    }
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config: ${result.error.message}`);
  }

  const config = result.data;
  const provider = config.agent.provider as SupportedProvider;
  if (provider !== "anthropic" && !(raw as Record<string, Record<string, unknown>>).agent?.model) {
    const meta = getProviderMetadata(provider);
    config.agent.model = meta.defaultModel;
  }

  config.telegram.session_path = expandPath(config.telegram.session_path);
  config.storage.sessions_file = expandPath(config.storage.sessions_file);
  config.storage.memory_file = expandPath(config.storage.memory_file);

  if (env.TELETON_API_KEY) {
    config.agent.api_key = env.TELETON_API_KEY;
  } else if (provider === "alpie" && env.PI_API_KEY) {
    config.agent.api_key = env.PI_API_KEY;
  }
  if (env.TELETON_TG_API_ID != null) {
    config.telegram.api_id = env.TELETON_TG_API_ID;
  }
  if (env.TELETON_TG_API_HASH) {
    config.telegram.api_hash = env.TELETON_TG_API_HASH;
  }
  if (env.TELETON_TG_PHONE) {
    config.telegram.phone = env.TELETON_TG_PHONE;
  }

  // WebUI environment variable overrides
  if (env.TELETON_WEBUI_ENABLED != null) {
    config.webui.enabled = env.TELETON_WEBUI_ENABLED;
  }
  if (env.TELETON_WEBUI_PORT != null && env.TELETON_WEBUI_PORT >= 1024) {
    config.webui.port = env.TELETON_WEBUI_PORT;
  }
  if (env.TELETON_WEBUI_HOST) {
    config.webui.host = env.TELETON_WEBUI_HOST;
    if (!["127.0.0.1", "localhost", "::1"].includes(config.webui.host)) {
      log.warn(
        { host: config.webui.host },
        "WebUI bound to non-loopback address — ensure auth_token is set"
      );
    }
  }

  // Management API environment variable overrides
  if (env.TELETON_API_ENABLED != null) {
    if (!config.api) config.api = { enabled: false, port: 7778, key_hash: "", allowed_ips: [] };
    config.api.enabled = env.TELETON_API_ENABLED;
  }
  if (env.TELETON_API_PORT != null && env.TELETON_API_PORT >= 1024) {
    if (!config.api) config.api = { enabled: false, port: 7778, key_hash: "", allowed_ips: [] };
    config.api.port = env.TELETON_API_PORT;
  }

  // Local LLM base URL override
  if (env.TELETON_BASE_URL) {
    try {
      new URL(env.TELETON_BASE_URL);
      config.agent.base_url = env.TELETON_BASE_URL;
    } catch {
      throw new Error(`Invalid TELETON_BASE_URL: "${env.TELETON_BASE_URL}" is not a valid URL`);
    }
  }

  // Optional API key overrides
  if (env.TELETON_TAVILY_API_KEY) {
    config.tavily_api_key = env.TELETON_TAVILY_API_KEY;
  }
  if (env.TELETON_TONAPI_KEY) {
    config.tonapi_key = env.TELETON_TONAPI_KEY;
  }
  if (env.TELETON_TONCENTER_API_KEY) {
    config.toncenter_api_key = env.TELETON_TONCENTER_API_KEY;
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
