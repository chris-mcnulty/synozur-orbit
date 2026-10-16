-- backfill:always-apply
-- Preserve legacy outputs; new/edited composites explicitly become dirty.
ALTER TABLE conference_images ADD COLUMN IF NOT EXISTS overlay_headline text;
ALTER TABLE conference_images ADD COLUMN IF NOT EXISTS overlay_supporting_text text;
ALTER TABLE conference_images ADD COLUMN IF NOT EXISTS source_image_id varchar;
ALTER TABLE conference_images ADD COLUMN IF NOT EXISTS render_dirty boolean NOT NULL DEFAULT false;
ALTER TABLE conference_images ADD COLUMN IF NOT EXISTS render_error text;
ALTER TABLE conference_images ADD COLUMN IF NOT EXISTS render_revision integer NOT NULL DEFAULT 0;
ALTER TABLE conference_images ADD COLUMN IF NOT EXISTS source_required boolean NOT NULL DEFAULT false;
UPDATE conference_images SET source_required = true WHERE template_asset_id IS NOT NULL OR background_id IS NOT NULL;
