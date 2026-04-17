import type { TelegramConfig } from "../config/schema.js";
import type { AgentRuntime } from "../agent/runtime.js";
import type { ITelegramBridge } from "./bridge-interface.js";
import { getWalletAddress, getWalletBalance } from "../ton/wallet-service.js";
import { Address } from "@ton/core";
import { DEALS_CONFIG } from "../deals/config.js";
import { loadTemplate } from "../workspace/manager.js";
import { isVerbose, setVerbose, createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");
import type { ModulePermissions, ModuleLevel } from "../agent/tools/module-permissions.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import { writePluginSecret, deletePluginSecret, listPluginSecretKeys } from "../sdk/secrets.js";

export interface AdminCommand {
  command: string;
  args: string[];
  chatId: string;
  senderId: number;
}

const VALID_DM_POLICIES = ["open", "allowlist", "admin-only", "disabled"] as const;
const VALID_GROUP_POLICIES = ["open", "allowlist", "admin-only", "disabled"] as const;
const VALID_MODULE_LEVELS = ["open", "admin", "disabled"] as const;

export class AdminHandler {
  private bridge: ITelegramBridge;
  private config: TelegramConfig;
  private agent: AgentRuntime;
  private paused = false;
  private permissions: ModulePermissions | null;
  private registry: ToolRegistry | null;

  constructor(
    bridge: ITelegramBridge,
    config: TelegramConfig,
    agent: AgentRuntime,
    permissions?: ModulePermissions,
    registry?: ToolRegistry
  ) {
    this.bridge = bridge;
    this.config = config;
    this.agent = agent;
    this.permissions = permissions ?? null;
    this.registry = registry ?? null;
  }

  isAdmin(userId: number): boolean {
    return this.config.admin_ids.includes(userId);
  }

  isPaused(): boolean {
    return this.paused;
  }

  parseCommand(message: string): AdminCommand | null {
    const trimmed = message.trim();
    if (!trimmed.startsWith("/") && !trimmed.startsWith("!") && !trimmed.startsWith(".")) {
      return null;
    }

    const parts = trimmed.split(/\s+/);
    const command = parts[0].slice(1).toLowerCase();
    const args = parts.slice(1);

    return {
      command,
      args,
      chatId: "",
      senderId: 0,
    };
  }

  async handleCommand(
    command: AdminCommand,
    chatId: string,
    senderId: number,
    isGroup?: boolean
  ): Promise<string> {
    if (!this.isAdmin(senderId)) {
      return "⛔ Admin access required";
    }

    command.chatId = chatId;
    command.senderId = senderId;

    switch (command.command) {
      case "status":
        return await this.handleStatusCommand(command);
      case "clear":
        return await this.handleClearCommand(command);
      case "loop":
        return this.handleLoopCommand(command);
      case "model":
        return this.handleModelCommand(command);
      case "reasoning":
        return this.handleReasoningCommand(command);
      case "policy":
        return this.handlePolicyCommand(command);
      case "pause":
        return this.handlePauseCommand();
      case "resume":
        return this.handleResumeCommand();
      case "wallet":
        return await this.handleWalletCommand();
      case "strategy":
        return this.handleStrategyCommand(command);
      case "stop":
        return await this.handleStopCommand();
      case "verbose":
        return this.handleVerboseCommand();
      case "rag":
        return this.handleRagCommand(command);
      case "modules":
        return this.handleModulesCommand(command, isGroup ?? false);
      case "plugin":
        return this.handlePluginCommand(command);
      case "help":
        return this.handleHelpCommand();
      case "ping":
        return "🏓 Pong!";
      default:
        return `❓ Unknown command: /${command.command}\n\nUse /help for available commands.`;
    }
  }

  private async handleStatusCommand(_command: AdminCommand): Promise<string> {
    const activeChatIds = this.agent.getActiveChatIds();
    const chatCount = activeChatIds.length;
    const cfg = this.agent.getConfig();

    let status = "🤖 **Teleton Status**\n\n";
    status += `${this.paused ? "⏸️ **PAUSED**\n" : ""}`;
    status += `💬 Active conversations: ${chatCount}\n`;
    status += `🧠 Provider: ${cfg.agent.provider}\n`;
    status += `🤖 Model: ${cfg.agent.model}\n`;
    status += `🔄 Max iterations: ${cfg.agent.max_agentic_iterations}\n`;
    status += `📬 DM policy: ${this.config.dm_policy}\n`;
    status += `👥 Group policy: ${this.config.group_policy}\n`;

    if (this.config.require_mention) {
      status += `🔔 Mention required: Yes\n`;
    }

    return status;
  }

  private async handleClearCommand(command: AdminCommand): Promise<string> {
    const targetChatId = command.args[0] || command.chatId;

    try {
      this.agent.clearHistory(targetChatId);
      return `✅ Cleared conversation history for chat: ${targetChatId}`;
    } catch (error) {
      return `❌ Error clearing history: ${error}`;
    }
  }

  private handleLoopCommand(command: AdminCommand): string {
    const n = parseInt(command.args[0], 10);
    if (isNaN(n) || n < 1 || n > 50) {
      const current = this.agent.getConfig().agent.max_agentic_iterations || 5;
      return `🔄 Current loop: **${current}** iterations\n\nUsage: /loop <1-50>`;
    }
    this.agent.getConfig().agent.max_agentic_iterations = n;
    return `🔄 Max iterations set to **${n}**`;
  }

  private handleModelCommand(command: AdminCommand): string {
    const cfg = this.agent.getConfig();
    if (command.args.length === 0) {
      const reasoning = cfg.agent.reasoning_effort ?? "low";
      return `🧠 Current model: **${cfg.agent.model}**\nReasoning: **${reasoning}**\n\nUsage: /model <model_name>`;
    }
    const newModel = command.args[0];
    const oldModel = cfg.agent.model;
    cfg.agent.model = newModel;
    return `🧠 Model: **${oldModel}** → **${newModel}**`;
  }

  private handleReasoningCommand(command: AdminCommand): string {
    const cfg = this.agent.getConfig();
    const valid = ["off", "low", "medium", "high"] as const;
    if (command.args.length === 0) {
      return `💭 Reasoning effort: **${cfg.agent.reasoning_effort ?? "low"}**\n\nControls thinking depth for reasoning models (o3, R1, etc).\nUsage: /reasoning <${valid.join("|")}>\n• off — skip reasoning (may not work with reasoning-only models)\n• low/medium/high — thinking depth`;
    }
    const value = command.args[0].toLowerCase();
    if (!valid.includes(value as typeof valid[number])) {
      return `❌ Invalid value. Must be one of: ${valid.join(", ")}`;
    }
    const old = cfg.agent.reasoning_effort ?? "low";
    cfg.agent.reasoning_effort = value as typeof valid[number];
    return `💭 Reasoning: **${old}** → **${value}**`;
  }

  private handlePolicyCommand(command: AdminCommand): string {
    if (command.args.length < 2) {
      return (
        `📬 DM policy: **${this.config.dm_policy}**\n` +
        `👥 Group policy: **${this.config.group_policy}**\n\n` +
        `Usage:\n/policy dm <${VALID_DM_POLICIES.join("|")}>\n/policy group <${VALID_GROUP_POLICIES.join("|")}>`
      );
    }

    const [target, value] = command.args;

    if (target === "dm") {
      if (!(VALID_DM_POLICIES as readonly string[]).includes(value)) {
        return `❌ Invalid DM policy. Valid: ${VALID_DM_POLICIES.join(", ")}`;
      }
      const old = this.config.dm_policy;
      this.config.dm_policy = value as typeof this.config.dm_policy;
      return `📬 DM policy: **${old}** → **${value}**`;
    }

    if (target === "group") {
      if (!(VALID_GROUP_POLICIES as readonly string[]).includes(value)) {
        return `❌ Invalid group policy. Valid: ${VALID_GROUP_POLICIES.join(", ")}`;
      }
      const old = this.config.group_policy;
      this.config.group_policy = value as typeof this.config.group_policy;
      return `👥 Group policy: **${old}** → **${value}**`;
    }

    return `❌ Unknown target: ${target}. Use "dm" or "group".`;
  }

  private handlePauseCommand(): string {
    if (this.paused) return "⏸️ Already paused.";
    this.paused = true;
    return "⏸️ Agent paused. Use /resume to restart.";
  }

  private handleResumeCommand(): string {
    if (!this.paused) return "▶️ Already running.";
    this.paused = false;
    return "▶️ Agent resumed.";
  }

  private handleStrategyCommand(command: AdminCommand): string {
    if (command.args.length === 0) {
      const buy = Math.round(DEALS_CONFIG.strategy.buyMaxMultiplier * 100);
      const sell = Math.round(DEALS_CONFIG.strategy.sellMinMultiplier * 100);
      return (
        `📊 **Trading Strategy**\n\n` +
        `Buy: max **${buy}%** of floor\n` +
        `Sell: min **${sell}%** of floor\n\n` +
        `Usage:\n/strategy buy <percent>\n/strategy sell <percent>`
      );
    }

    const [target, valueStr] = command.args;
    const value = parseInt(valueStr, 10);

    if (target === "buy") {
      if (isNaN(value) || value < 50 || value > 150) {
        return "❌ Buy threshold must be between 50 and 150";
      }
      const old = Math.round(DEALS_CONFIG.strategy.buyMaxMultiplier * 100);
      DEALS_CONFIG.strategy.buyMaxMultiplier = value / 100;
      return `📊 Buy threshold: **${old}%** → **${value}%** of floor`;
    }

    if (target === "sell") {
      if (isNaN(value) || value < 100 || value > 200) {
        return "❌ Sell threshold must be between 100 and 200";
      }
      const old = Math.round(DEALS_CONFIG.strategy.sellMinMultiplier * 100);
      DEALS_CONFIG.strategy.sellMinMultiplier = value / 100;
      return `📊 Sell threshold: **${old}%** → **${value}%** of floor`;
    }

    return `❌ Unknown target: ${target}. Use "buy" or "sell".`;
  }

  private async handleStopCommand(): Promise<string> {
    log.info("🛑 [Admin] /stop command received - shutting down");
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 1000);
    return "🛑 Shutting down...";
  }

  private async handleWalletCommand(): Promise<string> {
    const address = getWalletAddress();
    if (!address) return "❌ No wallet configured.";

    const result = await getWalletBalance(address);
    if (!result) return "❌ Failed to fetch balance.";

    const friendly = Address.parse(address).toString({ bounceable: false });
    return `💎 **${result.balance} TON**\n📍 \`${friendly}\``;
  }

  getBootstrapContent(): string | null {
    try {
      return loadTemplate("BOOTSTRAP.md");
    } catch {
      return null;
    }
  }

  private handleVerboseCommand(): string {
    const next = !isVerbose();
    setVerbose(next);
    return next ? "🔊 Verbose logging **ON**" : "🔇 Verbose logging **OFF**";
  }

  private handleRagCommand(command: AdminCommand): string {
    const cfg = this.agent.getConfig();
    const sub = command.args[0]?.toLowerCase();

    if (sub === "status") {
      const enabled = cfg.tool_rag.enabled;
      const topK = cfg.tool_rag.top_k;
      const toolIndex = this.registry?.getToolIndex();
      const indexed = toolIndex?.isIndexed ? "Yes" : "No";
      const totalTools = this.registry?.count ?? 0;
      return (
        `🔍 **Tool RAG Status**\n\n` +
        `Enabled: ${enabled ? "✅ ON" : "❌ OFF"}\n` +
        `Indexed: ${indexed}\n` +
        `Top-K: ${topK}\n` +
        `Total tools: ${totalTools}\n` +
        `Always include: ${cfg.tool_rag.always_include.length} patterns`
      );
    }

    if (sub === "topk") {
      const n = parseInt(command.args[1], 10);
      if (isNaN(n) || n < 5 || n > 200) {
        return `🔍 Current top_k: **${cfg.tool_rag.top_k}**\n\nUsage: /rag topk <5-200>`;
      }
      const old = cfg.tool_rag.top_k;
      cfg.tool_rag.top_k = n;
      return `🔍 Tool RAG top_k: **${old}** → **${n}**`;
    }

    // Toggle ON/OFF
    const next = !cfg.tool_rag.enabled;
    cfg.tool_rag.enabled = next;
    return next ? "🔍 Tool RAG **ON**" : "🔇 Tool RAG **OFF**";
  }

  private handleModulesCommand(command: AdminCommand, isGroup: boolean): string {
    if (!this.permissions || !this.registry) {
      return "❌ Module permissions not available";
    }

    if (!isGroup) {
      return "❌ /modules is only available in groups";
    }

    const chatId = command.chatId;
    const sub = command.args[0]?.toLowerCase();

    if (!sub) {
      return this.listModules(chatId);
    }

    switch (sub) {
      case "set":
        return this.setModuleLevel(chatId, command.args[1], command.args[2], command.senderId);
      case "info":
        return this.showModuleInfo(command.args[1], chatId);
      case "reset":
        return this.resetModules(chatId, command.args[1]);
      default:
        return `❌ Unknown subcommand: "${sub}"\n\nUsage: /modules | /modules set <module> <level> | /modules info <module> | /modules reset [module]`;
    }
  }

  private listModules(chatId: string): string {
    if (!this.registry || !this.permissions) return "❌ Module permissions not available";
    const modules = this.registry.getAvailableModules();
    const overrides = this.permissions.getOverrides(chatId);

    const lines: string[] = ["🧩 **Modules** (this group)\n"];

    for (const mod of modules) {
      const count = this.registry.getModuleToolCount(mod);
      const level = overrides.get(mod) ?? "open";
      const isProtected = this.permissions.isProtected(mod);

      let icon: string;
      switch (level) {
        case "open":
          icon = "✅";
          break;
        case "admin":
          icon = "🔐";
          break;
        case "disabled":
          icon = "❌";
          break;
      }

      const toolWord = count === 1 ? "tool" : "tools";
      const protectedMark = isProtected ? " 🔒" : "";
      lines.push(` ${icon} **${mod}**   ${count} ${toolWord}  ${level}${protectedMark}`);
    }

    lines.push("");
    lines.push("Levels: `open` | `admin` | `disabled`");
    lines.push("Usage: `/modules set <module> <level>`");

    return lines.join("\n");
  }

  private setModuleLevel(
    chatId: string,
    module: string | undefined,
    level: string | undefined,
    senderId: number
  ): string {
    if (!module || !level) {
      return "❌ Usage: /modules set <module> <level>";
    }

    module = module.toLowerCase();
    level = level.toLowerCase();

    if (!this.registry || !this.permissions) return "❌ Module permissions not available";
    const available = this.registry.getAvailableModules();
    if (!available.includes(module)) {
      return `❌ Unknown module: "${module}"`;
    }

    if (this.permissions.isProtected(module)) {
      return `⛔ Module "${module}" is protected`;
    }

    if (!(VALID_MODULE_LEVELS as readonly string[]).includes(level)) {
      return `❌ Invalid level: "${level}". Valid: ${VALID_MODULE_LEVELS.join(", ")}`;
    }

    const oldLevel = this.permissions.getLevel(chatId, module);
    this.permissions.setLevel(chatId, module, level as ModuleLevel, senderId);

    const icons: Record<string, string> = { open: "✅", admin: "🔐", disabled: "❌" };
    return `${icons[level]} **${module}**: ${oldLevel} → ${level}`;
  }

  private showModuleInfo(module: string | undefined, chatId: string): string {
    if (!module) {
      return "❌ Usage: /modules info <module>";
    }

    module = module.toLowerCase();

    if (!this.registry || !this.permissions) return "❌ Module permissions not available";
    const available = this.registry.getAvailableModules();
    if (!available.includes(module)) {
      return `❌ Unknown module: "${module}"`;
    }

    const tools = this.registry.getModuleTools(module);
    const count = tools.length;
    const toolWord = count === 1 ? "tool" : "tools";
    const level = this.permissions.getLevel(chatId, module);
    const isProtected = this.permissions.isProtected(module);
    const protectedMark = isProtected ? " 🔒" : "";

    const lines: string[] = [
      `📦 Module "**${module}**" — ${level}${protectedMark} (${count} ${toolWord})\n`,
    ];

    for (const t of tools) {
      lines.push(` ${t.name}   ${t.scope}`);
    }

    return lines.join("\n");
  }

  private resetModules(chatId: string, module: string | undefined): string {
    if (!this.registry || !this.permissions) return "❌ Module permissions not available";
    if (module) {
      module = module.toLowerCase();
      const available = this.registry.getAvailableModules();
      if (!available.includes(module)) {
        return `❌ Unknown module: "${module}"`;
      }
      if (this.permissions.isProtected(module)) {
        return `⛔ Module "${module}" is protected (already open)`;
      }
      this.permissions.resetModule(chatId, module);
      return `✅ **${module}** → open`;
    }

    this.permissions.resetAll(chatId);
    return "✅ All modules reset to **open**";
  }

  private handlePluginCommand(command: AdminCommand): string {
    const sub = command.args[0]?.toLowerCase();

    if (!sub) {
      return (
        "🔌 **Plugin Secrets**\n\n" +
        "**/plugin set** <name> <key> <value>\n" +
        "Set a secret for a plugin\n\n" +
        "**/plugin unset** <name> <key>\n" +
        "Remove a secret\n\n" +
        "**/plugin keys** <name>\n" +
        "List configured secret keys"
      );
    }

    switch (sub) {
      case "set": {
        const [, pluginName, key, ...valueParts] = command.args;
        if (!pluginName || !key || valueParts.length === 0) {
          return "❌ Usage: /plugin set <name> <key> <value>";
        }
        const value = valueParts.join(" ");
        writePluginSecret(pluginName, key, value);
        return `✅ Secret **${key}** saved for **${pluginName}**\n\n⚠️ Restart agent or reload plugin for changes to take effect.`;
      }

      case "unset": {
        const [, pluginName, key] = command.args;
        if (!pluginName || !key) {
          return "❌ Usage: /plugin unset <name> <key>";
        }
        const deleted = deletePluginSecret(pluginName, key);
        return deleted
          ? `✅ Secret **${key}** removed from **${pluginName}**`
          : `⚠️ Secret **${key}** not found for **${pluginName}**`;
      }

      case "keys": {
        const [, pluginName] = command.args;
        if (!pluginName) {
          return "❌ Usage: /plugin keys <name>";
        }
        const keys = listPluginSecretKeys(pluginName);
        if (keys.length === 0) {
          return `🔌 **${pluginName}** — no secrets configured`;
        }
        return `🔌 **${pluginName}** secrets:\n${keys.map((k) => `  • ${k}`).join("\n")}`;
      }

      default:
        return `❌ Unknown subcommand: "${sub}"\n\nUsage: /plugin set|unset|keys <name> ...`;
    }
  }

  private handleHelpCommand(): string {
    return `🤖 **Teleton Admin Commands**

**/status**
View agent status

**/model** <name>
Switch LLM model

**/reasoning** [off|low|medium|high]
Thinking depth for reasoning models (o3, DeepSeek R1, etc). No args = show current

**/loop** <1-50>
Set max agentic iterations

**/policy** <dm|group> <value>
Change access policy

**/strategy** [buy|sell <percent>]
View or change trading thresholds

**/modules** [set|info|reset]
Manage per-group module permissions

**/plugin** set|unset|keys <name> ...
Manage plugin secrets (API keys, tokens)

**/wallet**
Check TON wallet balance

**/verbose**
Toggle verbose debug logging

**/rag** [status|topk <n>]
Toggle Tool RAG or view status

**/pause** / **/resume**
Pause or resume the agent

**/stop**
Emergency shutdown

**/task** <description>
Give a task to the agent

**/clear** [chat_id]
Clear conversation history

**/boot**
Run agent bootstrap (first-time setup conversation)

**/ping**
Check if agent is responsive

**/help**
Show this help message`;
  }
}
