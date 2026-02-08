/**
 * Tonnet Onboarding Wizard
 */

import { createPrompter, CancelledError } from "../prompts.js";
import { ensureWorkspace, isNewWorkspace } from "../../workspace/manager.js";
import { writeFileSync, readFileSync, existsSync, chmodSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { TELETON_ROOT } from "../../workspace/paths.js";
import { TelegramUserClient } from "../../telegram/client.js";
import YAML from "yaml";
import {
  type Config,
  CasinoConfigSchema,
  DealsConfigSchema,
  MarketConfigSchema,
} from "../../config/schema.js";
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
import { ONBOARDING_PROMPT_TIMEOUT_MS } from "../../constants/timeouts.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../constants/limits.js";
import { fetchWithTimeout } from "../../utils/fetch.js";

export interface OnboardOptions {
  workspace?: string;
  nonInteractive?: boolean;
  apiId?: number;
  apiHash?: string;
  phone?: string;
  apiKey?: string;
  userId?: number;
  provider?: SupportedProvider;
}

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
      prompter.outro("Onboarding cancelled");
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
  // ASCII banner (blue color)
  const blue = "\x1b[34m";
  const reset = "\x1b[0m";
  console.log(`
${blue}  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                       │
  │       ______________    ________________  _   __   ___   _____________   ________     │
  │      /_  __/ ____/ /   / ____/_  __/ __ \\/ | / /  /   | / ____/ ____/ | / /_  __/     │
  │       / / / __/ / /   / __/   / / / / / /  |/ /  / /| |/ / __/ __/ /  |/ / / /        │
  │      / / / /___/ /___/ /___  / / / /_/ / /|  /  / ___ / /_/ / /___/ /|  / / /         │
  │     /_/ /_____/_____/_____/ /_/  \\____/_/ |_/  /_/  |_\\____/_____/_/ |_/ /_/          │
  │                                                                                       │
  └────────────────────────────────────────────────────────────────────────────── SETUP ──┘${reset}

  Need help? Join @ResistanceForum on Telegram
`);

  // Warning
  prompter.note(
    "Your Teleton agent will have FULL CONTROL over:\n\n" +
      "• TELEGRAM: Read, send, and delete messages on your behalf\n" +
      "• TON WALLET: A new wallet will be generated that the agent\n" +
      "  can use to send transactions autonomously\n\n" +
      "We strongly recommend using a dedicated Telegram account.\n" +
      "Only fund the generated wallet with amounts you're comfortable\n" +
      "letting the agent manage.",
    "Security Warning"
  );

  const acceptRisk = await prompter.confirm({
    message: "I understand the risks and want to continue",
    initialValue: false,
  });

  if (!acceptRisk) {
    prompter.outro("Setup cancelled - you must accept the risks to continue");
    process.exit(1);
  }

  // Workspace setup
  const spinner = prompter.spinner();
  spinner.start("Creating workspace...");

  const workspace = await ensureWorkspace({
    workspaceDir: options.workspace,
    ensureTemplates: true,
  });

  const isNew = isNewWorkspace(workspace);
  spinner.stop(`✓ Workspace: ${workspace.root}`);

  if (!isNew) {
    prompter.warn("Existing configuration detected");
    const shouldOverwrite = await prompter.confirm({
      message: "Overwrite existing configuration?",
      initialValue: false,
    });

    if (!shouldOverwrite) {
      prompter.outro("Setup cancelled - existing configuration preserved");
      return;
    }
  }

  // Agent name
  const agentName = await prompter.text({
    message: "Give your agent a name (optional)",
    placeholder: "e.g. Nova, Kai, Echo...",
  });

  if (agentName && agentName.trim() && existsSync(workspace.identityPath)) {
    const identity = readFileSync(workspace.identityPath, "utf-8");
    const updated = identity.replace("[Your name - pick one or ask your human]", agentName.trim());
    writeFileSync(workspace.identityPath, updated, "utf-8");
  }

  // Flow selection
  const flow = await prompter.select({
    message: "Installation mode",
    options: [
      { value: "quick", label: "QuickStart", hint: "Minimal configuration (recommended)" },
      { value: "advanced", label: "Advanced", hint: "Detailed configuration" },
    ],
    initialValue: "quick",
  });

  // Optional modules
  const enabledModules: string[] = await prompter.multiselect({
    message: "Enable optional modules",
    options: [
      { value: "casino", label: "Casino", hint: "Slot machine & dice games with TON bets" },
      { value: "deals", label: "Deals", hint: "Secure gift/TON trading with inline buttons" },
      {
        value: "market",
        label: "Gifts Market Data",
        hint: "Scrape gift floor prices (requires Chromium)",
      },
    ],
    required: false,
  });

  const casinoEnabled = enabledModules.includes("casino");
  const dealsEnabled = enabledModules.includes("deals");
  const marketEnabled = enabledModules.includes("market");

  // AI Provider selection
  const providers = getSupportedProviders();
  const selectedProvider: SupportedProvider = await prompter.select({
    message: "AI Provider",
    options: providers.map((p) => ({
      value: p.id,
      label: p.displayName,
      hint:
        p.toolLimit !== null ? `${p.defaultModel} (max ${p.toolLimit} tools)` : `${p.defaultModel}`,
    })),
    initialValue: "anthropic",
  });

  const providerMeta = getProviderMetadata(selectedProvider);

  // Tool limit warning
  if (providerMeta.toolLimit !== null) {
    prompter.note(
      `${providerMeta.displayName} supports max ${providerMeta.toolLimit} tools.\n` +
        "Tonnet currently has ~121 tools. If more tools are added,\n" +
        "some may be truncated.",
      "Tool Limit"
    );
  }

  // Telegram credentials
  prompter.note(
    "You need Telegram credentials from https://my.telegram.org/apps\n" +
      "Create an application and note the API ID and API Hash",
    "Telegram"
  );

  // Read env vars for pre-filling
  const envApiId = process.env.TELETON_TG_API_ID;
  const envApiHash = process.env.TELETON_TG_API_HASH;
  const envPhone = process.env.TELETON_TG_PHONE;
  const envApiKey = process.env.TELETON_API_KEY;

  const apiIdStr = options.apiId
    ? options.apiId.toString()
    : await prompter.text({
        message: envApiId ? "API ID (from env)" : "API ID (from my.telegram.org)",
        initialValue: envApiId,
        validate: (value) => {
          if (!value || isNaN(parseInt(value))) return "Invalid API ID (must be a number)";
        },
      });
  const apiId = parseInt(apiIdStr);

  const apiHash = options.apiHash
    ? options.apiHash
    : await prompter.text({
        message: envApiHash ? "API Hash (from env)" : "API Hash (from my.telegram.org)",
        initialValue: envApiHash,
        validate: (value) => {
          if (!value || value.length < 10) return "Invalid API Hash";
        },
      });

  const phone = options.phone
    ? options.phone
    : await prompter.text({
        message: envPhone
          ? "Phone number (from env)"
          : "Phone number (international format, e.g. +1234567890)",
        placeholder: "+1234567890",
        initialValue: envPhone,
        validate: (value) => {
          if (!value || !value.startsWith("+")) return "Invalid format (must start with +)";
        },
      });

  // User ID for admin
  prompter.note(
    "To get your Telegram User ID:\n" +
      "1. Open @userinfobot on Telegram\n" +
      "2. Send /start\n" +
      "3. Note the ID displayed",
    "User ID"
  );

  const userIdStr = options.userId
    ? options.userId.toString()
    : await prompter.text({
        message: "Your Telegram User ID (for admin rights)",
        validate: (value) => {
          if (!value || isNaN(parseInt(value))) return "Invalid User ID";
        },
      });
  const userId = parseInt(userIdStr);

  // Provider API Key (dynamic based on selection)
  prompter.note(
    `${providerMeta.displayName} API key required.\n` + `Get it at: ${providerMeta.consoleUrl}`,
    "API Key"
  );

  let apiKey: string;
  if (options.apiKey) {
    apiKey = options.apiKey;
  } else if (envApiKey) {
    const validationError = validateApiKeyFormat(selectedProvider, envApiKey);
    if (validationError) {
      prompter.warn(`TELETON_API_KEY env var found but invalid: ${validationError}`);
      apiKey = await prompter.password({
        message: `${providerMeta.displayName} API Key (${providerMeta.keyHint})`,
        validate: (value) => validateApiKeyFormat(selectedProvider, value),
      });
    } else {
      prompter.log(`Using API key from TELETON_API_KEY env var`);
      apiKey = envApiKey;
    }
  } else {
    apiKey = await prompter.password({
      message: `${providerMeta.displayName} API Key (${providerMeta.keyHint})`,
      validate: (value) => validateApiKeyFormat(selectedProvider, value),
    });
  }

  // Model selection (advanced mode only)
  const MODEL_OPTIONS: Record<string, Array<{ value: string; label: string; hint: string }>> = {
    anthropic: [
      { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", hint: "Most capable, $5/M" },
      { value: "claude-sonnet-4-0", label: "Claude Sonnet 4", hint: "Balanced, $3/M" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "Fast & cheap, $1/M" },
      { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", hint: "Cheapest, $0.80/M" },
    ],
    openai: [
      { value: "gpt-5", label: "GPT-5", hint: "Most capable, 400K ctx, $1.25/M" },
      { value: "gpt-4o", label: "GPT-4o", hint: "Balanced, 128K ctx, $2.50/M" },
      { value: "gpt-4.1", label: "GPT-4.1", hint: "1M ctx, $2/M" },
      { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", hint: "1M ctx, cheap, $0.40/M" },
      { value: "o3", label: "o3", hint: "Reasoning, 200K ctx, $2/M" },
    ],
    google: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Fast, 1M ctx, $0.30/M" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Most capable, 1M ctx, $1.25/M" },
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Cheap, 1M ctx, $0.10/M" },
    ],
    xai: [
      { value: "grok-4-fast", label: "Grok 4 Fast", hint: "Vision, 2M ctx, $0.20/M" },
      { value: "grok-4", label: "Grok 4", hint: "Reasoning, 256K ctx, $3/M" },
      { value: "grok-3", label: "Grok 3", hint: "Stable, 131K ctx, $3/M" },
    ],
    groq: [
      {
        value: "meta-llama/llama-4-maverick-17b-128e-instruct",
        label: "Llama 4 Maverick",
        hint: "Vision, 131K ctx, $0.20/M",
      },
      { value: "qwen/qwen3-32b", label: "Qwen3 32B", hint: "Reasoning, 131K ctx, $0.29/M" },
      {
        value: "deepseek-r1-distill-llama-70b",
        label: "DeepSeek R1 70B",
        hint: "Reasoning, 131K ctx, $0.75/M",
      },
      {
        value: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B",
        hint: "General purpose, 131K ctx, $0.59/M",
      },
    ],
    openrouter: [
      { value: "anthropic/claude-opus-4.5", label: "Claude Opus 4.5", hint: "200K ctx, $5/M" },
      { value: "openai/gpt-5", label: "GPT-5", hint: "400K ctx, $1.25/M" },
      { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "1M ctx, $0.30/M" },
      { value: "deepseek/deepseek-r1", label: "DeepSeek R1", hint: "Reasoning, 64K ctx, $0.70/M" },
      { value: "x-ai/grok-4", label: "Grok 4", hint: "256K ctx, $3/M" },
    ],
  };

  let selectedModel = providerMeta.defaultModel;
  if (flow === "advanced") {
    const providerModels = MODEL_OPTIONS[selectedProvider] || [];
    const modelOptions = [
      ...providerModels,
      { value: "__custom__", label: "Custom", hint: "Enter a model ID manually" },
    ];

    const modelChoice = await prompter.select({
      message: "Model",
      options: modelOptions,
      initialValue: providerMeta.defaultModel,
    });

    if (modelChoice === "__custom__") {
      const customModel = await prompter.text({
        message: "Model ID",
        placeholder: providerMeta.defaultModel,
        initialValue: providerMeta.defaultModel,
      });
      if (customModel && customModel.trim()) {
        selectedModel = customModel.trim();
      }
    } else {
      selectedModel = modelChoice;
    }
  }

  // Policies
  let dmPolicy: "open" | "allowlist" | "pairing" | "disabled" = "open";
  let groupPolicy: "open" | "allowlist" | "disabled" = "open";
  let requireMention = true;
  let maxAgenticIterations = "5";

  if (flow === "advanced") {
    dmPolicy = await prompter.select({
      message: "DM policy (private messages)",
      options: [
        { value: "open", label: "Open", hint: "Reply to everyone" },
        { value: "allowlist", label: "Allowlist", hint: "Only specific users" },
        { value: "disabled", label: "Disabled", hint: "No DM replies" },
      ],
      initialValue: "open",
    });

    groupPolicy = await prompter.select({
      message: "Group policy",
      options: [
        { value: "open", label: "Open", hint: "Reply in all groups" },
        { value: "allowlist", label: "Allowlist", hint: "Only specific groups" },
        { value: "disabled", label: "Disabled", hint: "No group replies" },
      ],
      initialValue: "open",
    });

    requireMention = await prompter.confirm({
      message: "Require @mention in groups?",
      initialValue: true,
    });

    maxAgenticIterations = await prompter.text({
      message: "Max agentic iterations (tool call loops per message)",
      initialValue: "5",
      validate: (v: string) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1 || n > 50) return "Must be a number between 1 and 50";
      },
    });
  }

  // Deals bot setup (only if deals enabled)
  let botToken: string | undefined;
  let botUsername: string | undefined;

  // Deals strategy thresholds (only if deals enabled)
  let buyMaxFloorPercent = 100;
  let sellMinFloorPercent = 105;

  if (dealsEnabled) {
    const customizeStrategy = await prompter.confirm({
      message: "Customize trading thresholds? (default: buy ≤ floor, sell ≥ floor +5%)",
      initialValue: false,
    });

    if (customizeStrategy) {
      const buyInput = await prompter.text({
        message: "Max buy price (% of floor price)",
        initialValue: "100",
        validate: (v: string) => {
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 50 || n > 150) return "Must be between 50 and 150";
        },
      });
      buyMaxFloorPercent = parseInt(buyInput, 10);

      const sellInput = await prompter.text({
        message: "Min sell price (% of floor price)",
        initialValue: "105",
        validate: (v: string) => {
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 100 || n > 200) return "Must be between 100 and 200";
        },
      });
      sellMinFloorPercent = parseInt(sellInput, 10);
    }
  }

  const setupBot = dealsEnabled
    ? await prompter.confirm({
        message: "Set up a Telegram bot for deal confirmations? (inline buttons)",
        initialValue: true,
      })
    : false;

  if (setupBot) {
    prompter.note(
      "Create a bot with @BotFather on Telegram:\n" +
        "1. Send /newbot and follow the instructions\n" +
        "2. Copy the bot token\n" +
        "3. Enable inline mode: /setinline on the bot",
      "Deals Bot"
    );

    const tokenInput = await prompter.password({
      message: "Bot token (from @BotFather)",
      validate: (value) => {
        if (!value || !value.includes(":")) return "Invalid bot token format (expected id:hash)";
      },
    });

    // Validate token with Telegram API
    spinner.start("Validating bot token...");
    try {
      const res = await fetchWithTimeout(`https://api.telegram.org/bot${tokenInput}/getMe`);
      const data = await res.json();
      if (!data.ok) {
        spinner.stop("⚠ Bot token is invalid - skipping bot setup");
      } else {
        botToken = tokenInput;
        botUsername = data.result.username;
        spinner.stop(`✓ Bot verified: @${botUsername}`);
      }
    } catch {
      spinner.stop("⚠ Could not validate bot token (network error) - saving anyway");
      botToken = tokenInput;
      const usernameInput = await prompter.text({
        message: "Bot username (without @)",
        validate: (value) => {
          if (!value || value.length < 3) return "Username too short";
        },
      });
      botUsername = usernameInput;
    }
  }

  // TonAPI key (optional, for higher rate limits)
  let tonapiKey: string | undefined;
  const setupTonapi = await prompter.confirm({
    message: "Add a TonAPI key? (optional, recommended)",
    initialValue: false,
  });

  if (setupTonapi) {
    prompter.note(
      "Without key: 1 req/s (you will hit rate limits)\n" +
        "With free key: 10 req/s (recommended)\n\n" +
        "Open @tonapibot on Telegram → tap the mini app → generate a server key",
      "TonAPI"
    );
    const keyInput = await prompter.text({
      message: "TonAPI key",
      validate: (v) => {
        if (!v || v.length < 10) return "Key too short";
      },
    });
    tonapiKey = keyInput;
  }

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
      session_name: "tonnet_session",
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
    casino: CasinoConfigSchema.parse({ enabled: casinoEnabled }),
    deals: DealsConfigSchema.parse({
      enabled: dealsEnabled,
      buy_max_floor_percent: buyMaxFloorPercent,
      sell_min_floor_percent: sellMinFloorPercent,
    }),
    market: MarketConfigSchema.parse({ enabled: marketEnabled }),
    tonapi_key: tonapiKey,
  };

  // Save config
  spinner.start("Saving configuration...");
  const configYaml = YAML.stringify(config);
  writeFileSync(workspace.configPath, configYaml, "utf-8");
  chmodSync(workspace.configPath, 0o600);
  spinner.stop("✓ Configuration saved");

  // TON wallet setup
  let wallet;
  const existingWallet = walletExists() ? loadWallet() : null;

  if (existingWallet) {
    prompter.note(`Existing wallet found: ${existingWallet.address}`, "TON Wallet");

    const walletAction = await prompter.select({
      message: "A TON wallet already exists. What do you want to do?",
      options: [
        { value: "keep", label: "Keep existing", hint: `${existingWallet.address}` },
        { value: "regenerate", label: "Generate new", hint: "WARNING: old wallet will be lost" },
        { value: "import", label: "Import mnemonic", hint: "Restore from 24-word seed" },
      ],
      initialValue: "keep",
    });

    if (walletAction === "keep") {
      wallet = existingWallet;
    } else if (walletAction === "import") {
      const mnemonicInput = await prompter.text({
        message: "Enter your 24-word mnemonic (space-separated)",
        validate: (value) => {
          const words = value.trim().split(/\s+/);
          if (words.length !== 24) return `Expected 24 words, got ${words.length}`;
        },
      });
      spinner.start("Importing wallet...");
      wallet = await importWallet(mnemonicInput.trim().split(/\s+/));
      saveWallet(wallet);
      spinner.stop(`✓ Wallet imported: ${wallet.address}`);
    } else {
      spinner.start("Generating new TON wallet...");
      wallet = await generateWallet();
      saveWallet(wallet);
      spinner.stop("✓ New TON wallet generated");
    }
  } else {
    spinner.start("Generating TON wallet...");
    wallet = await generateWallet();
    saveWallet(wallet);
    spinner.stop("✓ TON wallet generated");
  }

  // Install Playwright browser for market scraping (only if market enabled)
  if (marketEnabled) {
    spinner.start("Installing browser for market data...");
    try {
      execSync("npx playwright install chromium", {
        stdio: "pipe",
        timeout: ONBOARDING_PROMPT_TIMEOUT_MS,
      });
      spinner.stop("✓ Browser installed");
    } catch {
      spinner.stop(
        "⚠ Browser install failed (can be done later with: npx playwright install chromium)"
      );
    }
  }

  // Display mnemonic (only for new/regenerated wallets, not for kept ones)
  if (!existingWallet || wallet !== existingWallet) {
    prompter.note(
      "BACKUP REQUIRED - WRITE DOWN THESE 24 WORDS:\n\n" +
        wallet.mnemonic.join(" ") +
        "\n\nThese words allow you to recover your wallet.\n" +
        "Without them, you will lose access to your TON.\n" +
        "Write them on paper and keep them safe.",
      "Mnemonic Seed (24 words)"
    );
  }

  // Telegram authentication
  let telegramConnected = false;
  const connectNow = await prompter.confirm({
    message: "Connect to Telegram now? (you'll need the verification code sent to your phone)",
    initialValue: true,
  });

  if (connectNow) {
    prompter.log("Connecting to Telegram... Check your phone for the verification code.");
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
      prompter.success(
        `✓ Telegram connected as ${me?.firstName || ""}${me?.username ? ` (@${me.username})` : ""}`
      );
    } catch (err) {
      prompter.warn(
        `Telegram connection failed: ${err instanceof Error ? err.message : String(err)}\n` +
          "You can authenticate later when running: teleton start"
      );
    }
  }

  // Summary
  prompter.note(
    `Workspace: ${workspace.root}\n` +
      `Config: ${workspace.configPath}\n` +
      `Templates: SOUL.md, MEMORY.md, IDENTITY.md, USER.md\n` +
      `Telegram: ${phone} (API ID: ${apiId})${telegramConnected ? " ✓ connected" : ""}\n` +
      `Admin: User ID ${userId}\n` +
      `Provider: ${providerMeta.displayName}\n` +
      `Model: ${selectedModel}\n` +
      `TON Wallet: ${wallet.address}`,
    "Setup complete"
  );

  if (telegramConnected) {
    prompter.note(
      "Next steps:\n\n" +
        "1. Start the agent:\n" +
        "   $ teleton start\n\n" +
        "2. Send a message to your Telegram account to test",
      "Ready"
    );
  } else {
    prompter.note(
      "Next steps:\n\n" +
        "1. Start the agent:\n" +
        "   $ teleton start\n\n" +
        "2. On first launch, you will be asked for:\n" +
        "   - Telegram verification code\n" +
        "   - 2FA password (if enabled)\n\n" +
        "3. Send a message to your Telegram account to test",
      "Ready"
    );
  }

  prompter.outro("Good luck!");
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
      session_name: "tonnet_session",
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
    casino: CasinoConfigSchema.parse({}),
    deals: DealsConfigSchema.parse({}),
    market: MarketConfigSchema.parse({}),
  };

  const configYaml = YAML.stringify(config);
  writeFileSync(workspace.configPath, configYaml, "utf-8");
  chmodSync(workspace.configPath, 0o600);

  prompter.success(`✓ Configuration created: ${workspace.configPath}`);
}
