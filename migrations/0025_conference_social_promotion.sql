-- Conference Social Promotion.
-- Mirrors the schema additions in shared/schema.ts: a `conferences` container
-- with a promotion window + cadence, `conference_sessions` (one per delivered
-- session), and a dedicated `conference_images` space (kept out of the brand
-- library so it never clutters it, archivable after the event). The actual
-- posts reuse `generated_posts` via new conference linkage columns so they flow
-- through the existing scheduling/calendar/publishing machinery.

CREATE TABLE IF NOT EXISTS "conferences" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "name" text NOT NULL,
    "description" text,
    "location" text,
    "website" text,
    "event_hashtag" text,
    "start_date" timestamp,
    "end_date" timestamp,
    "promo_start_date" timestamp,
    "promo_end_date" timestamp,
    "posts_per_day" integer NOT NULL DEFAULT 2,
    "include_saturday" boolean NOT NULL DEFAULT false,
    "include_sunday" boolean NOT NULL DEFAULT false,
    "anchor_post_count" integer NOT NULL DEFAULT 2,
    "variants_per_post" integer NOT NULL DEFAULT 3,
    "thematic_brief" text,
    "always_hashtags" jsonb DEFAULT '[]'::jsonb,
    "product_ids" text[],
    "status" text NOT NULL DEFAULT 'active',
    "archived_at" timestamp,
    "post_generation_job_id" varchar,
    "created_by" varchar NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "conference_sessions" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "conference_id" varchar NOT NULL,
    "tenant_domain" text NOT NULL,
    "title" text NOT NULL,
    "speaker" text,
    "track" text,
    "room" text,
    "session_start" timestamp,
    "session_end" timestamp,
    "abstract" text,
    "url" text,
    "sort_order" integer NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'active',
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "conference_images" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "conference_id" varchar NOT NULL,
    "session_id" varchar,
    "tenant_domain" text NOT NULL,
    "role" text NOT NULL DEFAULT 'session',
    "source" text NOT NULL DEFAULT 'ai_generated',
    "name" text,
    "image_prompt" text,
    "template_asset_id" varchar,
    "file_url" text,
    "file_type" text,
    "file_size" integer,
    "status" text NOT NULL DEFAULT 'active',
    "archived_at" timestamp,
    "created_by" varchar NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Foreign keys (guarded so re-runs against a partially-migrated DB are safe).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conferences_market_id_markets_id_fk') THEN
        ALTER TABLE "conferences" ADD CONSTRAINT "conferences_market_id_markets_id_fk"
            FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conferences_post_generation_job_id_scheduled_job_runs_id_fk') THEN
        ALTER TABLE "conferences" ADD CONSTRAINT "conferences_post_generation_job_id_scheduled_job_runs_id_fk"
            FOREIGN KEY ("post_generation_job_id") REFERENCES "public"."scheduled_job_runs"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conferences_created_by_users_id_fk') THEN
        ALTER TABLE "conferences" ADD CONSTRAINT "conferences_created_by_users_id_fk"
            FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conference_sessions_conference_id_conferences_id_fk') THEN
        ALTER TABLE "conference_sessions" ADD CONSTRAINT "conference_sessions_conference_id_conferences_id_fk"
            FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conference_images_conference_id_conferences_id_fk') THEN
        ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_conference_id_conferences_id_fk"
            FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conference_images_session_id_conference_sessions_id_fk') THEN
        ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_session_id_conference_sessions_id_fk"
            FOREIGN KEY ("session_id") REFERENCES "public"."conference_sessions"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conference_images_template_asset_id_brand_assets_id_fk') THEN
        ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_template_asset_id_brand_assets_id_fk"
            FOREIGN KEY ("template_asset_id") REFERENCES "public"."brand_assets"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conference_images_created_by_users_id_fk') THEN
        ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_created_by_users_id_fk"
            FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
    END IF;
END $$;
--> statement-breakpoint

-- Enforce 1:1 — at most one image per session.
CREATE UNIQUE INDEX IF NOT EXISTS "conference_images_session_unique"
    ON "conference_images" ("session_id");
--> statement-breakpoint

-- Conference linkage on generated_posts. All nullable/defaulted so the backfill
-- is a no-op for existing campaign + standalone posts.
ALTER TABLE "generated_posts" ADD COLUMN IF NOT EXISTS "conference_id" varchar;
--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN IF NOT EXISTS "conference_session_id" varchar;
--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN IF NOT EXISTS "conference_image_id" varchar;
--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN IF NOT EXISTS "post_role" text;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_posts_conference_id_conferences_id_fk') THEN
        ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_conference_id_conferences_id_fk"
            FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_posts_conference_session_id_conference_sessions_id_fk') THEN
        ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_conference_session_id_conference_sessions_id_fk"
            FOREIGN KEY ("conference_session_id") REFERENCES "public"."conference_sessions"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_posts_conference_image_id_conference_images_id_fk') THEN
        ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_conference_image_id_conference_images_id_fk"
            FOREIGN KEY ("conference_image_id") REFERENCES "public"."conference_images"("id") ON DELETE SET NULL;
    END IF;
END $$;
