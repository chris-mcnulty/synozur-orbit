import { storage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import { crawlCompetitorWebsite, getCombinedContent } from "./web-crawler";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

interface WebsiteMonitoringResult {
  competitorId: string;
  competitorName: string;
  hasChanges: boolean;
  changeScore: number;
  summary?: string;
  status: "success" | "error" | "no_content";
  message?: string;
  pagesMonitored: number;
}

const MIN_CHANGE_THRESHOLD = 15;
const REQUEST_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, "")
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s*\d{4}\b/gi, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/©\s*\d{4}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateChangeScore(prev: string, next: string): number {
  if (!prev || !next) return 100;
  
  const prevNorm = normalizeContent(prev);
  const nextNorm = normalizeContent(next);
  
  const prevWordsArr = prevNorm.split(/\s+/).filter(w => w.length > 3);
  const nextWordsArr = nextNorm.split(/\s+/).filter(w => w.length > 3);
  const prevWords = new Set(prevWordsArr);
  const nextWords = new Set(nextWordsArr);
  
  const intersection = Array.from(prevWords).filter(w => nextWords.has(w)).length;
  const combined = new Set(prevWordsArr.concat(nextWordsArr));
  const union = combined.size;
  
  if (union === 0) return 0;
  const similarity = intersection / union;
  return Math.round((1 - similarity) * 100);
}

async function summarizeWebsiteChanges(
  competitorName: string,
  previousContent: string,
  newContent: string,
  changeScore: number
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `Analyze changes to ${competitorName}'s website content.

Change magnitude: ${changeScore}% different from previous crawl

PREVIOUS CONTENT (excerpt):
${previousContent.substring(0, 3000)}

CURRENT CONTENT (excerpt):
${newContent.substring(0, 3000)}

Provide a 2-3 sentence summary of the key changes detected. Focus on:
- Messaging or positioning changes
- New products, services, or features announced
- Pricing or offering updates
- Team or leadership changes
- Campaign or marketing updates

If changes appear to be only dynamic content (dates, counters, copyright years) or minor formatting, respond with: "No significant messaging changes detected."

Summary:`
        }
      ]
    });
    
    const textBlock = response.content.find(block => block.type === "text");
    return textBlock?.text || "Unable to summarize changes.";
  } catch (error) {
    console.error("Error summarizing website changes:", error);
    return "Changes detected but summary unavailable.";
  }
}

export async function monitorCompetitorWebsite(
  competitorId: string,
  userId?: string,
  tenantDomain?: string
): Promise<WebsiteMonitoringResult> {
  const competitor = await storage.getCompetitor(competitorId);
  if (!competitor) {
    throw new Error("Competitor not found");
  }
  
  const now = new Date();
  
  try {
    await delay(REQUEST_DELAY_MS + Math.random() * 500);
    
    const crawlResult = await crawlCompetitorWebsite(competitor.url);
    
    if (crawlResult.pages.length === 0) {
      return {
        competitorId: competitor.id,
        competitorName: competitor.name,
        hasChanges: false,
        changeScore: 0,
        status: "no_content",
        message: "Unable to crawl website - site may be unavailable",
        pagesMonitored: 0,
      };
    }
    
    const newContent = getCombinedContent(crawlResult);
    const previousContent = competitor.previousWebsiteContent || "";
    
    const changeScore = calculateChangeScore(previousContent, newContent);
    const hasSignificantChanges = previousContent.length > 0 && changeScore >= MIN_CHANGE_THRESHOLD;
    
    let summary: string | undefined;
    
    if (hasSignificantChanges) {
      summary = await summarizeWebsiteChanges(competitor.name, previousContent, newContent, changeScore);
      
      const isRealChange = !summary.toLowerCase().includes("no significant");
      
      if (isRealChange && userId && tenantDomain) {
        await storage.createActivity({
          type: "website_update",
          competitorId: competitor.id,
          competitorName: competitor.name,
          description: summary,
          date: now.toISOString().split("T")[0],
          impact: changeScore >= 40 ? "High" : changeScore >= 25 ? "Medium" : "Low",
          userId,
          tenantDomain,
        });
      }
    }
    
    await storage.updateCompetitor(competitor.id, {
      previousWebsiteContent: newContent.substring(0, 100000),
      lastWebsiteMonitor: now,
      crawlData: {
        pagesCrawled: crawlResult.pages.map(p => ({
          url: p.url,
          pageType: p.pageType,
          title: p.title,
          wordCount: p.wordCount,
        })),
        totalWordCount: crawlResult.totalWordCount,
        crawledAt: crawlResult.crawledAt,
      },
      lastFullCrawl: now,
      blogSnapshot: crawlResult.blogSnapshot ? {
        ...crawlResult.blogSnapshot,
        capturedAt: now.toISOString(),
      } : undefined,
      linkedInUrl: competitor.linkedInUrl || crawlResult.socialLinks.linkedIn,
      instagramUrl: competitor.instagramUrl || crawlResult.socialLinks.instagram,
    });
    
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      hasChanges: hasSignificantChanges && !summary?.toLowerCase().includes("no significant"),
      changeScore,
      summary: hasSignificantChanges ? summary : undefined,
      status: "success",
      pagesMonitored: crawlResult.pages.length,
    };
    
  } catch (error: any) {
    console.error(`Error monitoring website for ${competitor.name}:`, error);
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      hasChanges: false,
      changeScore: 0,
      status: "error",
      message: error.message || "Unknown error occurred",
      pagesMonitored: 0,
    };
  }
}

export async function monitorAllCompetitorsForTenant(
  tenantDomain: string
): Promise<WebsiteMonitoringResult[]> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) {
    throw new Error("Tenant not found");
  }
  
  if (tenant.plan === "free" || tenant.plan === "trial") {
    throw new Error("Website monitoring is a premium feature. Please upgrade your plan to access this functionality.");
  }
  
  const users = await storage.getUsersByDomain(tenantDomain);
  const allResults: WebsiteMonitoringResult[] = [];
  
  for (const user of users) {
    const competitors = await storage.getCompetitorsByUserId(user.id);
    
    for (const competitor of competitors) {
      try {
        const result = await monitorCompetitorWebsite(competitor.id, user.id, tenantDomain);
        allResults.push(result);
        
        await delay(REQUEST_DELAY_MS);
      } catch (error) {
        console.error(`Error monitoring ${competitor.name}:`, error);
        allResults.push({
          competitorId: competitor.id,
          competitorName: competitor.name,
          hasChanges: false,
          changeScore: 0,
          status: "error",
          message: "Failed to monitor",
          pagesMonitored: 0,
        });
      }
    }
  }
  
  return allResults;
}
