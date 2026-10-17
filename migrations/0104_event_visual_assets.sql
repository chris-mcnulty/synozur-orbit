-- backfill:always-apply
-- Register historical event files in the shared library without moving bytes or
-- changing any image IDs, generated posts, or historical delivery URLs.
ALTER TABLE conference_images ADD COLUMN IF NOT EXISTS brand_asset_id varchar;
ALTER TABLE conference_backgrounds ADD COLUMN IF NOT EXISTS brand_asset_id varchar;

-- Prefer an existing asset for the exact file within the same tenant/market.
UPDATE conference_images i SET brand_asset_id = (
  SELECT a.id FROM brand_assets a JOIN conferences c ON c.id = i.conference_id
  WHERE a.tenant_domain = i.tenant_domain AND a.market_id IS NOT DISTINCT FROM c.market_id
    AND a.file_url = i.file_url ORDER BY (a.status = 'active') DESC, a.created_at, a.id LIMIT 1
) WHERE i.brand_asset_id IS NULL AND i.file_url IS NOT NULL;
UPDATE conference_backgrounds i SET brand_asset_id = (
  SELECT a.id FROM brand_assets a JOIN conferences c ON c.id = i.conference_id
  WHERE a.tenant_domain = i.tenant_domain AND a.market_id IS NOT DISTINCT FROM c.market_id
    AND a.file_url = i.file_url ORDER BY (a.status = 'active') DESC, a.created_at, a.id LIMIT 1
) WHERE i.brand_asset_id IS NULL;

-- Deterministic IDs make the insert/link steps safe to repeat.
INSERT INTO brand_assets (id, tenant_domain, market_id, name, description, file_url,
  file_type, file_size, asset_type, status, created_by, created_at, updated_at)
SELECT 'event-image:' || i.id, i.tenant_domain, c.market_id,
  COALESCE(NULLIF(i.name, ''), c.name || ' — ' || i.role || ' image'),
  'Event image for ' || c.name, i.file_url, COALESCE(i.file_type, 'image/png'),
  i.file_size, 'image', 'active', i.created_by, i.created_at, i.updated_at
FROM conference_images i JOIN conferences c ON c.id = i.conference_id
WHERE i.brand_asset_id IS NULL AND i.file_url IS NOT NULL
ON CONFLICT (id) DO NOTHING;
UPDATE conference_images SET brand_asset_id = 'event-image:' || id
WHERE brand_asset_id IS NULL AND file_url IS NOT NULL;

-- A background may reuse an image that was just registered above.
UPDATE conference_backgrounds i SET brand_asset_id = (
  SELECT a.id FROM brand_assets a JOIN conferences c ON c.id = i.conference_id
  WHERE a.tenant_domain = i.tenant_domain AND a.market_id IS NOT DISTINCT FROM c.market_id
    AND a.file_url = i.file_url ORDER BY (a.status = 'active') DESC, a.created_at, a.id LIMIT 1
) WHERE i.brand_asset_id IS NULL;
INSERT INTO brand_assets (id, tenant_domain, market_id, name, description, file_url,
  file_type, file_size, asset_type, status, created_by, created_at)
SELECT 'event-background:' || i.id, i.tenant_domain, c.market_id,
  COALESCE(NULLIF(i.name, ''), c.name || ' — background'),
  'Event background for ' || c.name, i.file_url, COALESCE(i.file_type, 'image/png'),
  i.file_size, 'image', 'active', c.created_by, i.created_at
FROM conference_backgrounds i JOIN conferences c ON c.id = i.conference_id
WHERE i.brand_asset_id IS NULL
ON CONFLICT (id) DO NOTHING;
UPDATE conference_backgrounds SET brand_asset_id = 'event-background:' || id
WHERE brand_asset_id IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conference_images_brand_asset_fk' AND conrelid = 'conference_images'::regclass) THEN
    ALTER TABLE conference_images ADD CONSTRAINT conference_images_brand_asset_fk
      FOREIGN KEY (brand_asset_id) REFERENCES brand_assets(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conference_backgrounds_brand_asset_fk' AND conrelid = 'conference_backgrounds'::regclass) THEN
    ALTER TABLE conference_backgrounds ADD CONSTRAINT conference_backgrounds_brand_asset_fk
      FOREIGN KEY (brand_asset_id) REFERENCES brand_assets(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS conference_images_brand_asset_idx ON conference_images(brand_asset_id);
CREATE INDEX IF NOT EXISTS conference_backgrounds_brand_asset_idx ON conference_backgrounds(brand_asset_id);
