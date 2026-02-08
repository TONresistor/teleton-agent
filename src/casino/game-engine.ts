/**
 * Shared casino game engine for slot and dice games.
 * Handles: validation, payment verification, cooldown, Telegram dice,
 * house edge, user upsert, journal logging, auto-payout.
 */

import { Api } from "telegram";
import type { ToolContext, ToolResult } from "../agent/tools/types.js";
import { verifyPayment } from "./payment-verifier.js";
import { checkAndUpdateCooldown } from "./cooldown-manager.js";
import { processBetForJackpot, getJackpot } from "./jackpot-manager.js";
import { sendPayout, getWinMessage } from "./payout-sender.js";
import { getWalletAddress, getWalletBalance } from "../ton/wallet-service.js";
import { checkRateLimit } from "./rate-limiter.js";
import { CASINO_CONFIG } from "./config.js";

/** Game-specific configuration */
export interface GameConfig {
  /** Telegram dice emoticon ("🎰" or "🎲") */
  emoticon: string;
  /** Game type identifier for DB records */
  gameType: string;
  /** Tool name for journal logging */
  toolName: string;
  /** Asset label for journal (e.g. "SPIN", "DICE") */
  assetLabel: string;
  /** Max multiplier for this game (determines max bet coverage) */
  maxMultiplier: number;
  /** Function to get payout multiplier from dice/slot value */
  getMultiplier: (value: number) => number;
  /** Function to get human-readable interpretation */
  getInterpretation: (value: number) => string;
  /** Max value for reasoning string (e.g. 64 for slots, 6 for dice) */
  maxValue: number;
}

export interface GameParams {
  chat_id: string;
  bet_amount: number;
  player_username: string;
  reply_to?: number;
}

/**
 * Execute a casino game with full security pipeline.
 * Shared by both slot and dice games.
 */
