CREATE TABLE IF NOT EXISTS waybill_contacts (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  wallet TEXT NOT NULL CHECK (wallet ~ '^0x[0-9a-fA-F]{40}$'),
  role TEXT NOT NULL CHECK (role IN ('buyer', 'supplier', 'attestor', 'arbiter', 'operator')),
  email TEXT CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network, wallet, role)
);

CREATE TABLE IF NOT EXISTS waybill_deal_flags (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  deal_id NUMERIC(78, 0) NOT NULL CHECK (deal_id >= 0),
  label TEXT NOT NULL CHECK (length(btrim(label)) > 0),
  is_test BOOLEAN NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network, deal_id)
);
