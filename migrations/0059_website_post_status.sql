ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS website_post_status text;--> statement-breakpoint
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS website_scheduled_for timestamp;
