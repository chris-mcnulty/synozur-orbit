-- Strategic Intelligence Stack — Phase 0 foundation (Tasks #543 → #544 → #547).
--
-- Creates the two tables the whole stack is built on:
--   market_segments             — personas promoted to quantified segments
--                                 (TAM/SAM ranges + user overrides, 1–10
--                                 priority, structured Needs Map).
--   market_intelligence_sources — shared, polymorphic provenance store behind
--                                 every cited figure and the Study source panel.
--
-- Hand-written SQL because db:generate is broken (snapshot collision) — see the
-- note in 0083/0084. Fully idempotent: CREATE ... IF NOT EXISTS so re-running is
-- safe. Column names/types mirror the Drizzle definitions in shared/schema.ts.
-- Money is bigint (whole units of sizing_currency) so multi-billion TAM figures
-- never overflow int4.

-- ─── market_segments ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "market_segments" (
    "id"                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain"         text NOT NULL,
    "market_id"             varchar REFERENCES "markets"("id") ON DELETE SET NULL,
    "persona_id"            varchar REFERENCES "personas"("id") ON DELETE SET NULL,
    "name"                  text NOT NULL,
    "description"           text,
    -- Sizing (bigint = whole units of sizing_currency)
    "tam_low"               bigint,
    "tam_mid"               bigint,
    "tam_high"              bigint,
    "sam_low"               bigint,
    "sam_mid"               bigint,
    "sam_high"              bigint,
    "tam_user_override"     bigint,
    "sam_user_override"     bigint,
    "sizing_currency"       text NOT NULL DEFAULT 'USD',
    "sizing_method"         text,
    "sizing_confidence"     text,
    "sizing_rationale"      text,
    "last_estimated_at"     timestamp,
    -- Ranking
    "priority_score"        integer,
    "priority_score_source" text,
    "priority_rationale"    text,
    -- Needs Map + firmographics
    "needs_map"             jsonb NOT NULL DEFAULT '{}'::jsonb,
    "needs_map_source"      text,
    "firmographics"         jsonb NOT NULL DEFAULT '{}'::jsonb,
    "status"                text NOT NULL DEFAULT 'active',
    "created_by"            varchar NOT NULL REFERENCES "users"("id"),
    "created_at"            timestamp NOT NULL DEFAULT now(),
    "updated_at"            timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "market_segments_priority_range"
        CHECK ("priority_score" IS NULL OR ("priority_score" >= 1 AND "priority_score" <= 10))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "market_segments_tenant_market_idx"
    ON "market_segments" ("tenant_domain", "market_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "market_segments_priority_idx"
    ON "market_segments" ("tenant_domain", "market_id", "priority_score" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "market_segments_persona_idx"
    ON "market_segments" ("persona_id");
--> statement-breakpoint

-- ─── market_intelligence_sources ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "market_intelligence_sources" (
    "id"             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain"  text NOT NULL,
    "market_id"      varchar REFERENCES "markets"("id") ON DELETE SET NULL,
    "scope_type"     text NOT NULL,
    "scope_id"       varchar NOT NULL,
    "used_for_field" text,
    "url"            text,
    "title"          text,
    "publisher"      text,
    "excerpt"        text,
    "retrieved_at"   timestamp NOT NULL DEFAULT now(),
    "created_at"     timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "market_intelligence_sources_scope_idx"
    ON "market_intelligence_sources" ("tenant_domain", "scope_type", "scope_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "market_intelligence_sources_market_idx"
    ON "market_intelligence_sources" ("tenant_domain", "market_id");
