/**
 * Deals plugin module — wraps deal tools + DealBot lifecycle into a self-contained module.
 * Uses its own deals.db (fully isolated from main memory.db).
 */

import type { PluginModule } from "../agent/tools/types.js";
import { initDealsConfig, DEALS_CONFIG } from "./config.js";
import { DealBot, VerificationPoller } from "../bot/index.js";
import { verbose } from "../utils/logger.js";
import { openDealsDb, closeDealsDb, getDealsDb } from "./db.js";
import { createDbWrapper } from "../utils/module-db.js";
import { DEAL_VERIFICATION_WINDOW_SECONDS } from "../constants/limits.js";
import {
  dealProposeTool,
  dealProposeExecutor,
  dealVerifyPaymentTool,
  dealVerifyPaymentExecutor,
  dealStatusTool,
  dealStatusExecutor,
  dealListTool,
  dealListExecutor,
  dealCancelTool,
  dealCancelExecutor,
} from "../agent/tools/deals/index.js";

let dealBot: DealBot | null = null;
let verificationPoller: VerificationPoller | null = null;
let expiryInterval: ReturnType<typeof setInterval> | null = null;

const withDealsDb = createDbWrapper(getDealsDb, "Deals");

const dealsModule: PluginModule = {
  name: "deals",
  version: "1.0.0",

  configure(config) {
    initDealsConfig(config.deals);
  },

  tools(config) {
    if (!config.deals?.enabled) return [];
    return [
      {
        tool: dealProposeTool,
        executor: withDealsDb(dealProposeExecutor),
        scope: "dm-only" as const,
      },
      {
        tool: dealVerifyPaymentTool,
        executor: withDealsDb(dealVerifyPaymentExecutor),
        scope: "dm-only" as const,
      },
      { tool: dealStatusTool, executor: withDealsDb(dealStatusExecutor) },
      { tool: dealListTool, executor: withDealsDb(dealListExecutor) },
      {
        tool: dealCancelTool,
        executor: withDealsDb(dealCancelExecutor),
        scope: "dm-only" as const,
      },
    ];
  },

  async start(context) {
    if (!context.config.deals?.enabled) return;

    // Open deals database
    const dealsDb = openDealsDb();

    const { config, bridge } = context;
    const botToken = config.telegram.bot_token;
    const botUsername = config.telegram.bot_username;

    if (botToken && botToken !== "YOUR_BOT_TOKEN_FROM_BOTFATHER") {
      try {
        dealBot = new DealBot(
          {
            token: botToken,
            username: botUsername || "deals_bot",
            apiId: config.telegram.api_id,
            apiHash: config.telegram.api_hash,
          },
          dealsDb
        );
        await dealBot.start();

        verificationPoller = new VerificationPoller(dealsDb, bridge, dealBot, {
          pollIntervalMs: DEALS_CONFIG.verification.pollIntervalMs,
        });
        verificationPoller.start();

        console.log(`✅ Deal Bot: @${botUsername} connected`);
      } catch (botError) {
        console.warn(`⚠️ Deal Bot failed to start: ${botError}`);
      }
    } else {
      console.log(`⚠️ Deal Bot: not configured (set bot_token in config)`);
    }

    // Expire stale deals
    expiryInterval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const currentDb = getDealsDb();
      if (!currentDb) return;
      const r = currentDb
        .prepare(
          `UPDATE deals SET status = 'expired' WHERE status IN ('proposed', 'accepted') AND expires_at < ?`
        )
        .run(now);
      if (r.changes > 0) verbose(`⏰ Expired ${r.changes} stale deal(s)`);
    }, DEALS_CONFIG.expiryCheckIntervalMs);
  },

  async stop() {
    if (verificationPoller) {
      verificationPoller.stop();
      verificationPoller = null;
    }
    if (dealBot) {
      await dealBot.stop();
      dealBot = null;
    }
    if (expiryInterval) {
      clearInterval(expiryInterval);
      expiryInterval = null;
    }
    closeDealsDb();
  },
};

export default dealsModule;

/**
 * Check if a verified deal exists authorizing a gift transfer.
 * Used by gift tools (transfer-collectible, send-gift) for security checks.
 */
export function hasVerifiedDeal(giftId: string, userId: string): boolean {
  const dealsDb = getDealsDb();
  if (!dealsDb) return false;
  const deal = dealsDb
    .prepare(
      `SELECT id FROM deals
       WHERE status = 'verified'
         AND agent_gives_type = 'gift'
         AND agent_gives_gift_id = ?
         AND user_telegram_id = ?
         AND user_payment_verified_at >= unixepoch() - ${DEAL_VERIFICATION_WINDOW_SECONDS}
         AND agent_sent_at IS NULL
       LIMIT 1`
    )
    .get(giftId, userId);
  return !!deal;
}
