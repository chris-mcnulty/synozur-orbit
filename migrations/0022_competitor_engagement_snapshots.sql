-- Time-series engagement metrics per competitor + platform. Used by the
-- Visualization Dashboard (Enterprise) to chart followers / posts / reactions
-- trends over time. The current latest snapshot still lives on the JSONB
-- columns on `competitors` for fast single-record reads.

CREATE TABLE IF NOT EXISTS "competitor_engagement_snapshots" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "competitor_id" varchar NOT NULL,
    "platform" text NOT NULL,
    "followers" integer,
    "posts" integer,
    "reactions" integer,
    "comments" integer,
    "likes" integer,
    "raw" jsonb,
    "captured_at" timestamp NOT NULL DEFAULT now(),
    "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'competitor_engagement_snapshots_competitor_id_fk'
    ) THEN
        ALTER TABLE "competitor_engagement_snapshots"
            ADD CONSTRAINT "competitor_engagement_snapshots_competitor_id_fk"
            FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE CASCADE;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'competitor_engagement_snapshots_market_id_fk'
    ) THEN
        ALTER TABLE "competitor_engagement_snapshots"
            ADD CONSTRAINT "competitor_engagement_snapshots_market_id_fk"
            FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE SET NULL;
    END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "competitor_engagement_snapshots_competitor_platform_idx"
    ON "competitor_engagement_snapshots" ("competitor_id", "platform", "captured_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "competitor_engagement_snapshots_tenant_captured_idx"
    ON "competitor_engagement_snapshots" ("tenant_domain", "captured_at");
