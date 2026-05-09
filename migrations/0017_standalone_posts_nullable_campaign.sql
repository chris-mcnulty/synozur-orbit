-- Phase 3: standalone posts. Drop NOT NULL on generated_posts.campaign_id so
-- composer-created posts can exist without a campaign. The publish worker
-- now treats campaign_id IS NULL as auto-publishable (status='approved' and
-- scheduledDate <= now() is sufficient).

ALTER TABLE "generated_posts"
    ALTER COLUMN "campaign_id" DROP NOT NULL;
--> statement-breakpoint

-- Helpful index for the calendar view query.
CREATE INDEX IF NOT EXISTS "generated_posts_tenant_scheduled_idx"
    ON "generated_posts" ("tenant_domain", "scheduled_date");
