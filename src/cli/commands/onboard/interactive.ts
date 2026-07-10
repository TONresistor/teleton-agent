import {
  type createPrompter,
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
} from "../../prompts.js";
import { ensureWorkspace, isNewWorkspace, type Workspace } from "../../../workspace/manager.js";
import { TELETON_ROOT } from "../../../workspace/paths.js";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { TelegramUserClient } from "../../../telegram/client.js";
import { maskSecret } from "../../../utils/mask.js";
import YAML from "yaml";
import { getModelsForProvider } from "../../../config/model-catalog.js";
import {
  generateWallet,
  importWallet,
  saveWallet,
  walletExists,
  loadWallet,
  type WalletData,
} from "../../../ton/wallet-service.js";
import {
  getSupportedProviders,
  getProviderMetadata,
  validateApiKeyFormat,
  type SupportedProvider,
} from "../../../config/providers.js";
import { getErrorMessage } from "../../../utils/errors.js";
import ora from "ora";
import { getCodexApiKey, isCodexTokenValid } from "../../../providers/codex-credentials.js";
import {
  getGrokBuildCliVersion,
  getGrokBuildApiKey,
  isGrokBuildTokenValid,
} from "../../../providers/grok-build-credentials.js";
import type { OnboardOptions } from "../onboard.js";
import { buildConfig, type Policy } from "./config-builder.js";
import { validateAndFetchBot, validateBotTokenFormat } from "./telegram-validation.js";

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

/**
 * Auto-detect provider credentials (Codex), with a manual
 * API-key fallback. Returns the resolved api key (empty when auto-detected,
 * since it is read at runtime) and the STEPS[1].value status string.
 */
