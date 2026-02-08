/**
 * Types for the deals inline bot
 */

export interface BotConfig {
  token: string;
  username: string;
  apiId?: number;
  apiHash?: string;
}

export interface DealContext {
  dealId: string;
  userId: number;
  username?: string;
  chatId: string;
  userGivesType: "ton" | "gift";
  userGivesTonAmount?: number;
  userGivesGiftSlug?: string;
  userGivesValueTon: number;
  agentGivesType: "ton" | "gift";
  agentGivesTonAmount?: number;
  agentGivesGiftSlug?: string;
  agentGivesValueTon: number;
  profitTon: number;
  status: DealStatus;
  createdAt: number;
  expiresAt: number;
  inlineMessageId?: string;
  paymentClaimedAt?: number;
  verifiedAt?: number;
  completedAt?: number;
  agentWallet?: string;
}

export type DealStatus =
  | "proposed"
  | "accepted"
  | "payment_claimed"
  | "verified"
  | "completed"
  | "declined"
  | "expired"
  | "cancelled"
  | "failed";

export type MessageState =
  | "proposal" // Accept/Decline buttons
  | "accepted" // Payment/gift instructions + "I've sent"
  | "payment_claimed" // Verifying...
  | "verified" // Sending agent's part...
  | "completed" // Final recap
  | "declined" // Declined message
  | "expired" // Expired message
  | "failed"; // Error message

export interface CallbackData {
  action: "accept" | "decline" | "sent" | "copy_addr" | "copy_memo" | "refresh";
  dealId: string;
}

export function encodeCallback(data: CallbackData): string {
  return `${data.action}:${data.dealId}`;
}

export function decodeCallback(raw: string): CallbackData | null {
  const parts = raw.split(":");
  if (parts.length !== 2) return null;

  const action = parts[0] as CallbackData["action"];
  const dealId = parts[1];

  if (!["accept", "decline", "sent", "copy_addr", "copy_memo", "refresh"].includes(action)) {
    return null;
  }

  return { action, dealId };
}
