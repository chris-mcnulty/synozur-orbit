-- Task #103: Collaboration features
-- New tables for threaded comments, @mentions, shared annotations.
-- New column for action item assignments on feature_recommendations.
-- Also adds the previously missing tenants.seo_refresh_interval_days column
-- (declared in shared/schema.ts but not migrated).

CREATE TABLE IF NOT EXISTS "collaboration_threads" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "target_kind" text NOT NULL,
    "target_id" text NOT NULL,
    "created_by" varchar,
    "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collaboration_threads_market_id_markets_id_fk') THEN
        ALTER TABLE "collaboration_threads"
            ADD CONSTRAINT "collaboration_threads_market_id_markets_id_fk"
            FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collaboration_threads_created_by_users_id_fk') THEN
        ALTER TABLE "collaboration_threads"
            ADD CONSTRAINT "collaboration_threads_created_by_users_id_fk"
            FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "collab_threads_target_idx"
    ON "collaboration_threads" ("tenant_domain", "target_kind", "target_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "collaboration_comments" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "thread_id" varchar NOT NULL,
    "tenant_domain" text NOT NULL,
    "author_user_id" varchar NOT NULL,
    "body" text NOT NULL,
    "mentions" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "edited_at" timestamp,
    "deleted_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collaboration_comments_thread_id_collaboration_threads_id_fk') THEN
        ALTER TABLE "collaboration_comments"
            ADD CONSTRAINT "collaboration_comments_thread_id_collaboration_threads_id_fk"
            FOREIGN KEY ("thread_id") REFERENCES "public"."collaboration_threads"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collaboration_comments_author_user_id_users_id_fk') THEN
        ALTER TABLE "collaboration_comments"
            ADD CONSTRAINT "collaboration_comments_author_user_id_users_id_fk"
            FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "collab_comments_thread_idx"
    ON "collaboration_comments" ("thread_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collab_comments_tenant_idx"
    ON "collaboration_comments" ("tenant_domain", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "annotations" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain" text NOT NULL,
    "market_id" varchar,
    "target_kind" text NOT NULL,
    "target_id" text NOT NULL,
    "field_path" text,
    "range_start" integer,
    "range_end" integer,
    "selected_text" text,
    "thread_id" varchar NOT NULL,
    "created_by_user_id" varchar NOT NULL,
    "resolved_at" timestamp,
    "resolved_by_user_id" varchar,
    "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'annotations_market_id_markets_id_fk') THEN
        ALTER TABLE "annotations"
            ADD CONSTRAINT "annotations_market_id_markets_id_fk"
            FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'annotations_thread_id_collaboration_threads_id_fk') THEN
        ALTER TABLE "annotations"
            ADD CONSTRAINT "annotations_thread_id_collaboration_threads_id_fk"
            FOREIGN KEY ("thread_id") REFERENCES "public"."collaboration_threads"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'annotations_created_by_user_id_users_id_fk') THEN
        ALTER TABLE "annotations"
            ADD CONSTRAINT "annotations_created_by_user_id_users_id_fk"
            FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'annotations_resolved_by_user_id_users_id_fk') THEN
        ALTER TABLE "annotations"
            ADD CONSTRAINT "annotations_resolved_by_user_id_users_id_fk"
            FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "annotations_target_idx"
    ON "annotations" ("tenant_domain", "target_kind", "target_id");
--> statement-breakpoint

ALTER TABLE "feature_recommendations"
    ADD COLUMN IF NOT EXISTS "assigned_to_user_id" varchar;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feature_recommendations_assigned_to_user_id_users_id_fk') THEN
        ALTER TABLE "feature_recommendations"
            ADD CONSTRAINT "feature_recommendations_assigned_to_user_id_users_id_fk"
            FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "feature_rec_assigned_to_idx"
    ON "feature_recommendations" ("assigned_to_user_id");
--> statement-breakpoint

ALTER TABLE "tenants"
    ADD COLUMN IF NOT EXISTS "seo_refresh_interval_days" integer DEFAULT 7;