async function handleAutoDetectedProvider(opts: {
  getKey: () => string;
  isValid: () => boolean;
  displayName: string;
  noteTitle: string;
  detectedFromMsg: string;
  statusExpiredMsg: string;
  noteFooterMsg: string;
  notFoundHint: string;
  fallbackKeyLabel?: string;
  prompter: ReturnType<typeof createPrompter>;
}): Promise<{ apiKey: string; stepValue: string }> {
  let apiKey = "";
  let detected = false;
  try {
    const key = opts.getKey();
    const valid = opts.isValid();
    apiKey = ""; // Don't store in config — auto-detected at runtime
    detected = true;
    const masked = maskSecret(key, 12, 4);
    noteBox(
      `${opts.detectedFromMsg}\n` +
        `Key: ${masked}\n` +
        `Status: ${valid ? GREEN("valid ✓") : opts.statusExpiredMsg}\n` +
        opts.noteFooterMsg,
      opts.noteTitle,
      TON
    );
    await confirm({
      message: "Continue with auto-detected credentials?",
      default: true,
      theme,
    });
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    opts.prompter.warn(opts.notFoundHint);
    if (!opts.fallbackKeyLabel) {
      throw new CancelledError();
    }
    const useFallback = await confirm({
      message: "Enter an API key manually instead?",
      default: true,
      theme,
    });
    if (useFallback) {
      apiKey = await password({
        message: opts.fallbackKeyLabel,
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

  const stepValue = detected
    ? `${opts.displayName}  ${DIM("auto-detected ✓")}`
    : `${opts.displayName}  ${DIM(maskSecret(apiKey))}`;
  return { apiKey, stepValue };
}

/**
 * Prompt for an optional integration key: ask to enable, show a note, then
 * collect+validate the key. Returns the entered value, or undefined if skipped.
 * Callers handle assignment and `extras.push` based on the return value.
 */
async function promptOptionalKey(opts: {
  confirmMsg: string;
  note: string;
  noteTitle: string;
  inputMsg: string;
  validate: (value: string) => true | string;
}): Promise<string | undefined> {
  const enable = await confirm({
    message: opts.confirmMsg,
    default: false,
    theme,
  });

  if (!enable) return undefined;

  noteBox(opts.note, opts.noteTitle, TON);
  return input({
    message: opts.inputMsg,
    theme,
    validate: (v = "") => opts.validate(v),
  });
}

/** Prompt for a 24-word mnemonic and import+save the wallet, with spinner feedback. */
async function importWalletFlow(spinner: ReturnType<typeof ora>): Promise<WalletData> {
  const mnemonicInput = await input({
    message: "Enter your 24-word mnemonic (space-separated)",
    theme,
    validate: (value = "") => {
      const words = value.trim().split(/\s+/);
      return words.length === 24 ? true : `Expected 24 words, got ${words.length}`;
    },
  });
  spinner.start(DIM("Importing wallet..."));
  const wallet = await importWallet(mnemonicInput.trim().split(/\s+/));
  saveWallet(wallet);
  spinner.succeed(DIM(`Wallet imported: ${wallet.address}`));
  return wallet;
}

// ── Interactive wizard state ──────────────────────────────────────────

/** Mutable state shared across the interactive wizard steps. */
interface OnboardState {
  selectedProvider: SupportedProvider;
  selectedModel: string;
  apiKey: string;
  localBaseUrl: string;
  gocoonInstance: number;
  apiId: number;
  apiHash: string;
  phone: string;
  userId: number;
  telegramMode: "user" | "bot";
  botToken: string | undefined;
  botUsername: string | undefined;
  dmPolicy: Policy;
  groupPolicy: Policy;
  requireMention: boolean;
  maxAgenticIterations: string;
  execMode: "off" | "yolo";
  tonapiKey: string | undefined;
  toncenterApiKey: string | undefined;
  tavilyApiKey: string | undefined;
}

/**
 * Step 0: Agent — security warning, workspace, name, Telegram mode.
 * Returns the workspace/spinner shared by later steps, plus the agent name and
 * mode. Returns null when the user declines to overwrite an existing config.
 */
async function stepAgent(
  options: OnboardOptions,
  prompter: ReturnType<typeof createPrompter>
): Promise<{
  workspace: Workspace;
  spinner: ReturnType<typeof ora>;
  agentName: string;
  telegramMode: "user" | "bot";
} | null> {
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
      return null;
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

  const telegramMode = await select({
    message: "Telegram mode",
    default: "user",
    theme,
    choices: [
      {
        value: "user" as const,
        name: "User Account (full power)",
        description: "Log in with your personal Telegram account",
      },
      {
        value: "bot" as const,
        name: "Bot Telegram (simpler setup)",
        description: "Use a Telegram bot token — no phone number needed",
      },
    ],
  });

  STEPS[0].value = agentName;
  return { workspace, spinner, agentName, telegramMode };
}

/** Step 1: Provider — select provider, resolve API key/base URL, pick model. */
async function stepProvider(
  options: OnboardOptions,
  prompter: ReturnType<typeof createPrompter>
): Promise<{
  selectedProvider: SupportedProvider;
  apiKey: string;
  localBaseUrl: string;
  gocoonInstance: number;
  selectedModel: string;
}> {
  redraw(1);

  const providers = getSupportedProviders();
  const selectedProvider = await select({
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

  // API key (or Gocoon / Local setup)
  let apiKey = "";
  let localBaseUrl = "";
  let gocoonInstance = 10000;
  if (selectedProvider === "gocoon") {
    // Gocoon — no API key, decentralized LLM on TON via the gocoon-runner
    apiKey = "";

    const gocoonPort = await input({
      message: "gocoon-runner HTTP port",
      default: "10000",
      theme,
      validate: (value = "") => {
        const n = parseInt(value.trim(), 10);
        return n >= 1 && n <= 65535 ? true : "Must be a port number (1-65535)";
      },
    });
    gocoonInstance = parseInt(gocoonPort.trim(), 10);

    noteBox(
      "Gocoon — Decentralized LLM on TON\n" +
        "No API key needed. Requires the gocoon runner running externally.\n" +
        `Teleton will connect to http://localhost:${gocoonInstance}/v1/`,
      "Gocoon",
      TON
    );

    STEPS[1].value = `${providerMeta.displayName}  ${DIM(`port ${gocoonInstance}`)}`;
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
  } else if (selectedProvider === "codex") {
    // Codex — auto-detect credentials from ~/.codex/auth.json
    const result = await handleAutoDetectedProvider({
      getKey: getCodexApiKey,
      isValid: isCodexTokenValid,
      displayName: providerMeta.displayName,
      noteTitle: "Codex",
      detectedFromMsg: "Credentials auto-detected from Codex CLI",
      statusExpiredMsg: "expired (run codex to re-authenticate)",
      noteFooterMsg: "Token read from ~/.codex/auth.json",
      notFoundHint:
        "Codex credentials not found. Make sure Codex CLI is installed and authenticated.",
      fallbackKeyLabel: "OpenAI API Key (fallback)",
      prompter,
    });
    apiKey = result.apiKey;
    STEPS[1].value = result.stepValue;
  } else if (selectedProvider === "grok-build") {
    const grokCliVersion = getGrokBuildCliVersion();
    const result = await handleAutoDetectedProvider({
      getKey: getGrokBuildApiKey,
      isValid: isGrokBuildTokenValid,
      displayName: providerMeta.displayName,
      noteTitle: "Grok Build",
      detectedFromMsg: "Credentials auto-detected from Grok CLI",
      statusExpiredMsg: "expired (run grok login to re-authenticate)",
      noteFooterMsg:
        `Grok CLI ${grokCliVersion}\n` +
        "Token read from $GROK_HOME/auth.json (default: ~/.grok/auth.json)",
      notFoundHint:
        "Grok Build credentials not found. Make sure Grok CLI is installed and authenticated.",
      prompter,
    });
    apiKey = result.apiKey;
    STEPS[1].value = result.stepValue;
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

    const maskedKey = maskSecret(apiKey);
    STEPS[1].value = `${providerMeta.displayName}  ${DIM(maskedKey)}`;
  }

  // Model selection (advanced mode only, after provider + API key)
  let selectedModel: string = providerMeta.defaultModel;

  if (selectedProvider !== "gocoon" && selectedProvider !== "local") {
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

  return { selectedProvider, apiKey, localBaseUrl, gocoonInstance, selectedModel };
}

/** Step 2: Config — admin user ID, DM/group policies, iterations, exec mode. */
async function stepConfig(
  options: OnboardOptions,
  telegramMode: "user" | "bot"
): Promise<{
  userId: number;
  dmPolicy: Policy;
  groupPolicy: Policy;
  requireMention: boolean;
  maxAgenticIterations: string;
  execMode: "off" | "yolo";
}> {
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
  const userId = parseInt(userIdStr);

  let dmPolicy: Policy = "admin-only";
  let groupPolicy: Policy = "admin-only";
  let requireMention = true;
  if (telegramMode === "bot") {
    dmPolicy = "admin-only";
    groupPolicy = "admin-only";
    requireMention = true;
  } else {
    dmPolicy = await select({
      message: "DM policy (private messages)",
      default: "admin-only",
      theme,
      choices: [
        {
          value: "admin-only" as const,
          name: "Admin Only",
          description: "Only admins can DM the agent",
        },
        { value: "allowlist" as const, name: "Allowlist", description: "Only specific users" },
        { value: "open" as const, name: "Open", description: "Reply to everyone" },
        { value: "disabled" as const, name: "Disabled", description: "Ignore all DMs" },
      ],
    });

    groupPolicy = await select({
      message: "Group policy",
      default: "admin-only",
      theme,
      choices: [
        {
          value: "admin-only" as const,
          name: "Admin Only",
          description: "Only admins can trigger the agent",
        },
        { value: "allowlist" as const, name: "Allowlist", description: "Only specific groups" },
        { value: "open" as const, name: "Open", description: "Reply in all groups" },
        { value: "disabled" as const, name: "Disabled", description: "Ignore all group messages" },
      ],
    });

    requireMention = await confirm({
      message: "Require @mention in groups?",
      default: true,
      theme,
    });
  }

  const maxAgenticIterations = await input({
    message: "Max agentic iterations (tool call loops per message)",
    default: "5",
    theme,
    validate: (v) => {
      const n = parseInt(v, 10);
      return !isNaN(n) && n >= 1 && n <= 50 ? true : "Must be 1–50";
    },
  });

  const execMode = await select({
    message: "Coding Agent (system execution)",
    choices: [
      { value: "off" as const, name: "Disabled", description: "No system execution capability" },
      {
        value: "yolo" as const,
        name: "YOLO Mode",
        description: "Full system access — STRONGLY RECOMMENDED to use a dedicated VPS",
      },
    ],
    default: "off",
    theme,
  });

  STEPS[2].value = `${dmPolicy}/${groupPolicy}`;
  return { userId, dmPolicy, groupPolicy, requireMention, maxAgenticIterations, execMode };
}

/** Step 3: Modules — optional bot token (user mode) and TonAPI/TonCenter/Tavily keys. */
async function stepModules(
  telegramMode: "user" | "bot",
  spinner: ReturnType<typeof ora>
): Promise<{
  botToken: string | undefined;
  botUsername: string | undefined;
  tonapiKey: string | undefined;
  toncenterApiKey: string | undefined;
  tavilyApiKey: string | undefined;
}> {
  redraw(3);

  const extras: string[] = [];
  let botToken: string | undefined;
  let botUsername: string | undefined;

  // Bot token (optional — enables inline bot features; skipped in bot mode, handled at step 5)
  const setupBot =
    telegramMode === "user"
      ? await confirm({
          message: `Add a Telegram bot token? ${DIM("(optional — enables inline buttons)")}`,
          default: true,
          theme,
        })
      : false;

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
      validate: (value = "") => validateBotTokenFormat(value),
    });

    // Validate bot token
    spinner.start(DIM("Validating bot token..."));
    const result = await validateAndFetchBot(tokenInput);
    if (result.ok) {
      botToken = tokenInput;
      botUsername = result.username;
      spinner.succeed(DIM(`Bot verified: @${botUsername}`));
      extras.push("Bot");
    } else if (result.networkError) {
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
    } else {
      spinner.warn(DIM("Bot token is invalid — skipping bot setup"));
    }
  }

  // TonAPI key
  const tonapiKey = await promptOptionalKey({
    confirmMsg: `Add a TonAPI key? ${DIM("(strongly recommended for TON features)")}`,
    note:
      "Blockchain data — jettons, NFTs, prices, transaction history.\n" +
      "Without key: 1 req/s (you WILL hit rate limits)\n" +
      "With free key: 5 req/s\n" +
      "\n" +
      "Open @tonapibot on Telegram → mini app → generate a server key",
    noteTitle: "TonAPI",
    inputMsg: "TonAPI key",
    validate: (v) => (!v || v.length < 10 ? "Key too short" : true),
  });
  if (tonapiKey) extras.push("TonAPI");

  // TonCenter key
  const toncenterApiKey = await promptOptionalKey({
    confirmMsg: `Add a TonCenter API key? ${DIM("(optional, dedicated RPC endpoint)")}`,
    note:
      "Blockchain RPC — send transactions, check balances.\n" +
      "Without key: falls back to ORBS network (decentralized, slower)\n" +
      "With free key: dedicated RPC endpoint\n" +
      "\n" +
      "Go to https://toncenter.com → get a free API key (instant, no signup)",
    noteTitle: "TonCenter",
    inputMsg: "TonCenter API key",
    validate: (v) => (!v || v.length < 10 ? "Key too short" : true),
  });
  if (toncenterApiKey) extras.push("TonCenter");

  // Tavily key
  const tavilyApiKey = await promptOptionalKey({
    confirmMsg: `Enable web search? ${DIM("(free Tavily key — 1,000 req/month)")}`,
    note:
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
    noteTitle: "Tavily — Web Search API",
    inputMsg: "Tavily API key (starts with tvly-)",
    validate: (v) => (!v || !v.startsWith("tvly-") ? "Should start with tvly-" : true),
  });
  if (tavilyApiKey) extras.push("Tavily");

  STEPS[3].value = extras.length ? extras.join(", ") : "defaults";
  return { botToken, botUsername, tonapiKey, toncenterApiKey, tavilyApiKey };
}

/** Step 4: Wallet — generate / import / keep, then show the mnemonic backup. */
async function stepWallet(spinner: ReturnType<typeof ora>): Promise<WalletData> {
  redraw(4);

  let wallet: WalletData;
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
      wallet = await importWalletFlow(spinner);
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
      wallet = await importWalletFlow(spinner);
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
  return wallet;
}

/**
 * Step 5: Telegram — bot token (bot mode) or API id/hash/phone (user mode).
 * In bot mode it returns the resolved bot token/username; in user mode it
 * returns the captured credentials. Unset fields keep their incoming values.
 */
async function stepTelegram(
  options: OnboardOptions,
  telegramMode: "user" | "bot",
  spinner: ReturnType<typeof ora>
): Promise<{
  botToken?: string;
  botUsername?: string;
  apiId?: number;
  apiHash?: string;
  phone?: string;
}> {
  redraw(5);

  if (telegramMode === "bot") {
    noteBox(
      "Create or use an existing bot with @BotFather on Telegram:\n" +
        "1. Send /newbot and follow the instructions\n" +
        "2. Copy the bot token (format: 123456:ABC-DEF...)\n" +
        "3. Start the bot by sending /start to it",
      "Bot Token",
      TON
    );

    const tokenInput = await password({
      message: "Bot token (from @BotFather)",
      theme,
      validate: (value = "") => validateBotTokenFormat(value),
    });
    const botToken = tokenInput;
    let botUsername: string | undefined;

    // Validate and fetch bot username
    spinner.start(DIM("Validating bot token..."));
    const result = await validateAndFetchBot(botToken);
    if (result.ok) {
      botUsername = result.username;
      spinner.succeed(DIM(`Bot verified: @${botUsername}`));
    } else if (result.networkError) {
      spinner.warn(DIM("Could not validate bot token (network error) — saving anyway"));
    } else {
      spinner.warn(DIM("Bot token validation failed — saving anyway"));
    }

    STEPS[5].value = botUsername ? `@${botUsername}` : "bot token set";
    return { botToken, botUsername };
  }

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
  const apiId = parseInt(apiIdStr);

  const apiHash = options.apiHash
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

  const phone = options.phone
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
  return { apiId, apiHash, phone };
}

/** Step 6: Connect — build+save config, optionally authenticate with Telegram. */
async function stepConnect(
  state: OnboardState,
  workspace: Workspace,
  spinner: ReturnType<typeof ora>,
  prompter: ReturnType<typeof createPrompter>
): Promise<boolean> {
  redraw(6);

  // Build config (shared with the non-interactive flow via buildConfig)
  const config = buildConfig({
    provider: state.selectedProvider,
    apiKey: state.apiKey,
    baseUrl: state.selectedProvider === "local" ? state.localBaseUrl : undefined,
    model: state.selectedModel,
    maxAgenticIterations: parseInt(state.maxAgenticIterations, 10),
    telegramMode: state.telegramMode,
    apiId: state.apiId,
    apiHash: state.apiHash,
    phone: state.phone,
    userId: state.userId,
    dmPolicy: state.dmPolicy,
    groupPolicy: state.groupPolicy,
    requireMention: state.requireMention,
    execMode: state.execMode,
    botToken: state.botToken,
    botUsername: state.botUsername,
    tonapiKey: state.tonapiKey,
    toncenterApiKey: state.toncenterApiKey,
    tavilyApiKey: state.tavilyApiKey,
    gocoonPort: state.selectedProvider === "gocoon" ? state.gocoonInstance : undefined,
    sessionPath: workspace.sessionPath,
    workspaceRoot: workspace.root,
  });

  // Save config
  spinner.start(DIM("Saving configuration..."));
  const configYaml = YAML.stringify(config);
  writeFileSync(workspace.configPath, configYaml, { encoding: "utf-8", mode: 0o600 });
  spinner.succeed(DIM(`Configuration saved: ${workspace.configPath}`));

  // Telegram authentication
  let telegramConnected = false;
  if (state.telegramMode === "bot") {
    console.log(`\n  ${DIM("Bot mode — no Telegram auth required. Ready to start.")}\n`);
    STEPS[6].value = "Bot mode ✓";
    telegramConnected = true;
  } else {
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
          apiId: state.apiId,
          apiHash: state.apiHash,
          phone: state.phone,
          sessionPath,
        });
        await client.connect();
        const me = client.getMe();
        await client.disconnect();
        telegramConnected = true;
        const displayName = `${me?.firstName || ""}${me?.username ? ` (@${me.username})` : ""}`;
        console.log(`  ${GREEN("✓")} ${DIM("Telegram connected as")} ${CYAN(displayName)}\n`);
        STEPS[6].value = `Connected${me?.username ? ` (@${me.username})` : ""}`;
      } catch (error) {
        prompter.warn(
          `Telegram connection failed: ${getErrorMessage(error)}\n` +
            "You can authenticate later when running: teleton start"
        );
        STEPS[6].value = "Auth on first start";
      }
    } else {
      console.log(`\n  ${DIM("You can authenticate later when running: teleton start")}\n`);
      STEPS[6].value = "Auth on first start";
    }
  }

  return telegramConnected;
}

