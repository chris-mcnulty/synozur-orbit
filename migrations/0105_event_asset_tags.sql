-- backfill:always-apply
-- Event is a persisted topic tag, not just a transient UI association badge.
-- Merge into existing metadata; do not replace seasons, locations, or topics.
UPDATE brand_assets a SET tags = jsonb_set(COALESCE(a.tags, '{}'::jsonb), '{topics}',
  COALESCE((SELECT jsonb_agg(topic) FROM jsonb_array_elements_text(
    COALESCE(a.tags->'topics', '[]'::jsonb)) AS topic
    WHERE lower(topic) <> 'event'), '[]'::jsonb) || '["Event"]'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM conference_images i JOIN conferences c ON c.id = i.conference_id
  WHERE i.brand_asset_id = a.id AND i.tenant_domain = a.tenant_domain
    AND c.tenant_domain = a.tenant_domain AND c.market_id IS NOT DISTINCT FROM a.market_id
) OR EXISTS (
  SELECT 1 FROM conference_backgrounds b JOIN conferences c ON c.id = b.conference_id
  WHERE b.brand_asset_id = a.id AND b.tenant_domain = a.tenant_domain
    AND c.tenant_domain = a.tenant_domain AND c.market_id IS NOT DISTINCT FROM a.market_id
);
