-- Unix seconds of the block that emitted the event. Nullable: rows indexed before this column
-- existed have no time, and the API reports them as unknown rather than guessing.
ALTER TABLE waybill_chain_events
  ADD COLUMN IF NOT EXISTS block_timestamp NUMERIC(78, 0) CHECK (block_timestamp IS NULL OR block_timestamp >= 0);