export async function runInteractiveOnboarding(
  options: OnboardOptions,
  prompter: ReturnType<typeof createPrompter>
): Promise<void> {
  // ── Mutable shared state ──
  const state: OnboardState = {
    selectedProvider: "anthropic",
    selectedModel: "",
    apiKey: "",
    localBaseUrl: "",
    gocoonInstance: 10000,
    apiId: 0,
    apiHash: "",
    phone: "",
    userId: 0,
    telegramMode: "user",
    botToken: undefined,
    botUsername: undefined,
    dmPolicy: "admin-only",
    groupPolicy: "admin-only",
    requireMention: true,
    maxAgenticIterations: "5",
    execMode: "off",
    tonapiKey: undefined,
    toncenterApiKey: undefined,
    tavilyApiKey: undefined,
  };

  // Intro
  console.clear();
  console.log();
  console.log(wizardFrame(0, STEPS));
  console.log();
  await sleep(800);

  // Step 0: Agent
  const agentResult = await stepAgent(options, prompter);
  if (!agentResult) return; // user declined to overwrite existing config
  const { workspace, spinner } = agentResult;
  state.telegramMode = agentResult.telegramMode;

  // Step 1: Provider
  const provider = await stepProvider(options, prompter);
  state.selectedProvider = provider.selectedProvider;
  state.apiKey = provider.apiKey;
  state.localBaseUrl = provider.localBaseUrl;
  state.gocoonInstance = provider.gocoonInstance;
  state.selectedModel = provider.selectedModel;

  // Step 2: Config
  const cfg = await stepConfig(options, state.telegramMode);
  state.userId = cfg.userId;
  state.dmPolicy = cfg.dmPolicy;
  state.groupPolicy = cfg.groupPolicy;
  state.requireMention = cfg.requireMention;
  state.maxAgenticIterations = cfg.maxAgenticIterations;
  state.execMode = cfg.execMode;

  // Step 3: Modules
  const modules = await stepModules(state.telegramMode, spinner);
  state.botToken = modules.botToken;
  state.botUsername = modules.botUsername;
  state.tonapiKey = modules.tonapiKey;
  state.toncenterApiKey = modules.toncenterApiKey;
  state.tavilyApiKey = modules.tavilyApiKey;

  // Step 4: Wallet (produced + persisted inside the step; not needed downstream)
  await stepWallet(spinner);

  // Step 5: Telegram
  const telegram = await stepTelegram(options, state.telegramMode, spinner);
  if (telegram.botToken !== undefined) state.botToken = telegram.botToken;
  if (telegram.botUsername !== undefined) state.botUsername = telegram.botUsername;
  if (telegram.apiId !== undefined) state.apiId = telegram.apiId;
  if (telegram.apiHash !== undefined) state.apiHash = telegram.apiHash;
  if (telegram.phone !== undefined) state.phone = telegram.phone;

  // Step 6: Connect
  const telegramConnected = await stepConnect(state, workspace, spinner, prompter);

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
