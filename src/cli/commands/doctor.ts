import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { ConfigSchema } from "../../config/schema.js";
import { TELETON_ROOT } from "../../workspace/paths.js";
import {
  getProviderMetadata,
  validateApiKeyFormat,
  type SupportedProvider,
} from "../../config/providers.js";
import { getErrorMessage } from "../../utils/errors.js";
import { SUPPORTED_NODE_RANGE, isNodeVersionSupported } from "../../constants/runtime.js";
import { GREEN, YELLOW, RED } from "../prompts.js";
import { getCodexApiKey, isCodexTokenValid } from "../../providers/codex-credentials.js";
import {
  getGrokBuildCliVersion,
  getGrokBuildApiKey,
  isGrokBuildTokenValid,
} from "../../providers/grok-build-credentials.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

// ASCII banner colors (raw ANSI — chalk has no equivalent blue export)
const blue = "\x1b[34m";
const reset = "\x1b[0m";

function formatResult(result: CheckResult): string {
  const icon =
    result.status === "ok" ? GREEN("✓") : result.status === "warn" ? YELLOW("⚠") : RED("✗");
  return `${icon} ${result.name}: ${result.message}`;
}

/** Read and YAML-parse the config file (shared by the config-dependent checks). */
function readAndParseConfig(configPath: string) {
  return parse(readFileSync(configPath, "utf-8"));
}

async function checkConfig(workspaceDir: string): Promise<CheckResult> {
  const configPath = join(workspaceDir, "config.yaml");

  if (!existsSync(configPath)) {
    return {
      name: "Config file",
      status: "error",
      message: `Not found at ${configPath}`,
    };
  }

  try {
    const raw = readAndParseConfig(configPath);
    const result = ConfigSchema.safeParse(raw);

    if (!result.success) {
      return {
        name: "Config file",
        status: "error",
        message: `Invalid: ${result.error.issues[0]?.message || "Unknown error"}`,
      };
    }

    return {
      name: "Config file",
      status: "ok",
      message: "Valid",
    };
  } catch (error) {
    return {
      name: "Config file",
      status: "error",
      message: `Parse error: ${getErrorMessage(error)}`,
    };
  }
}

async function checkTelegramCredentials(workspaceDir: string): Promise<CheckResult> {
  const configPath = join(workspaceDir, "config.yaml");

  if (!existsSync(configPath)) {
    return {
      name: "Telegram credentials",
      status: "error",
      message: "Config not found",
    };
  }

  try {
    const config = readAndParseConfig(configPath);

    if (!config.telegram?.api_id || !config.telegram?.api_hash) {
      return {
        name: "Telegram credentials",
        status: "error",
        message: "Missing API ID or API Hash",
      };
    }

    if (!config.telegram?.phone) {
      return {
        name: "Telegram credentials",
        status: "error",
        message: "Missing phone number",
      };
    }

    return {
      name: "Telegram credentials",
      status: "ok",
      message: `Phone: ${config.telegram.phone}`,
    };
  } catch {
    return {
      name: "Telegram credentials",
      status: "error",
      message: "Could not read config",
    };
  }
}

