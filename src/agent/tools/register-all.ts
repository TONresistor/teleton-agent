/**
 * Central tool registration for the Tonnet agent.
 * Extracted from index.ts for maintainability.
 */

import type { ToolRegistry } from "./registry.js";
import type { Config } from "../../config/schema.js";

// Telegram tools
import {
  telegramSendMessageTool,
  telegramSendMessageExecutor,
  telegramQuoteReplyTool,
  telegramQuoteReplyExecutor,
  telegramGetRepliesTool,
  telegramGetRepliesExecutor,
  telegramCreateScheduledTaskTool,
  telegramCreateScheduledTaskExecutor,
  telegramEditMessageTool,
  telegramEditMessageExecutor,
  telegramScheduleMessageTool,
  telegramScheduleMessageExecutor,
  telegramSearchMessagesTool,
  telegramSearchMessagesExecutor,
  telegramPinMessageTool,
  telegramPinMessageExecutor,
  telegramUnpinMessageTool,
  telegramUnpinMessageExecutor,
  telegramReactTool,
  telegramReactExecutor,
  telegramSendDiceTool,
  telegramSendDiceExecutor,
  telegramGetHistoryTool,
  telegramGetHistoryExecutor,
  telegramJoinChannelTool,
  telegramJoinChannelExecutor,
  telegramLeaveChannelTool,
  telegramLeaveChannelExecutor,
  telegramGetMeTool,
  telegramGetMeExecutor,
  telegramGetParticipantsTool,
  telegramGetParticipantsExecutor,
  telegramKickUserTool,
  telegramKickUserExecutor,
  telegramBanUserTool,
  telegramBanUserExecutor,
  telegramUnbanUserTool,
  telegramUnbanUserExecutor,
  telegramCreateGroupTool,
  telegramCreateGroupExecutor,
  telegramSetChatPhotoTool,
  telegramSetChatPhotoExecutor,
  telegramBlockUserTool,
  telegramBlockUserExecutor,
  telegramGetBlockedTool,
  telegramGetBlockedExecutor,
  telegramGetCommonChatsTool,
  telegramGetCommonChatsExecutor,
  telegramSendStoryTool,
  telegramSendStoryExecutor,
  telegramGetDialogsTool,
  telegramGetDialogsExecutor,
  telegramMarkAsReadTool,
  telegramMarkAsReadExecutor,
  telegramGetChatInfoTool,
  telegramGetChatInfoExecutor,
  telegramForwardMessageTool,
  telegramForwardMessageExecutor,
  telegramSendPhotoTool,
  telegramSendPhotoExecutor,
  telegramSendVoiceTool,
  telegramSendVoiceExecutor,
  telegramSendStickerTool,
  telegramSendStickerExecutor,
  telegramSendGifTool,
  telegramSendGifExecutor,
  telegramCreatePollTool,
  telegramCreatePollExecutor,
  telegramCreateQuizTool,
  telegramCreateQuizExecutor,
  telegramReplyKeyboardTool,
  telegramReplyKeyboardExecutor,
  telegramSearchStickersTool,
  telegramSearchStickersExecutor,
  telegramGetMyStickersTool,
  telegramGetMyStickersExecutor,
  telegramSearchGifsTool,
  telegramSearchGifsExecutor,
  telegramAddStickerSetTool,
  telegramAddStickerSetExecutor,
  telegramGetFoldersTool,
  telegramGetFoldersExecutor,
  telegramCreateFolderTool,
  telegramCreateFolderExecutor,
  telegramAddChatToFolderTool,
  telegramAddChatToFolderExecutor,
  telegramCreateChannelTool,
  telegramCreateChannelExecutor,
  telegramUpdateProfileTool,
  telegramUpdateProfileExecutor,
  telegramSetBioTool,
  telegramSetBioExecutor,
  telegramSetUsernameTool,
  telegramSetUsernameExecutor,
  telegramDeleteMessageTool,
  telegramDeleteMessageExecutor,
  telegramDownloadMediaTool,
  telegramDownloadMediaExecutor,
  visionAnalyzeTool,
  visionAnalyzeExecutor,
  // Stars
  telegramGetStarsBalanceTool,
  telegramGetStarsBalanceExecutor,
  telegramGetStarsTransactionsTool,
  telegramGetStarsTransactionsExecutor,
  // Gifts
  telegramGetAvailableGiftsTool,
  telegramGetAvailableGiftsExecutor,
  telegramSendGiftTool,
  telegramSendGiftExecutor,
  telegramGetMyGiftsTool,
  telegramGetMyGiftsExecutor,
  telegramTransferCollectibleTool,
  telegramTransferCollectibleExecutor,
  telegramSetCollectiblePriceTool,
  telegramSetCollectiblePriceExecutor,
  telegramGetResaleGiftsTool,
  telegramGetResaleGiftsExecutor,
  telegramBuyResaleGiftTool,
  telegramBuyResaleGiftExecutor,
  telegramSetGiftStatusTool,
  telegramSetGiftStatusExecutor,
  // Memory tools
  memoryWriteTool,
  memoryWriteExecutor,
  memoryReadTool,
  memoryReadExecutor,
  // User info & contacts
  telegramGetUserInfoTool,
  telegramGetUserInfoExecutor,
  telegramCheckUsernameTool,
  telegramCheckUsernameExecutor,
  // Channel management
  telegramEditChannelInfoTool,
  telegramEditChannelInfoExecutor,
  telegramInviteToChannelTool,
  telegramInviteToChannelExecutor,
  // Market (gift floor prices)
  marketGetFloorTool,
  marketGetFloorExecutor,
  marketSearchTool,
  marketSearchExecutor,
  marketCheapestTool,
  marketCheapestExecutor,
  marketPriceHistoryTool,
  marketPriceHistoryExecutor,
} from "./telegram/index.js";

