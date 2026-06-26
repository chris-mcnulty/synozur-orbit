ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS asset_date timestamp;--> statement-breakpoint
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS is_external boolean DEFAULT false NOT NULL;
