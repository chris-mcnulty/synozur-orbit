-- Market Study Wizard — Task #547.
--
-- One table: market_studies — the durable record of an end-to-end run (brief/URL
-- → segments → sizing → matrix → executive summary). The pipeline writes segment
-- and matrix data into the existing tables (output-compatible); this row holds
-- the run's status, staged progress, executive summary, and provenance refs.
--
-- Hand-written idempotent SQL (IF NOT EXISTS) matching shared/schema.ts — see
-- 0087/0088 for the convention. parent_study_id self-references for refresh
-- lineage.

CREATE TABLE IF NOT EXISTS "market_studies" (
    "id"                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain"     text NOT NULL,
    "market_id"         varchar REFERENCES "markets"("id") ON DELETE SET NULL,
    "input_type"        text NOT NULL DEFAULT 'brief',
    "input_value"       text,
    "depth"             text NOT NULL DEFAULT 'focus',
    "status"            text NOT NULL DEFAULT 'pending',
    "current_stage"     text,
    "stages"            jsonb NOT NULL DEFAULT '[]'::jsonb,
    "executive_summary" text,
    "result_refs"       jsonb NOT NULL DEFAULT '{}'::jsonb,
    "error"             text,
    "parent_study_id"   varchar REFERENCES "market_studies"("id") ON DELETE SET NULL,
    "created_by"        varchar NOT NULL REFERENCES "users"("id"),
    "created_at"        timestamp NOT NULL DEFAULT now(),
    "started_at"        timestamp,
    "completed_at"      timestamp
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "market_studies_tenant_market_idx"
    ON "market_studies" ("tenant_domain", "market_id", "created_at" DESC);
