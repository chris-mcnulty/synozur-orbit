ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS source_brief_id varchar REFERENCES content_briefs(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_content_assets_source_brief ON content_assets(source_brief_id);--> statement-breakpoint
UPDATE content_assets ca SET source_brief_id = cb.id FROM content_briefs cb WHERE cb.content_asset_id = ca.id AND ca.source_brief_id IS NULL;
