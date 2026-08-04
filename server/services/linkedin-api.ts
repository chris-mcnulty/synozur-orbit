import { storage } from "../storage";
import { db } from "../db";
import { socialAccounts } from "@shared/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../utils/encryption";
import { getGlobalLinkedInCredentials } from "./platform-credentials-service";

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "fresh-linkedin-scraper-api.p.rapidapi.com";
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}/api/v1`;

/** Extract company slug from a LinkedIn company URL, e.g. linkedin.com/company/microsoft → "microsoft" */
function extractCompanySlug(url: string): string | null {
  const m = url.match(/linkedin\.com\/company\/([^\/\?#]+)/i);
  return m ? m[1] : null;
}

/** Extract personal username from a LinkedIn profile URL, e.g. linkedin.com/in/williamhgates → "williamhgates" */
function extractProfileUsername(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^\/\?#]+)/i);
  return m ? m[1] : null;
}

/**
 * Whether the official LinkedIn r_member_social scope is approved and should be
 * used for personal post fetching instead of the RapidAPI scraper.
 * Set LINKEDIN_MEMBER_SOCIAL_ENABLED=true once LinkedIn grants scope approval.
 */
function isMemberSocialEnabled(): boolean {
  return process.env.LINKEDIN_MEMBER_SOCIAL_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Attempt to refresh a LinkedIn access token using the stored refresh token
 * and the global LinkedIn client credentials.
 * Returns the new access token on success, or null on failure.
 * Also persists the refreshed credentials back to the socialAccounts row.
 */
async function refreshLinkedInToken(
  accountId: string,
  encryptedRefreshToken: string,
  tenantDomain: string,
): Promise<string | null> {
  const creds = getGlobalLinkedInCredentials();
  if (!creds) {
    console.warn(
      `[LinkedIn API] Cannot refresh token for tenant ${tenantDomain}: ` +
      `LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET not configured.`,
    );
    return null;
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(encryptedRefreshToken);
  } catch {
    console.warn(
      `[LinkedIn API] Cannot refresh token for tenant ${tenantDomain}: ` +
      `failed to decrypt stored refresh token.`,
    );
    return null;
  }

  const resp = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }).toString(),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.warn(
      `[LinkedIn API] Token refresh failed for tenant ${tenantDomain}: ` +
      `${resp.status} ${errText}`,
    );
    return null;
  }

  const tok = (await resp.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (!tok.access_token) {
    console.warn(
      `[LinkedIn API] Token refresh for tenant ${tenantDomain} returned no access_token.`,
    );
    return null;
  }

  const newExpiresAt = tok.expires_in
    ? new Date(Date.now() + tok.expires_in * 1000)
    : null;

  await db
    .update(socialAccounts)
    .set({
      encryptedAccessToken: encryptSecret(tok.access_token),
      encryptedRefreshToken: tok.refresh_token
        ? encryptSecret(tok.refresh_token)
        : encryptedRefreshToken,
      tokenExpiresAt: newExpiresAt,
      // Clear any pending reauth flag — token is healthy again.
      lastPublishError: null,
      updatedAt: new Date(),
    })
    .where(eq(socialAccounts.id, accountId));

  console.log(
    `[LinkedIn API] Token refreshed successfully for tenant ${tenantDomain}; ` +
    `new expiry: ${newExpiresAt?.toISOString() ?? "unknown"}.`,
  );

  return tok.access_token;
}

/**
 * Retrieve and decrypt the access token for the tenant's connected LinkedIn
 * account. Returns null when no connected account exists or the token is absent.
 * When the stored access token is expired, attempts a refresh using the stored
 * refresh token and the global LinkedIn OAuth credentials before falling back.
 */
async function getTenantLinkedInAccessToken(tenantDomain: string): Promise<string | null> {
  const [account] = await db
    .select({
      id: socialAccounts.id,
      encryptedAccessToken: socialAccounts.encryptedAccessToken,
      encryptedRefreshToken: socialAccounts.encryptedRefreshToken,
      tokenExpiresAt: socialAccounts.tokenExpiresAt,
      lastPublishError: socialAccounts.lastPublishError,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.tenantDomain, tenantDomain),
        eq(socialAccounts.platform, "linkedin"),
        eq(socialAccounts.status, "active"),
        isNotNull(socialAccounts.encryptedAccessToken),
      ),
    )
    .limit(1);

  if (!account?.encryptedAccessToken) return null;

  if (account.tokenExpiresAt && account.tokenExpiresAt < new Date()) {
    console.warn(
      `[LinkedIn API] Access token for tenant ${tenantDomain} is expired — attempting refresh.`,
    );

    if (account.encryptedRefreshToken) {
      const refreshed = await refreshLinkedInToken(
        account.id,
        account.encryptedRefreshToken,
        tenantDomain,
      );
      if (refreshed) return refreshed;
    } else {
      console.warn(
        `[LinkedIn API] No refresh token stored for tenant ${tenantDomain} — ` +
        `falling back gracefully.`,
      );
    }

    // Both access token and refresh token are exhausted (or absent).
    // Mark the account so the UI can surface a reconnect prompt.
    if (account.lastPublishError !== "needs_reauth") {
      await db
        .update(socialAccounts)
        .set({ lastPublishError: "needs_reauth", updatedAt: new Date() })
        .where(eq(socialAccounts.id, account.id));
      console.warn(
        `[LinkedIn API] Marked socialAccount ${account.id} as needs_reauth ` +
        `for tenant ${tenantDomain}.`,
      );
    }

    return null;
  }

  try {
    return decryptSecret(account.encryptedAccessToken);
  } catch {
    console.warn(`[LinkedIn API] Failed to decrypt access token for tenant ${tenantDomain}`);
    return null;
  }
}

const LI_API = "https://api.linkedin.com";
const LI_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "X-Restli-Protocol-Version": "2.0.0",
  "LinkedIn-Version": "202309",
});

/**
 * Resolve the LinkedIn member URN (urn:li:person:{id}) for the owner of the
 * given access token using the /v2/me endpoint.
 */
async function resolveMemberUrn(accessToken: string): Promise<string | null> {
  const res = await fetch(`${LI_API}/v2/me`, {
    headers: LI_HEADERS(accessToken),
  });
  if (!res.ok) {
    console.warn(`[LinkedIn API] /v2/me returned ${res.status}`);
    return null;
  }
  const data: any = await res.json();
  return data?.id ? `urn:li:person:${data.id}` : null;
}

/**
 * Fetch posts via the official LinkedIn UGC Posts API (r_member_social scope).
 * Filters to original posts (LIFECYCLESTATE=PUBLISHED, no reshares) within the
 * given date range. Paginates until all in-range posts are collected.
 */
async function fetchPostsViaOfficialApi(
  accessToken: string,
  memberUrn: string,
  startMs: number,
  endMs: number,
): Promise<PersonalPost[]> {
  const allPosts: PersonalPost[] = [];
  const PAGE_SIZE = 50;
  const MAX_PAGES = 10;
  let start = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      q: "authors",
      authors: `List(${memberUrn})`,
      start: String(start),
      count: String(PAGE_SIZE),
    });

    const res = await fetch(`${LI_API}/v2/ugcPosts?${params.toString()}`, {
      headers: LI_HEADERS(accessToken),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[LinkedIn API] ugcPosts returned ${res.status}: ${errText}`);
      throw new Error(`LinkedIn ugcPosts API returned ${res.status}`);
    }

    const data: any = await res.json();
    const elements: any[] = data?.elements ?? [];

    if (elements.length === 0) break;

    let reachedBeforeRange = false;

    for (const el of elements) {
      const timestamp: number | undefined =
        typeof el?.firstPublishedAt === "number"
          ? el.firstPublishedAt
          : typeof el?.created?.time === "number"
            ? el.created.time
            : undefined;

      if (timestamp !== undefined && timestamp < startMs) {
        reachedBeforeRange = true;
        break;
      }
      if (timestamp !== undefined && timestamp > endMs) continue;

      // Only include original published posts — skip reshares
      if (el?.lifecycleState !== "PUBLISHED") continue;
      if (el?.resharedBy !== undefined) continue;

      const shareContent =
        el?.specificContent?.["com.linkedin.ugc.ShareContent"] ?? {};
      const text: string = (
        shareContent?.shareCommentary?.text ??
        el?.text?.text ??
        ""
      ).trim();
      if (!text) continue;

      const postedAt = timestamp
        ? new Date(timestamp).toISOString()
        : "";

      allPosts.push({
        text,
        postedAt,
        postedAtTimestamp: timestamp,
        urn: el?.id,
      });
    }

    if (reachedBeforeRange) break;

    const paging = data?.paging ?? {};
    const total: number = paging.total ?? 0;
    start += PAGE_SIZE;
    if (start >= total || elements.length < PAGE_SIZE) break;
  }

  return allPosts;
}

