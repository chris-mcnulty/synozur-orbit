-- backfill:always-apply
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS classification jsonb;
