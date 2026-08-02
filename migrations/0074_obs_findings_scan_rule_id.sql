-- Add scan_rule_id column to obs_findings so the automated security scanner
-- can match existing findings by rule on re-scan (upsert instead of duplicate insert).
DO $$ BEGIN
  ALTER TABLE "obs_findings" ADD COLUMN "scan_rule_id" text;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;
