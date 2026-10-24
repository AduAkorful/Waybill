ALTER TABLE waybill_evidence_pointers ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE waybill_evidence_pointers ADD COLUMN IF NOT EXISTS created_unix BIGINT;
