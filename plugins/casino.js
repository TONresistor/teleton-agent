/**
 * Teleton Casino Plugin
 *
 * Slot machine and dice games with TON payments.
 * First external plugin built on the Plugin SDK — validates the full
 * lifecycle: manifest, migrate, tools(sdk), verifyPayment, sendTON.
 *
 * Flow:
 *   1. Player tells agent they want to bet X TON
 *   2. Agent instructs: "Send X TON to <address> with memo: <username>"
 *   3. Player sends payment on-chain
 *   4. Agent calls casino_spin / casino_dice
 *   5. Plugin verifies payment, sends dice animation, calculates payout
 *   6. Auto-payout on win via sdk.ton.sendTON()
 */

// ── Manifest ─────────────────────────────────────────────────────

export const manifest = {
  name: "casino",
  version: "2.0.0",
  sdkVersion: ">=1.0.0",
  description: "Slot machine and dice games with TON payments",
  defaultConfig: {
    min_bet: 0.1,
    max_bet_percent: 5,
    min_bankroll: 10,
    cooldown_seconds: 30,
    max_payment_age_minutes: 10,
  },
};

// ── Configuration ────────────────────────────────────────────────

function buildConfig(pluginConfig) {
  const defaults = manifest.defaultConfig;
  return {
    minBet: pluginConfig?.min_bet ?? defaults.min_bet,
    maxBetPercent: pluginConfig?.max_bet_percent ?? defaults.max_bet_percent,
    minBankroll: pluginConfig?.min_bankroll ?? defaults.min_bankroll,
    cooldownSeconds: pluginConfig?.cooldown_seconds ?? defaults.cooldown_seconds,
    maxPaymentAgeMinutes: pluginConfig?.max_payment_age_minutes ?? defaults.max_payment_age_minutes,
  };
}

// ── Slot Machine (🎰 values 1–64) ───────────────────────────────

const SLOT_PAYOUTS = [
  { min: 64, max: 64, multiplier: 5.0, label: "Triple Seven (777) — JACKPOT!" },
  { min: 60, max: 63, multiplier: 2.5, label: "Triple match! Big win!" },
  { min: 55, max: 59, multiplier: 1.8, label: "Double match plus!" },
  { min: 43, max: 54, multiplier: 1.2, label: "Lucky spin! Small win!" },
];

function getSlotMultiplier(value) {
  for (const tier of SLOT_PAYOUTS) {
    if (value >= tier.min && value <= tier.max) return tier.multiplier;
  }
  return 0;
}

function getSlotLabel(value) {
  for (const tier of SLOT_PAYOUTS) {
    if (value >= tier.min && value <= tier.max) return tier.label;
  }
  return "No match. Better luck next time!";
}

// ── Dice (🎲 values 1–6) ────────────────────────────────────────

const DICE_PAYOUTS = [
  { value: 6, multiplier: 2.5, label: "SIX — Maximum roll!" },
  { value: 5, multiplier: 1.8, label: "FIVE — Great roll!" },
  { value: 4, multiplier: 1.3, label: "FOUR — Good roll!" },
];

function getDiceMultiplier(value) {
  const tier = DICE_PAYOUTS.find((t) => t.value === value);
  return tier ? tier.multiplier : 0;
}

function getDiceLabel(value) {
  const tier = DICE_PAYOUTS.find((t) => t.value === value);
  return tier ? tier.label : "Low roll. Better luck next time!";
}

// ── Cooldown ─────────────────────────────────────────────────────

function checkCooldown(db, senderId, cooldownSeconds) {
  const row = db
    .prepare("SELECT last_bet_at FROM casino_cooldowns WHERE telegram_id = ?")
    .get(String(senderId));

  if (!row) return { allowed: true, remaining: 0 };

  const elapsed = Math.floor(Date.now() / 1000) - row.last_bet_at;
  if (elapsed < cooldownSeconds) {
    return { allowed: false, remaining: cooldownSeconds - elapsed };
  }
  return { allowed: true, remaining: 0 };
}

function updateCooldown(db, senderId) {
  db.prepare(
    `INSERT INTO casino_cooldowns (telegram_id, last_bet_at)
     VALUES (?, unixepoch())
     ON CONFLICT(telegram_id) DO UPDATE SET last_bet_at = unixepoch()`
  ).run(String(senderId));
}

