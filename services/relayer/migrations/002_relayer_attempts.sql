CREATE TABLE IF NOT EXISTS waybill_relayer_attempts (
  operation TEXT NOT NULL CHECK (operation IN ('claim', 'refund', 'applyDefault')),
  deal_id NUMERIC(78, 0) NOT NULL CHECK (deal_id >= 0),
  milestone_index INTEGER NOT NULL CHECK (milestone_index BETWEEN 0 AND 255),
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'success', 'reverted')),
  tx_hash TEXT CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  attempt_count INTEGER NOT NULL CHECK (attempt_count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (operation, deal_id, milestone_index)
);
