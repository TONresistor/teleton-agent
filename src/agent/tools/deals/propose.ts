import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { generateDealId, calculateExpiry, formatDealProposal } from "../../../deals/utils.js";
import {
  checkStrategyCompliance,
  formatStrategyCheckJSON,
  type AssetValue,
} from "../../../deals/strategy-checker.js";

interface DealProposeParams {
  chatId: string;
  userId: number;
  userGivesType: "ton" | "gift";
  userGivesTonAmount?: number;
  userGivesGiftId?: string;
  userGivesGiftSlug?: string;
  userGivesValueTon: number;
  agentGivesType: "ton" | "gift";
  agentGivesTonAmount?: number;
  agentGivesGiftId?: string;
  agentGivesGiftSlug?: string;
  agentGivesValueTon: number;
  userUsername?: string;
}

export const dealProposeTool: Tool = {
  name: "deal_propose",
  description: `Create a trade deal proposal with interactive Accept/Decline buttons.

Automatically sends an inline bot message with buttons in the chat.
The user can Accept or Decline directly from the message.

IMPORTANT - MESSAGE FLOW:
- Send your message BEFORE calling this tool (e.g. "I'll create a deal for you")
- Do NOT send any message after this tool returns — the deal card already contains all info
- The inline bot message IS the proposal, no need to repeat deal details

CRITICAL - STRATEGY.md ENFORCEMENT:
- When BUYING (you buy their gift): Pay max 80% of floor price
- When SELLING (you sell your gift): Charge min 115% of floor price
- Gift swaps: Must receive equal or more value
- User ALWAYS sends first (TON or gift)

BEFORE proposing:
1. Get market floor price using market_get_floor
2. Calculate values in TON
3. This tool will REJECT deals that violate strategy

Deal expires in 2 minutes if not accepted.`,
  parameters: Type.Object({
    chatId: Type.String({ description: "Chat ID where to send proposal" }),
    userId: Type.Number({ description: "Telegram user ID" }),
    userGivesType: Type.Union([Type.Literal("ton"), Type.Literal("gift")]),
    userGivesTonAmount: Type.Optional(
      Type.Number({ description: "TON amount user gives (if type=ton)" })
    ),
    userGivesGiftId: Type.Optional(
      Type.String({ description: "Gift msgId user gives (if type=gift)" })
    ),
    userGivesGiftSlug: Type.Optional(
      Type.String({
        description:
          "Gift's slug field from telegram_get_my_gifts (e.g. 'LolPop-425402'), NOT the title",
      })
    ),
    userGivesValueTon: Type.Number({ description: "Estimated TON value of what user gives" }),
    agentGivesType: Type.Union([Type.Literal("ton"), Type.Literal("gift")]),
    agentGivesTonAmount: Type.Optional(
      Type.Number({ description: "TON amount you give (if type=ton)" })
    ),
    agentGivesGiftId: Type.Optional(
      Type.String({ description: "Gift msgId you give (if type=gift)" })
    ),
    agentGivesGiftSlug: Type.Optional(
      Type.String({
        description:
          "Gift's slug field from telegram_get_my_gifts (e.g. 'LolPop-425402'), NOT the title",
      })
    ),
    agentGivesValueTon: Type.Number({ description: "Estimated TON value of what you give" }),
    userUsername: Type.Optional(Type.String({ description: "User's @username for display" })),
  }),
};

