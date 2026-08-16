-- GTM Opportunity Matrix — Task #544.
--
-- One table: opportunity_matrix_cells — a scored grid crossing market segments
-- × buyer needs × GTM channels (revenue potential, execution effort, derived
-- ROI, whitespace flag). Cells cascade-delete with their segment.
--
-- Hand-written idempotent SQL (IF NOT EXISTS) matching the Drizzle definitions
-- in shared/schema.ts — see 0083/0084/0087 for the convention.

CREATE TABLE IF NOT EXISTS "opportunity_matrix_cells" (
    "id"                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain"     text NOT NULL,
    "market_id"         varchar REFERENCES "markets"("id") ON DELETE SET NULL,
    "segment_id"        varchar NOT NULL REFERENCES "market_segments"("id") ON DELETE CASCADE,
    "need_key"          text NOT NULL,
    "need_label"        text NOT NULL,
    "channel_key"       text NOT NULL,
    "revenue_potential" real,
    "execution_effort"  real,
    "roi_score"         real,
    "score_rationale"   text,
    "is_whitespace"     boolean NOT NULL DEFAULT false,
    "source"            text NOT NULL DEFAULT 'ai',
    "created_at"        timestamp NOT NULL DEFAULT now(),
    "updated_at"        timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_matrix_cell_unique"
    ON "opportunity_matrix_cells" ("segment_id", "need_key", "channel_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "opportunity_matrix_rank_idx"
    ON "opportunity_matrix_cells" ("tenant_domain", "market_id", "roi_score" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "opportunity_matrix_segment_idx"
    ON "opportunity_matrix_cells" ("segment_id");