interface LinkedInCompanyData {
  success: boolean;
  message?: string;
  cost?: number;
  data?: {
    id?: string;
    name?: string;
    universal_name?: string;
    linkedin_url?: string;
    tagline?: string;
    description?: string;
    website?: string;
    industry?: string;
    company_size?: string;
    company_size_on_linkedin?: number;
    hq?: {
      city?: string;
      country?: string;
      state?: string;
    };
    logo?: string;
    cover?: string;
    follower_count?: number;
    staff_count?: number;
    specialities?: string[];
    founded?: number;
    locations?: Array<{
      city?: string;
      country?: string;
    }>;
  };
}

interface LinkedInCompanyPosts {
  success: boolean;
  message?: string;
  cost?: number;
  data?: Array<{
    urn?: string;
    text?: string;
    posted_at?: string;
    num_likes?: number;
    num_comments?: number;
    num_reposts?: number;
    author?: {
      name?: string;
    };
  }>;
}

interface LinkedInApiResult {
  success: boolean;
  companyData?: LinkedInCompanyData["data"];
  posts?: LinkedInCompanyPosts["data"];
  followerCount?: number;
  employeeCount?: number;
  recentPostCount?: number;
  totalEngagement?: number;
  error?: string;
}

export async function getCompanyByDomain(domain: string): Promise<LinkedInApiResult> {
  if (!RAPIDAPI_KEY) {
    return { success: false, error: "RapidAPI key not configured" };
  }

  try {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const slug = cleanDomain.split(".")[0];

    const response = await fetch(
      `${RAPIDAPI_BASE}/company/profile?company=${encodeURIComponent(slug)}`,
      {
        method: "GET",
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LinkedIn API] Error response:", errorText);
      return { success: false, error: `API returned ${response.status}: ${errorText}` };
    }

    const data: LinkedInCompanyData = await response.json();

    if (!data.data) {
      return { success: false, error: data.message || "No company data found" };
    }

    const apiData = data.data as any;
    return {
      success: true,
      companyData: data.data,
      followerCount: apiData.follower_count ?? apiData.followers_count,
      employeeCount: apiData.employee_count || apiData.staff_count || data.data.company_size_on_linkedin,
    };
  } catch (error: any) {
    console.error("[LinkedIn API] Error fetching company by domain:", error);
    return { success: false, error: error.message };
  }
}

