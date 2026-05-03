-- Task #117: Push Vega exports straight to the Vega Launchpad
-- Adds tenant-level Vega Launchpad credentials and per-plan push history.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "vega_launchpad_url" text,
  ADD COLUMN IF NOT EXISTS "vega_launchpad_api_key" text,
  ADD COLUMN IF NOT EXISTS "vega_launchpad_workspace_id" text,
  ADD COLUMN IF NOT EXISTS "vega_launchpad_connected_at" timestamp;
--> statement-breakpoint

ALTER TABLE "marketing_plans"
  ADD COLUMN IF NOT EXISTS "vega_last_push_at" timestamp,
  ADD COLUMN IF NOT EXISTS "vega_last_push_status" text,
  ADD COLUMN IF NOT EXISTS "vega_last_push_error" text,
  ADD COLUMN IF NOT EXISTS "vega_last_push_bundle_id" text,
  ADD COLUMN IF NOT EXISTS "vega_last_pushed_by" varchar;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_plans_vega_last_pushed_by_users_id_fk') THEN
    ALTER TABLE "marketing_plans"
      ADD CONSTRAINT "marketing_plans_vega_last_pushed_by_users_id_fk"
      FOREIGN KEY ("vega_last_pushed_by") REFERENCES "public"."users"("id") ON DELETE set null;
  END IF;
END $$;
