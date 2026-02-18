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
import { writeFileSync, readFileSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { TELETON_ROOT } from "../../workspace/paths.js";
import { TelegramUserClient } from "../../telegram/client.js";
import YAML from "yaml";
import { type Config, DealsConfigSchema } from "../../config/schema.js";
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

export interface OnboardOptions {
  workspace?: string;
  nonInteractive?: boolean;
  apiId?: number;
  apiHash?: string;
  phone?: string;
  apiKey?: string;
  userId?: number;
  provider?: SupportedProvider;
  tavilyApiKey?: string;
}

// ── Progress steps ────────────────────────────────────────────────────

const STEPS: StepDef[] = [
  { label: "Agent", desc: "Name & mode" },
  { label: "Provider", desc: "LLM & API key" },
  { label: "Telegram", desc: "Credentials" },
  { label: "Config", desc: "Model & policies" },
  { label: "Modules", desc: "Optional features" },
  { label: "Wallet", desc: "TON blockchain" },
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

// ── Model catalogs (per provider) ─────────────────────────────────────

const MODEL_OPTIONS: Record<string, Array<{ value: string; name: string; description: string }>> = {
  anthropic: [
    {
      value: "claude-opus-4-5-20251101",
      name: "Claude Opus 4.5",
      description: "Most capable, $5/M",
    },
    { value: "claude-sonnet-4-0", name: "Claude Sonnet 4", description: "Balanced, $3/M" },
    {
      value: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      description: "Fast & cheap, $1/M",
    },
    {
      value: "claude-3-5-haiku-20241022",
      name: "Claude 3.5 Haiku",
      description: "Cheapest, $0.80/M",
    },
  ],
  openai: [
    { value: "gpt-5", name: "GPT-5", description: "Most capable, 400K ctx, $1.25/M" },
    { value: "gpt-4o", name: "GPT-4o", description: "Balanced, 128K ctx, $2.50/M" },
    { value: "gpt-4.1", name: "GPT-4.1", description: "1M ctx, $2/M" },
    { value: "gpt-4.1-mini", name: "GPT-4.1 Mini", description: "1M ctx, cheap, $0.40/M" },
    { value: "o3", name: "o3", description: "Reasoning, 200K ctx, $2/M" },
  ],
  google: [
    { value: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Fast, 1M ctx, $0.30/M" },
    {
      value: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      description: "Most capable, 1M ctx, $1.25/M",
    },
    { value: "gemini-2.0-flash", name: "Gemini 2.0 Flash", description: "Cheap, 1M ctx, $0.10/M" },
  ],
  xai: [
    { value: "grok-4-fast", name: "Grok 4 Fast", description: "Vision, 2M ctx, $0.20/M" },
    { value: "grok-4", name: "Grok 4", description: "Reasoning, 256K ctx, $3/M" },
    { value: "grok-3", name: "Grok 3", description: "Stable, 131K ctx, $3/M" },
  ],
  groq: [
    {
      value: "meta-llama/llama-4-maverick-17b-128e-instruct",
      name: "Llama 4 Maverick",
      description: "Vision, 131K ctx, $0.20/M",
    },
    { value: "qwen/qwen3-32b", name: "Qwen3 32B", description: "Reasoning, 131K ctx, $0.29/M" },
    {
      value: "deepseek-r1-distill-llama-70b",
      name: "DeepSeek R1 70B",
      description: "Reasoning, 131K ctx, $0.75/M",
    },
    {
      value: "llama-3.3-70b-versatile",
      name: "Llama 3.3 70B",
      description: "General purpose, 131K ctx, $0.59/M",
    },
  ],
  openrouter: [
    { value: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5", description: "200K ctx, $5/M" },
    { value: "openai/gpt-5", name: "GPT-5", description: "400K ctx, $1.25/M" },
    { value: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "1M ctx, $0.30/M" },
    {
      value: "deepseek/deepseek-r1",
      name: "DeepSeek R1",
      description: "Reasoning, 64K ctx, $0.70/M",
    },
    { value: "x-ai/grok-4", name: "Grok 4", description: "256K ctx, $3/M" },
  ],
  moonshot: [
    { value: "kimi-k2.5", name: "Kimi K2.5", description: "Free, 256K ctx, multimodal" },
    {
      value: "kimi-k2-thinking",
      name: "Kimi K2 Thinking",
      description: "Free, 256K ctx, reasoning",
    },
  ],
};

/**
 * Main onboard command
 */
export async function onboardCommand(options: OnboardOptions = {}): Promise<void> {
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
  let selectedFlow: "quick" | "advanced" = "quick";
  let selectedProvider: SupportedProvider = "anthropic";
  const dealsEnabled = true;
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
  let buyMaxFloorPercent = 100;
  let sellMinFloorPercent = 105;

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

  // Installation mode
  selectedFlow = await select({
    message: "Installation mode",
    default: "quick",
    theme,
    choices: [
      {
        value: "quick" as const,
        name: "⚡ QuickStart",
        description: "Minimal configuration (recommended)",
      },
      { value: "advanced" as const, name: "⚙  Advanced", description: "Detailed configuration" },
    ],
  });

  STEPS[0].value = `${agentName} (${selectedFlow})`;

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

  // API key
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

  // ════════════════════════════════════════════════════════════════════
  // Step 2: Telegram — credentials
  // ════════════════════════════════════════════════════════════════════
  redraw(2);

  noteBox(
    "You need Telegram credentials from https://my.telegram.org/apps\n" +
      "Create an application and note the API ID and API Hash",
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

  // User ID
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

  STEPS[2].value = `${phone} (ID: ${userId})`;

  // ════════════════════════════════════════════════════════════════════
  // Step 3: Config — model + policies (advanced only)
  // ════════════════════════════════════════════════════════════════════
  redraw(3);

  selectedModel = providerMeta.defaultModel;

  if (selectedFlow === "advanced") {
    const providerModels = MODEL_OPTIONS[selectedProvider] || [];
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

    const modelLabel = providerModels.find((m) => m.value === selectedModel)?.name ?? selectedModel;
    STEPS[3].value = `${modelLabel}, ${dmPolicy}/${groupPolicy}`;
  } else {
    STEPS[3].value = `${selectedModel} (defaults)`;
  }

  // ════════════════════════════════════════════════════════════════════
  // Step 4: Modules — deals bot + TonAPI + Tavily
  // ════════════════════════════════════════════════════════════════════
  redraw(4);

  const extras: string[] = [];

  if (dealsEnabled) {
    // Trading thresholds
    const customizeStrategy = await confirm({
      message: `Customize trading thresholds? ${DIM("(default: buy ≤ floor, sell ≥ floor +5%)")}`,
      default: false,
      theme,
    });

    if (customizeStrategy) {
      const buyInput = await input({
        message: "Max buy price (% of floor price)",
        default: "100",
        theme,
        validate: (v) => {
          const n = parseInt(v, 10);
          return !isNaN(n) && n >= 50 && n <= 150 ? true : "Must be 50–150";
        },
      });
      buyMaxFloorPercent = parseInt(buyInput, 10);

      const sellInput = await input({
        message: "Min sell price (% of floor price)",
        default: "105",
        theme,
        validate: (v) => {
          const n = parseInt(v, 10);
          return !isNaN(n) && n >= 100 && n <= 200 ? true : "Must be 100–200";
        },
      });
      sellMinFloorPercent = parseInt(sellInput, 10);
    }

    // Bot setup
    noteBox(
      "Create a bot with @BotFather on Telegram:\n" +
        "1. Send /newbot and follow the instructions\n" +
        "2. Copy the bot token\n" +
        "3. Enable inline mode: /setinline on the bot",
      "Deals Bot",
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
    }

    extras.push("Deals");
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

  STEPS[4].value = extras.length ? extras.join(", ") : "defaults";

  // ════════════════════════════════════════════════════════════════════
  // Step 5: Wallet — generate / import / keep
  // ════════════════════════════════════════════════════════════════════
  redraw(5);

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
    spinner.start(DIM("Generating TON wallet..."));
    wallet = await generateWallet();
    saveWallet(wallet);
    spinner.succeed(DIM("TON wallet generated"));
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
  }

  STEPS[5].value = `${wallet.address.slice(0, 8)}...${wallet.address.slice(-4)}`;

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
    deals: DealsConfigSchema.parse({
      enabled: dealsEnabled,
      buy_max_floor_percent: buyMaxFloorPercent,
      sell_min_floor_percent: sellMinFloorPercent,
    }),
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
    mcp: { servers: {} },
    plugins: {},
    tonapi_key: tonapiKey,
    tavily_api_key: tavilyApiKey,
  };

  // Save config
  spinner.start(DIM("Saving configuration..."));
  const configYaml = YAML.stringify(config);
  writeFileSync(workspace.configPath, configYaml, "utf-8");
  chmodSync(workspace.configPath, 0o600);
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
  if (!options.apiId || !options.apiHash || !options.phone || !options.apiKey || !options.userId) {
    prompter.error(
      "Non-interactive mode requires: --api-id, --api-hash, --phone, --api-key, --user-id"
    );
    process.exit(1);
  }

  const workspace = await ensureWorkspace({
    workspaceDir: options.workspace,
    ensureTemplates: true,
  });

  const selectedProvider = options.provider || "anthropic";
  const providerMeta = getProviderMetadata(selectedProvider);

  const config: Config = {
    meta: {
      version: "1.0.0",
      created_at: new Date().toISOString(),
      onboard_command: "teleton setup",
    },
    agent: {
      provider: selectedProvider,
      api_key: options.apiKey,
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
    mcp: { servers: {} },
    plugins: {},
    tavily_api_key: options.tavilyApiKey,
  };

  const configYaml = YAML.stringify(config);
  writeFileSync(workspace.configPath, configYaml, "utf-8");
  chmodSync(workspace.configPath, 0o600);

  prompter.success(`Configuration created: ${workspace.configPath}`);
}
