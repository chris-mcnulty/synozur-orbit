ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "publishing_paused" boolean NOT NULL DEFAULT false;