// TON blockchain tools
import {
  tonGetAddressTool,
  tonGetAddressExecutor,
  tonGetBalanceTool,
  tonGetBalanceExecutor,
  tonPriceTool,
  tonPriceExecutor,
  tonSendTool,
  tonSendExecutor,
  tonGetTransactionsTool,
  tonGetTransactionsExecutor,
  tonMyTransactionsTool,
  tonMyTransactionsExecutor,
} from "./ton/index.js";

// DNS tools
import {
  dnsCheckTool,
  dnsCheckExecutor,
  dnsAuctionsTool,
  dnsAuctionsExecutor,
  dnsResolveTool,
  dnsResolveExecutor,
  dnsStartAuctionTool,
  dnsStartAuctionExecutor,
  dnsBidTool,
  dnsBidExecutor,
  dnsLinkTool,
  dnsLinkExecutor,
  dnsUnlinkTool,
  dnsUnlinkExecutor,
} from "./dns/index.js";

// Jetton tools
import {
  jettonBalancesTool,
  jettonBalancesExecutor,
  jettonSwapTool,
  jettonSwapExecutor,
  jettonSendTool,
  jettonSendExecutor,
  jettonInfoTool,
  jettonInfoExecutor,
  jettonPriceTool,
  jettonPriceExecutor,
  jettonSearchTool,
  jettonSearchExecutor,
  jettonQuoteTool,
  jettonQuoteExecutor,
  jettonHoldersTool,
  jettonHoldersExecutor,
  jettonHistoryTool,
  jettonHistoryExecutor,
  jettonTrendingTool,
  jettonTrendingExecutor,
  jettonPoolsTool,
  jettonPoolsExecutor,
} from "./jetton/index.js";

// DeDust DEX tools
import {
  dedustQuoteTool,
  dedustQuoteExecutor,
  dedustSwapTool,
  dedustSwapExecutor,
  dedustPoolsTool,
  dedustPoolsExecutor,
} from "./dedust/index.js";

// Smart Router (unified DEX)
import { dexQuoteTool, dexQuoteExecutor, dexSwapTool, dexSwapExecutor } from "./dex/index.js";

