-- Global (platform-wide) social OAuth credentials.
--
-- Synozur owns ONE OAuth app per social platform (the Buffer/Hootsuite model):
-- every tenant connects accounts one-click and never registers their own app.
-- These credentials are managed by a Global Admin in the UI and stored
-- encrypted at rest. This replaces the retired per-tenant "bring your own app"
-- model for X / Twitter, Facebook, and Instagram (Instagram rides on the same
-- Meta app as Facebook). LinkedIn continues to use its own shared Synozur app.
--
-- Singleton per platform: the unique platform column enforces one row each.
-- direct_publish_enabled is the per-platform safety switch — posting stays OFF
-- until the shared app clears platform app review, then a Global Admin flips it.

CREATE TABLE IF NOT EXISTS "global_platform_credentials" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "platform" text NOT NULL,
    "encrypted_client_id" text NOT NULL,
    "encrypted_client_secret" text,
    "notes" text,
    "direct_publish_enabled" boolean NOT NULL DEFAULT false,
    "updated_by" varchar,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'global_platform_credentials_updated_by_users_id_fk'
    ) THEN
        ALTER TABLE "global_platform_credentials"
            ADD CONSTRAINT "global_platform_credentials_updated_by_users_id_fk"
            FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");
    END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "global_platform_credentials_platform_idx"
    ON "global_platform_credentials" ("platform");
