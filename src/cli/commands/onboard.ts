/**
 * Teleton Onboarding Wizard
 *
 * Interactive setup wizard with @inquirer/prompts UI.
 * Fused ASCII banner + progress box frame.
 */

import {
  createPrompter,
  CancelledError,
  input,
  select,
  confirm,
  password,
  inquirerTheme as theme,
  wizardFrame,
  noteBox,
  finalSummaryBox,
  FRAME_WIDTH,
  TON,
  GREEN,
  CYAN,
  DIM,
  RED,
  WHITE,
  padRight,
  padRightAnsi,
  stripAnsi,
  type StepDef,
} from "../prompts.js";

import { ensureWorkspace, isNewWorkspace } from "../../workspace/manager.js";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { TELETON_ROOT } from "../../workspace/paths.js";
import { TelegramUserClient } from "../../telegram/client.js";
import YAML from "yaml";
import { type Config, DealsConfigSchema } from "../../config/schema.js";
import { getModelsForProvider } from "../../config/model-catalog.js";
import {
  generateWallet,
  importWallet,
  saveWallet,
  walletExists,
  loadWallet,
} from "../../ton/wallet-service.js";
import {
  getSupportedProviders,
  getProviderMetadata,
  validateApiKeyFormat,
  type SupportedProvider,
} from "../../config/providers.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../constants/limits.js";
import { fetchWithTimeout } from "../../utils/fetch.js";
import ora from "ora";
import {
  getClaudeCodeApiKey,
  isClaudeCodeTokenValid,
} from "../../providers/claude-code-credentials.js";

export interface OnboardOptions {
  workspace?: string;
  nonInteractive?: boolean;
  ui?: boolean;
  uiPort?: string;
  apiId?: number;
  apiHash?: string;
  phone?: string;
  apiKey?: string;
  baseUrl?: string;
  userId?: number;
  provider?: SupportedProvider;
  tavilyApiKey?: string;
}

// ── Progress steps ────────────────────────────────────────────────────

const STEPS: StepDef[] = [
  { label: "Agent", desc: "Name" },
  { label: "Provider", desc: "LLM, key & model" },
  { label: "Config", desc: "Policies" },
  { label: "Modules", desc: "Optional API keys" },
  { label: "Wallet", desc: "TON blockchain" },
  { label: "Telegram", desc: "Credentials" },
  { label: "Connect", desc: "Telegram auth" },
];

// ── Helpers ────────────────────────────────────────────────────────────