// Journal tools
import {
  journalLogTool,
  journalLogExecutor,
  journalQueryTool,
  journalQueryExecutor,
  journalUpdateTool,
  journalUpdateExecutor,
} from "./journal/index.js";

// Workspace tools
import {
  workspaceListTool,
  workspaceListExecutor,
  workspaceReadTool,
  workspaceReadExecutor,
  workspaceWriteTool,
  workspaceWriteExecutor,
  workspaceDeleteTool,
  workspaceDeleteExecutor,
  workspaceInfoTool,
  workspaceInfoExecutor,
  workspaceRenameTool,
  workspaceRenameExecutor,
} from "./workspace/index.js";

// Casino tools
import {
  casinoBalanceTool,
  casinoBalanceExecutor,
  casinoSpinTool,
  casinoSpinExecutor,
  casinoDiceTool,
  casinoDiceExecutor,
  casinoPayoutTool,
  casinoPayoutExecutor,
  casinoLeaderboardTool,
  casinoLeaderboardExecutor,
  casinoMyStatsTool,
  casinoMyStatsExecutor,
  casinoJackpotInfoTool,
  casinoJackpotInfoExecutor,
  casinoAwardJackpotTool,
  casinoAwardJackpotExecutor,
} from "./casino/index.js";

// Deals tools
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
} from "./deals/index.js";

/**
 * Register all tools with the given registry.
 * Conditionally registers casino and deals tools based on config.
 */