async function checkApiKey(workspaceDir: string): Promise<CheckResult> {
  const configPath = join(workspaceDir, "config.yaml");

  if (!existsSync(configPath)) {
    return {
      name: "API key",
      status: "error",
      message: "Config not found",
    };
  }

  try {
    const config = readAndParseConfig(configPath);

    const provider = (config.agent?.provider || "anthropic") as SupportedProvider;
    const apiKey = config.agent?.api_key;
    let meta;
    try {
      meta = getProviderMetadata(provider);
    } catch {
      return {
        name: "API key",
        status: "error",
        message: `Unknown provider: ${provider}`,
      };
    }

    if (meta.credentialMode === "none") {
      return {
        name: `${meta.displayName}`,
        status: "ok",
        message: "No API key needed",
      };
    }

    if (meta.credentialMode === "cli-auto") {
      try {
        if (provider === "codex") {
          getCodexApiKey();
          return {
            name: meta.displayName,
            status: isCodexTokenValid() ? "ok" : "warn",
            message: isCodexTokenValid() ? "CLI credentials detected" : "CLI token expired",
          };
        }

        const cliVersion = getGrokBuildCliVersion();
        getGrokBuildApiKey();
        const tokenValid = isGrokBuildTokenValid();
        return {
          name: meta.displayName,
          status: tokenValid ? "ok" : "warn",
          message: tokenValid
            ? `Grok CLI ${cliVersion}; credentials detected`
            : `Grok CLI ${cliVersion}; token expired (run grok login)`,
        };
      } catch (error) {
        return {
          name: meta.displayName,
          status: "error",
          message: getErrorMessage(error),
        };
      }
    }

    if (!apiKey) {
      return {
        name: `${meta.displayName} API key`,
        status: "error",
        message: "Not configured",
      };
    }

    const validationError = validateApiKeyFormat(provider, apiKey);
    if (validationError) {
      return {
        name: `${meta.displayName} API key`,
        status: "warn",
        message: validationError,
      };
    }

    // Mask the key for display
    const maskLen = Math.min(4, Math.max(0, apiKey.length - 4));
    const masked = apiKey.substring(0, maskLen) + "****" + apiKey.substring(apiKey.length - 4);

    return {
      name: `${meta.displayName} API key`,
      status: "ok",
      message: masked,
    };
  } catch {
    return {
      name: "API key",
      status: "error",
      message: "Could not read config",
    };
  }
}

async function checkWallet(workspaceDir: string): Promise<CheckResult> {
  const walletPath = join(workspaceDir, "wallet.json");

  if (!existsSync(walletPath)) {
    return {
      name: "TON wallet",
      status: "warn",
      message: "Not found (run teleton setup to generate)",
    };
  }

  try {
    const content = readFileSync(walletPath, "utf-8");
    const wallet = JSON.parse(content);

    if (!wallet.address) {
      return {
        name: "TON wallet",
        status: "error",
        message: "Invalid wallet file (no address)",
      };
    }

    const shortAddr =
      wallet.address.substring(0, 8) + "..." + wallet.address.substring(wallet.address.length - 6);

    return {
      name: "TON wallet",
      status: "ok",
      message: shortAddr,
    };
  } catch {
    return {
      name: "TON wallet",
      status: "error",
      message: "Could not read wallet file",
    };
  }
}

async function checkSoul(workspaceDir: string): Promise<CheckResult> {
  const soulPath = join(workspaceDir, "workspace", "SOUL.md");

  if (!existsSync(soulPath)) {
    return {
      name: "SOUL.md",
      status: "warn",
      message: "Not found (agent will use defaults)",
    };
  }

  try {
    const stats = statSync(soulPath);
    const sizeKb = (stats.size / 1024).toFixed(1);

    return {
      name: "SOUL.md",
      status: "ok",
      message: `${sizeKb} KB`,
    };
  } catch {
    return {
      name: "SOUL.md",
      status: "error",
      message: "Could not read file",
    };
  }
}

async function checkDatabase(workspaceDir: string): Promise<CheckResult> {
  const dbPath = join(workspaceDir, "memory.db");

  if (!existsSync(dbPath)) {
    return {
      name: "Memory database",
      status: "warn",
      message: "Not found (will be created on first start)",
    };
  }

  try {
    const stats = statSync(dbPath);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(2);

    return {
      name: "Memory database",
      status: "ok",
      message: `${sizeMb} MB`,
    };
  } catch {
    return {
      name: "Memory database",
      status: "error",
      message: "Could not read database",
    };
  }
}

async function checkTelegramSession(workspaceDir: string): Promise<CheckResult> {
  const sessionPath = join(workspaceDir, "telegram_session.txt");

  if (!existsSync(sessionPath)) {
    return {
      name: "Telegram session",
      status: "warn",
      message: "Not found (will prompt for login on first start)",
    };
  }

  try {
    const stats = statSync(sessionPath);
    const age = Date.now() - stats.mtimeMs;
    const daysAgo = Math.floor(age / (1000 * 60 * 60 * 24));

    if (daysAgo > 30) {
      return {
        name: "Telegram session",
        status: "warn",
        message: `Last updated ${daysAgo} days ago (may need re-auth)`,
      };
    }

    return {
      name: "Telegram session",
      status: "ok",
      message: daysAgo === 0 ? "Active (today)" : `Active (${daysAgo} days ago)`,
    };
  } catch {
    return {
      name: "Telegram session",
      status: "error",
      message: "Could not read session",
    };
  }
}

