-- Migration 1.6.0: Bot inline message tracking + payment_claimed status
-- Recreates deals table to add 'payment_claimed' to CHECK constraint
-- Adds inline_message_id and payment_claimed_at columns

-- Step 1: Rename old table
ALTER TABLE deals RENAME TO deals_old;

-- Step 2: Create new table with payment_claimed status + new columns
CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN (
    'proposed', 'accepted', 'payment_claimed', 'verified', 'completed',
    'declined', 'expired', 'cancelled', 'failed'
  )),
  user_telegram_id INTEGER NOT NULL,
  user_username TEXT,
  chat_id TEXT NOT NULL,
  proposal_message_id INTEGER,
  user_gives_type TEXT NOT NULL CHECK(user_gives_type IN ('ton', 'gift')),
  user_gives_ton_amount REAL,
  user_gives_gift_id TEXT,
  user_gives_gift_slug TEXT,
  user_gives_value_ton REAL NOT NULL,
  agent_gives_type TEXT NOT NULL CHECK(agent_gives_type IN ('ton', 'gift')),
  agent_gives_ton_amount REAL,
  agent_gives_gift_id TEXT,
  agent_gives_gift_slug TEXT,
  agent_gives_value_ton REAL NOT NULL,
  user_payment_verified_at INTEGER,
  user_payment_tx_hash TEXT,
  user_payment_gift_msgid TEXT,
  user_payment_wallet TEXT,
  agent_sent_at INTEGER,
  agent_sent_tx_hash TEXT,
  agent_sent_gift_msgid TEXT,
  strategy_check TEXT,
  profit_ton REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  notes TEXT,
  inline_message_id TEXT,
  payment_claimed_at INTEGER
);

-- Step 3: Copy data from old table (new columns default to NULL)
INSERT INTO deals (
  id, status, user_telegram_id, user_username, chat_id, proposal_message_id,
  user_gives_type, user_gives_ton_amount, user_gives_gift_id, user_gives_gift_slug, user_gives_value_ton,
  agent_gives_type, agent_gives_ton_amount, agent_gives_gift_id, agent_gives_gift_slug, agent_gives_value_ton,
  user_payment_verified_at, user_payment_tx_hash, user_payment_gift_msgid, user_payment_wallet,
  agent_sent_at, agent_sent_tx_hash, agent_sent_gift_msgid,
  strategy_check, profit_ton, created_at, expires_at, completed_at, notes
)
SELECT
  id, status, user_telegram_id, user_username, chat_id, proposal_message_id,
  user_gives_type, user_gives_ton_amount, user_gives_gift_id, user_gives_gift_slug, user_gives_value_ton,
  agent_gives_type, agent_gives_ton_amount, agent_gives_gift_id, agent_gives_gift_slug, agent_gives_value_ton,
  user_payment_verified_at, user_payment_tx_hash, user_payment_gift_msgid, user_payment_wallet,
  agent_sent_at, agent_sent_tx_hash, agent_sent_gift_msgid,
  strategy_check, profit_ton, created_at, expires_at, completed_at, notes
FROM deals_old;

-- Step 4: Drop old table
DROP TABLE deals_old;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_telegram_id);
CREATE INDEX IF NOT EXISTS idx_deals_chat ON deals(chat_id);
CREATE INDEX IF NOT EXISTS idx_deals_inline_msg ON deals(inline_message_id) WHERE inline_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_payment_claimed ON deals(payment_claimed_at) WHERE payment_claimed_at IS NOT NULL;

-- User stats for trading history
CREATE TABLE IF NOT EXISTS user_trade_stats (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  first_trade_at INTEGER DEFAULT (unixepoch()),
  total_deals INTEGER DEFAULT 0,
  completed_deals INTEGER DEFAULT 0,
  declined_deals INTEGER DEFAULT 0,
  total_ton_sent REAL DEFAULT 0,
  total_ton_received REAL DEFAULT 0,
  total_gifts_sent INTEGER DEFAULT 0,
  total_gifts_received INTEGER DEFAULT 0,
  last_deal_at INTEGER
);

-- Update schema version
UPDATE meta SET value = '1.6.0' WHERE key = 'schema_version';
