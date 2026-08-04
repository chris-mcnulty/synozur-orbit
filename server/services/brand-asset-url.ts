/**
 * Resolves the display URL for a brand asset, preferring fileUrl over url.
 *
 * This mirrors the COALESCE order in the backfill migration SQL:
 *   SET override_image_url = COALESCE(ba.file_url, ba.url)
 *
 * Returns null when neither column is populated. Callers MUST NOT set
 * overrideBrandAssetId on a generated_posts row without a resolved URL —
 * doing so creates the exact broken state this function was introduced to
 * prevent (task: backfill migration 0070).
 */
export function resolveBrandAssetUrl(asset: {
  fileUrl?: string | null;
  url?: string | null;
}): string | null {
  return asset.fileUrl || asset.url || null;
}
