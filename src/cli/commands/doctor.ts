/**
 * Teleton Doctor - Health check command
 */

import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { parse } from "yaml";
import { ConfigSchema } from "../../config/schema.js";
import { TELETON_ROOT } from "../../workspace/paths.js";
import {
  getProviderMetadata,
  validateApiKeyFormat,
  type SupportedProvider,
} from "../../config/providers.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const reset = "\x1b[0m";
const blue = "\x1b[34m";

function formatResult(result: CheckResult): string {
  const icon =
    result.status === "ok"
      ? `${green}✓${reset}`
      : result.status === "warn"
        ? `${yellow}⚠${reset}`
        : `${red}✗${reset}`;
  return `${icon} ${result.name}: ${result.message}`;
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
    const content = readFileSync(configPath, "utf-8");
    const raw = parse(content);
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
  } catch (err) {
    return {
      name: "Config file",
      status: "error",
      message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
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
    const content = readFileSync(configPath, "utf-8");
    const config = parse(content);

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
    const content = readFileSync(configPath, "utf-8");
    const config = parse(content);

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
    const maskLen = Math.min(10, apiKey.length - 4);
    const masked = apiKey.substring(0, maskLen) + "..." + apiKey.substring(apiKey.length - 4);

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
  const soulPath = join(workspaceDir, "SOUL.md");

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

async function checkMarketData(workspaceDir: string): Promise<CheckResult> {
  const dbPath = join(workspaceDir, "gifts.db");

  if (!existsSync(dbPath)) {
    return {
      name: "Gift market data",
      status: "warn",
      message: "Not found (will fetch on first start)",
    };
  }

  try {
    // Import database module to check stats
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });

    // Get stats
    const collections = db.prepare("SELECT COUNT(*) as count FROM gift_collections").get() as any;
    const models = db.prepare("SELECT COUNT(*) as count FROM gift_models").get() as any;
    const lastUpdate = db
      .prepare("SELECT MAX(updated_at) as last FROM gift_collections")
      .get() as any;

    db.close();

    if (!lastUpdate.last) {
      return {
        name: "Gift market data",
        status: "warn",
        message: "Database empty (no data yet)",
      };
    }

    // Parse last update time (SQLite stores without Z suffix)
    const lastUpdateTime = new Date(lastUpdate.last + "Z").getTime();
    const age = Date.now() - lastUpdateTime;
    const hoursAgo = Math.floor(age / (1000 * 60 * 60));
    const daysAgo = Math.floor(hoursAgo / 24);

    const dataInfo = `${collections.count} collections, ${models.count} models`;

    if (daysAgo > 7) {
      return {
        name: "Gift market data",
        status: "warn",
        message: `Stale (${daysAgo} days old) - ${dataInfo}`,
      };
    }

    if (hoursAgo > 24) {
      return {
        name: "Gift market data",
        status: "ok",
        message: `${daysAgo} day${daysAgo > 1 ? "s" : ""} old - ${dataInfo}`,
      };
    }

    return {
      name: "Gift market data",
      status: "ok",
      message: hoursAgo === 0 ? `Fresh (< 1h) - ${dataInfo}` : `${hoursAgo}h old - ${dataInfo}`,
    };
  } catch (err) {
    return {
      name: "Gift market data",
      status: "error",
      message: `Database error: ${err instanceof Error ? err.message : String(err)}`,
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
    const content = readFileSync(configPath, "utf-8");
    const config = parse(content);

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
    const content = readFileSync(configPath, "utf-8");
    const config = parse(content);

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
  const major = parseInt(version.slice(1).split(".")[0]);

  if (major < 20) {
    return {
      name: "Node.js",
      status: "error",
      message: `${version} (requires >= 20.0.0)`,
    };
  }

  return {
    name: "Node.js",
    status: "ok",
    message: version,
  };
}

async function checkPlaywrightBrowser(): Promise<CheckResult> {
  // Check common browser cache locations
  const homeDir = homedir();
  const browserPaths = [
    join(homeDir, ".cache", "ms-playwright", "chromium-*"),
    join(homeDir, ".cache", "ms-playwright"),
    join(homeDir, "Library", "Caches", "ms-playwright"),
    join(homeDir, "AppData", "Local", "ms-playwright"),
  ];

  for (const basePath of browserPaths) {
    const checkPath = basePath.replace("/chromium-*", "");
    if (existsSync(checkPath)) {
      // Check if chromium folder exists inside
      try {
        const { readdirSync } = await import("fs");
        const contents = readdirSync(checkPath);
        const hasChromium = contents.some((f) => f.startsWith("chromium"));
        if (hasChromium) {
          return {
            name: "Playwright browser",
            status: "ok",
            message: "Chromium installed",
          };
        }
      } catch {
        // Directory exists but can't read - assume OK
        return {
          name: "Playwright browser",
          status: "ok",
          message: "Cache found",
        };
      }
    }
  }

  return {
    name: "Playwright browser",
    status: "warn",
    message: "Not found (run: npx playwright install chromium)",
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

  console.log(`  Workspace: ${workspaceDir}\n`);

  // Run all checks
  const results: CheckResult[] = [];

  console.log("  Running checks...\n");

  // System checks
  results.push(await checkNodeVersion());
  results.push(await checkPlaywrightBrowser());

  // Config checks
  results.push(await checkConfig(workspaceDir));
  results.push(await checkTelegramCredentials(workspaceDir));
  results.push(await checkApiKey(workspaceDir));
  results.push(await checkTelegramSession(workspaceDir));
  results.push(await checkWallet(workspaceDir));
  results.push(await checkSoul(workspaceDir));
  results.push(await checkDatabase(workspaceDir));
  results.push(await checkMarketData(workspaceDir));
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
      `${red}  ✗ ${errors} error${errors > 1 ? "s" : ""} found - run 'teleton setup' to fix${reset}`
    );
  } else if (warnings > 0) {
    console.log(
      `${yellow}  ⚠ ${warnings} warning${warnings > 1 ? "s" : ""} - agent may work with limited features${reset}`
    );
  } else {
    console.log(`${green}  ✓ All ${ok} checks passed - system ready${reset}`);
  }

  console.log("");
}