// ── Database Migration ───────────────────────────────────────────

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS casino_users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      wallet_address TEXT,
      total_bets INTEGER NOT NULL DEFAULT 0,
      total_wagered REAL NOT NULL DEFAULT 0,
      total_wins INTEGER NOT NULL DEFAULT 0,
      total_won REAL NOT NULL DEFAULT 0,
      total_losses INTEGER NOT NULL DEFAULT 0,
      total_lost REAL NOT NULL DEFAULT 0,
      last_bet_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS used_transactions (
      tx_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      game_type TEXT NOT NULL,
      used_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS casino_cooldowns (
      telegram_id TEXT PRIMARY KEY,
      last_bet_at INTEGER NOT NULL
    );
  `);
}

// ── Shared Game Executor ─────────────────────────────────────────

async function executeGame(sdk, context, params, gameConfig) {
  const { emoticon, gameType, getMultiplier, getLabel, maxMultiplier } = gameConfig;
  const config = buildConfig(sdk.pluginConfig);

  // 1. Cooldown check
  const cooldown = checkCooldown(sdk.db, context.senderId, config.cooldownSeconds);
  if (!cooldown.allowed) {
    return {
      success: false,
      error: `Cooldown active. Wait ${cooldown.remaining}s before your next bet.`,
    };
  }

  // 2. Validate bet amount
  if (params.bet_amount < config.minBet) {
    return { success: false, error: `Minimum bet is ${config.minBet} TON.` };
  }

  // 3. Check bankroll
  const address = sdk.ton.getAddress();
  if (!address) {
    return { success: false, error: "Wallet not initialized. Contact admin." };
  }

  const balanceInfo = await sdk.ton.getBalance(address);
  if (!balanceInfo) {
    return { success: false, error: "Failed to fetch wallet balance." };
  }

  const bankroll = parseFloat(balanceInfo.balance);
  if (bankroll < config.minBankroll) {
    return { success: false, error: `Casino temporarily closed. Bankroll below ${config.minBankroll} TON.` };
  }

  const maxBet = bankroll * (config.maxBetPercent / 100);
  if (params.bet_amount > maxBet) {
    return { success: false, error: `Maximum bet is ${maxBet.toFixed(2)} TON (${config.maxBetPercent}% of bankroll).` };
  }

  // 4. Check if casino can cover max payout
  const maxPayout = params.bet_amount * maxMultiplier;
  if (maxPayout > bankroll) {
    const safeBet = (bankroll / maxMultiplier).toFixed(2);
    return { success: false, error: `Bet too high for current bankroll. Max safe bet: ${safeBet} TON.` };
  }

  // 5. Verify payment
  const payment = await sdk.ton.verifyPayment({
    amount: params.bet_amount,
    memo: params.player_memo,
    gameType,
    maxAgeMinutes: config.maxPaymentAgeMinutes,
  });

  if (!payment.verified) {
    return { success: false, error: payment.error };
  }

  // 6. Send dice animation
  const dice = await sdk.telegram.sendDice(context.chatId, emoticon);

  // 7. Calculate result
  const multiplier = getMultiplier(dice.value);
  const payout = +(params.bet_amount * multiplier).toFixed(4);
  const isWin = multiplier > 0;
  const label = getLabel(dice.value);

  // 8. Auto-payout on win
  let txRef = null;
  if (isWin && payment.playerWallet) {
    try {
      const result = await sdk.ton.sendTON(payment.playerWallet, payout, `Casino ${gameType}: ${multiplier}x`);
      txRef = result.txRef;
    } catch (err) {
      sdk.log.error(`Payout failed for ${payment.playerWallet}:`, err);
      return {
        success: false,
        error: `You won ${payout} TON but payout failed. Contact admin with ref: ${payment.compositeKey}`,
      };
    }
  }

  // 9. Set cooldown (after successful payout or loss — never locks on failure)
  updateCooldown(sdk.db, context.senderId);

  // 10. Record stats (atomic)
  const recordBet = sdk.db.transaction(() => {
    sdk.db
      .prepare(
        `INSERT INTO casino_users (telegram_id, username, wallet_address, total_bets, total_wagered, total_wins, total_won, total_losses, total_lost, last_bet_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, unixepoch())
         ON CONFLICT(telegram_id) DO UPDATE SET
           username = excluded.username,
           wallet_address = excluded.wallet_address,
           total_bets = total_bets + 1,
           total_wagered = total_wagered + excluded.total_wagered,
           total_wins = total_wins + excluded.total_wins,
           total_won = total_won + excluded.total_won,
           total_losses = total_losses + excluded.total_losses,
           total_lost = total_lost + excluded.total_lost,
           last_bet_at = unixepoch()`
      )
      .run(
        String(context.senderId),
        params.player_memo,
        payment.playerWallet,
        params.bet_amount,
        isWin ? 1 : 0,
        isWin ? payout : 0,
        isWin ? 0 : 1,
        isWin ? 0 : params.bet_amount,
      );
  });
  recordBet();

  // 11. Result
  const netResult = isWin ? `+${(payout - params.bet_amount).toFixed(4)}` : `-${params.bet_amount}`;

  return {
    success: true,
    data: {
      game: gameType,
      bet: params.bet_amount,
      diceValue: dice.value,
      interpretation: label,
      multiplier,
      payout: isWin ? payout : 0,
      win: isWin,
      netResult: `${netResult} TON`,
      txRef,
      message: isWin
        ? `${emoticon} ${label} You won ${payout} TON (${multiplier}x)!`
        : `${emoticon} ${label} You lost ${params.bet_amount} TON.`,
    },
  };
}

// ── Tool Definitions ─────────────────────────────────────────────

export const tools = (sdk) => {
  if (!sdk.db) {
    sdk.log.error("Casino requires a database. Ensure migrate() is exported.");
    return [];
  }

  const config = buildConfig(sdk.pluginConfig);

  // Shared parameter schema for game tools
  const gameParams = {
    type: "object",
    properties: {
      bet_amount: {
        type: "number",
        description: `Bet amount in TON (min ${config.minBet})`,
        minimum: config.minBet,
      },
      player_memo: {
        type: "string",
        description: "Player's username or identifier used as payment memo",
      },
    },
    required: ["bet_amount", "player_memo"],
  };

  return [
    // ── casino_balance ───────────────────────────────────────────
    {
      name: "casino_balance",
      description: `Check Teleton Casino bankroll status and betting limits.
Returns wallet address, balance, max bet, and whether the casino can accept bets.
When a player wants to bet, tell them to send TON to this address with their username as memo.`,
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const address = sdk.ton.getAddress();
        if (!address) {
          return { success: false, error: "Wallet not initialized." };
        }

        const balanceInfo = await sdk.ton.getBalance(address);
        if (!balanceInfo) {
          return { success: false, error: "Failed to fetch balance." };
        }

        const bankroll = parseFloat(balanceInfo.balance);
        const maxBet = bankroll * (config.maxBetPercent / 100);

        let status;
        if (bankroll < config.minBankroll) status = "closed";
        else if (bankroll < config.minBankroll * 2) status = "warning";
        else status = "open";

        return {
          success: true,
          data: {
            address,
            balance: `${bankroll.toFixed(2)} TON`,
            minBet: `${config.minBet} TON`,
            maxBet: `${maxBet.toFixed(2)} TON`,
            status,
            acceptingBets: status !== "closed",
            cooldown: `${config.cooldownSeconds}s between bets`,
            message:
              status === "closed"
                ? `Casino temporarily closed. Bankroll below ${config.minBankroll} TON.`
                : `Casino is ${status}! Balance: ${bankroll.toFixed(2)} TON. Bet range: ${config.minBet} – ${maxBet.toFixed(2)} TON. Send TON to ${address} with your username as memo.`,
          },
        };
      },
    },

    // ── casino_spin ──────────────────────────────────────────────
    {
      name: "casino_spin",
      description: `Play the slot machine (🎰). Player must send TON to the casino wallet with their username as memo BEFORE calling this tool.

Payouts: 777 (64) = 5x | Triple (60-63) = 2.5x | Double+ (55-59) = 1.8x | Lucky (43-54) = 1.2x | Miss (1-42) = 0x

Security: Payment verified on-chain, cooldown ${config.cooldownSeconds}s, max bet ${config.maxBetPercent}% of bankroll, replay-protected.`,
      parameters: gameParams,
      execute: async (params, context) =>
        executeGame(sdk, context, params, {
          emoticon: "🎰",
          gameType: "slot",
          maxMultiplier: 5.0,
          getMultiplier: getSlotMultiplier,
          getLabel: getSlotLabel,
        }),
    },

    // ── casino_dice ──────────────────────────────────────────────
    {
      name: "casino_dice",
      description: `Play the dice game (🎲). Player must send TON to the casino wallet with their username as memo BEFORE calling this tool.

Payouts: 6 = 2.5x | 5 = 1.8x | 4 = 1.3x | 1-3 = 0x

Security: Payment verified on-chain, cooldown ${config.cooldownSeconds}s, max bet ${config.maxBetPercent}% of bankroll, replay-protected.`,
      parameters: gameParams,
      execute: async (params, context) =>
        executeGame(sdk, context, params, {
          emoticon: "🎲",
          gameType: "dice",
          maxMultiplier: 2.5,
          getMultiplier: getDiceMultiplier,
          getLabel: getDiceLabel,
        }),
    },

    // ── casino_leaderboard ───────────────────────────────────────
    {
      name: "casino_leaderboard",
      description:
        "Show casino leaderboard. Supports 'winners' (by profit), 'losers' (by loss), and 'wagered' (by total volume).",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["winners", "losers", "wagered"],
            description: "Leaderboard type (default: winners)",
          },
          limit: {
            type: "integer",
            description: "Number of entries (default: 10, max: 25)",
            minimum: 1,
            maximum: 25,
          },
        },
      },
      execute: async (params) => {
        const type = params.type || "winners";
        const limit = Math.min(params.limit || 10, 25);

        const orderClauses = {
          winners: "total_won - total_lost DESC",
          losers: "total_lost - total_won DESC",
          wagered: "total_wagered DESC",
        };

        const orderBy = orderClauses[type];
        if (!orderBy) {
          return { success: false, error: `Invalid type: ${type}. Use: winners, losers, wagered.` };
        }

        const rows = sdk.db
          .prepare(
            `SELECT username, total_bets, total_wagered, total_wins, total_won, total_losses, total_lost,
                    (total_won - total_lost) AS net_pnl
             FROM casino_users
             WHERE total_bets > 0
             ORDER BY ${orderBy}
             LIMIT ?`
          )
          .all(limit);

        if (rows.length === 0) {
          return { success: true, data: { message: "No players yet. Be the first!" } };
        }

        const entries = rows.map((r, i) => ({
          rank: i + 1,
          player: r.username || "anonymous",
          bets: r.total_bets,
          wagered: `${r.total_wagered.toFixed(2)} TON`,
          won: `${r.total_won.toFixed(2)} TON`,
          lost: `${r.total_lost.toFixed(2)} TON`,
          pnl: `${r.net_pnl >= 0 ? "+" : ""}${r.net_pnl.toFixed(2)} TON`,
        }));

        return {
          success: true,
          data: {
            type,
            entries,
            message: `Casino Leaderboard (${type}) — ${entries.length} players`,
          },
        };
      },
    },

    // ── casino_my_stats ──────────────────────────────────────────
    {
      name: "casino_my_stats",
      description: "Show your personal casino statistics: bets, wins, losses, P&L, and win rate.",
      parameters: { type: "object", properties: {} },
      execute: async (_params, context) => {
        const row = sdk.db
          .prepare(
            `SELECT username, total_bets, total_wagered, total_wins, total_won,
                    total_losses, total_lost, (total_won - total_lost) AS net_pnl, last_bet_at
             FROM casino_users WHERE telegram_id = ?`
          )
          .get(String(context.senderId));

        if (!row) {
          return { success: true, data: { message: "No casino history found. Place your first bet!" } };
        }

        const winRate = row.total_bets > 0 ? ((row.total_wins / row.total_bets) * 100).toFixed(1) : "0";

        return {
          success: true,
          data: {
            player: row.username || "anonymous",
            totalBets: row.total_bets,
            wins: row.total_wins,
            losses: row.total_losses,
            wagered: `${row.total_wagered.toFixed(2)} TON`,
            won: `${row.total_won.toFixed(2)} TON`,
            lost: `${row.total_lost.toFixed(2)} TON`,
            pnl: `${row.net_pnl >= 0 ? "+" : ""}${row.net_pnl.toFixed(2)} TON`,
            winRate: `${winRate}%`,
            lastPlayed: row.last_bet_at ? new Date(row.last_bet_at * 1000).toISOString() : "never",
          },
        };
      },
    },
  ];
};
