CREATE TABLE IF NOT EXISTS waybill_relayer_cursors (
  stream TEXT PRIMARY KEY,
  block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
  log_index NUMERIC(78, 0) NOT NULL CHECK (log_index >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
