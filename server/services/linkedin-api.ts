import { storage } from "../storage";
import { db } from "../db";
import { socialAccounts } from "@shared/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { decryptSecret } from "../utils/encryption";

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "fresh-linkedin-profile-data.p.rapidapi.com";

/**
 * Whether the official LinkedIn r_member_social scope is approved and should be
 * used for personal post fetching instead of the RapidAPI scraper.
 * Set LINKEDIN_MEMBER_SOCIAL_ENABLED=true once LinkedIn grants scope approval.
 */
function isMemberSocialEnabled(): boolean {
  return process.env.LINKEDIN_MEMBER_SOCIAL_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Retrieve and decrypt the access token for the tenant's connected LinkedIn
 * account. Returns null when no connected account exists or the token is absent.
 */
async function getTenantLinkedInAccessToken(tenantDomain: string): Promise<string | null> {
  const [account] = await db
    .select({
      encryptedAccessToken: socialAccounts.encryptedAccessToken,
      tokenExpiresAt: socialAccounts.tokenExpiresAt,
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
    console.warn(`[LinkedIn API] Access token for tenant ${tenantDomain} is expired`);
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
    const companyName = cleanDomain.split(".")[0];
    const linkedinUrl = `https://www.linkedin.com/company/${companyName}/`;
    
    const response = await fetch(
      `https://${RAPIDAPI_HOST}/get-company-by-linkedinurl?linkedin_url=${encodeURIComponent(linkedinUrl)}`,
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

    // API returns employee_count, staff_count, or company_size_on_linkedin depending on company
    const apiData = data.data as any;
    return {
      success: true,
      companyData: data.data,
      followerCount: apiData.follower_count,
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
    const normalizedUrl = linkedinUrl.includes("linkedin.com/company/") 
      ? linkedinUrl 
      : `https://www.linkedin.com/company/${linkedinUrl}/`;

    const response = await fetch(
      `https://${RAPIDAPI_HOST}/get-company-by-linkedinurl?linkedin_url=${encodeURIComponent(normalizedUrl)}`,
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

    // API returns employee_count, staff_count, or company_size_on_linkedin depending on company
    const apiData = data.data as any;
    return {
      success: true,
      companyData: data.data,
      followerCount: apiData.follower_count,
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
      `https://${RAPIDAPI_HOST}/get-company-posts?linkedin_url=${encodeURIComponent(normalizedUrl)}&type=posts`,
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
    
    const posts = data.data || [];
    const totalEngagement = posts.reduce((sum, post) => {
      return sum + (post.num_likes || 0) + (post.num_comments || 0) + (post.num_reposts || 0);
    }, 0);

    return {
      success: true,
      posts: posts,
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
          `LinkedIn account token found for tenant ${tenantDomain}. Falling back to RapidAPI.`,
        );
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

  const normalizedUrl = profileUrl.trim().replace(/\/$/, "");
  const allPosts: PersonalPost[] = [];
  let paginationToken: string | undefined;
  const MAX_PAGES = 5;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        linkedin_url: normalizedUrl,
        type: "posts",
      });
      if (paginationToken) params.set("pagination_token", paginationToken);

      const response = await fetch(
        `https://${RAPIDAPI_HOST}/get-profile-posts?${params.toString()}`,
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
        // Parse post timestamp — the API returns either a unix ms timestamp or
        // an ISO string in posted_at.
        const timestamp: number | undefined =
          typeof raw?.posted_at_timestamp === "number"
            ? raw.posted_at_timestamp
            : typeof raw?.posted_at === "string" && raw.posted_at.match(/^\d+$/)
              ? Number(raw.posted_at)
              : typeof raw?.posted_at === "string"
                ? new Date(raw.posted_at).getTime()
                : undefined;

        if (timestamp !== undefined && timestamp < startMs) {
          reachedBeforeRange = true;
          break;
        }
        if (timestamp !== undefined && timestamp > endMs) continue;

        // Filter to original posts only — exclude reshares, shares, and comments.
        const activityType: string = (raw?.activity_type ?? raw?.activityType ?? "").toUpperCase();
        const isExcluded =
          activityType === "SHARE" ||
          activityType === "RESHARE" ||
          activityType === "COMMENT" ||
          raw?.is_reshared === true ||
          raw?.reshared === true ||
          raw?.is_comment === true ||
          raw?.isComment === true ||
          raw?.root_post !== undefined; // comment replies often include a root_post reference
        if (isExcluded) continue;

        const text: string = (raw?.text ?? raw?.content ?? "").trim();
        if (!text) continue;

        allPosts.push({
          text,
          postedAt: raw?.posted_at ?? "",
          postedAtTimestamp: timestamp,
          urn: raw?.urn,
          activityType: activityType || undefined,
        });
      }

      if (reachedBeforeRange) break;

      // Pagination
      paginationToken = data?.pagination_token ?? data?.paginationToken;
      if (!paginationToken) break;
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
