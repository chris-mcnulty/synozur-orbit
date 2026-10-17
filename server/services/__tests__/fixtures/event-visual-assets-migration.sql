-- Run in one development executeSql call with the migration substituted at
-- each marker. All fixture tables are temporary and the transaction rolls back.
BEGIN;
CREATE TEMP TABLE conferences (id varchar PRIMARY KEY, tenant_domain text, market_id varchar, name text, created_by varchar);
CREATE TEMP TABLE brand_assets (
  id varchar PRIMARY KEY, tenant_domain text, market_id varchar, name text, description text,
  file_url text, file_type text, file_size integer, asset_type text, status text, tags jsonb,
  created_by varchar, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TEMP TABLE conference_images (
  id varchar PRIMARY KEY, conference_id varchar, tenant_domain text, name text, role text,
  file_url text, file_type text, file_size integer, status text,
  created_by varchar, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TEMP TABLE conference_backgrounds (
  id varchar PRIMARY KEY, conference_id varchar, tenant_domain text, name text,
  file_url text, file_type text, file_size integer, created_at timestamptz DEFAULT now()
);
CREATE TEMP TABLE generated_posts (id varchar PRIMARY KEY, conference_image_id varchar, lead_image_url text);
INSERT INTO conferences VALUES ('event-a', 'fixture.example', 'market-a', 'Event A', 'editor'),
  ('event-b', 'fixture.example', 'market-b', 'Event B', 'editor'),
  ('event-wide', 'fixture.example', NULL, 'Tenant-wide Event', 'editor');
INSERT INTO brand_assets (id, tenant_domain, market_id, file_url, status) VALUES
  ('library-a', 'fixture.example', 'market-a', '/shared.png', 'active'),
  ('foreign-market', 'fixture.example', 'market-b', '/shared.png', 'active'),
  ('archived-a', 'fixture.example', 'market-a', '/shared.png', 'archived');
UPDATE brand_assets SET tags = '{"topics":["Webinar","event"],"seasons":["Autumn"],"locations":["Seattle"]}' WHERE id = 'library-a';
INSERT INTO conference_images (id, conference_id, tenant_domain, role, file_url, status, created_by) VALUES
  ('existing', 'event-a', 'fixture.example', 'anchor', '/shared.png', 'active', 'editor'),
  ('new', 'event-a', 'fixture.example', 'anchor', '/original.png', 'active', 'editor'),
  ('archived', 'event-a', 'fixture.example', 'session', '/retained.png', 'archived', 'editor'),
  ('wide', 'event-wide', 'fixture.example', 'anchor', '/shared.png', 'active', 'editor');
INSERT INTO conference_backgrounds (id, conference_id, tenant_domain, file_url) VALUES
  ('background', 'event-a', 'fixture.example', '/original.png');
INSERT INTO generated_posts VALUES ('posted', 'new', '/original.png');

-- APPLY_EVENT_VISUAL_ASSETS_MIGRATION
-- APPLY_EVENT_ASSET_TAGS

CREATE TEMP TABLE first_asset_links AS SELECT id, brand_asset_id FROM conference_images;

-- APPLY_EVENT_VISUAL_ASSETS_MIGRATION
-- APPLY_EVENT_ASSET_TAGS

DO $$ BEGIN
  IF (SELECT count(*) FROM brand_assets) <> 6 THEN RAISE EXCEPTION 'Registration duplicated or lost assets'; END IF;
  IF (SELECT brand_asset_id FROM conference_images WHERE id = 'existing') <> 'library-a'
    THEN RAISE EXCEPTION 'Existing active library asset was not reused'; END IF;
  IF EXISTS (SELECT 1 FROM conference_images i JOIN conferences c ON c.id = i.conference_id
    JOIN brand_assets a ON a.id = i.brand_asset_id
    WHERE a.market_id IS DISTINCT FROM c.market_id OR a.tenant_domain <> i.tenant_domain)
    THEN RAISE EXCEPTION 'Market or tenant isolation violated'; END IF;
  IF (SELECT brand_asset_id FROM conference_backgrounds WHERE id = 'background') <>
    (SELECT brand_asset_id FROM conference_images WHERE id = 'new')
    THEN RAISE EXCEPTION 'Shared background source was duplicated'; END IF;
  IF EXISTS (SELECT 1 FROM conference_images i JOIN first_asset_links f USING (id)
    WHERE i.brand_asset_id IS DISTINCT FROM f.brand_asset_id)
    THEN RAISE EXCEPTION 'Repeated migration changed canonical identity'; END IF;
  IF NOT EXISTS (SELECT 1 FROM generated_posts WHERE id = 'posted' AND conference_image_id = 'new' AND lead_image_url = '/original.png')
    THEN RAISE EXCEPTION 'Historical post reference changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM conference_images WHERE id = 'archived' AND status = 'archived' AND file_url = '/retained.png')
    THEN RAISE EXCEPTION 'Archived selection or existing URL changed'; END IF;
  IF EXISTS (SELECT 1 FROM conference_images i JOIN brand_assets a ON a.id = i.brand_asset_id
    WHERE NOT (a.tags->'topics' @> '["Event"]'::jsonb))
    THEN RAISE EXCEPTION 'Event tag is not persisted on associated images'; END IF;
  IF NOT EXISTS (SELECT 1 FROM brand_assets WHERE id = 'library-a'
    AND tags = '{"topics":["Webinar","Event"],"seasons":["Autumn"],"locations":["Seattle"]}'::jsonb)
    THEN RAISE EXCEPTION 'Existing topics, seasons, or locations were not preserved'; END IF;
  IF EXISTS (SELECT 1 FROM brand_assets WHERE id = 'foreign-market' AND tags IS NOT NULL)
    THEN RAISE EXCEPTION 'An unrelated market asset was tagged'; END IF;
END $$;
SELECT 'event visual assets migration assertions passed, including repeat application' AS verification;
ROLLBACK;