export const dealProposeExecutor: ToolExecutor<DealProposeParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const userGives: AssetValue = {
      type: params.userGivesType,
      tonAmount: params.userGivesTonAmount,
      giftSlug: params.userGivesGiftSlug,
      valueTon: params.userGivesValueTon,
    };

    const agentGives: AssetValue = {
      type: params.agentGivesType,
      tonAmount: params.agentGivesTonAmount,
      giftSlug: params.agentGivesGiftSlug,
      valueTon: params.agentGivesValueTon,
    };

    // CRITICAL: Check strategy compliance
    const strategyCheck = checkStrategyCompliance(userGives, agentGives);

    if (!strategyCheck.acceptable) {
      return {
        success: false,
        error: `Deal rejected by strategy rules:\n${strategyCheck.reason}`,
      };
    }

    // Generate deal ID and expiry
    const dealId = generateDealId();
    const expiresAt = calculateExpiry();
    const createdAt = Math.floor(Date.now() / 1000);

    // Create deal in database
    context.db
      .prepare(
        `
      INSERT INTO deals (
        id, status, user_telegram_id, user_username, chat_id,
        user_gives_type, user_gives_ton_amount, user_gives_gift_id, user_gives_gift_slug, user_gives_value_ton,
        agent_gives_type, agent_gives_ton_amount, agent_gives_gift_id, agent_gives_gift_slug, agent_gives_value_ton,
        strategy_check, profit_ton, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        dealId,
        "proposed",
        params.userId,
        params.userUsername || null,
        params.chatId,
        params.userGivesType,
        params.userGivesTonAmount || null,
        params.userGivesGiftId || null,
        params.userGivesGiftSlug || null,
        params.userGivesValueTon,
        params.agentGivesType,
        params.agentGivesTonAmount || null,
        params.agentGivesGiftId || null,
        params.agentGivesGiftSlug || null,
        params.agentGivesValueTon,
        formatStrategyCheckJSON(strategyCheck),
        strategyCheck.profit,
        createdAt,
        expiresAt
      );

    console.log(
      `📋 [Deal] Created deal #${dealId} - profit: ${strategyCheck.profit.toFixed(2)} TON`
    );

    // Send inline bot message with Accept/Decline buttons
    const botUsername = context.config?.telegram?.bot_username;
    let inlineSent = false;

    if (botUsername) {
      try {
        inlineSent = await sendInlineBotResult(context.bridge, params.chatId, botUsername, dealId);
      } catch (inlineError) {
        console.warn(`⚠️ [Deal] Failed to send inline bot result:`, inlineError);
      }
    }

    // Fallback: send plain text if inline bot failed
    if (!inlineSent) {
      const proposalText = formatDealProposal(
        dealId,
        {
          type: params.userGivesType,
          tonAmount: params.userGivesTonAmount,
          giftSlug: params.userGivesGiftSlug,
          valueTon: params.userGivesValueTon,
        },
        {
          type: params.agentGivesType,
          tonAmount: params.agentGivesTonAmount,
          giftSlug: params.agentGivesGiftSlug,
          valueTon: params.agentGivesValueTon,
        },
        strategyCheck.profit,
        true
      );

      const fallbackText = botUsername
        ? `${proposalText}\n\nTo confirm, type: @${botUsername} ${dealId}`
        : proposalText;

      const sentMessage = await context.bridge.sendMessage({
        chatId: params.chatId,
        text: fallbackText,
      });

      context.db
        .prepare(`UPDATE deals SET proposal_message_id = ? WHERE id = ?`)
        .run(sentMessage.id, dealId);
    }

    return {
      success: true,
      data: {
        dealId,
        profit: strategyCheck.profit,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        strategyRule: strategyCheck.rule,
        inlineSent,
        note: "Deal card sent with buttons. STOP HERE — do NOT send any follow-up message. The user will click Accept/Decline on the card.",
      },
    };
  } catch (error) {
    console.error("Error creating deal proposal:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Send inline bot result via GramJS (userbot queries the bot, then sends the result)
 * This makes the deal card with buttons appear directly in the chat.
 */
async function sendInlineBotResult(
  bridge: any,
  chatId: string,
  botUsername: string,
  dealId: string
): Promise<boolean> {
  const gramJsClient = bridge.getClient().getClient();
  const Api = (await import("telegram")).Api;

  // Resolve bot and chat entities
  const bot = await gramJsClient.getInputEntity(botUsername);
  const peer = await gramJsClient.getInputEntity(chatId.startsWith("-") ? Number(chatId) : chatId);

  // Query the inline bot with the deal ID
  const results = await gramJsClient.invoke(
    new Api.messages.GetInlineBotResults({
      bot: bot,
      peer: peer,
      query: dealId,
      offset: "",
    })
  );

  if (!results.results || results.results.length === 0) {
    console.warn(`⚠️ [Deal] No inline results returned for deal ${dealId}`);
    return false;
  }

  // Find the deal result (skip help/not_found/wrong_user results)
  const dealResult = results.results.find((r: any) => r.id === dealId);
  const resultToSend = dealResult || results.results[0];

  // Send the inline result as a message in the chat
  await gramJsClient.invoke(
    new Api.messages.SendInlineBotResult({
      peer: peer,
      queryId: results.queryId,
      id: resultToSend.id,
      randomId: BigInt(Math.floor(Math.random() * 1e16)) as any,
    })
  );

  console.log(`✅ [Deal] Inline bot message sent for deal #${dealId}`);
  return true;
}
