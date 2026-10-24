-- The email a wallet asked to be told at. Only a verified address is ever mailed: the owner of the wallet proves the
-- address by clicking a link sent to it, so nobody can aim Waybill's mail at someone else's inbox.
CREATE TABLE IF NOT EXISTS waybill_wallet_emails (
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  wallet TEXT NOT NULL CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  email TEXT NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND length(email) <= 254),
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at TIMESTAMPTZ,
  -- SHA-256 of the one-time token in the verification link; the token itself is never stored
  verify_token_hash TEXT,
  verify_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network, wallet)
);

CREATE INDEX IF NOT EXISTS waybill_wallet_emails_token_idx
  ON waybill_wallet_emails (verify_token_hash) WHERE verify_token_hash IS NOT NULL;
