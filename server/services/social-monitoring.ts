import { storage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

interface SocialMonitoringResult {
  competitorId: string;
  competitorName: string;
  platform: "linkedin" | "instagram";
  hasChanges: boolean;
  summary?: string;
  status: "success" | "blocked" | "error" | "no_url";
  message?: string;
  engagement?: EngagementSnapshot;
}

interface EngagementSnapshot {
  followers?: number;
  posts?: number;
  reactions?: number;
  comments?: number;
  likes?: number;
  capturedAt: string;
}

const MIN_CHANGE_THRESHOLD = 50;
const REQUEST_DELAY_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractKeySignals(html: string, platform: string): string {
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  
  // Remove numeric engagement counts to avoid false positives in content comparison
  content = content.replace(/\b\d{1,3}(,\d{3})*\s*(followers?|likes?|comments?|reactions?|posts?|connections?)\b/gi, "");
  content = content.replace(/\b\d+[KMB]?\s*(followers?|likes?|comments?|reactions?|posts?)\b/gi, "");
  
  content = content
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  
  return content.substring(0, 5000);
}

function extractEngagementMetrics(html: string, platform: string): EngagementSnapshot {
  const engagement: EngagementSnapshot = {
    capturedAt: new Date().toISOString(),
  };
  
  // Extract numbers from common patterns
  const parseNumber = (str: string): number | undefined => {
    if (!str) return undefined;
    str = str.trim().toLowerCase();
    let num = parseFloat(str.replace(/,/g, ""));
    if (str.includes("k")) num *= 1000;
    if (str.includes("m")) num *= 1000000;
    if (str.includes("b")) num *= 1000000000;
    return isNaN(num) ? undefined : Math.round(num);
  };
  
  if (platform === "linkedin") {
    // LinkedIn patterns: "1,234 followers", "12K followers"
    const followersMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*followers?/i);
    if (followersMatch) engagement.followers = parseNumber(followersMatch[1]);
    
    // Reactions/likes pattern
    const reactionsMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*(?:reactions?|likes?)/i);
    if (reactionsMatch) engagement.reactions = parseNumber(reactionsMatch[1]);
    
    // Comments pattern
    const commentsMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*comments?/i);
    if (commentsMatch) engagement.comments = parseNumber(commentsMatch[1]);
    
    // Posts pattern
    const postsMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*posts?/i);
    if (postsMatch) engagement.posts = parseNumber(postsMatch[1]);
  } else if (platform === "instagram") {
    // Instagram patterns
    const followersMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*followers?/i);
    if (followersMatch) engagement.followers = parseNumber(followersMatch[1]);
    
    const postsMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*posts?/i);
    if (postsMatch) engagement.posts = parseNumber(postsMatch[1]);
    
    const likesMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*likes?/i);
    if (likesMatch) engagement.likes = parseNumber(likesMatch[1]);
  }
  
  return engagement;
}

function calculateChangeScore(prev: string, next: string): number {
  if (!prev || !next) return 100;
  
  const prevWordsArr = prev.toLowerCase().split(/\s+/);
  const nextWordsArr = next.toLowerCase().split(/\s+/);
  const prevWords = new Set(prevWordsArr);
  const nextWords = new Set(nextWordsArr);
  
  const intersection = Array.from(prevWords).filter(w => nextWords.has(w)).length;
  const combined = new Set(prevWordsArr.concat(nextWordsArr));
  const union = combined.size;
  
  if (union === 0) return 0;
  const similarity = intersection / union;
  return Math.round((1 - similarity) * 100);
}

async function fetchSocialPageContent(url: string): Promise<{ content: string | null; rawHtml: string | null; blocked: boolean }> {
  try {
    await delay(REQUEST_DELAY_MS + Math.random() * 1000);
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
    
    if (response.status === 429 || response.status === 403 || response.status === 401) {
      console.warn(`Social page blocked (${response.status}): ${url}`);
      return { content: null, rawHtml: null, blocked: true };
    }
    
    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status}`);
      return { content: null, rawHtml: null, blocked: false };
    }
    
    const html = await response.text();
    
    if (html.includes("authwall") || html.includes("login-required") || html.includes("sign-in")) {
      console.warn(`Login wall detected: ${url}`);
      return { content: null, rawHtml: null, blocked: true };
    }
    
    const platform = url.includes("linkedin") ? "linkedin" : "instagram";
    const content = extractKeySignals(html, platform);
    
    return { content, rawHtml: html, blocked: false };
  } catch (error) {
    console.error(`Error fetching social page ${url}:`, error);
    return { content: null, rawHtml: null, blocked: false };
  }
}

async function summarizeChanges(
  competitorName: string,
  platform: string,
  previousContent: string,
  newContent: string,
  changeScore: number
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Analyze changes to ${competitorName}'s ${platform} company page.

Change magnitude: ${changeScore}% different from previous

PREVIOUS (excerpt):
${previousContent.substring(0, 2000)}

CURRENT (excerpt):
${newContent.substring(0, 2000)}

Provide a 1-2 sentence summary of key changes. Focus on:
- Messaging or positioning changes
- New products/services
- Team updates
- Campaign announcements

If changes appear to be only dynamic content (dates, counters) or formatting, respond with: "No significant messaging changes detected."

Summary:`
        }
      ]
    });
    
    const textBlock = response.content.find(block => block.type === "text");
    return textBlock ? textBlock.text.trim() : "Changes detected";
  } catch (error) {
    console.error("Error summarizing changes:", error);
    return "Changes detected (summary unavailable)";
  }
}

