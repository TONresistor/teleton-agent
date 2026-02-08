-- Migration 1.5.0: Deals system for secure gift/TON trading
-- Enforces STRATEGY.md rules at code level
-- User ALWAYS sends first (TON or gift) → verification → agent sends

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN (
    'proposed', 'accepted', 'verified', 'completed',
    'declined', 'expired', 'cancelled', 'failed'
  )),

  -- Parties
  user_telegram_id INTEGER NOT NULL,
  user_username TEXT,
  chat_id TEXT NOT NULL,
  proposal_message_id INTEGER,

  -- What USER gives
  user_gives_type TEXT NOT NULL CHECK(user_gives_type IN ('ton', 'gift')),
  user_gives_ton_amount REAL,
  user_gives_gift_id TEXT,
  user_gives_gift_slug TEXT,
  user_gives_value_ton REAL NOT NULL,

  -- What AGENT gives
  agent_gives_type TEXT NOT NULL CHECK(agent_gives_type IN ('ton', 'gift')),
  agent_gives_ton_amount REAL,
  agent_gives_gift_id TEXT,
  agent_gives_gift_slug TEXT,
  agent_gives_value_ton REAL NOT NULL,

  -- Payment/Gift verification
  user_payment_verified_at INTEGER,
  user_payment_tx_hash TEXT,
  user_payment_gift_msgid TEXT,
  user_payment_wallet TEXT,

  -- Agent send tracking
  agent_sent_at INTEGER,
  agent_sent_tx_hash TEXT,
  agent_sent_gift_msgid TEXT,

  -- Business logic
  strategy_check TEXT,  -- JSON: {floor_price, ratio, rule, profit}
  profit_ton REAL,

  -- Timestamps
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,  -- 2 minutes from creation
  completed_at INTEGER,

  notes TEXT
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_telegram_id);
CREATE INDEX IF NOT EXISTS idx_deals_chat ON deals(chat_id);
CREATE INDEX IF NOT EXISTS idx_deals_expires ON deals(expires_at)
  WHERE status IN ('proposed', 'accepted');

-- Update schema version
UPDATE meta SET value = '1.5.0' WHERE key = 'schema_version';
