CREATE TABLE IF NOT EXISTS waybill_evidence_pointers (
  id UUID PRIMARY KEY,
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  deal_id NUMERIC(78, 0) NOT NULL CHECK (deal_id >= 0),
  milestone_index INTEGER NOT NULL CHECK (milestone_index BETWEEN 0 AND 255),
  uploaded_by TEXT NOT NULL CHECK (uploaded_by ~ '^0x[0-9a-fA-F]{40}$'),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^0x[0-9a-fA-F]{64}$'),
  object_uri TEXT NOT NULL CHECK (object_uri ~ '^https?://|^s3://'),
  ipfs_uri TEXT NOT NULL CHECK (ipfs_uri ~ '^ipfs://'),
  mime_type TEXT NOT NULL CHECK (length(btrim(mime_type)) > 0),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (network, deal_id, milestone_index, content_sha256)
);
