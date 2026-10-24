-- Details the contract does not hold (goods, names, places, part titles), set by the deal's buyer while the deal is
-- still unfunded. Private to the parties unless the buyer marks them public.
CREATE TABLE IF NOT EXISTS waybill_deal_terms (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  deal_id NUMERIC(78, 0) NOT NULL CHECK (deal_id >= 0),
  terms JSONB NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  set_by TEXT NOT NULL CHECK (set_by ~ '^0x[0-9a-f]{40}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network, deal_id)
);
