import { storage } from "../storage";

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "fresh-linkedin-profile-data.p.rapidapi.com";

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