export async function getCompanyDetails(linkedinUrl: string): Promise<LinkedInApiResult> {
  if (!RAPIDAPI_KEY) {
    return { success: false, error: "RapidAPI key not configured" };
  }

  try {
    const slug =
      extractCompanySlug(linkedinUrl) ??
      (linkedinUrl.includes("linkedin.com/company/") ? null : linkedinUrl);

    if (!slug) {
      return { success: false, error: "Could not extract company slug from LinkedIn URL" };
    }

    const response = await fetch(
      `${RAPIDAPI_BASE}/company/profile?company=${encodeURIComponent(slug)}`,
      {
        method: "GET",
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LinkedIn API] Error response:", errorText);
      return { success: false, error: `API returned ${response.status}: ${errorText}` };
    }

    const data: LinkedInCompanyData = await response.json();

    if (!data.data) {
      return { success: false, error: data.message || "No company data found" };
    }

    const apiData = data.data as any;
    return {
      success: true,
      companyData: data.data,
      followerCount: apiData.follower_count ?? apiData.followers_count,
      employeeCount: apiData.employee_count || apiData.staff_count || data.data.company_size_on_linkedin,
    };
  } catch (error: any) {
    console.error("[LinkedIn API] Error fetching company details:", error);
    return { success: false, error: error.message };
  }
}