export async function executeGame(
  config: GameConfig,
  params: GameParams,
  context: ToolContext
): Promise<ToolResult> {
  try {
    const { chat_id, bet_amount, player_username, reply_to } = params;
    const userId = context.senderId.toString();
    const username = player_username?.replace(/^@/, "").toLowerCase().trim();

    // 0. Validate username
    if (!username || username.length === 0) {
      return {
        success: false,
        error:
          "❌ You need a Telegram @username to play at Teleton Casino. Set up your username in Telegram settings and try again!",
      };
    }

    // 0.5 Check rate limit
    const rateCheck = checkRateLimit(userId, config.toolName);
    if (!rateCheck.allowed) {
      return {
        success: false,
        error: rateCheck.message || "Too many attempts. Please wait.",
      };
    }

    // 1. Get casino wallet
    const casinoWallet = getWalletAddress();
    if (!casinoWallet) {
      return { success: false, error: "Casino wallet not initialized." };
    }

    // 2. Check casino balance
    const balanceInfo = await getWalletBalance(casinoWallet);
    if (!balanceInfo) {
      return { success: false, error: "Failed to check casino balance." };
    }

    const balance = parseFloat(balanceInfo.balance);

    if (balance < CASINO_CONFIG.minBankroll) {
      return {
        success: false,
        error: "🚨 Teleton Casino is temporarily closed (insufficient bankroll).",
      };
    }

    // Calculate max bet
    const maxBetByPercent = balance * (CASINO_CONFIG.maxBetPercent / 100);
    const maxBetByCoverage = balance / config.maxMultiplier;
    const maxBet = Math.min(maxBetByPercent, maxBetByCoverage);

    if (bet_amount > maxBet) {
      return {
        success: false,
        error: `❌ Bet too high. Maximum bet: ${maxBet.toFixed(2)} TON (current casino balance: ${balance.toFixed(2)} TON)`,
      };
    }

    if (bet_amount < CASINO_CONFIG.minBet) {
      return {
        success: false,
        error: `❌ Minimum bet is ${CASINO_CONFIG.minBet} TON`,
      };
    }

    // 3. Check cooldown (atomic: check + update in single transaction)
    const cooldownCheck = checkAndUpdateCooldown(context.db, userId);
    if (!cooldownCheck.allowed) {
      return {
        success: false,
        error: cooldownCheck.message || "Please wait before playing again.",
      };
    }

    // 4. Verify payment
    const requestTime = Date.now();
    const paymentVerification = await verifyPayment(context.db, {
      botWalletAddress: casinoWallet,
      betAmount: bet_amount,
      requestTime: requestTime - CASINO_CONFIG.paymentWindowMinutes * 60 * 1000,
      gameType: config.gameType,
      userId: username,
    });

    if (!paymentVerification.verified || !paymentVerification.playerWallet) {
      return {
        success: false,
        error:
          paymentVerification.error ||
          `❌ Payment not found. Send ${bet_amount} TON to ${casinoWallet} with memo: ${username}`,
      };
    }

    const playerWallet = paymentVerification.playerWallet;

    // 5. (cooldown already updated atomically in step 3)

    // 6. Send dice animation
    const gramJsClient = context.bridge.getClient().getClient();
    const result = await gramJsClient.invoke(
      new Api.messages.SendMedia({
        peer: chat_id,
        media: new Api.InputMediaDice({ emoticon: config.emoticon }),
        message: "",
        randomId: BigInt(Math.floor(Math.random() * 1e16)) as any,
        replyTo: reply_to ? new Api.InputReplyToMessage({ replyToMsgId: reply_to }) : undefined,
      })
    );

    // Extract value from result
    let gameValue: number | undefined;
    let messageId: number | undefined;

    if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
      for (const update of result.updates) {
        if (
          update instanceof Api.UpdateNewMessage ||
          update instanceof Api.UpdateNewChannelMessage
        ) {
          const msg = update.message;
          if (msg instanceof Api.Message && msg.media instanceof Api.MessageMediaDice) {
            gameValue = msg.media.value;
            messageId = msg.id;
            break;
          }
        }
      }
    }

    if (gameValue === undefined) {
      return {
        success: false,
        error: `Failed to get ${config.gameType} result from Telegram.`,
      };
    }

    // 7. Process house edge to jackpot
    const houseEdge = processBetForJackpot(context.db, bet_amount);

    // 8-10. Record bet, journal, and determine outcome (atomic transaction)
    const multiplier = config.getMultiplier(gameValue);
    const won = multiplier > 0;
    const payoutAmount = won ? bet_amount * multiplier : 0;
    const jackpot = getJackpot(context.db);

    const recordBet = context.db.transaction(() => {
      // Upsert casino user
      context.db
        .prepare(
          `INSERT INTO casino_users (telegram_id, wallet_address, total_bets, total_wagered, last_bet_at)
           VALUES (?, ?, 1, ?, unixepoch())
           ON CONFLICT(telegram_id) DO UPDATE SET
             wallet_address = excluded.wallet_address,
             total_bets = total_bets + 1,
             total_wagered = total_wagered + ?,
             last_bet_at = unixepoch()`
        )
        .run(userId, playerWallet, bet_amount, bet_amount);

      // Log to journal
      const journalEntry = context.db
        .prepare(
          `INSERT INTO journal (
             type, action, asset_from, asset_to, amount_from,
             platform, reasoning, outcome, tx_hash, tool_used,
             chat_id, user_id, timestamp
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
        )
        .run(
          "trade",
          config.toolName,
          "TON",
          config.assetLabel,
          bet_amount,
          "telegram_casino",
          `${config.gameType} result: ${gameValue}/${config.maxValue}`,
          "pending",
          paymentVerification.txHash,
          config.toolName,
          chat_id,
          userId
        );

      return (journalEntry as any).lastInsertRowid as number;
    });

    const journalId = recordBet();

    // 11. Auto-payout
    let payoutSent = false;
    let payoutTxHash: string | undefined;

    if (won && payoutAmount > 0) {
      const winMessage = getWinMessage(multiplier, payoutAmount);
      const payoutResult = await sendPayout(playerWallet, payoutAmount, winMessage);

      if (payoutResult.success) {
        payoutSent = true;
        payoutTxHash = payoutResult.txHash;

        // Update stats atomically after successful payout
        const recordWin = context.db.transaction(() => {
          context.db
            .prepare(
              `UPDATE journal SET outcome = 'loss', amount_to = ?, pnl_ton = ?, closed_at = unixepoch() WHERE id = ?`
            )
            .run(payoutAmount, -(payoutAmount - bet_amount), journalId);

          context.db
            .prepare(
              `UPDATE casino_users SET total_wins = total_wins + 1, total_won = total_won + ? WHERE telegram_id = ?`
            )
            .run(payoutAmount, userId);
        });
        recordWin();
      }
    } else {
      // Record loss atomically
      const recordLoss = context.db.transaction(() => {
        context.db
          .prepare(
            `UPDATE journal SET outcome = 'profit', amount_to = 0, pnl_ton = ?, closed_at = unixepoch() WHERE id = ?`
          )
          .run(bet_amount, journalId);

        context.db
          .prepare(`UPDATE casino_users SET total_losses = total_losses + 1 WHERE telegram_id = ?`)
          .run(userId);
      });
      recordLoss();
    }

    const interpretation = config.getInterpretation(gameValue);

    return {
      success: true,
      data: {
        game_value: gameValue,
        won,
        multiplier,
        payout_amount: payoutAmount > 0 ? payoutAmount.toFixed(2) : "0",
        payout_sent: payoutSent,
        payout_tx_hash: payoutTxHash,
        bet_amount: bet_amount.toFixed(2),
        player_username: username,
        player_wallet: playerWallet,
        house_edge: houseEdge.toFixed(2),
        current_jackpot: jackpot.amount.toFixed(2),
        payment_tx_hash: paymentVerification.txHash,
        journal_id: journalId,
        message_id: messageId,
        interpretation,
      },
    };
  } catch (error) {
    console.error(`Error in ${config.toolName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
