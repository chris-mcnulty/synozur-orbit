/**
 * Marketing Links — shared helpers for slug generation, bot detection,
 * IP hashing, UTM tagging, and outbound-URL wrapping during AI generation.
 *
 * The redirect handler and AI generation flows both depend on these so they
 * stay in lockstep (e.g. the same bot regex, the same UTM rules).
 */

import { randomBytes, createHash } from "crypto";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { marketingLinks, type InsertMarketingLink } from "@shared/schema";

const BOT_UA_PATTERN = /bot|crawl|spider|slurp|preview|fetch|monitor|wget|curl|headless|lighthouse|pingdom|uptimerobot|gtmetrix|whatsapp|facebookexternalhit|linkedinbot|twitterbot|telegrambot|slackbot|discordbot|googleimage|bingpreview/i;

export function isLikelyBot(userAgent: string | undefined | null): boolean {
  if (!userAgent || userAgent.trim().length === 0) return true;
  return BOT_UA_PATTERN.test(userAgent);
}

/**
 * Daily-rotating IP hash — gives us rough uniqueness for de-duping repeated
 * clicks without ever persisting the raw IP. The salt rotates each UTC day
 * so the hash cannot be used to track a visitor across days.
 */
export function hashIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${day}:${ip}`).digest("hex").slice(0, 16);
}

/**
 * Best-effort client IP extraction. Express's `trust proxy` is set so
 * `req.ip` already respects X-Forwarded-For when configured.
 */
export function clientIp(req: { ip?: string; headers: Record<string, any> }): string | null {
  if (req.ip) return req.ip;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0].trim();
  return null;
}

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/O/1/l/I — easier to read aloud
const SLUG_LENGTH = 8;

function generateSlugCandidate(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return out;
}

/**
 * Generate a slug that is not already in use. Slugs are globally unique (DB
 * has a UNIQUE constraint), so retry until we hit an unused value.
 */
export async function generateUniqueSlug(maxAttempts = 8): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateSlugCandidate();
    const [existing] = await db.select({ id: marketingLinks.id })
      .from(marketingLinks)
      .where(eq(marketingLinks.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  // Fall back to a longer candidate if we somehow keep colliding.
  return `${generateSlugCandidate()}${generateSlugCandidate().slice(0, 4)}`;
}

export interface UtmDefaults {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
}

/**
 * Append UTM parameters to a destination URL without clobbering UTMs the
 * caller already set. Invalid URLs are returned unchanged so the caller can
 * decide how to handle them — link rows are still created with the raw value.
 */
export function applyUtmParams(rawUrl: string, utm: UtmDefaults): string {
  try {
    const u = new URL(rawUrl);
    const setIfMissing = (key: string, value: string | null | undefined) => {
      if (!value) return;
      if (!u.searchParams.has(key)) {
        u.searchParams.set(key, value);
      }
    };
    setIfMissing("utm_source", utm.source ?? undefined);
    setIfMissing("utm_medium", utm.medium ?? undefined);
    setIfMissing("utm_campaign", utm.campaign ?? undefined);
    setIfMissing("utm_content", utm.content ?? undefined);
    setIfMissing("utm_term", utm.term ?? undefined);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

export function slugifyForUtm(value: string | null | undefined, fallback = ""): string {
  if (!value) return fallback;
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || fallback;
}

/**
 * Build the public redirect URL for a slug. Prefers the request host so the
 * URL works in the user's current environment (preview, prod, custom domain)
 * without configuration. Falls back to PUBLIC_APP_URL for callers that don't
 * have a request handy (e.g. background jobs).
 */
export function buildRedirectUrl(slug: string, opts: { protocol?: string; host?: string }): string {
  const proto = opts.protocol || "https";
  const host = opts.host || process.env.PUBLIC_APP_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "";
  if (!host) return `/r/${slug}`;
  return `${proto}://${host}/r/${slug}`;
}

const URL_REGEX = /(https?:\/\/[^\s<>"')]+[^\s<>"')\.,;:!?])/g;

/**
 * Walk through `text`, find unique outbound URLs, persist a marketing_link row
 * for each, and replace the URL inline with a redirect URL. Returns the
 * rewritten text and the slugs that were created. Existing redirect URLs
 * (already pointing at /r/...) are left alone.
 */
export async function wrapOutboundLinksInText(
  text: string,
  ctx: {
    tenantDomain: string;
    marketId: string;
    campaignId?: string | null;
    userId: string;
    utm: UtmDefaults;
    source: "post-wrap" | "email-wrap";
    redirectBase: { protocol?: string; host?: string };
    label?: string | null;
  },
): Promise<{ text: string; createdSlugs: string[] }> {
  if (!text) return { text, createdSlugs: [] };

  const urlsFound = Array.from(new Set(text.match(URL_REGEX) || []));
  const replacements: Array<{ original: string; replacement: string }> = [];
  const createdSlugs: string[] = [];

  for (const original of urlsFound) {
    // Skip links that are already redirect URLs to avoid double-wrapping.
    if (/\/r\/[a-z0-9]{6,}/i.test(original)) continue;

    const finalDestination = applyUtmParams(original, ctx.utm);
    const slug = await generateUniqueSlug();

    const insertRow: InsertMarketingLink = {
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      campaignId: ctx.campaignId ?? null,
      slug,
      destinationUrl: finalDestination,
      label: ctx.label ?? null,
      utmSource: ctx.utm.source ?? null,
      utmMedium: ctx.utm.medium ?? null,
      utmCampaign: ctx.utm.campaign ?? null,
      utmContent: ctx.utm.content ?? null,
      utmTerm: ctx.utm.term ?? null,
      status: "active",
      source: ctx.source,
      createdBy: ctx.userId,
    };

    try {
      await db.insert(marketingLinks).values(insertRow);
      const replacement = buildRedirectUrl(slug, ctx.redirectBase);
      replacements.push({ original, replacement });
      createdSlugs.push(slug);
    } catch (err: any) {
      console.warn(`[MarketingLinks] Failed to create wrap link for ${original}:`, err.message);
    }
  }

  let rewritten = text;
  for (const { original, replacement } of replacements) {
    // Use split/join to replace ALL occurrences of the URL — safer than regex
    // because the URL itself may contain regex-special characters.
    rewritten = rewritten.split(original).join(replacement);
  }

  return { text: rewritten, createdSlugs };
}
