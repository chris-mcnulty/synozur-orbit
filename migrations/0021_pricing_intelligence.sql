-- Pricing Intelligence Tracker (backlog: Competitor Pricing Intelligence Tracker)
-- 1. Adds a per-competitor pricing page URL
-- 2. Adds a time-series `competitor_pricing_snapshots` table storing structured tier
--    extractions plus the raw page content used for diffing, change scores, and
--    AI-generated change narratives.

ALTER TABLE "competitors"
    ADD COLUMN IF NOT EXISTS "pricing_page_url" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "competitor_pricing_snapshots" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "competitor_id" varchar NOT NULL,
    "pricing_url" text NOT NULL,
    "tiers" jsonb NOT NULL,
    "pricing_model" text,
    "currency" text,
    "has_free_tier" boolean,
    "raw_content" text,
    "change_score" integer NOT NULL DEFAULT 0,
    "change_summary" text,
    "change_analysis" jsonb,
    "crawl_method" text,
    "captured_at" timestamp NOT NULL DEFAULT now(),
    "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'competitor_pricing_snapshots_competitor_id_fk'
    ) THEN
        ALTER TABLE "competitor_pricing_snapshots"
            ADD CONSTRAINT "competitor_pricing_snapshots_competitor_id_fk"
            FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE CASCADE;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'competitor_pricing_snapshots_market_id_fk'
    ) THEN
        ALTER TABLE "competitor_pricing_snapshots"
            ADD CONSTRAINT "competitor_pricing_snapshots_market_id_fk"
            FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE SET NULL;
    END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "competitor_pricing_snapshots_competitor_captured_idx"
    ON "competitor_pricing_snapshots" ("competitor_id", "captured_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "competitor_pricing_snapshots_tenant_captured_idx"
    ON "competitor_pricing_snapshots" ("tenant_domain", "captured_at");
