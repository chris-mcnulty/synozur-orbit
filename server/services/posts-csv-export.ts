import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { socialAccounts, brandAssets, contentAssets } from "@shared/schema";
import {
  ObjectStorageService,
  objectStorageClient,
} from "../replit_integrations/object_storage/objectStorage";

/**
 * Shared CSV renderer for generated social posts. Used by both the campaign
 * export (`/api/campaigns/:id/export-csv`) and the Event Promotion / conference
 * export (`/api/conferences/:id/export-csv`) so both produce byte-identical
 * output across the supported scheduler formats:
 *   - generic       Generic copy/paste sheet
 *   - socialpilot   SocialPilot bulk upload (no header row)  [default]
 *   - hootsuite     Hootsuite bulk composer
 *   - sproutsocial  Sprout Social bulk publishing
 *
 * Callers pass already date-filtered posts (e.g. excludeUndated handling).
 * Sorting, collision staggering, and account/asset resolution happen here.
 */
export interface BuildPostsCsvOptions {
  posts: any[];
  tenantDomain: string;
  format: string;
  tzOffset: number;
  /**
   * Optional account ids whose platform→accountId mapping should be used as a
   * fallback when a post has no `socialAccountId` (campaign-linked accounts).
   * Order matters: the first account per platform wins.
   */
  fallbackAccountIds?: string[];
  /**
   * Absolute base URL (e.g. `https://orbit.example.com`, no trailing slash) used
   * to turn relative image paths like `/public-objects/...` into absolute URLs.
   * External schedulers can't fetch a relative path, so callers should pass the
   * host the export request came in on. When omitted, relative paths are left
   * as-is.
   */
  imageBaseUrl?: string;
}

/**
 * SocialPilot's destination ID is unrelated to the OAuth provider identity.
 * Existing accounts fall back to their historic accountId until an operator
 * explicitly saves a dedicated SocialPilot ID.
 */
export function resolveSocialPilotAccountId(
  account: { socialPilotAccountId?: string | null; accountId?: string | null } | null | undefined,
): string {
  const socialPilotAccountId = account?.socialPilotAccountId?.trim();
  return socialPilotAccountId || account?.accountId || "";
}

/**
 * Returns true when a post should be published by Orbit's native publisher
 * rather than exported to an external scheduler CSV.
 *
 * Classification rules (in priority order):
 *   1. deliveryMode="csv"  → always CSV (explicit override), never Orbit-direct
 *   2. deliveryMode=null + campaign-account link has autoPublish=true → Orbit-direct
 *   3. deliveryMode=null + autoPublish=false (or no link found)       → CSV eligible
 *
 * publishingPaused is intentionally NOT checked here. It is a temporary worker
 * gate that prevents Orbit from sending the post *right now* — it does not
 * change who owns the post. Exporting paused auto-publish posts to CSV would
 * cause duplicate delivery when publishing is resumed.
 *
 * @param post            A generatedPost row (needs .deliveryMode, .socialAccountId)
 * @param autoPublishMap  socialAccountId → campaign autoPublish flag
 */
export function isOrbitDirectPost(
  post: { deliveryMode?: string | null; socialAccountId?: string | null },
  autoPublishMap: Map<string, boolean>,
): boolean {
  if (post.deliveryMode === "csv") return false;
  if (!post.deliveryMode && post.socialAccountId) {
    const autoPublish = autoPublishMap.get(post.socialAccountId);
    if (autoPublish === true) return true;
  }
  return false;
}

