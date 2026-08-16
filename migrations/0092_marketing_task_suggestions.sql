-- backfill:always-apply
-- (Alter-only + fully idempotent: on an established database with an empty
-- migration ledger, this must execute for real — not be stamped — or the
-- provenance columns the app selects will be missing.)
-- Task suggestions: approval gate + dedup support for AI-generated marketing tasks.
-- Adds generation-run provenance columns. The dismissed status reuses the existing
-- text status column (no enum), so no status migration is needed.
ALTER TABLE "marketing_tasks" ADD COLUMN IF NOT EXISTS "source_generation_id" text;
ALTER TABLE "marketing_tasks" ADD COLUMN IF NOT EXISTS "source_generation_label" text;
