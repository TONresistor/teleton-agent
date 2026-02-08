/**
 * Types for deals system
 */

export interface Deal {
  id: string;
  status: DealStatus;
  user_telegram_id: number;
  user_username: string | null;
  chat_id: string;
  proposal_message_id: number | null;
  user_gives_type: "ton" | "gift";
  user_gives_ton_amount: number | null;
  user_gives_gift_id: string | null;
  user_gives_gift_slug: string | null;
  user_gives_value_ton: number;
  agent_gives_type: "ton" | "gift";
  agent_gives_ton_amount: number | null;
  agent_gives_gift_id: string | null;
  agent_gives_gift_slug: string | null;
  agent_gives_value_ton: number;
  user_payment_verified_at: number | null;
  user_payment_tx_hash: string | null;
  user_payment_gift_msgid: string | null;
  user_payment_wallet: string | null;
  agent_sent_at: number | null;
  agent_sent_tx_hash: string | null;
  agent_sent_gift_msgid: string | null;
  strategy_check: string | null;
  profit_ton: number | null;
  created_at: number;
  expires_at: number;
  completed_at: number | null;
  notes: string | null;
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

export interface ReceivedGift {
  msgId: string;
  slug: string;
  name: string;
  fromUserId?: number;
  fromUsername?: string;
  receivedAt: number;
}
