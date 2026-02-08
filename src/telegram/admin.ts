import type { TelegramConfig } from "../config/schema.js";
import type { AgentRuntime } from "../agent/runtime.js";
import { TelegramBridge } from "./bridge.js";
import { getWalletAddress, getWalletBalance } from "../ton/wallet-service.js";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { DEALS_CONFIG } from "../deals/config.js";

export interface AdminCommand {
  command: string;
  args: string[];
  chatId: string;
  senderId: number;
}

const VALID_DM_POLICIES = ["open", "allowlist", "pairing", "disabled"] as const;
const VALID_GROUP_POLICIES = ["open", "allowlist", "disabled"] as const;

/**
 * Admin command handler for bot panel and DM commands
 */
export class AdminHandler {
  private bridge: TelegramBridge;
  private config: TelegramConfig;
  private agent: AgentRuntime;
  private paused = false;

  constructor(bridge: TelegramBridge, config: TelegramConfig, agent: AgentRuntime) {
    this.bridge = bridge;
    this.config = config;
    this.agent = agent;
  }

  /**
   * Check if user is admin
   */
  isAdmin(userId: number): boolean {
    return this.config.admin_ids.includes(userId);
  }

  /**
   * Check if agent is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Parse message for admin command
   */
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

  /**
   * Handle admin command
   */
  async handleCommand(command: AdminCommand, chatId: string, senderId: number): Promise<string> {
    if (!this.isAdmin(senderId)) {
      return "⛔ Admin access required";
    }

    command.chatId = chatId;
    command.senderId = senderId;

    switch (command.command) {
      case "task":
        return await this.handleTaskCommand(command);
      case "status":
        return await this.handleStatusCommand(command);
      case "clear":
        return await this.handleClearCommand(command);
      case "loop":
        return this.handleLoopCommand(command);
      case "model":
        return this.handleModelCommand(command);
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
      case "help":
        return this.handleHelpCommand();
      case "ping":
        return "🏓 Pong!";
      default:
        return `❓ Unknown command: /${command.command}\n\nUse /help for available commands.`;
    }
  }

  /**
   * /task <description> - Give a task to the agent
   */
  private async handleTaskCommand(command: AdminCommand): Promise<string> {
    if (command.args.length === 0) {
      return "❌ Usage: /task <description>";
    }

    const taskDescription = command.args.join(" ");

    // This would integrate with a task queue system
    // For now, just acknowledge
    return `✅ Task received:\n\n"${taskDescription}"\n\n🤖 I'll work on this and update you.`;
  }

  /**
   * /status - Get agent status
   */
  private async handleStatusCommand(command: AdminCommand): Promise<string> {
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

  /**
   * /clear [chat_id] - Clear conversation history
   */
  private async handleClearCommand(command: AdminCommand): Promise<string> {
    const targetChatId = command.args[0] || command.chatId;

    try {
      this.agent.clearHistory(targetChatId);
      return `✅ Cleared conversation history for chat: ${targetChatId}`;
    } catch (error) {
      return `❌ Error clearing history: ${error}`;
    }
  }

  /**
   * /loop <number> - Set max agentic iterations
   */
  private handleLoopCommand(command: AdminCommand): string {
    const n = parseInt(command.args[0], 10);
    if (isNaN(n) || n < 1 || n > 50) {
      const current = this.agent.getConfig().agent.max_agentic_iterations || 5;
      return `🔄 Current loop: **${current}** iterations\n\nUsage: /loop <1-50>`;
    }
    this.agent.getConfig().agent.max_agentic_iterations = n;
    return `🔄 Max iterations set to **${n}**`;
  }

  /**
   * /model <name> - Switch LLM model at runtime
   */
  private handleModelCommand(command: AdminCommand): string {
    const cfg = this.agent.getConfig();
    if (command.args.length === 0) {
      return `🧠 Current model: **${cfg.agent.model}**\n\nUsage: /model <model_name>`;
    }
    const newModel = command.args[0];
    const oldModel = cfg.agent.model;
    cfg.agent.model = newModel;
    return `🧠 Model: **${oldModel}** → **${newModel}**`;
  }

  /**
   * /policy <dm|group> <value> - Change access policies
   */
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
      if (!VALID_DM_POLICIES.includes(value as any)) {
        return `❌ Invalid DM policy. Valid: ${VALID_DM_POLICIES.join(", ")}`;
      }
      const old = this.config.dm_policy;
      this.config.dm_policy = value as typeof this.config.dm_policy;
      return `📬 DM policy: **${old}** → **${value}**`;
    }

    if (target === "group") {
      if (!VALID_GROUP_POLICIES.includes(value as any)) {
        return `❌ Invalid group policy. Valid: ${VALID_GROUP_POLICIES.join(", ")}`;
      }
      const old = this.config.group_policy;
      this.config.group_policy = value as typeof this.config.group_policy;
      return `👥 Group policy: **${old}** → **${value}**`;
    }

    return `❌ Unknown target: ${target}. Use "dm" or "group".`;
  }

  /**
   * /pause - Pause agent responses
   */
  private handlePauseCommand(): string {
    if (this.paused) return "⏸️ Already paused.";
    this.paused = true;
    return "⏸️ Agent paused. Use /resume to restart.";
  }

  /**
   * /resume - Resume agent responses
   */
  private handleResumeCommand(): string {
    if (!this.paused) return "▶️ Already running.";
    this.paused = false;
    return "▶️ Agent resumed.";
  }

  /**
   * /strategy [buy|sell <percent>] - View or change trading thresholds at runtime
   */
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

  /**
   * /stop - Emergency shutdown
   */
  private async handleStopCommand(): Promise<string> {
    console.log("🛑 [Admin] /stop command received - shutting down");
    // Give time for the reply to be sent, then kill
    setTimeout(() => process.exit(0), 1000);
    return "🛑 Shutting down...";
  }

  /**
   * /wallet - Check TON wallet balance
   */
  private async handleWalletCommand(): Promise<string> {
    const address = getWalletAddress();
    if (!address) return "❌ No wallet configured.";

    const result = await getWalletBalance(address);
    if (!result) return "❌ Failed to fetch balance.";

    return `💎 **${result.balance} TON**\n📍 \`${address}\``;
  }

  /**
   * /help - Show available commands
   */
  private handleHelpCommand(): string {
    return `🤖 **Teleton Admin Commands**

**/status**
View agent status

**/model** <name>
Switch LLM model

**/loop** <1-50>
Set max agentic iterations

**/policy** <dm|group> <value>
Change access policy

**/strategy** [buy|sell <percent>]
View or change trading thresholds

**/wallet**
Check TON wallet balance

**/pause** / **/resume**
Pause or resume the agent

**/stop**
Emergency shutdown

**/task** <description>
Give a task to the agent

**/clear** [chat_id]
Clear conversation history

**/ping**
Check if agent is responsive

**/help**
Show this help message`;
  }
}