async function checkModel(workspaceDir: string): Promise<CheckResult> {
  const configPath = join(workspaceDir, "config.yaml");

  if (!existsSync(configPath)) {
    return {
      name: "AI Model",
      status: "error",
      message: "Config not found",
    };
  }

  try {
    const config = readAndParseConfig(configPath);

    const provider = (config.agent?.provider || "anthropic") as SupportedProvider;
    let model = config.agent?.model;
    if (!model) {
      try {
        model = getProviderMetadata(provider).defaultModel;
      } catch {
        model = "unknown";
      }
    }

    return {
      name: "AI Model",
      status: "ok",
      message: `${provider}/${model}`,
    };
  } catch {
    return {
      name: "AI Model",
      status: "error",
      message: "Could not read config",
    };
  }
}

async function checkAdmins(workspaceDir: string): Promise<CheckResult> {
  const configPath = join(workspaceDir, "config.yaml");

  if (!existsSync(configPath)) {
    return {
      name: "Admin users",
      status: "error",
      message: "Config not found",
    };
  }

  try {
    const config = readAndParseConfig(configPath);

    const admins = config.telegram?.admin_ids || [];

    if (admins.length === 0) {
      return {
        name: "Admin users",
        status: "warn",
        message: "None configured (no admin commands available)",
      };
    }

    return {
      name: "Admin users",
      status: "ok",
      message: `${admins.length} user${admins.length > 1 ? "s" : ""}: ${admins.join(", ")}`,
    };
  } catch {
    return {
      name: "Admin users",
      status: "error",
      message: "Could not read config",
    };
  }
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.version;

  if (!isNodeVersionSupported(version)) {
    return {
      name: "Node.js",
      status: "error",
      message: `${version} (requires ${SUPPORTED_NODE_RANGE})`,
    };
  }

  return {
    name: "Node.js",
    status: "ok",
    message: version,
  };
}

export async function doctorCommand(): Promise<void> {
  const workspaceDir = TELETON_ROOT;

  // ASCII banner (blue)
  console.log(`
${blue}  ┌─────────────────────────────────────────────────────────────┐
  │  TELETON DOCTOR - System Health Check                       │
  └─────────────────────────────────────────────────────────────┘${reset}
`);

  console.log(`  Data directory: ${workspaceDir}\n`);

  // Run all checks
  const results: CheckResult[] = [];

  console.log("  Running checks...\n");

  // System checks
  results.push(await checkNodeVersion());

  // Config checks
  results.push(await checkConfig(workspaceDir));
  results.push(await checkTelegramCredentials(workspaceDir));
  results.push(await checkApiKey(workspaceDir));
  results.push(await checkTelegramSession(workspaceDir));
  results.push(await checkWallet(workspaceDir));
  results.push(await checkSoul(workspaceDir));
  results.push(await checkDatabase(workspaceDir));
  results.push(await checkModel(workspaceDir));
  results.push(await checkAdmins(workspaceDir));

  // Display results
  for (const result of results) {
    console.log(`  ${formatResult(result)}`);
  }

  // Summary
  const errors = results.filter((r) => r.status === "error").length;
  const warnings = results.filter((r) => r.status === "warn").length;
  const ok = results.filter((r) => r.status === "ok").length;

  console.log("");

  if (errors > 0) {
    console.log(
      RED(`  ✗ ${errors} error${errors > 1 ? "s" : ""} found - run 'teleton setup' to fix`)
    );
  } else if (warnings > 0) {
    console.log(
      YELLOW(
        `  ⚠ ${warnings} warning${warnings > 1 ? "s" : ""} - agent may work with limited features`
      )
    );
  } else {
    console.log(GREEN(`  ✓ All ${ok} checks passed - system ready`));
  }

  console.log("");
}