function redraw(currentStep: number): void {
  console.clear();
  console.log();
  console.log(wizardFrame(currentStep, STEPS));
  console.log();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Model catalog imported from shared source (see src/config/model-catalog.ts)

/**
 * Main onboard command
 */
export async function onboardCommand(options: OnboardOptions = {}): Promise<void> {
  // Web UI mode
  if (options.ui) {
    const { SetupServer } = await import("../../webui/setup-server.js");
    const port = parseInt(options.uiPort || "7777") || 7777;
    const url = `http://localhost:${port}/setup`;

    const blue = "\x1b[34m";
    const reset = "\x1b[0m";
    const dim = "\x1b[2m";
    console.log(`
${blue}  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                       │
  │       ______________    ________________  _   __   ___   _____________   ________     │
  │      /_  __/ ____/ /   / ____/_  __/ __ \\/ | / /  /   | / ____/ ____/ | / /_  __/     │
  │       / / / __/ / /   / __/   / / / / / /  |/ /  / /| |/ / __/ __/ /  |/ / / /        │
  │      / / / /___/ /___/ /___  / / / /_/ / /|  /  / ___ / /_/ / /___/ /|  / / /         │
  │     /_/ /_____/_____/_____/ /_/  \\____/_/ |_/  /_/  |_\\____/_____/_/ |_/ /_/          │
  │                                                                                       │
  └────────────────────────────────────────────────────────────────── DEV: ZKPROOF.T.ME ──┘${reset}

  ${dim}Setup wizard running at${reset} ${url}
  ${dim}Opening in your default browser...${reset}
  ${dim}Press Ctrl+C to cancel.${reset}
`);

    const server = new SetupServer(port);
    await server.start();

    process.on("SIGINT", async () => {
      await server.stop();
      process.exit(0);
    });

    // Wait for user to click "Start Agent" in the browser
    await server.waitForLaunch();
    console.log("\n  Launch signal received — stopping setup server");
    await server.stop();

    // Boot TonnetApp on the same port
    console.log("  Starting TonnetApp...\n");
    const { TeletonApp } = await import("../../index.js");
    const configPath = join(TELETON_ROOT, "config.yaml");
    const app = new TeletonApp(configPath);
    await app.start();

    // Keep process alive (TonnetApp manages its own lifecycle)
    return;
  }

  const prompter = createPrompter();

  try {
    if (options.nonInteractive) {
      await runNonInteractiveOnboarding(options, prompter);
    } else {
      await runInteractiveOnboarding(options, prompter);
    }
  } catch (err) {
    if (err instanceof CancelledError) {
      console.log(`\n  ${DIM("Setup cancelled. No changes were made.")}\n`);
      process.exit(0);
    }
    throw err;
  }
}

/**
 * Interactive onboarding wizard
 */
async function runInteractiveOnboarding(
  options: OnboardOptions,
  prompter: ReturnType<typeof createPrompter>
): Promise<void> {
  // ── Shared state ──
  let selectedProvider: SupportedProvider = "anthropic";
  let selectedModel = "";
  let apiKey = "";
  let apiId = 0;
  let apiHash = "";
  let phone = "";
  let userId = 0;
  let tonapiKey: string | undefined;
  let tavilyApiKey: string | undefined;
  let botToken: string | undefined;
  let botUsername: string | undefined;
  let dmPolicy: "open" | "allowlist" | "pairing" | "disabled" = "open";
  let groupPolicy: "open" | "allowlist" | "disabled" = "open";
  let requireMention = true;
  let maxAgenticIterations = "5";
  let cocoonInstance = 10000;

  // Intro
  console.clear();
  console.log();
  console.log(wizardFrame(0, STEPS));
  console.log();
  await sleep(800);

  // ════════════════════════════════════════════════════════════════════
  // Step 0: Agent — security warning, workspace, name, mode, modules
  // ════════════════════════════════════════════════════════════════════
  redraw(0);

  noteBox(
    "Your Teleton agent will have FULL CONTROL over:\n" +
      "\n" +
      "  • TELEGRAM: Read, send, and delete messages on your behalf\n" +
      "  • TON WALLET: A new wallet will be generated that the agent\n" +
      "    can use to send transactions autonomously\n" +
      "\n" +
      "We strongly recommend using a dedicated Telegram account.\n" +
      "Only fund the generated wallet with amounts you're comfortable\n" +
      "letting the agent manage.",
    "Security Warning",
    RED
  );

  const acceptRisk = await confirm({
    message: "I understand the risks and want to continue",
    default: false,
    theme,
  });

  if (!acceptRisk) {
    console.log(`\n  ${DIM("Setup cancelled — you must accept the risks to continue.")}\n`);
    process.exit(1);
  }

  // Workspace
  const spinner = ora({ color: "cyan" });
  spinner.start(DIM("Creating workspace..."));
  const workspace = await ensureWorkspace({
    workspaceDir: options.workspace,
    ensureTemplates: true,
    silent: true,
  });
  const isNew = isNewWorkspace(workspace);
  spinner.succeed(DIM(`Workspace: ${workspace.root}`));

  if (!isNew) {
    prompter.warn("Existing configuration detected");
    const shouldOverwrite = await confirm({
      message: "Overwrite existing configuration?",
      default: false,
      theme,
    });
    if (!shouldOverwrite) {
      console.log(`\n  ${DIM("Setup cancelled — existing configuration preserved.")}\n`);
      return;
    }
  }

  // Agent name
  const agentName = await input({
    message: "Give your agent a name (optional)",
    default: "Nova",
    theme,
  });

  if (agentName && agentName.trim() && existsSync(workspace.identityPath)) {
    const identity = readFileSync(workspace.identityPath, "utf-8");
    const updated = identity.replace("[Your name - pick one or ask your human]", agentName.trim());
    writeFileSync(workspace.identityPath, updated, "utf-8");
  }

  STEPS[0].value = agentName;

  // ════════════════════════════════════════════════════════════════════
  // Step 1: Provider — select + tool limit warning + API key
  // ════════════════════════════════════════════════════════════════════
  redraw(1);

  const providers = getSupportedProviders();
  selectedProvider = await select({
    message: "AI Provider",
    default: "anthropic",
    theme,
    choices: providers.map((p) => ({
      value: p.id,
      name: p.displayName,
      description:
        p.toolLimit !== null ? `${p.defaultModel} (max ${p.toolLimit} tools)` : `${p.defaultModel}`,
    })),
  });

  const providerMeta = getProviderMetadata(selectedProvider);

  // Tool limit warning
  if (providerMeta.toolLimit !== null) {
    noteBox(
      `${providerMeta.displayName} supports max ${providerMeta.toolLimit} tools.\n` +
        "Teleton currently has ~116 tools. If more tools are added,\n" +
        "some may be truncated.",
      "Tool Limit"
    );
  }

  // API key (or Cocoon / Local setup)
  let localBaseUrl = "";
  if (selectedProvider === "cocoon") {
    // Cocoon Network — no API key, managed externally via cocoon-cli
    apiKey = "";

    const cocoonPort = await input({
      message: "Cocoon proxy HTTP port",
      default: "10000",
      theme,
      validate: (value = "") => {
        const n = parseInt(value.trim(), 10);
        return n >= 1 && n <= 65535 ? true : "Must be a port number (1-65535)";
      },
    });
    cocoonInstance = parseInt(cocoonPort.trim(), 10);

    noteBox(
      "Cocoon Network — Decentralized LLM on TON\n" +
        "No API key needed. Requires cocoon-cli running externally.\n" +
        `Teleton will connect to http://localhost:${cocoonInstance}/v1/`,
      "Cocoon Network",
      TON
    );

    STEPS[1].value = `${providerMeta.displayName}  ${DIM(`port ${cocoonInstance}`)}`;
  } else if (selectedProvider === "local") {
    // Local LLM — no API key, needs base URL
    apiKey = "";

    localBaseUrl = await input({
      message: "Local LLM server URL",
      default: "http://localhost:11434/v1",
      theme,
      validate: (value = "") => {
        try {
          new URL(value.trim());
          return true;
        } catch {
          return "Must be a valid URL (e.g. http://localhost:11434/v1)";
        }
      },
    });
    localBaseUrl = localBaseUrl.trim();

    noteBox(
      "Local LLM — OpenAI-compatible server\n" +
        "No API key needed. Models auto-discovered at startup.\n" +
        `Teleton will connect to ${localBaseUrl}`,
      "Local LLM",
      TON
    );

    STEPS[1].value = `${providerMeta.displayName}  ${DIM(localBaseUrl)}`;
  } else if (selectedProvider === "claude-code") {
    // Claude Code — auto-detect credentials, fallback to manual key
    let detected = false;
    try {
      const key = getClaudeCodeApiKey();
      const valid = isClaudeCodeTokenValid();
      apiKey = ""; // Don't store in config — auto-detected at runtime
      detected = true;
      const masked = key.length > 16 ? key.slice(0, 12) + "..." + key.slice(-4) : "***";
      noteBox(
        `Credentials auto-detected from Claude Code\n` +
          `Key: ${masked}\n` +
          `Status: ${valid ? GREEN("valid ✓") : "expired (will refresh on use)"}\n` +
          `Token will auto-refresh when it expires.`,
        "Claude Code",
        TON
      );
      await confirm({
        message: "Continue with auto-detected credentials?",
        default: true,
        theme,
      });
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      prompter.warn(
        "Claude Code credentials not found. Make sure Claude Code is installed and authenticated (claude login)."
      );
      const useFallback = await confirm({
        message: "Enter an API key manually instead?",
        default: true,
        theme,
      });
      if (useFallback) {
        apiKey = await password({
          message: `Anthropic API Key (fallback)`,
          theme,
          validate: (value = "") => {
            if (!value || value.trim().length === 0) return "API key is required";
            return true;
          },
        });
      } else {
        throw new CancelledError();
      }
    }

    if (detected) {
      STEPS[1].value = `${providerMeta.displayName}  ${DIM("auto-detected ✓")}`;
    } else {
      const maskedKey = apiKey.length > 10 ? apiKey.slice(0, 6) + "..." + apiKey.slice(-4) : "***";
      STEPS[1].value = `${providerMeta.displayName}  ${DIM(maskedKey)}`;
    }
  } else {
    // Standard providers — API key required
    const envApiKey = process.env.TELETON_API_KEY;
    if (options.apiKey) {
      apiKey = options.apiKey;
    } else if (envApiKey) {
      const validationError = validateApiKeyFormat(selectedProvider, envApiKey);
      if (validationError) {
        prompter.warn(`TELETON_API_KEY env var found but invalid: ${validationError}`);
        apiKey = await password({
          message: `${providerMeta.displayName} API Key (${providerMeta.keyHint})`,
          theme,
          validate: (value = "") => validateApiKeyFormat(selectedProvider, value) ?? true,
        });
      } else {
        prompter.log(`Using API key from TELETON_API_KEY env var`);
        apiKey = envApiKey;
      }
    } else {
      noteBox(
        `${providerMeta.displayName} API key required.\nGet it at: ${providerMeta.consoleUrl}`,
        "API Key",
        TON
      );
      apiKey = await password({
        message: `${providerMeta.displayName} API Key (${providerMeta.keyHint})`,
        theme,
        validate: (value = "") => validateApiKeyFormat(selectedProvider, value) ?? true,
      });
    }

    const maskedKey = apiKey.length > 10 ? apiKey.slice(0, 6) + "..." + apiKey.slice(-4) : "***";
    STEPS[1].value = `${providerMeta.displayName}  ${DIM(maskedKey)}`;
  }

  // Model selection (advanced mode only, after provider + API key)
  selectedModel = providerMeta.defaultModel;

  if (selectedProvider !== "cocoon" && selectedProvider !== "local") {
    const providerModels = getModelsForProvider(selectedProvider);
    const modelChoices = [
      ...providerModels,
      { value: "__custom__", name: "Custom", description: "Enter a model ID manually" },
    ];

    const modelChoice = await select({
      message: "Model",
      default: providerMeta.defaultModel,
      theme,
      choices: modelChoices,
    });

    if (modelChoice === "__custom__") {
      const customModel = await input({
        message: "Model ID",
        default: providerMeta.defaultModel,
        theme,
      });
      if (customModel?.trim()) selectedModel = customModel.trim();
    } else {
      selectedModel = modelChoice;
    }

    const modelLabel = providerModels.find((m) => m.value === selectedModel)?.name ?? selectedModel;
    STEPS[1].value = `${STEPS[1].value ?? providerMeta.displayName}, ${modelLabel}`;
  }

  // ════════════════════════════════════════════════════════════════════
  // Step 2: Config — admin + policies
  // ════════════════════════════════════════════════════════════════════
  redraw(2);

  // Admin User ID
  noteBox(
    "To get your Telegram User ID:\n" +
      "1. Open @userinfobot on Telegram\n" +
      "2. Send /start\n" +
      "3. Note the ID displayed",
    "User ID",
    TON
  );

  const userIdStr = options.userId
    ? options.userId.toString()
    : await input({
        message: "Your Telegram User ID (for admin rights)",
        theme,
        validate: (value) => {
          if (!value || isNaN(parseInt(value))) return "Invalid User ID";
          return true;
        },
      });
  userId = parseInt(userIdStr);

  dmPolicy = await select({
    message: "DM policy (private messages)",
    default: "open",
    theme,
    choices: [
      { value: "open" as const, name: "Open", description: "Reply to everyone" },
      { value: "allowlist" as const, name: "Allowlist", description: "Only specific users" },
      { value: "disabled" as const, name: "Disabled", description: "No DM replies" },
    ],
  });

  groupPolicy = await select({
    message: "Group policy",
    default: "open",
    theme,
    choices: [
      { value: "open" as const, name: "Open", description: "Reply in all groups" },
      { value: "allowlist" as const, name: "Allowlist", description: "Only specific groups" },
      { value: "disabled" as const, name: "Disabled", description: "No group replies" },
    ],
  });

  requireMention = await confirm({
    message: "Require @mention in groups?",
    default: true,
    theme,
  });

  maxAgenticIterations = await input({
    message: "Max agentic iterations (tool call loops per message)",
    default: "5",
    theme,
    validate: (v) => {
      const n = parseInt(v, 10);
      return !isNaN(n) && n >= 1 && n <= 50 ? true : "Must be 1–50";
    },
  });

  STEPS[2].value = `${dmPolicy}/${groupPolicy}`;

  // ════════════════════════════════════════════════════════════════════
  // Step 3: Modules — optional API keys
  // ════════════════════════════════════════════════════════════════════
  redraw(3);

  const extras: string[] = [];

  // Bot token (recommended — required for deals module)
  const setupBot = await confirm({
    message: `Add a Telegram bot token? ${DIM("(recommended — enables deals & inline buttons)")}`,
    default: true,
    theme,
  });

  if (setupBot) {
    noteBox(
      "Create a bot with @BotFather on Telegram:\n" +
        "1. Send /newbot and follow the instructions\n" +
        "2. Copy the bot token\n" +
        "3. Enable inline mode: /setinline on the bot",
      "Bot Token",
      TON
    );

    const tokenInput = await password({
      message: "Bot token (from @BotFather)",
      theme,
      validate: (value) => {
        if (!value || !value.includes(":")) return "Invalid format (expected id:hash)";
        return true;
      },
    });

    // Validate bot token
    spinner.start(DIM("Validating bot token..."));
    try {
      const res = await fetchWithTimeout(`https://api.telegram.org/bot${tokenInput}/getMe`);
      const data = await res.json();
      if (!data.ok) {
        spinner.warn(DIM("Bot token is invalid — skipping bot setup"));
      } else {
        botToken = tokenInput;
        botUsername = data.result.username;
        spinner.succeed(DIM(`Bot verified: @${botUsername}`));
        extras.push("Bot");
      }
    } catch {
      spinner.warn(DIM("Could not validate bot token (network error) — saving anyway"));
      botToken = tokenInput;
      const usernameInput = await input({
        message: "Bot username (without @)",
        theme,
        validate: (value) => {
          if (!value || value.length < 3) return "Username too short";
          return true;
        },
      });
      botUsername = usernameInput;
      extras.push("Bot");
    }
  }

  // TonAPI key
  const setupTonapi = await confirm({
    message: `Add a TonAPI key? ${DIM("(optional, recommended for 10x rate limits)")}`,
    default: false,
    theme,
  });

  if (setupTonapi) {
    noteBox(
      "Without key: 1 req/s (you will hit rate limits)\n" +
        "With free key: 10 req/s (recommended)\n" +
        "\n" +
        "Open @tonapibot on Telegram → tap the mini app → generate a server key",
      "TonAPI",
      TON
    );
    const keyInput = await input({
      message: "TonAPI key",
      theme,
      validate: (v) => {
        if (!v || v.length < 10) return "Key too short";
        return true;
      },
    });
    tonapiKey = keyInput;
    extras.push("TonAPI");
  }

  // Tavily key
  const setupTavily = await confirm({
    message: `Enable web search? ${DIM("(free Tavily key — 1,000 req/month)")}`,
    default: false,
    theme,
  });

  if (setupTavily) {
    noteBox(
      "Web search lets your agent search the internet and read web pages.\n" +
        "\n" +
        "To get your free API key (takes 30 seconds):\n" +
        "\n" +
        "  1. Go to https://app.tavily.com/sign-in\n" +
        "  2. Create an account (email or Google/GitHub)\n" +
        "  3. Your API key is displayed on the dashboard\n" +
        "     (starts with tvly-)\n" +
        "\n" +
        "Free plan: 1,000 requests/month — no credit card required.",
      "Tavily — Web Search API",
      TON
    );
    const keyInput = await input({
      message: "Tavily API key (starts with tvly-)",
      theme,
      validate: (v) => {
        if (!v || !v.startsWith("tvly-")) return "Should start with tvly-";
        return true;
      },
    });
    tavilyApiKey = keyInput;
    extras.push("Tavily");
  }

  STEPS[3].value = extras.length ? extras.join(", ") : "defaults";

  // ════════════════════════════════════════════════════════════════════
  // Step 4: Wallet — generate / import / keep
  // ════════════════════════════════════════════════════════════════════
  redraw(4);

  let wallet;
  const existingWallet = walletExists() ? loadWallet() : null;

  if (existingWallet) {
    noteBox(`Existing wallet found: ${existingWallet.address}`, "TON Wallet", TON);

    const walletAction = await select({
      message: "A TON wallet already exists. What do you want to do?",
      default: "keep",
      theme,
      choices: [
        { value: "keep", name: "Keep existing", description: existingWallet.address },
        {
          value: "regenerate",
          name: "Generate new",
          description: "WARNING: old wallet will be lost",
        },
        { value: "import", name: "Import mnemonic", description: "Restore from 24-word seed" },
      ],
    });

    if (walletAction === "keep") {
      wallet = existingWallet;
    } else if (walletAction === "import") {
      const mnemonicInput = await input({
        message: "Enter your 24-word mnemonic (space-separated)",
        theme,
        validate: (value = "") => {
          const words = value.trim().split(/\s+/);
          return words.length === 24 ? true : `Expected 24 words, got ${words.length}`;
        },
      });
      spinner.start(DIM("Importing wallet..."));
      wallet = await importWallet(mnemonicInput.trim().split(/\s+/));
      saveWallet(wallet);
      spinner.succeed(DIM(`Wallet imported: ${wallet.address}`));
    } else {
      spinner.start(DIM("Generating new TON wallet..."));
      wallet = await generateWallet();
      saveWallet(wallet);
      spinner.succeed(DIM("New TON wallet generated"));
    }
  } else {
    const walletAction = await select({
      message: "TON Wallet",
      default: "generate",
      theme,
      choices: [
        {
          value: "generate",
          name: "Generate new wallet",
          description: "Create a fresh TON wallet",
        },
        { value: "import", name: "Import from mnemonic", description: "Restore from 24-word seed" },
      ],
    });

    if (walletAction === "import") {
      const mnemonicInput = await input({
        message: "Enter your 24-word mnemonic (space-separated)",
        theme,
        validate: (value = "") => {
          const words = value.trim().split(/\s+/);
          return words.length === 24 ? true : `Expected 24 words, got ${words.length}`;
        },
      });
      spinner.start(DIM("Importing wallet..."));
      wallet = await importWallet(mnemonicInput.trim().split(/\s+/));
      saveWallet(wallet);
      spinner.succeed(DIM(`Wallet imported: ${wallet.address}`));
    } else {
      spinner.start(DIM("Generating TON wallet..."));
      wallet = await generateWallet();
      saveWallet(wallet);
      spinner.succeed(DIM("TON wallet generated"));
    }
  }

  // Display mnemonic for new/regenerated wallets
  if (!existingWallet || wallet !== existingWallet) {
    const W = FRAME_WIDTH;
    const mnTitle = "  ⚠  BACKUP REQUIRED — WRITE DOWN THESE 24 WORDS";

    console.log();
    console.log(RED(`  ┌${"─".repeat(W)}┐`));
    console.log(RED("  │") + RED.bold(padRight(mnTitle, W)) + RED("│"));
    console.log(RED(`  ├${"─".repeat(W)}┤`));
    console.log(RED("  │") + " ".repeat(W) + RED("│"));

    const cols = 4;
    const wordWidth = Math.max(10, Math.floor((W - 8) / cols) - 5);
    const words = wallet.mnemonic;
    for (let r = 0; r < 6; r++) {
      const parts: string[] = [];
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const num = String(idx + 1).padStart(2, " ");
        parts.push(`${DIM(num + ".")} ${WHITE(padRight(words[idx], wordWidth))}`);
      }
      const line = `  ${parts.join("  ")}`;
      const visPad = W - stripAnsi(line).length;
      console.log(RED("  │") + line + " ".repeat(Math.max(0, visPad)) + RED("│"));
    }

    console.log(RED("  │") + " ".repeat(W) + RED("│"));
    console.log(
      RED("  │") +
        padRightAnsi(DIM("  These words allow you to recover your wallet."), W) +
        RED("│")
    );
    console.log(
      RED("  │") +
        padRightAnsi(DIM("  Without them, you will lose access to your TON."), W) +
        RED("│")
    );
    console.log(
      RED("  │") + padRightAnsi(DIM("  Write them on paper and keep them safe."), W) + RED("│")
    );
    console.log(RED("  │") + " ".repeat(W) + RED("│"));
    console.log(RED(`  └${"─".repeat(W)}┘`));
    console.log();

    await confirm({
      message: "I have written down my seed phrase",
      default: true,
      theme,
    });
  }

  STEPS[4].value = `${wallet.address.slice(0, 8)}...${wallet.address.slice(-4)}`;

  // ════════════════════════════════════════════════════════════════════
  // Step 5: Telegram — credentials
  // ════════════════════════════════════════════════════════════════════
  redraw(5);

  noteBox(
    "To get your API credentials:\n" +
      "\n" +
      "  1. Go to https://my.telegram.org/apps\n" +
      "  2. Log in with your phone number\n" +
      '  3. Click "API development tools"\n' +
      "  4. Create an application (any name/short name works)\n" +
      "  5. Copy the API ID (number) and API Hash (hex string)\n" +
      "\n" +
      "⚠ Do NOT use a VPN — Telegram will block the login page.",
    "Telegram",
    TON
  );

  const envApiId = process.env.TELETON_TG_API_ID;
  const envApiHash = process.env.TELETON_TG_API_HASH;
  const envPhone = process.env.TELETON_TG_PHONE;

  const apiIdStr = options.apiId
    ? options.apiId.toString()
    : await input({
        message: envApiId ? "API ID (from env)" : "API ID (from my.telegram.org)",
        default: envApiId,
        theme,
        validate: (value) => {
          if (!value || isNaN(parseInt(value))) return "Invalid API ID (must be a number)";
          return true;
        },
      });
  apiId = parseInt(apiIdStr);

  apiHash = options.apiHash
    ? options.apiHash
    : await input({
        message: envApiHash ? "API Hash (from env)" : "API Hash (from my.telegram.org)",
        default: envApiHash,
        theme,
        validate: (value) => {
          if (!value || value.length < 10) return "Invalid API Hash";
          return true;
        },
      });

  phone = options.phone
    ? options.phone
    : await input({
        message: envPhone ? "Phone number (from env)" : "Phone number (international format)",
        default: envPhone,
        theme,
        validate: (value) => {
          if (!value || !value.startsWith("+")) return "Must start with +";
          return true;
        },
      });

  STEPS[5].value = phone;

  // ════════════════════════════════════════════════════════════════════
  // Step 6: Connect — save config + Telegram auth
  // ════════════════════════════════════════════════════════════════════
  redraw(6);

  // Build config
  const config: Config = {
    meta: {
      version: "1.0.0",
      created_at: new Date().toISOString(),
      onboard_command: "teleton setup",
    },
    agent: {
      provider: selectedProvider,
      api_key: apiKey,
      ...(selectedProvider === "local" && localBaseUrl ? { base_url: localBaseUrl } : {}),
      model: selectedModel,
      max_tokens: 4096,
      temperature: 0.7,
      system_prompt: null,
      max_agentic_iterations: parseInt(maxAgenticIterations, 10),
      session_reset_policy: {
        daily_reset_enabled: true,
        daily_reset_hour: 4,
        idle_expiry_enabled: true,
        idle_expiry_minutes: 1440,
      },
    },
    telegram: {
      api_id: apiId,
      api_hash: apiHash,
      phone,
      session_name: "teleton_session",
      session_path: workspace.sessionPath,
      dm_policy: dmPolicy,
      allow_from: [],
      group_policy: groupPolicy,
      group_allow_from: [],
      require_mention: requireMention,
      max_message_length: TELEGRAM_MAX_MESSAGE_LENGTH,
      typing_simulation: true,
      rate_limit_messages_per_second: 1.0,
      rate_limit_groups_per_minute: 20,
      admin_ids: [userId],
      owner_id: userId,
      agent_channel: null,
      debounce_ms: 1500,
      bot_token: botToken,
      bot_username: botUsername,
    },
    storage: {
      sessions_file: `${workspace.root}/sessions.json`,
      pairing_file: `${workspace.root}/pairing.json`,
      memory_file: `${workspace.root}/memory.json`,
      history_limit: 100,
    },
    embedding: { provider: "local" },
    deals: DealsConfigSchema.parse({ enabled: !!botToken }),
    webui: {
      enabled: false,
      port: 7777,
      host: "127.0.0.1",
      cors_origins: ["http://localhost:5173", "http://localhost:7777"],
      log_requests: false,
    },
    dev: { hot_reload: false },
    tool_rag: {
      enabled: true,
      top_k: 25,
      always_include: [
        "telegram_send_message",
        "telegram_reply_message",
        "telegram_send_photo",
        "telegram_send_document",
        "journal_*",
        "workspace_*",
        "web_*",
      ],
      skip_unlimited_providers: false,
    },
    logging: { level: "info", pretty: true },
    mcp: { servers: {} },
    plugins: {},
    ...(selectedProvider === "cocoon" ? { cocoon: { port: cocoonInstance } } : {}),
    tonapi_key: tonapiKey,
    tavily_api_key: tavilyApiKey,
  };

  // Save config
  spinner.start(DIM("Saving configuration..."));
  const configYaml = YAML.stringify(config);
  writeFileSync(workspace.configPath, configYaml, { encoding: "utf-8", mode: 0o600 });
  spinner.succeed(DIM(`Configuration saved: ${workspace.configPath}`));

  // Telegram authentication
  let telegramConnected = false;
  const connectNow = await confirm({
    message: `Connect to Telegram now? ${DIM("(verification code will be sent to your phone)")}`,
    default: true,
    theme,
  });

  if (connectNow) {
    console.log(
      `\n  ${DIM("Connecting to Telegram... Check your phone for the verification code.")}`
    );
    try {
      const sessionPath = join(TELETON_ROOT, "telegram_session.txt");
      const client = new TelegramUserClient({
        apiId,
        apiHash,
        phone,
        sessionPath,
      });
      await client.connect();
      const me = client.getMe();
      await client.disconnect();
      telegramConnected = true;
      const displayName = `${me?.firstName || ""}${me?.username ? ` (@${me.username})` : ""}`;
      console.log(`  ${GREEN("✓")} ${DIM("Telegram connected as")} ${CYAN(displayName)}\n`);
      STEPS[6].value = `Connected${me?.username ? ` (@${me.username})` : ""}`;
    } catch (err) {
      prompter.warn(
        `Telegram connection failed: ${err instanceof Error ? err.message : String(err)}\n` +
          "You can authenticate later when running: teleton start"
      );
      STEPS[6].value = "Auth on first start";
    }
  } else {
    console.log(`\n  ${DIM("You can authenticate later when running: teleton start")}\n`);
    STEPS[6].value = "Auth on first start";
  }

  // ════════════════════════════════════════════════════════════════════
  // Final summary
  // ════════════════════════════════════════════════════════════════════
  console.clear();
  console.log();
  console.log(wizardFrame(STEPS.length, STEPS));
  console.log();
  console.log(finalSummaryBox(STEPS, telegramConnected));
  console.log();
  console.log(
    `  ${GREEN.bold("✔")} ${GREEN.bold("Setup complete!")} ${DIM(`Config saved to ${workspace.configPath}`)}`
  );
  console.log(`  ${TON.bold("⚡")} Good luck!\n`);
}

