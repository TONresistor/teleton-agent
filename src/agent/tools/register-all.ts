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

/**
 * Register all tools with the given registry.
 * Casino, market, and deals tools are loaded via module-loader.ts.
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
  registry.register(telegramJoinChannelTool, telegramJoinChannelExecutor, "dm-only");
  registry.register(telegramLeaveChannelTool, telegramLeaveChannelExecutor, "dm-only");
  registry.register(telegramGetMeTool, telegramGetMeExecutor);
  registry.register(telegramGetParticipantsTool, telegramGetParticipantsExecutor);

  // Group moderation (group-only)
  registry.register(telegramKickUserTool, telegramKickUserExecutor, "group-only");
  registry.register(telegramBanUserTool, telegramBanUserExecutor, "group-only");
  registry.register(telegramUnbanUserTool, telegramUnbanUserExecutor, "group-only");
  registry.register(telegramCreateGroupTool, telegramCreateGroupExecutor, "dm-only");
  registry.register(telegramSetChatPhotoTool, telegramSetChatPhotoExecutor, "group-only");

  // Contacts management (dm-only)
  registry.register(telegramBlockUserTool, telegramBlockUserExecutor, "dm-only");
  registry.register(telegramGetBlockedTool, telegramGetBlockedExecutor, "dm-only");
  registry.register(telegramGetCommonChatsTool, telegramGetCommonChatsExecutor);

  // Stories (dm-only)
  registry.register(telegramSendStoryTool, telegramSendStoryExecutor, "dm-only");

  // Folders & organization
  registry.register(telegramGetFoldersTool, telegramGetFoldersExecutor);
  registry.register(telegramCreateFolderTool, telegramCreateFolderExecutor);
  registry.register(telegramAddChatToFolderTool, telegramAddChatToFolderExecutor);

  // Channel & group creation (dm-only)
  registry.register(telegramCreateChannelTool, telegramCreateChannelExecutor, "dm-only");

  // Profile management (dm-only)
  registry.register(telegramUpdateProfileTool, telegramUpdateProfileExecutor, "dm-only");
  registry.register(telegramSetBioTool, telegramSetBioExecutor, "dm-only");
  registry.register(telegramSetUsernameTool, telegramSetUsernameExecutor, "dm-only");

  // Message management
  registry.register(telegramDeleteMessageTool, telegramDeleteMessageExecutor);

  // Media
  registry.register(telegramDownloadMediaTool, telegramDownloadMediaExecutor);
  registry.register(visionAnalyzeTool, visionAnalyzeExecutor);

  // Stars & Balance (dm-only)
  registry.register(telegramGetStarsBalanceTool, telegramGetStarsBalanceExecutor, "dm-only");
  registry.register(
    telegramGetStarsTransactionsTool,
    telegramGetStarsTransactionsExecutor,
    "dm-only"
  );

  // Gifts & Collectibles (mutations dm-only)
  registry.register(telegramGetAvailableGiftsTool, telegramGetAvailableGiftsExecutor);
  registry.register(telegramSendGiftTool, telegramSendGiftExecutor, "dm-only");
  registry.register(telegramGetMyGiftsTool, telegramGetMyGiftsExecutor);
  registry.register(
    telegramTransferCollectibleTool,
    telegramTransferCollectibleExecutor,
    "dm-only"
  );
  registry.register(
    telegramSetCollectiblePriceTool,
    telegramSetCollectiblePriceExecutor,
    "dm-only"
  );
  registry.register(telegramGetResaleGiftsTool, telegramGetResaleGiftsExecutor);
  registry.register(telegramBuyResaleGiftTool, telegramBuyResaleGiftExecutor, "dm-only");
  registry.register(telegramSetGiftStatusTool, telegramSetGiftStatusExecutor, "dm-only");

  // Memory (agent self-memory management; write dm-only)
  registry.register(memoryWriteTool, memoryWriteExecutor, "dm-only");
  registry.register(memoryReadTool, memoryReadExecutor);

  // User info & contacts
  registry.register(telegramGetUserInfoTool, telegramGetUserInfoExecutor);
  registry.register(telegramCheckUsernameTool, telegramCheckUsernameExecutor);

  // Channel management (dm-only)
  registry.register(telegramEditChannelInfoTool, telegramEditChannelInfoExecutor, "dm-only");
  registry.register(telegramInviteToChannelTool, telegramInviteToChannelExecutor, "dm-only");

  // TON blockchain (send dm-only)
  registry.register(tonGetAddressTool, tonGetAddressExecutor);
  registry.register(tonGetBalanceTool, tonGetBalanceExecutor);
  registry.register(tonPriceTool, tonPriceExecutor);
  registry.register(tonSendTool, tonSendExecutor, "dm-only");
  registry.register(tonGetTransactionsTool, tonGetTransactionsExecutor);
  registry.register(tonMyTransactionsTool, tonMyTransactionsExecutor);

  // TON Jettons (swap/send dm-only)
  registry.register(jettonBalancesTool, jettonBalancesExecutor);
  registry.register(jettonSwapTool, jettonSwapExecutor, "dm-only");
  registry.register(jettonSendTool, jettonSendExecutor, "dm-only");
  registry.register(jettonInfoTool, jettonInfoExecutor);
  registry.register(jettonPriceTool, jettonPriceExecutor);
  registry.register(jettonSearchTool, jettonSearchExecutor);
  registry.register(jettonQuoteTool, jettonQuoteExecutor);
  registry.register(jettonHoldersTool, jettonHoldersExecutor);
  registry.register(jettonHistoryTool, jettonHistoryExecutor);
  registry.register(jettonTrendingTool, jettonTrendingExecutor);
  registry.register(jettonPoolsTool, jettonPoolsExecutor);

  // TON DNS (mutations dm-only)
  registry.register(dnsCheckTool, dnsCheckExecutor);
  registry.register(dnsAuctionsTool, dnsAuctionsExecutor);
  registry.register(dnsResolveTool, dnsResolveExecutor);
  registry.register(dnsStartAuctionTool, dnsStartAuctionExecutor, "dm-only");
  registry.register(dnsBidTool, dnsBidExecutor, "dm-only");
  registry.register(dnsLinkTool, dnsLinkExecutor, "dm-only");
  registry.register(dnsUnlinkTool, dnsUnlinkExecutor, "dm-only");

  // DeDust DEX (swap dm-only)
  registry.register(dedustQuoteTool, dedustQuoteExecutor);
  registry.register(dedustSwapTool, dedustSwapExecutor, "dm-only");
  registry.register(dedustPoolsTool, dedustPoolsExecutor);

  // Smart Router (unified DEX; swap dm-only)
  registry.register(dexQuoteTool, dexQuoteExecutor);
  registry.register(dexSwapTool, dexSwapExecutor, "dm-only");

  // Journal (trading & business operations; mutations dm-only)
  registry.register(journalLogTool, journalLogExecutor, "dm-only");
  registry.register(journalQueryTool, journalQueryExecutor);
  registry.register(journalUpdateTool, journalUpdateExecutor, "dm-only");

  // Workspace (secure file operations; mutations dm-only)
  registry.register(workspaceListTool, workspaceListExecutor);
  registry.register(workspaceReadTool, workspaceReadExecutor);
  registry.register(workspaceWriteTool, workspaceWriteExecutor, "dm-only");
  registry.register(workspaceDeleteTool, workspaceDeleteExecutor, "dm-only");
  registry.register(workspaceInfoTool, workspaceInfoExecutor);
  registry.register(workspaceRenameTool, workspaceRenameExecutor, "dm-only");
}