export async function buildPostsCsv(opts: BuildPostsCsvOptions): Promise<string> {
  const { posts, tenantDomain, tzOffset } = opts;
  const format = (opts.format || "socialpilot").toLowerCase();
  const fallbackAccountIds = opts.fallbackAccountIds ?? [];

  const allAccountIds = Array.from(new Set([
    ...posts.map(p => p.socialAccountId).filter(Boolean),
    ...fallbackAccountIds,
  ])) as string[];
  const accountMap = new Map<string, any>();
  if (allAccountIds.length) {
    const accts = await db.select().from(socialAccounts).where(inArray(socialAccounts.id, allAccountIds));
    for (const a of accts) accountMap.set(a.id, a);
  }
  const platformAccountFallback = new Map<string, string>();
  const platformSocialPilotFallback = new Map<string, string>();
  for (const id of fallbackAccountIds) {
    const acct = accountMap.get(id);
    if (acct?.accountId && acct.platform && !platformAccountFallback.has(acct.platform)) {
      platformAccountFallback.set(acct.platform, acct.accountId);
    }
    const socialPilotAccountId = resolveSocialPilotAccountId(acct);
    if (socialPilotAccountId && acct?.platform && !platformSocialPilotFallback.has(acct.platform)) {
      platformSocialPilotFallback.set(acct.platform, socialPilotAccountId);
    }
  }

  const brandAssetIds = Array.from(new Set(posts.map(p => p.overrideBrandAssetId).filter(Boolean))) as string[];
  const brandMap = new Map<string, any>();
  if (brandAssetIds.length) {
    // Tenant-scope the lookup so a post referencing another tenant's asset id
    // (defense-in-depth alongside the write-path ownership check) can never
    // resolve to a foreign asset URL in the export.
    const assets = await db.select().from(brandAssets).where(and(
      eq(brandAssets.tenantDomain, tenantDomain),
      inArray(brandAssets.id, brandAssetIds),
    ));
    for (const a of assets) brandMap.set(a.id, a);
  }

  const sourceUrls = Array.from(new Set(posts.map(p => p.sourceUrl).filter(Boolean))) as string[];
  const contentAssetByUrl = new Map<string, any>();
  if (sourceUrls.length) {
    const cas = await db.select().from(contentAssets)
      .where(and(eq(contentAssets.tenantDomain, tenantDomain), inArray(contentAssets.url, sourceUrls)));
    for (const ca of cas) if (ca.url) contentAssetByUrl.set(ca.url, ca);
  }

  const sourceAssetIds = Array.from(new Set(posts.map(p => p.sourceAssetId).filter(Boolean))) as string[];
  const contentAssetById = new Map<string, any>();
  if (sourceAssetIds.length) {
    const cas = await db.select().from(contentAssets)
      .where(and(eq(contentAssets.tenantDomain, tenantDomain), inArray(contentAssets.id, sourceAssetIds)));
    for (const ca of cas) contentAssetById.set(ca.id, ca);
  }

  const now = new Date();
  const sortedPosts = [...posts].sort((a, b) => {
    const aDate = a.scheduledDate ? new Date(a.scheduledDate) : null;
    const bDate = b.scheduledDate ? new Date(b.scheduledDate) : null;
    const aEffective = aDate && aDate >= now ? aDate : null;
    const bEffective = bDate && bDate >= now ? bDate : null;
    if (aEffective && bEffective) return aEffective.getTime() - bEffective.getTime();
    if (aEffective && !bEffective) return -1;
    if (!aEffective && bEffective) return 1;
    return 0;
  });

  const COLLISION_STAGGER_MINUTES = 15;
  const slotUsed = new Map<string, Date>();
  for (const post of sortedPosts) {
    if (!post.scheduledDate) continue;
    const sd = new Date(post.scheduledDate);
    if (sd < now) continue;
    const acctId = (() => {
      if (post.socialAccountId) {
        const acct = accountMap.get(post.socialAccountId);
        const accountId = format === "socialpilot"
          ? resolveSocialPilotAccountId(acct)
          : acct?.accountId;
        if (accountId) return accountId;
      }
      const fallback = format === "socialpilot"
        ? platformSocialPilotFallback.get(post.platform)
        : platformAccountFallback.get(post.platform);
      return fallback || post.platform;
    })();
    const key = `${sd.toISOString()}|${acctId}`;
    if (slotUsed.has(key)) {
      let bumped = new Date(slotUsed.get(key)!.getTime() + COLLISION_STAGGER_MINUTES * 60000);
      let bumpKey = `${bumped.toISOString()}|${acctId}`;
      while (slotUsed.has(bumpKey)) {
        bumped = new Date(bumped.getTime() + COLLISION_STAGGER_MINUTES * 60000);
        bumpKey = `${bumped.toISOString()}|${acctId}`;
      }
      (post as any).scheduledDate = bumped;
      slotUsed.set(bumpKey, bumped);
    } else {
      slotUsed.set(key, sd);
    }
  }

  let lines: string[];

  const escCsv = (s: string) => `"${s.replace(/"/g, '""')}"`;

  const toClientTime = (d: Date): Date => {
    const utcMs = d.getTime();
    return new Date(utcMs - tzOffset * 60000);
  };

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmtSocialPilotDate = (d: Date | null | undefined) => {
    if (!d) return "";
    const dt = toClientTime(new Date(d));
    const mon = MONTHS[dt.getUTCMonth()];
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    const yyyy = dt.getUTCFullYear();
    let hh = dt.getUTCHours();
    const min = String(dt.getUTCMinutes()).padStart(2, "0");
    const ampm = hh >= 12 ? "PM" : "AM";
    hh = hh % 12 || 12;
    return `${mon} ${dd}, ${yyyy} ${hh}:${min} ${ampm}`;
  };

  const fmtHootsuiteDate = (d: Date | null | undefined) => {
    if (!d) return { date: "", time: "" };
    const dt = toClientTime(new Date(d));
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    const yyyy = dt.getUTCFullYear();
    const hh = String(dt.getUTCHours()).padStart(2, "0");
    const min = String(dt.getUTCMinutes()).padStart(2, "0");
    return { date: `${mm}/${dd}/${yyyy}`, time: `${hh}:${min}` };
  };

  const fmtSproutDate = (d: Date | null | undefined) => {
    if (!d) return "";
    const dt = toClientTime(new Date(d));
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    const yyyy = dt.getUTCFullYear();
    const hh = String(dt.getUTCHours()).padStart(2, "0");
    const min = String(dt.getUTCMinutes()).padStart(2, "0");
    return `${mm}/${dd}/${yyyy} ${hh}:${min}`;
  };

  // External schedulers cannot use Orbit's authenticated `/objects/...` URLs.
  // Publish those images into the public object area during export, then emit
  // an absolute `/public-objects/...` URL. Already-public and external URLs are
  // left intact apart from absolutizing a relative public path.
  const imageBaseUrl = (opts.imageBaseUrl || "").replace(/\/$/, "");
  const storage = new ObjectStorageService();
  const publicizedImages = new Map<string, Promise<string>>();
  const absolutize = async (url: string): Promise<string> => {
    if (url.startsWith("/public-objects/")) {
      return imageBaseUrl ? `${imageBaseUrl}${url}` : url;
    }
    if (!url.startsWith("/objects/")) return url;
    if (!imageBaseUrl) {
      throw new Error("Cannot export a private image without an absolute application URL");
    }

    let pending = publicizedImages.get(url);
    if (!pending) {
      pending = (async () => {
        const source = await storage.getObjectEntityFile(url);
        const entityPath = url.slice("/objects/".length).replace(/^\/+/, "");
        const publicPath = `social-exports/${entityPath}`;
        const existing = await storage.searchPublicObject(publicPath);
        if (!existing) {
          const publicRoot = storage.getPublicObjectSearchPaths()[0];
          const parts = publicRoot.replace(/^\/+/, "").split("/");
          const bucketName = parts.shift();
          if (!bucketName) throw new Error("Public object storage is not configured");
          const prefix = parts.join("/").replace(/\/+$/, "");
          const destinationName = [prefix, publicPath].filter(Boolean).join("/");
          const [metadata] = await source.getMetadata();
          const [buffer] = await source.download();
          await objectStorageClient.bucket(bucketName).file(destinationName).save(buffer, {
            contentType: metadata.contentType || "application/octet-stream",
            resumable: false,
          });
        }
        const relative = `/public-objects/${publicPath}`;
        return `${imageBaseUrl}${relative}`;
      })();
      publicizedImages.set(url, pending);
    }
    return pending;
  };

  const getPostImageUrl = async (post: any): Promise<string> => {
    if (post.overrideImageUrl) return await absolutize(post.overrideImageUrl);
    if (post.overrideBrandAssetId) {
      const ba = brandMap.get(post.overrideBrandAssetId);
      if (ba?.fileUrl) return await absolutize(ba.fileUrl);
      if (ba?.url) return await absolutize(ba.url);
    }
    if (post.sourceAssetId) {
      const ca = contentAssetById.get(post.sourceAssetId);
      if (ca?.leadImageUrl) return await absolutize(ca.leadImageUrl);
      if (ca?.fileUrl && typeof ca.fileType === "string" && ca.fileType.startsWith("image/")) return await absolutize(ca.fileUrl);
    }
    if (post.sourceUrl) {
      const ca = contentAssetByUrl.get(post.sourceUrl);
      if (ca?.leadImageUrl) return await absolutize(ca.leadImageUrl);
    }
    return "";
  };

  const buildHashtagLine = (hashtags: string[]): string =>
    (hashtags || []).map(h => `#${h}`).join(" ");

  const buildTagsSemicolon = (hashtags: string[]): string =>
    (hashtags || []).join(";");

  const getAccountId = (post: any): string => {
    if (post.socialAccountId) {
      const acct = accountMap.get(post.socialAccountId);
      if (acct?.accountId) return acct.accountId;
    }
    return platformAccountFallback.get(post.platform) || "";
  };

  const getSocialPilotAccountId = (post: any): string => {
    if (post.socialAccountId) {
      const accountId = resolveSocialPilotAccountId(accountMap.get(post.socialAccountId));
      if (accountId) return accountId;
    }
    return platformSocialPilotFallback.get(post.platform) || "";
  };

  const isTwitterPost = (post: any) => (post.platform || "").toLowerCase() === "twitter";
  const TWITTER_CHAR_LIMIT = 280;

  const buildTwitterContent = (baseContent: string, hashtags: string[], sourceUrl?: string): string => {
    const hashtagLine = buildHashtagLine(hashtags);
    const urlPart = sourceUrl || "";
    const parts = [baseContent];
    if (hashtagLine) parts.push(hashtagLine);
    if (urlPart) parts.push(urlPart);
    let full = parts.join("\n");
    if (full.length <= TWITTER_CHAR_LIMIT) return full;

    const suffix = [hashtagLine, urlPart].filter(Boolean).join("\n");
    const suffixLen = suffix ? suffix.length + 1 : 0;
    const maxText = TWITTER_CHAR_LIMIT - suffixLen;
    if (maxText > 20) {
      const truncated = baseContent.substring(0, maxText - 1).replace(/\s+\S*$/, "") + "…";
      return [truncated, ...(suffix ? [suffix] : [])].join("\n");
    }
    return full.substring(0, TWITTER_CHAR_LIMIT - 1) + "…";
  };

  switch (format) {
    case "generic": {
      lines = ["Platform,Account,Content,Hashtags,Image URL,Source URL,Scheduled Date"];
      for (const post of sortedPosts) {
        let sd = post.scheduledDate ? new Date(post.scheduledDate) : null;
        if (sd && sd < now) sd = null;
        const baseContent = (post.editedContent ?? post.content);
        const hashtagLine = buildHashtagLine(post.hashtags as string[]);
        const fullContent = isTwitterPost(post)
          ? buildTwitterContent(baseContent, post.hashtags as string[], post.sourceUrl || "")
          : baseContent;
        const imageUrl = await getPostImageUrl(post);
        const acct = post.socialAccountId ? accountMap.get(post.socialAccountId) : null;
        const accountName = acct?.accountName || "";
        const dateStr = sd ? fmtSproutDate(sd) : "";
        lines.push(`${escCsv(post.platform)},${escCsv(accountName)},${escCsv(fullContent)},${escCsv(hashtagLine)},${escCsv(imageUrl)},${escCsv(post.sourceUrl || "")},${escCsv(dateStr)}`);
      }
      break;
    }
    case "hootsuite": {
      lines = ["Date,Time,Message,Media URLs,Social Profile"];
      for (const post of sortedPosts) {
        let sd = post.scheduledDate ? new Date(post.scheduledDate) : null;
        if (sd && sd < now) sd = null;
        const baseContent = (post.editedContent ?? post.content);
        const hashtagLine = buildHashtagLine(post.hashtags as string[]);
        const fullContent = isTwitterPost(post)
          ? buildTwitterContent(baseContent, post.hashtags as string[])
          : (hashtagLine ? `${baseContent}\n${hashtagLine}` : baseContent);
        const imageUrl = await getPostImageUrl(post);
        const { date, time } = fmtHootsuiteDate(sd);
        const profile = getAccountId(post) || post.platform;
        lines.push(`${escCsv(date)},${escCsv(time)},${escCsv(fullContent)},${escCsv(imageUrl)},${escCsv(profile)}`);
      }
      break;
    }
    case "sproutsocial": {
      lines = ["Post Text,Image URL,Scheduled Date/Time,Network,Profile"];
      for (const post of sortedPosts) {
        let sd = post.scheduledDate ? new Date(post.scheduledDate) : null;
        if (sd && sd < now) sd = null;
        const baseContent = (post.editedContent ?? post.content);
        const hashtagLine = buildHashtagLine(post.hashtags as string[]);
        const fullContent = isTwitterPost(post)
          ? buildTwitterContent(baseContent, post.hashtags as string[])
          : (hashtagLine ? `${baseContent}\n${hashtagLine}` : baseContent);
        const imageUrl = await getPostImageUrl(post);
        const dateStr = fmtSproutDate(sd);
        lines.push(`${escCsv(fullContent)},${escCsv(imageUrl)},${escCsv(dateStr)},${escCsv(post.platform)},${escCsv(getAccountId(post))}`);
      }
      break;
    }
    default: {
      // SocialPilot bulk CSV columns:
      //   Content, Image URL, Scheduled Date, Account ID, First Comment,
      //   Tags (internal SP labels), Link URL
      //
      // Keep First Comment blank. Hashtags belong only in SocialPilot's Tags field;
      // duplicating them as a first comment creates an unwanted public comment.
      // Twitter still needs hashtags + URL inline in the post body.
      lines = [];
      for (const post of sortedPosts) {
        let sd = post.scheduledDate ? new Date(post.scheduledDate) : null;
        if (sd && sd < now) sd = null;
        const baseContent = (post.editedContent ?? post.content);
        const sourceUrl = post.sourceUrl || "";

        let fullContent: string;
        let firstComment: string;
        if (isTwitterPost(post)) {
          // Twitter: hashtags + source URL inline in the post body.
          fullContent = buildTwitterContent(baseContent, post.hashtags as string[], sourceUrl);
          firstComment = "";
        } else {
          // LinkedIn / Facebook / Instagram etc.: keep the body clean and do not
          // generate a public first comment from SocialPilot tags.
          const contentParts = [baseContent];
          if (sourceUrl) contentParts.push(sourceUrl);
          fullContent = contentParts.join("\n");
          firstComment = "";
        }

        const imageUrl = await getPostImageUrl(post);
        const dateStr = fmtSocialPilotDate(sd);
        const platformAccountId = getSocialPilotAccountId(post);
        // Tags column = SocialPilot's internal label field (semicolon-separated,
        // no # prefix). Keep populated so SP's library filtering still works.
        const tags = buildTagsSemicolon(post.hashtags as string[]);

        const linkUrlValue = post.linkUrl || "";
        const linkCsvValue = linkUrlValue
          ? (post.linkLabel ? `${post.linkLabel} | ${linkUrlValue}` : linkUrlValue)
          : "";

        lines.push(`${escCsv(fullContent)},${escCsv(imageUrl)},${escCsv(dateStr)},${escCsv(platformAccountId)},${escCsv(firstComment)},${escCsv(tags)},${escCsv(linkCsvValue)}`);
      }
      break;
    }
  }

  return lines.join("\n");
}
