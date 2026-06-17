/**
 * LinkedIn outreach — pure helpers shared by client + server.
 *
 * Distinguishes the two LinkedIn message shapes a seller actually sends by hand
 * (LinkedIn exposes no 1:1 messaging API): a *connect request* note, capped at
 * LinkedIn's 300-char limit, and a longer *direct message* to an existing
 * connection. An *intent* (outreach vs. engagement) shapes the ask. Also builds
 * best-effort deep links into LinkedIn so the seller can open the right screen
 * and paste — LinkedIn cannot pre-fill the message body via any public URL.
 */

export type LinkedInFormat = "connect_request" | "direct_message";
export type OutreachIntent = "outreach" | "engagement";

/** Hard character ceilings per LinkedIn message shape. */
export const LINKEDIN_FORMAT_LIMITS: Record<LinkedInFormat, number> = {
  connect_request: 300, // LinkedIn's connection-note limit
  direct_message: 600, // keep DMs tight; matches the composer's linkedin cap
};

export const LINKEDIN_FORMAT_LABELS: Record<LinkedInFormat, string> = {
  connect_request: "Connect request",
  direct_message: "Direct message",
};

export const OUTREACH_INTENT_LABELS: Record<OutreachIntent, string> = {
  outreach: "Outreach",
  engagement: "Engagement",
};

export function isLinkedInFormat(v: unknown): v is LinkedInFormat {
  return v === "connect_request" || v === "direct_message";
}

export function isOutreachIntent(v: unknown): v is OutreachIntent {
  return v === "outreach" || v === "engagement";
}

/** Character ceiling for a format (defaults to the longer DM limit). */
export function linkedinCharLimit(format: LinkedInFormat | null | undefined): number {
  return format ? LINKEDIN_FORMAT_LIMITS[format] : LINKEDIN_FORMAT_LIMITS.direct_message;
}

/** Whether a URL looks like a real LinkedIn profile / company page. */
export function isValidLinkedInProfileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return /(^|\.)linkedin\.com$/i.test(u.hostname) && /\/(in|pub|company)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/** Extract the vanity slug from a profile URL (…/in/<slug>). */
export function linkedinProfileSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const m = u.pathname.match(/\/in\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export interface LinkedInDeepLinks {
  /** The prospect's profile (where the Connect button lives). */
  profile: string | null;
  /** Best-effort messaging-compose deep link (DM) — by vanity slug. */
  messaging: string | null;
  /** People-search fallback when no verified profile URL is on file. */
  search: string | null;
}

/**
 * Build the deep links the seller clicks to land on the right LinkedIn screen.
 * Connect requests open the profile (the Connect button lives there); DMs use
 * the messaging-compose URL. LinkedIn does not support pre-filling the body.
 */
export function buildLinkedInDeepLinks(opts: {
  profileUrl?: string | null;
  name?: string | null;
  companyName?: string | null;
}): LinkedInDeepLinks {
  const profile = isValidLinkedInProfileUrl(opts.profileUrl) ? opts.profileUrl!.trim() : null;
  const slug = linkedinProfileSlug(profile);
  const messaging = slug
    ? `https://www.linkedin.com/messaging/compose/?recipient=${encodeURIComponent(slug)}`
    : null;
  const query = [opts.name, opts.companyName].filter(Boolean).join(" ").trim();
  const search = query
    ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`
    : null;
  return { profile, messaging, search };
}