export function registerAllTools(registry: ToolRegistry, config: Config): void {
  // Basic messaging
  registry.register(telegramSendMessageTool, telegramSendMessageExecutor);
  registry.register(telegramQuoteReplyTool, telegramQuoteReplyExecutor);
  registry.register(telegramGetRepliesTool, telegramGetRepliesExecutor);
  registry.register(telegramEditMessageTool, telegramEditMessageExecutor);
  registry.register(telegramScheduleMessageTool, telegramScheduleMessageExecutor);
  registry.register(telegramCreateScheduledTaskTool, telegramCreateScheduledTaskExecutor);
  registry.register(telegramSearchMessagesTool, telegramSearchMessagesExecutor);
  registry.register(telegramPinMessageTool, telegramPinMessageExecutor);
  registry.register(telegramUnpinMessageTool, telegramUnpinMessageExecutor);
  registry.register(telegramReactTool, telegramReactExecutor);
  registry.register(telegramSendDiceTool, telegramSendDiceExecutor);
  registry.register(telegramForwardMessageTool, telegramForwardMessageExecutor);

  // Media & files
  registry.register(telegramSendPhotoTool, telegramSendPhotoExecutor);
  registry.register(telegramSendVoiceTool, telegramSendVoiceExecutor);
  registry.register(telegramSendStickerTool, telegramSendStickerExecutor);
  registry.register(telegramSendGifTool, telegramSendGifExecutor);

  // Interactive elements
  registry.register(telegramCreatePollTool, telegramCreatePollExecutor);
  registry.register(telegramCreateQuizTool, telegramCreateQuizExecutor);
  registry.register(telegramReplyKeyboardTool, telegramReplyKeyboardExecutor);

  // Search & discovery
  registry.register(telegramSearchStickersTool, telegramSearchStickersExecutor);
  registry.register(telegramGetMyStickersTool, telegramGetMyStickersExecutor);
  registry.register(telegramSearchGifsTool, telegramSearchGifsExecutor);
  registry.register(telegramAddStickerSetTool, telegramAddStickerSetExecutor);

  // Chat management
  registry.register(telegramGetHistoryTool, telegramGetHistoryExecutor);
  registry.register(telegramGetDialogsTool, telegramGetDialogsExecutor);
  registry.register(telegramMarkAsReadTool, telegramMarkAsReadExecutor);
  registry.register(telegramGetChatInfoTool, telegramGetChatInfoExecutor);
  registry.register(telegramJoinChannelTool, telegramJoinChannelExecutor);
  registry.register(telegramLeaveChannelTool, telegramLeaveChannelExecutor);
  registry.register(telegramGetMeTool, telegramGetMeExecutor);
  registry.register(telegramGetParticipantsTool, telegramGetParticipantsExecutor);

  // Group moderation
  registry.register(telegramKickUserTool, telegramKickUserExecutor);
  registry.register(telegramBanUserTool, telegramBanUserExecutor);
  registry.register(telegramUnbanUserTool, telegramUnbanUserExecutor);
  registry.register(telegramCreateGroupTool, telegramCreateGroupExecutor);
  registry.register(telegramSetChatPhotoTool, telegramSetChatPhotoExecutor);

  // Contacts management
  registry.register(telegramBlockUserTool, telegramBlockUserExecutor);
  registry.register(telegramGetBlockedTool, telegramGetBlockedExecutor);
  registry.register(telegramGetCommonChatsTool, telegramGetCommonChatsExecutor);

  // Stories
  registry.register(telegramSendStoryTool, telegramSendStoryExecutor);

  // Folders & organization
  registry.register(telegramGetFoldersTool, telegramGetFoldersExecutor);
  registry.register(telegramCreateFolderTool, telegramCreateFolderExecutor);
  registry.register(telegramAddChatToFolderTool, telegramAddChatToFolderExecutor);

  // Channel & group creation
  registry.register(telegramCreateChannelTool, telegramCreateChannelExecutor);

  // Profile management
  registry.register(telegramUpdateProfileTool, telegramUpdateProfileExecutor);
  registry.register(telegramSetBioTool, telegramSetBioExecutor);
  registry.register(telegramSetUsernameTool, telegramSetUsernameExecutor);

  // Message management
  registry.register(telegramDeleteMessageTool, telegramDeleteMessageExecutor);

  // Media
  registry.register(telegramDownloadMediaTool, telegramDownloadMediaExecutor);
  registry.register(visionAnalyzeTool, visionAnalyzeExecutor);

  // Stars & Balance
  registry.register(telegramGetStarsBalanceTool, telegramGetStarsBalanceExecutor);
  registry.register(telegramGetStarsTransactionsTool, telegramGetStarsTransactionsExecutor);

  // Gifts & Collectibles
  registry.register(telegramGetAvailableGiftsTool, telegramGetAvailableGiftsExecutor);
  registry.register(telegramSendGiftTool, telegramSendGiftExecutor);
  registry.register(telegramGetMyGiftsTool, telegramGetMyGiftsExecutor);
  registry.register(telegramTransferCollectibleTool, telegramTransferCollectibleExecutor);
  registry.register(telegramSetCollectiblePriceTool, telegramSetCollectiblePriceExecutor);
  registry.register(telegramGetResaleGiftsTool, telegramGetResaleGiftsExecutor);
  registry.register(telegramBuyResaleGiftTool, telegramBuyResaleGiftExecutor);
  registry.register(telegramSetGiftStatusTool, telegramSetGiftStatusExecutor);

  // Memory (agent self-memory management)
  registry.register(memoryWriteTool, memoryWriteExecutor);
  registry.register(memoryReadTool, memoryReadExecutor);

  // User info & contacts
  registry.register(telegramGetUserInfoTool, telegramGetUserInfoExecutor);
  registry.register(telegramCheckUsernameTool, telegramCheckUsernameExecutor);

  // Channel management
  registry.register(telegramEditChannelInfoTool, telegramEditChannelInfoExecutor);
  registry.register(telegramInviteToChannelTool, telegramInviteToChannelExecutor);

  // Market (gift floor prices) — also required when deals are enabled
  if (config.market.enabled || config.deals.enabled) {
    registry.register(marketGetFloorTool, marketGetFloorExecutor);
    registry.register(marketSearchTool, marketSearchExecutor);
    registry.register(marketCheapestTool, marketCheapestExecutor);
    registry.register(marketPriceHistoryTool, marketPriceHistoryExecutor);
  }

  // TON blockchain
  registry.register(tonGetAddressTool, tonGetAddressExecutor);
  registry.register(tonGetBalanceTool, tonGetBalanceExecutor);
  registry.register(tonPriceTool, tonPriceExecutor);
  registry.register(tonSendTool, tonSendExecutor);
  registry.register(tonGetTransactionsTool, tonGetTransactionsExecutor);
  registry.register(tonMyTransactionsTool, tonMyTransactionsExecutor);

  // TON Jettons
  registry.register(jettonBalancesTool, jettonBalancesExecutor);
  registry.register(jettonSwapTool, jettonSwapExecutor);
  registry.register(jettonSendTool, jettonSendExecutor);
  registry.register(jettonInfoTool, jettonInfoExecutor);
  registry.register(jettonPriceTool, jettonPriceExecutor);
  registry.register(jettonSearchTool, jettonSearchExecutor);
  registry.register(jettonQuoteTool, jettonQuoteExecutor);
  registry.register(jettonHoldersTool, jettonHoldersExecutor);
  registry.register(jettonHistoryTool, jettonHistoryExecutor);
  registry.register(jettonTrendingTool, jettonTrendingExecutor);
  registry.register(jettonPoolsTool, jettonPoolsExecutor);

  // TON DNS
  registry.register(dnsCheckTool, dnsCheckExecutor);
  registry.register(dnsAuctionsTool, dnsAuctionsExecutor);
  registry.register(dnsResolveTool, dnsResolveExecutor);
  registry.register(dnsStartAuctionTool, dnsStartAuctionExecutor);
  registry.register(dnsBidTool, dnsBidExecutor);
  registry.register(dnsLinkTool, dnsLinkExecutor);
  registry.register(dnsUnlinkTool, dnsUnlinkExecutor);

  // DeDust DEX
  registry.register(dedustQuoteTool, dedustQuoteExecutor);
  registry.register(dedustSwapTool, dedustSwapExecutor);
  registry.register(dedustPoolsTool, dedustPoolsExecutor);

  // Smart Router (unified DEX)
  registry.register(dexQuoteTool, dexQuoteExecutor);
  registry.register(dexSwapTool, dexSwapExecutor);

  // Journal (trading & business operations)
  registry.register(journalLogTool, journalLogExecutor);
  registry.register(journalQueryTool, journalQueryExecutor);
  registry.register(journalUpdateTool, journalUpdateExecutor);

  // Workspace (secure file operations)
  registry.register(workspaceListTool, workspaceListExecutor);
  registry.register(workspaceReadTool, workspaceReadExecutor);
  registry.register(workspaceWriteTool, workspaceWriteExecutor);
  registry.register(workspaceDeleteTool, workspaceDeleteExecutor);
  registry.register(workspaceInfoTool, workspaceInfoExecutor);
  registry.register(workspaceRenameTool, workspaceRenameExecutor);

  // Teleton Casino (slot & dice games with TON payments)
  if (config.casino.enabled) {
    registry.register(casinoBalanceTool, casinoBalanceExecutor);
    registry.register(casinoSpinTool, casinoSpinExecutor);
    registry.register(casinoDiceTool, casinoDiceExecutor);
    registry.register(casinoPayoutTool, casinoPayoutExecutor);
    registry.register(casinoLeaderboardTool, casinoLeaderboardExecutor);
    registry.register(casinoMyStatsTool, casinoMyStatsExecutor);
    registry.register(casinoJackpotInfoTool, casinoJackpotInfoExecutor);
    registry.register(casinoAwardJackpotTool, casinoAwardJackpotExecutor);
  }

  // Deals System (secure gift/TON trading with STRATEGY.md enforcement)
  if (config.deals.enabled) {
    registry.register(dealProposeTool, dealProposeExecutor);
    registry.register(dealVerifyPaymentTool, dealVerifyPaymentExecutor);
    registry.register(dealStatusTool, dealStatusExecutor);
    registry.register(dealListTool, dealListExecutor);
    registry.register(dealCancelTool, dealCancelExecutor);
  }
}
