-- Backfill overrideImageUrl for posts that have overrideBrandAssetId set but overrideImageUrl null.
-- This fixes posts generated before the fix that populates overrideImageUrl at generation time.
UPDATE generated_posts
SET override_image_url = COALESCE(ba.file_url, ba.url)
FROM brand_assets ba
WHERE generated_posts.override_brand_asset_id = ba.id
  AND generated_posts.override_image_url IS NULL
  AND generated_posts.override_brand_asset_id IS NOT NULL;
