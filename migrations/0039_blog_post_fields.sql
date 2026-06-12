ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS subtitle text;
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS overview text;
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS post_tags text;