export async function monitorCompetitorSocialMedia(
  competitorId: string,
  userId?: string,
  tenantDomain?: string
): Promise<SocialMonitoringResult[]> {
  const competitor = await storage.getCompetitor(competitorId);
  if (!competitor) {
    throw new Error("Competitor not found");
  }
  
  const results: SocialMonitoringResult[] = [];
  const now = new Date();
  const updates: any = { lastSocialCrawl: now };
  
  if (competitor.linkedInUrl) {
    const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(competitor.linkedInUrl);
    
    if (blocked) {
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "linkedin",
        hasChanges: false,
        status: "blocked",
        message: "LinkedIn requires authentication. Consider using official LinkedIn API for reliable monitoring.",
      });
    } else if (newContent && rawHtml) {
      const previousContent = competitor.linkedInContent || "";
      const changeScore = calculateChangeScore(previousContent, newContent);
      const hasSignificantChanges = previousContent !== "" && changeScore >= MIN_CHANGE_THRESHOLD;
      
      // Extract and store engagement metrics (snapshot only, no change alerts)
      const engagement = extractEngagementMetrics(rawHtml, "linkedin");
      updates.linkedInEngagement = engagement;
      
      let summary: string | undefined;
      if (hasSignificantChanges) {
        summary = await summarizeChanges(
          competitor.name,
          "LinkedIn",
          previousContent,
          newContent,
          changeScore
        );
        
        if (!summary.toLowerCase().includes("no significant")) {
          await storage.createActivity({
            type: "social_update",
            competitorId: competitor.id,
            competitorName: competitor.name,
            description: `LinkedIn Update: ${summary}`,
            date: now.toISOString(),
            impact: changeScore > 70 ? "High" : "Medium",
            userId: userId || competitor.userId,
            tenantDomain,
          });
        }
      }
      
      updates.linkedInContent = newContent;
      
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "linkedin",
        hasChanges: hasSignificantChanges,
        summary,
        status: "success",
        engagement,
      });
    } else {
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "linkedin",
        hasChanges: false,
        status: "error",
        message: "Could not fetch LinkedIn page content",
      });
    }
  }
  
  if (competitor.instagramUrl) {
    const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(competitor.instagramUrl);
    
    if (blocked) {
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "instagram",
        hasChanges: false,
        status: "blocked",
        message: "Instagram requires authentication. Consider using official Instagram API for reliable monitoring.",
      });
    } else if (newContent && rawHtml) {
      const previousContent = competitor.instagramContent || "";
      const changeScore = calculateChangeScore(previousContent, newContent);
      const hasSignificantChanges = previousContent !== "" && changeScore >= MIN_CHANGE_THRESHOLD;
      
      // Extract and store engagement metrics (snapshot only, no change alerts)
      const engagement = extractEngagementMetrics(rawHtml, "instagram");
      updates.instagramEngagement = engagement;
      
      let summary: string | undefined;
      if (hasSignificantChanges) {
        summary = await summarizeChanges(
          competitor.name,
          "Instagram",
          previousContent,
          newContent,
          changeScore
        );
        
        if (!summary.toLowerCase().includes("no significant")) {
          await storage.createActivity({
            type: "social_update",
            competitorId: competitor.id,
            competitorName: competitor.name,
            description: `Instagram Update: ${summary}`,
            date: now.toISOString(),
            impact: changeScore > 70 ? "High" : "Medium",
            userId: userId || competitor.userId,
            tenantDomain,
          });
        }
      }
      
      updates.instagramContent = newContent;
      
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "instagram",
        hasChanges: hasSignificantChanges,
        summary,
        status: "success",
        engagement,
      });
    } else {
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "instagram",
        hasChanges: false,
        status: "error",
        message: "Could not fetch Instagram page content",
      });
    }
  }
  
  await storage.updateCompetitor(competitorId, updates);
  
  return results;
}

export async function monitorAllCompetitorsForTenant(
  tenantDomain: string
): Promise<SocialMonitoringResult[]> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) {
    throw new Error("Tenant not found");
  }
  
  if (tenant.plan === "free") {
    throw new Error("Social media monitoring is a premium feature. Please upgrade your plan to access this functionality.");
  }
  
  const users = await storage.getUsersByDomain(tenantDomain);
  const allResults: SocialMonitoringResult[] = [];
  
  for (const user of users) {
    const competitors = await storage.getCompetitorsByUserId(user.id);
    
    for (const competitor of competitors) {
      if (competitor.linkedInUrl || competitor.instagramUrl) {
        try {
          const results = await monitorCompetitorSocialMedia(competitor.id, user.id, tenantDomain);
          allResults.push(...results);
        } catch (error) {
          console.error(`Error monitoring competitor ${competitor.id}:`, error);
        }
      }
    }
  }
  
  return allResults;
}
