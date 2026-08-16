-- Opportunity Matrix competitor presence (Task #749).
--
-- Adds per-cell competitor-presence scoring so is_whitespace can reflect
-- "high ROI + low competitor presence" instead of a pure top-ROI proxy.
-- Hand-written idempotent SQL matching shared/schema.ts (see 0088 convention).

ALTER TABLE "opportunity_matrix_cells"
    ADD COLUMN IF NOT EXISTS "competitor_presence" real;
--> statement-breakpoint

ALTER TABLE "opportunity_matrix_cells"
    ADD COLUMN IF NOT EXISTS "presence_rationale" text;