export async function getCompanyPosts(linkedinUrl: string): Promise<LinkedInApiResult> {
  if (!RAPIDAPI_KEY) {
    return { success: false, error: "RapidAPI key not configured" };
  }

  try {
    const normalizedUrl = linkedinUrl.includes("linkedin.com/company/")
      ? linkedinUrl
      : `https://www.linkedin.com/company/${linkedinUrl}/`;

    const response = await fetch(
      `${RAPIDAPI_BASE}/company/posts?linkedin_url=${encodeURIComponent(normalizedUrl)}`,
      {
        method: "GET",
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[LinkedIn API] Posts error response:", errorText);
      return { success: false, error: `API returned ${response.status}: ${errorText}` };
    }

    const data: LinkedInCompanyPosts = await response.json();

    const rawPosts: any[] = (data as any).data || [];
    // New API: engagement is nested in stats{}; old shape had flat num_likes etc.
    const posts = rawPosts.map((p: any) => ({
      urn: p.urn ?? p.post_id,
      text: p.text ?? p.content ?? "",
      posted_at: p.posted_at ?? "",
      num_likes: p.num_likes ?? p.stats?.likes ?? 0,
      num_comments: p.num_comments ?? p.stats?.comments ?? 0,
      num_reposts: p.num_reposts ?? p.stats?.shares ?? 0,
      author: p.author,
    }));

    const totalEngagement = posts.reduce((sum, post) => {
      return sum + (post.num_likes || 0) + (post.num_comments || 0) + (post.num_reposts || 0);
    }, 0);

    return {
      success: true,
      posts,
      recentPostCount: posts.length,
      totalEngagement,
    };
  } catch (error: any) {
    console.error("[LinkedIn API] Error fetching company posts:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchLinkedInData(
  competitorId: string,
  linkedinUrl?: string,
  websiteUrl?: string
): Promise<{
  success: boolean;
  followerCount?: number;
  employeeCount?: number;
  recentPosts?: Array<{
    text: string;
    postedAt: string;
    reactions: number;
    comments: number;
  }>;
  companyDescription?: string;
  industry?: string;
  error?: string;
}> {
  if (!RAPIDAPI_KEY) {
    return { success: false, error: "RapidAPI key not configured" };
  }

  let companyResult: LinkedInApiResult | null = null;

  if (linkedinUrl) {
    companyResult = await getCompanyDetails(linkedinUrl);
  } else if (websiteUrl) {
    companyResult = await getCompanyByDomain(websiteUrl);
  }

  if (!companyResult || !companyResult.success) {
    return { 
      success: false, 
      error: companyResult?.error || "Could not fetch LinkedIn data - no URL provided" 
    };
  }

  const postsResult = await getCompanyPosts(
    linkedinUrl || `https://linkedin.com/company/${companyResult.companyData?.universal_name}`
  );

  const recentPosts = (postsResult.posts || []).slice(0, 5).map(post => {
    // LinkedIn URN format: urn:li:activity:1234567890
    // Can be converted to URL: https://www.linkedin.com/feed/update/urn:li:activity:1234567890
    const postUrl = post.urn ? `https://www.linkedin.com/feed/update/${post.urn}` : undefined;
    return {
      text: post.text || "",
      postedAt: post.posted_at || "",
      reactions: post.num_likes || 0,
      comments: post.num_comments || 0,
      url: postUrl,
    };
  });

  return {
    success: true,
    followerCount: companyResult.followerCount,
    employeeCount: companyResult.employeeCount,
    recentPosts,
    companyDescription: companyResult.companyData?.description,
    industry: companyResult.companyData?.industry,
  };
}

// ── Personal profile post fetcher (LinkedIn Digest) ──────────────────────────
// Isolated so it can be swapped for LinkedIn's official r_member_social API
// call with no broader rework once that OAuth scope is approved.

export interface PersonalPost {
  text: string;
  postedAt: string;
  postedAtTimestamp?: number;
  urn?: string;
  activityType?: string;
}

export interface PersonalPostsResult {
  success: boolean;
  posts?: PersonalPost[];
  postCount?: number;
  error?: string;
  errorCode?: "NO_LINKEDIN_ACCOUNT";
}

/**
 * Fetch a person's own original mainline LinkedIn posts (no shares, no reposts)
 * within a date range.
 *
 * Primary path (when LINKEDIN_MEMBER_SOCIAL_ENABLED=true and tenantDomain is
 * supplied): uses the official LinkedIn UGC Posts API (r_member_social scope)
 * with the tenant's stored OAuth access token.
 *
 * Fallback path: the RapidAPI fresh-linkedin-profile-data scraper (public
 * profiles only). Used when the official scope is not yet approved, when no
 * connected LinkedIn account exists for the tenant, or when tenantDomain is
 * not passed (backwards-compatible callers).
 */
export async function getPersonalProfilePosts(
  profileUrl: string,
  startDate: Date,
  endDate: Date,
  tenantDomain?: string,
): Promise<PersonalPostsResult> {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  // ── Official LinkedIn API path ──────────────────────────────────────────────
  if (isMemberSocialEnabled() && tenantDomain) {
    try {
      const accessToken = await getTenantLinkedInAccessToken(tenantDomain);
      if (!accessToken) {
        console.warn(
          `[LinkedIn API] LINKEDIN_MEMBER_SOCIAL_ENABLED is true but no active ` +
          `LinkedIn account token found for tenant ${tenantDomain}. Returning NO_LINKEDIN_ACCOUNT.`,
        );
        return {
          success: false,
          error: "No LinkedIn account connected for this workspace.",
          errorCode: "NO_LINKEDIN_ACCOUNT",
        };
      } else {
        const memberUrn = await resolveMemberUrn(accessToken);
        if (!memberUrn) {
          console.warn("[LinkedIn API] Could not resolve member URN. Falling back to RapidAPI.");
        } else {
          const posts = await fetchPostsViaOfficialApi(accessToken, memberUrn, startMs, endMs);
          return { success: true, posts, postCount: posts.length };
        }
      }
    } catch (error: any) {
      console.error("[LinkedIn API] Official API call failed, falling back to RapidAPI:", error.message);
    }
  }

  // ── RapidAPI fallback path ─────────────────────────────────────────────────
  if (!RAPIDAPI_KEY) {
    const reason = isMemberSocialEnabled()
      ? "LinkedIn official API is enabled but no connected account token was found, and RapidAPI key is not configured"
      : "RapidAPI key not configured";
    return { success: false, error: reason };
  }

  // New API (fresh-linkedin-scraper-api) identifies profiles by username slug, not full URL.
  const username = extractProfileUsername(profileUrl.trim());
  if (!username) {
    return { success: false, error: "Could not extract LinkedIn username from profile URL. Expected a URL like https://www.linkedin.com/in/username" };
  }

  const allPosts: PersonalPost[] = [];
  const MAX_PAGES = 5;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const response = await fetch(
        `${RAPIDAPI_BASE}/user/posts?username=${encodeURIComponent(username)}&page=${page}`,
        {
          method: "GET",
          headers: {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": RAPIDAPI_HOST,
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[LinkedIn API] Personal posts error response:", errorText);
        return { success: false, error: `API returned ${response.status}: ${errorText}` };
      }

      const data: any = await response.json();
      const rawPosts: any[] = data?.data ?? [];

      if (rawPosts.length === 0) break;

      let reachedBeforeRange = false;

      for (const raw of rawPosts) {
        // Parse post timestamp — new API returns ISO string in posted_at.
        const postedAtStr: string = raw?.posted_at ?? raw?.postedAt ?? "";
        const timestamp: number | undefined =
          typeof raw?.posted_at_timestamp === "number"
            ? raw.posted_at_timestamp
            : postedAtStr.match(/^\d+$/)
              ? Number(postedAtStr)
              : postedAtStr
                ? new Date(postedAtStr).getTime()
                : undefined;

        if (timestamp !== undefined && !isNaN(timestamp) && timestamp < startMs) {
          reachedBeforeRange = true;
          break;
        }
        if (timestamp !== undefined && !isNaN(timestamp) && timestamp > endMs) continue;

        // Filter to original posts only — exclude reshares, shares, and comments.
        // New API may not return activity_type; fall back to structural signals.
        const activityType: string = (raw?.activity_type ?? raw?.activityType ?? raw?.post_type ?? "").toUpperCase();
        const isExcluded =
          activityType === "SHARE" ||
          activityType === "RESHARE" ||
          activityType === "COMMENT" ||
          raw?.is_reshared === true ||
          raw?.reshared === true ||
          raw?.is_repost === true ||
          raw?.is_comment === true ||
          raw?.isComment === true ||
          raw?.root_post !== undefined;
        if (isExcluded) continue;

        const text: string = (raw?.text ?? raw?.content ?? "").trim();
        if (!text) continue;

        allPosts.push({
          text,
          postedAt: postedAtStr,
          postedAtTimestamp: timestamp,
          urn: raw?.urn ?? raw?.post_id,
          activityType: activityType || undefined,
        });
      }

      if (reachedBeforeRange) break;

      // New API uses has_more flag instead of pagination tokens.
      const hasMore: boolean = data?.has_more ?? false;
      if (!hasMore) break;
    } catch (error: any) {
      console.error("[LinkedIn API] Error fetching personal profile posts:", error);
      return { success: false, error: error.message };
    }
  }

  return {
    success: true,
    posts: allPosts,
    postCount: allPosts.length,
  };
}

function extractLinkedInUsername(url: string): string | null {
  if (!url) return null;
  
  const match = url.match(/linkedin\.com\/company\/([^\/\?]+)/i);
  return match ? match[1] : null;
}

export async function monitorCompetitorLinkedIn(
  competitorId: string,
  tenantDomain: string,
  marketId?: string
): Promise<{
  success: boolean;
  hasChanges: boolean;
  summary?: string;
  error?: string;
}> {
  try {
    const competitor = await storage.getCompetitor(competitorId);
    if (!competitor) {
      return { success: false, hasChanges: false, error: "Competitor not found" };
    }

    const linkedinUrl = competitor.linkedInUrl || undefined;
    const websiteUrl = competitor.url;

    const result = await fetchLinkedInData(competitorId, linkedinUrl, websiteUrl);
    
    if (!result.success) {
      return { success: false, hasChanges: false, error: result.error };
    }

    const previousMetricsArray = await storage.getSocialMetrics(competitorId, "linkedin");
    const previousMetrics = previousMetricsArray.length > 0 ? previousMetricsArray[0] : null;
    
    const hasFollowerChange = previousMetrics?.followers !== undefined && 
      previousMetrics.followers !== null &&
      result.followerCount !== undefined &&
      Math.abs(result.followerCount - previousMetrics.followers) > 100;

    const hasNewPosts = result.recentPosts && result.recentPosts.length > 0;

    await storage.createSocialMetric({
      competitorId,
      tenantDomain,
      marketId: marketId || null,
      platform: "linkedin",
      period: new Date().toISOString().split("T")[0],
      followers: result.followerCount || null,
      posts: result.recentPosts?.length || null,
      engagement: result.recentPosts?.reduce((sum, p) => sum + p.reactions + p.comments, 0) || null,
    });

    let summary = "";
    if (hasFollowerChange || hasNewPosts) {
      const changes: string[] = [];
      if (hasFollowerChange && previousMetrics?.followers && result.followerCount) {
        const diff = result.followerCount - previousMetrics.followers;
        changes.push(`Followers ${diff > 0 ? "increased" : "decreased"} by ${Math.abs(diff).toLocaleString()} (now ${result.followerCount.toLocaleString()})`);
      }
      if (hasNewPosts && result.recentPosts) {
        changes.push(`${result.recentPosts.length} recent posts detected`);
        const topPost = result.recentPosts[0];
        if (topPost) {
          changes.push(`Latest post: "${topPost.text.substring(0, 100)}..." (${topPost.reactions} reactions)`);
        }
      }
      summary = changes.join(". ");
    }

    if (summary) {
      await storage.createActivity({
        type: "social_update",
        sourceType: "competitor",
        competitorId,
        competitorName: competitor.name,
        description: summary,
        date: new Date().toISOString(),
        impact: "medium",
        tenantDomain,
        marketId: marketId || null,
        details: {
          platform: "linkedin",
          followerCount: result.followerCount,
          employeeCount: result.employeeCount,
          postCount: result.recentPosts?.length,
        },
      });
    }

    return {
      success: true,
      hasChanges: !!summary,
      summary: summary || "No significant changes detected",
    };
  } catch (error: any) {
    console.error("[LinkedIn API] Monitor error:", error);
    return { success: false, hasChanges: false, error: error.message };
  }
}
