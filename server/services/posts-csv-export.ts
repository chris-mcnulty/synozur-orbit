import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { socialAccounts, brandAssets, contentAssets } from "@shared/schema";

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
  for (const id of fallbackAccountIds) {
    const acct = accountMap.get(id);
    if (acct?.accountId && acct.platform && !platformAccountFallback.has(acct.platform)) {
      platformAccountFallback.set(acct.platform, acct.accountId);
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
        if (acct?.accountId) return acct.accountId;
      }
      return platformAccountFallback.get(post.platform) || post.platform;
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

  // Turn a relative public Orbit path (`/public-objects/...`) into an absolute
  // URL so external schedulers can fetch it. Only `/public-objects/...` is
  // anonymously fetchable — auth-gated `/objects/...` paths are left untouched
  // (absolutizing them would just produce an absolute URL that still 401s), and
  // already-absolute URLs pass through unchanged.
  const imageBaseUrl = (opts.imageBaseUrl || "").replace(/\/$/, "");
  const absolutize = (url: string): string =>
    url.startsWith("/public-objects/") && imageBaseUrl ? `${imageBaseUrl}${url}` : url;

  const getPostImageUrl = (post: any): string => {
    if (post.overrideImageUrl) return absolutize(post.overrideImageUrl);
    if (post.overrideBrandAssetId) {
      const ba = brandMap.get(post.overrideBrandAssetId);
      if (ba?.fileUrl) return absolutize(ba.fileUrl);
      if (ba?.url) return absolutize(ba.url);
    }
    if (post.sourceAssetId) {
      const ca = contentAssetById.get(post.sourceAssetId);
      if (ca?.leadImageUrl) return absolutize(ca.leadImageUrl);
      if (ca?.fileUrl && typeof ca.fileType === "string" && ca.fileType.startsWith("image/")) return absolutize(ca.fileUrl);
    }
    if (post.sourceUrl) {
      const ca = contentAssetByUrl.get(post.sourceUrl);
      if (ca?.leadImageUrl) return absolutize(ca.leadImageUrl);
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
        const imageUrl = getPostImageUrl(post);
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
        const imageUrl = getPostImageUrl(post);
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
        const imageUrl = getPostImageUrl(post);
        const dateStr = fmtSproutDate(sd);
        lines.push(`${escCsv(fullContent)},${escCsv(imageUrl)},${escCsv(dateStr)},${escCsv(post.platform)},${escCsv(getAccountId(post))}`);
      }
      break;
    }
    default: {
      lines = [];
      for (const post of sortedPosts) {
        let sd = post.scheduledDate ? new Date(post.scheduledDate) : null;
        if (sd && sd < now) sd = null;
        const baseContent = (post.editedContent ?? post.content);
        const hashtagLine = buildHashtagLine(post.hashtags as string[]);
        const sourceUrl = post.sourceUrl || "";

        let fullContent: string;
        if (isTwitterPost(post)) {
          fullContent = buildTwitterContent(baseContent, post.hashtags as string[], sourceUrl);
        } else {
          const contentParts = [baseContent];
          if (hashtagLine) contentParts.push(hashtagLine);
          if (sourceUrl) contentParts.push(sourceUrl);
          fullContent = contentParts.join("\n");
        }

        const imageUrl = getPostImageUrl(post);
        const dateStr = fmtSocialPilotDate(sd);
        const platformAccountId = getAccountId(post);
        const tags = buildTagsSemicolon(post.hashtags as string[]);

        lines.push(`${escCsv(fullContent)},${escCsv(imageUrl)},${escCsv(dateStr)},${escCsv(platformAccountId)},"",${escCsv(tags)}`);
      }
      break;
    }
  }

  return lines.join("\n");
}