/**
 * Non-interactive onboarding (requires all options)
 */
async function runNonInteractiveOnboarding(
  options: OnboardOptions,
  prompter: ReturnType<typeof createPrompter>
): Promise<void> {
  const selectedProvider = options.provider || "anthropic";
  const needsApiKey = selectedProvider !== "cocoon" && selectedProvider !== "local";
  if (!options.apiId || !options.apiHash || !options.phone || !options.userId) {
    prompter.error("Non-interactive mode requires: --api-id, --api-hash, --phone, --user-id");
    process.exit(1);
  }
  if (needsApiKey && !options.apiKey) {
    prompter.error(`Non-interactive mode requires --api-key for provider "${selectedProvider}"`);
    process.exit(1);
  }
  if (selectedProvider === "local" && !options.baseUrl) {
    prompter.error("Non-interactive mode requires --base-url for local provider");
    process.exit(1);
  }

  const workspace = await ensureWorkspace({
    workspaceDir: options.workspace,
    ensureTemplates: true,
  });

  const providerMeta = getProviderMetadata(selectedProvider);

  const config: Config = {
    meta: {
      version: "1.0.0",
      created_at: new Date().toISOString(),
      onboard_command: "teleton setup",
    },
    agent: {
      provider: selectedProvider,
      api_key: options.apiKey || "",
      ...(options.baseUrl ? { base_url: options.baseUrl } : {}),
      model: providerMeta.defaultModel,
      max_tokens: 4096,
      temperature: 0.7,
      system_prompt: null,
      max_agentic_iterations: 5,
      session_reset_policy: {
        daily_reset_enabled: true,
        daily_reset_hour: 4,
        idle_expiry_enabled: true,
        idle_expiry_minutes: 1440,
      },
    },
    telegram: {
      api_id: options.apiId,
      api_hash: options.apiHash,
      phone: options.phone,
      session_name: "teleton_session",
      session_path: workspace.sessionPath,
      dm_policy: "open",
      allow_from: [],
      group_policy: "open",
      group_allow_from: [],
      require_mention: true,
      max_message_length: TELEGRAM_MAX_MESSAGE_LENGTH,
      typing_simulation: true,
      rate_limit_messages_per_second: 1.0,
      rate_limit_groups_per_minute: 20,
      admin_ids: [options.userId],
      owner_id: options.userId,
      agent_channel: null,
      debounce_ms: 1500,
      bot_token: undefined,
      bot_username: undefined,
    },
    storage: {
      sessions_file: `${workspace.root}/sessions.json`,
      pairing_file: `${workspace.root}/pairing.json`,
      memory_file: `${workspace.root}/memory.json`,
      history_limit: 100,
    },
    embedding: { provider: "local" },
    deals: DealsConfigSchema.parse({}),
    webui: {
      enabled: false,
      port: 7777,
      host: "127.0.0.1",
      cors_origins: ["http://localhost:5173", "http://localhost:7777"],
      log_requests: false,
    },
    dev: { hot_reload: false },
    tool_rag: {
      enabled: true,
      top_k: 25,
      always_include: [
        "telegram_send_message",
        "telegram_reply_message",
        "telegram_send_photo",
        "telegram_send_document",
        "journal_*",
        "workspace_*",
        "web_*",
      ],
      skip_unlimited_providers: false,
    },
    logging: { level: "info", pretty: true },
    mcp: { servers: {} },
    plugins: {},
    tavily_api_key: options.tavilyApiKey,
  };

  const configYaml = YAML.stringify(config);
  writeFileSync(workspace.configPath, configYaml, { encoding: "utf-8", mode: 0o600 });

  prompter.success(`Configuration created: ${workspace.configPath}`);
}
