-- backfill:always-apply
-- (Alter-only + fully idempotent: the ADD COLUMN is IF NOT EXISTS and the
-- backfill UPDATE only touches rows with accepted_at IS NULL, so re-running
-- is safe; ledger-backfill deployments must execute it, not stamp it.)
-- Durable acceptance provenance for AI-generated marketing tasks.
-- Planner sync eligibility for AI tasks now requires accepted_at, so lifecycle
-- progression (e.g. Planner-side percent-complete changes) can never
-- substitute for explicit user acceptance.
ALTER TABLE "marketing_tasks" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp;

-- One-time grandfathering: legacy AI tasks that already progressed past the
-- review states (accepted / planned / in_progress / completed / removed /
-- cancelled) predate the approval gate and have visible user engagement, so
-- they are classified as accepted to avoid ripping in-flight work out of
-- Planner. All future suggestions require an explicit acceptance stamp.
UPDATE "marketing_tasks"
SET "accepted_at" = COALESCE("updated_at", now())
WHERE "ai_generated" = true
  AND "accepted_at" IS NULL
  AND "status" NOT IN ('suggested', 'dismissed');
