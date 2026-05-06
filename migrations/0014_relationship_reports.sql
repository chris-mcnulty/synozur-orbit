-- Relationship Reports
-- On-demand 12-month engagement plans for any company in a market (defaults
-- to a tracked competitor). Captures recommended posture and quarter-by-
-- quarter actions for engaging, cooperating, selling, competing, speaking
-- with, or steering clear of the target.

CREATE TABLE IF NOT EXISTS "relationship_reports" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "company_profile_id" varchar,
    "competitor_id" varchar,
    "target_name" text NOT NULL,
    "target_url" text,
    "name" text NOT NULL,
    "content" text,
    "saved_prompts" jsonb,
    "status" text NOT NULL DEFAULT 'not_generated',
    "last_generated_at" timestamp,
    "generated_from_data_as_of" timestamp,
    "generated_by" varchar,
    "created_by" varchar,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_reports_market_id_markets_id_fk') THEN
        ALTER TABLE "relationship_reports"
            ADD CONSTRAINT "relationship_reports_market_id_markets_id_fk"
            FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_reports_company_profile_id_company_profiles_id_fk') THEN
        ALTER TABLE "relationship_reports"
            ADD CONSTRAINT "relationship_reports_company_profile_id_company_profiles_id_fk"
            FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_reports_competitor_id_competitors_id_fk') THEN
        ALTER TABLE "relationship_reports"
            ADD CONSTRAINT "relationship_reports_competitor_id_competitors_id_fk"
            FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_reports_generated_by_users_id_fk') THEN
        ALTER TABLE "relationship_reports"
            ADD CONSTRAINT "relationship_reports_generated_by_users_id_fk"
            FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationship_reports_created_by_users_id_fk') THEN
        ALTER TABLE "relationship_reports"
            ADD CONSTRAINT "relationship_reports_created_by_users_id_fk"
            FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "relationship_reports_tenant_market_idx"
    ON "relationship_reports" ("tenant_domain", "market_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationship_reports_competitor_idx"
    ON "relationship_reports" ("competitor_id");
