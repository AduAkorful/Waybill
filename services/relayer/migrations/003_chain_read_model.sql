CREATE TABLE IF NOT EXISTS waybill_chain_events (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
  log_index NUMERIC(78, 0) NOT NULL CHECK (log_index >= 0),
  transaction_hash TEXT NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  event_name TEXT NOT NULL,
  deal_id NUMERIC(78, 0) CHECK (deal_id IS NULL OR deal_id >= 0),
  milestone_index INTEGER CHECK (milestone_index IS NULL OR milestone_index BETWEEN 0 AND 255),
  payload JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network, block_number, log_index)
);

CREATE TABLE IF NOT EXISTS waybill_deal_projections (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  deal_id NUMERIC(78, 0) NOT NULL CHECK (deal_id >= 0),
  state TEXT NOT NULL,
  buyer TEXT,
  supplier TEXT,
  supplier_payout TEXT,
  total_amount NUMERIC(78, 0),
  prepaid_fee NUMERIC(78, 0),
  last_block_number NUMERIC(78, 0) NOT NULL CHECK (last_block_number >= 0),
  last_log_index NUMERIC(78, 0) NOT NULL CHECK (last_log_index >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network, deal_id)
);
