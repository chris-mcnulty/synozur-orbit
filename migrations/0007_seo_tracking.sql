-- SEO & Share-of-Voice Tracking
-- Adds tracked_keywords + seo_metrics tables (tenant/market-scoped) and a
-- per-tenant SEO refresh cadence column on tenants.

CREATE TABLE IF NOT EXISTS "tracked_keywords" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "keyword" text NOT NULL,
    "country" text DEFAULT 'us' NOT NULL,
    "locale" text DEFAULT 'en' NOT NULL,
    "created_by" varchar NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "tracked_keywords_market_id_markets_id_fk"
        FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE SET NULL,
    CONSTRAINT "tracked_keywords_created_by_users_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tracked_keywords_tenant_market_idx"
    ON "tracked_keywords" ("tenant_domain", "market_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "seo_metrics" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "keyword_id" varchar NOT NULL,
    "entity_type" text NOT NULL,
    "entity_id" varchar,
    "entity_name" text NOT NULL,
    "entity_domain" text,
    "rank" integer,
    "estimated_traffic" integer DEFAULT 0 NOT NULL,
    "share_of_voice" integer DEFAULT 0 NOT NULL,
    "captured_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "seo_metrics_market_id_markets_id_fk"
        FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE SET NULL,
    CONSTRAINT "seo_metrics_keyword_id_tracked_keywords_id_fk"
        FOREIGN KEY ("keyword_id") REFERENCES "public"."tracked_keywords"("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "seo_metrics_tenant_market_idx"
    ON "seo_metrics" ("tenant_domain", "market_id", "captured_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_metrics_keyword_idx"
    ON "seo_metrics" ("keyword_id", "captured_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_metrics_entity_idx"
    ON "seo_metrics" ("entity_id", "captured_at");
--> statement-breakpoint

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "seo_refresh_interval_days" integer DEFAULT 7;
