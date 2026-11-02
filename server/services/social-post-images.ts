import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { brandAssets, campaignAssets, contentAssets } from "@shared/schema";
import { resolveBrandAssetUrl } from "./brand-asset-url";

export interface PostImageInput {
  tenantDomain: string;
  campaignId?: string | null;
  sourceAssetId?: string | null;
  sourceUrl?: string | null;
  overrideImageUrl?: string | null;
  overrideBrandAssetId?: string | null;
  leadImageUrl?: string | null;
  status?: string;
  publishedAt?: unknown;
}

interface SourceImage {
  id: string;
  campaignId: string | null;
  url: string | null;
  leadImageUrl: string | null;
  fileUrl: string | null;
  fileType: string | null;
}

export function selectPostImage(
  post: PostImageInput,
  sources: SourceImage[],
  brands: Map<string, string | null>,
): string | null {
  if (post.overrideImageUrl) return post.overrideImageUrl;
  // Historical deliveries must not acquire an image retroactively when the
  // source article is updated. Successful sends snapshot the attempted image.
  if (post.publishedAt || ["published", "exported"].includes(post.status || "")) return null;
  if (post.overrideBrandAssetId) return brands.get(post.overrideBrandAssetId) || null;
  const sourceImage = (source?: SourceImage) => source?.leadImageUrl ||
    (source?.fileType?.startsWith("image/") ? source.fileUrl : null) || null;
  if (post.sourceAssetId) {
    const image = sourceImage(sources.find(s => s.id === post.sourceAssetId));
    if (image) return image;
  }
  if (post.sourceUrl) {
    const matches = sources.filter(s => s.url === post.sourceUrl);
    const image = sourceImage(matches.find(s => s.campaignId === post.campaignId)) ||
      sourceImage(matches[0]);
    if (image) return image;
  }
  if (post.leadImageUrl) return post.leadImageUrl;
  // Matches the campaign viewer's legacy default for posts without a selected
  // graphic. Sources arrive in the campaign's explicit sort order.
  return sourceImage(sources.find(s => s.campaignId && s.campaignId === post.campaignId));
}

/** Batch and tenant-scope all lookups, rather than querying once per queue row. */
export async function resolveSocialPostImages<T extends PostImageInput>(
  posts: T[],
): Promise<Array<T & { leadImageUrl: string | null }>> {
  const images = new Map<T, string | null>();
  for (const tenant of new Set(posts.map(p => p.tenantDomain))) {
    const scoped = posts.filter(p => p.tenantDomain === tenant);
    const pending = scoped.filter(p => !p.overrideImageUrl && !p.publishedAt &&
      !["published", "exported"].includes(p.status || ""));
    const brandIds = [...new Set(pending.flatMap(p => p.overrideBrandAssetId ? [p.overrideBrandAssetId] : []))];
    const brands = new Map<string, string | null>();
    if (brandIds.length) {
      const rows = await db.select().from(brandAssets).where(and(
        eq(brandAssets.tenantDomain, tenant), inArray(brandAssets.id, brandIds),
      ));
      for (const row of rows) brands.set(row.id, resolveBrandAssetUrl(row));
    }
    const sourceIds = [...new Set(pending.flatMap(p => p.sourceAssetId ? [p.sourceAssetId] : []))];
    const urls = [...new Set(pending.flatMap(p => p.sourceUrl ? [p.sourceUrl] : []))];
    const campaignIds = [...new Set(pending.flatMap(p => p.campaignId ? [p.campaignId] : []))];
    let sources: SourceImage[] = [];
    if (sourceIds.length || urls.length || campaignIds.length) {
      sources = await db.select({
        id: contentAssets.id, url: contentAssets.url,
        leadImageUrl: contentAssets.leadImageUrl, fileUrl: contentAssets.fileUrl,
        fileType: contentAssets.fileType, campaignId: campaignAssets.campaignId,
      }).from(contentAssets)
        .leftJoin(campaignAssets, and(
          eq(campaignAssets.assetId, contentAssets.id),
          // An empty list must not join every campaign that uses this asset.
          inArray(campaignAssets.campaignId, campaignIds),
        ))
        .where(and(eq(contentAssets.tenantDomain, tenant), or(
          sourceIds.length ? inArray(contentAssets.id, sourceIds) : undefined,
          urls.length ? inArray(contentAssets.url, urls) : undefined,
          campaignIds.length ? inArray(campaignAssets.campaignId, campaignIds) : undefined,
        )))
        .orderBy(asc(campaignAssets.sortOrder), asc(contentAssets.id));
    }
    for (const post of scoped) images.set(post, selectPostImage(post, sources, brands));
  }
  return posts.map(post => ({ ...post, leadImageUrl: images.get(post) ?? null }));
}

/** Publishers require the resolved image as an override, so retrieval failure
 * cannot silently downgrade an image-bearing post to a text-only delivery. */
export async function withPublishImage<T extends PostImageInput>(post: T): Promise<T & { overrideImageUrl: string | null }> {
  const [resolved] = await resolveSocialPostImages([post]);
  if (post.overrideBrandAssetId && !resolved.leadImageUrl) {
    throw new Error("The selected post image is unavailable. Select another image before publishing.");
  }
  return { ...post, overrideImageUrl: resolved.leadImageUrl };
}
