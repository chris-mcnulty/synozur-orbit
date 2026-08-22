-- backfill:always-apply
-- Durable, expiring ownership for social publish attempts. All columns are
-- nullable so existing posts remain immediately eligible.
ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS publish_claim_token varchar;
--> statement-breakpoint
ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS publish_claim_owner text;
--> statement-breakpoint
ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS publish_claim_expires_at timestamp;