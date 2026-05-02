-- Customer feedback intake & feature voting (Task #69)

-- Add public feedback fields to products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "public_feedback_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "public_feedback_token" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_public_feedback_token_idx" ON "products" ("public_feedback_token") WHERE "public_feedback_token" IS NOT NULL;
--> statement-breakpoint

-- Track when a roadmap item came from customer feedback
ALTER TABLE "roadmap_items" ADD COLUMN IF NOT EXISTS "from_feedback" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Customer feedback table
CREATE TABLE IF NOT EXISTS "product_feedback" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "product_id" varchar NOT NULL,
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "title" text NOT NULL,
    "description" text,
    "category" text,
    "status" text NOT NULL DEFAULT 'new',
    "source" text NOT NULL DEFAULT 'internal',
    "submitter_user_id" varchar,
    "submitter_email" text,
    "submitter_name" text,
    "submitter_ip" text,
    "promoted_feature_id" varchar,
    "vote_count" integer NOT NULL DEFAULT 0,
    "embedding" jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_product_id_products_id_fk') THEN
        ALTER TABLE "product_feedback"
            ADD CONSTRAINT "product_feedback_product_id_products_id_fk"
            FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_market_id_markets_id_fk') THEN
        ALTER TABLE "product_feedback"
            ADD CONSTRAINT "product_feedback_market_id_markets_id_fk"
            FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_submitter_user_id_users_id_fk') THEN
        ALTER TABLE "product_feedback"
            ADD CONSTRAINT "product_feedback_submitter_user_id_users_id_fk"
            FOREIGN KEY ("submitter_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_promoted_feature_id_product_features_id_fk') THEN
        ALTER TABLE "product_feedback"
            ADD CONSTRAINT "product_feedback_promoted_feature_id_product_features_id_fk"
            FOREIGN KEY ("promoted_feature_id") REFERENCES "public"."product_features"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_feedback_product_idx" ON "product_feedback" ("product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_feedback_tenant_idx" ON "product_feedback" ("tenant_domain");
--> statement-breakpoint

-- Votes table
CREATE TABLE IF NOT EXISTS "product_feedback_votes" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "feedback_id" varchar NOT NULL,
    "product_id" varchar NOT NULL,
    "tenant_domain" text NOT NULL,
    "voter_user_id" varchar,
    "voter_email" text,
    "voter_ip" text,
    "voter_key" text NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_votes_feedback_id_product_feedback_id_fk') THEN
        ALTER TABLE "product_feedback_votes"
            ADD CONSTRAINT "product_feedback_votes_feedback_id_product_feedback_id_fk"
            FOREIGN KEY ("feedback_id") REFERENCES "public"."product_feedback"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_votes_product_id_products_id_fk') THEN
        ALTER TABLE "product_feedback_votes"
            ADD CONSTRAINT "product_feedback_votes_product_id_products_id_fk"
            FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_votes_voter_user_id_users_id_fk') THEN
        ALTER TABLE "product_feedback_votes"
            ADD CONSTRAINT "product_feedback_votes_voter_user_id_users_id_fk"
            FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_feedback_votes_unique_voter" ON "product_feedback_votes" ("feedback_id", "voter_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_feedback_votes_product_idx" ON "product_feedback_votes" ("product_id");
