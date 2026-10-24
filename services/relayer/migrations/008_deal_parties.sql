-- Who is named in each deal, read from the escrow when the deal is created. Lets the API answer
-- "which deals involve this wallet, and as what" without scanning the chain. Addresses are lowercase.
CREATE TABLE IF NOT EXISTS waybill_deal_parties (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  deal_id NUMERIC(78, 0) NOT NULL CHECK (deal_id >= 0),
  address TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  role TEXT NOT NULL CHECK (role IN ('buyer', 'supplier', 'arbiter', 'panel', 'attestor')),
  -- the part an attestor confirms; -1 for roles that are about the whole deal
  milestone_index INTEGER NOT NULL DEFAULT -1 CHECK (milestone_index BETWEEN -1 AND 255),
  PRIMARY KEY (network, deal_id, address, role, milestone_index)
);

CREATE INDEX IF NOT EXISTS waybill_deal_parties_address_idx
  ON waybill_deal_parties (network, address);
