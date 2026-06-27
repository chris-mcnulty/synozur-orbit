ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS website_excerpt text;
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS website_author_id text;
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS website_category_ids text[];
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS website_tag_ids text[];
