import { storage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import { crawlCompetitorWebsite, getCombinedContent } from "./web-crawler";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

interface StructuredChange {
  category: "messaging" | "pricing" | "product" | "team" | "content" | "design";
  description: string;
  significance: "high" | "medium" | "low";
}

interface StructuredChangeAnalysis {
  categories: string[];
  changes: StructuredChange[];
  narrative: string;
}

interface WebsiteMonitoringResult {
  competitorId: string;
  competitorName: string;
  hasChanges: boolean;
  changeScore: number;
  summary?: string;
  changeAnalysis?: StructuredChangeAnalysis;
  status: "success" | "error" | "no_content";
  message?: string;
  pagesMonitored: number;
}

const MIN_CHANGE_THRESHOLD = 5;
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

async function analyzeWebsiteChanges(
  competitorName: string,
  previousContent: string,
  newContent: string,
  changeScore: number
): Promise<{ summary: string; analysis: StructuredChangeAnalysis | null }> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `Analyze changes to ${competitorName}'s website content.

Change magnitude: ${changeScore}% different from previous crawl

PREVIOUS CONTENT (excerpt):
${previousContent.substring(0, 6000)}

CURRENT CONTENT (excerpt):
${newContent.substring(0, 6000)}

Respond with a JSON object (no markdown, no code fences) with the following structure:
{
  "noSignificantChanges": false,
  "categories": ["messaging", "pricing", "product", "team", "content", "design"],
  "changes": [
    {
      "category": "messaging|pricing|product|team|content|design",
      "description": "Brief description of the specific change",
      "significance": "high|medium|low"
    }
  ],
  "narrative": "2-3 sentence summary of the key changes and their strategic implications"
}

Category definitions:
- messaging: Changes to positioning, taglines, value propositions, or brand language
- pricing: Changes to pricing tiers, plans, discounts, or pricing page content
- product: New products, features, capabilities, or service offerings
- team: Leadership changes, new hires, team page updates
- content: Blog posts, case studies, whitepapers, or resource updates
- design: Visual redesigns, layout changes, UX updates

Only include categories where actual changes were detected in the "categories" array.

If changes appear to be only dynamic content (dates, counters, copyright years) or minor formatting, respond with:
{"noSignificantChanges": true, "categories": [], "changes": [], "narrative": "No significant messaging changes detected."}

JSON:`
        }
      ]
    });
    
    const textBlock = response.content.find(block => block.type === "text");
    let rawText = textBlock?.text || "";
    rawText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    
    try {
      const parsed = JSON.parse(rawText);
      
      if (parsed.noSignificantChanges) {
        return {
          summary: "No significant messaging changes detected.",
          analysis: null,
        };
      }
      
      const analysis: StructuredChangeAnalysis = {
        categories: parsed.categories || [],
        changes: (parsed.changes || []).map((c: any) => ({
          category: c.category,
          description: c.description,
          significance: c.significance,
        })),
        narrative: parsed.narrative || "",
      };
      
      return {
        summary: analysis.narrative,
        analysis,
      };
    } catch {
      let fallbackSummary = "Changes detected but analysis unavailable.";
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extracted = JSON.parse(jsonMatch[0]);
          if (extracted.narrative) fallbackSummary = extracted.narrative;
        }
      } catch {}
      return {
        summary: fallbackSummary,
        analysis: null,
      };
    }
  } catch (error) {
    console.error("Error analyzing website changes:", error);
    return {
      summary: "Changes detected but analysis unavailable.",
      analysis: null,
    };
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
    let changeAnalysis: StructuredChangeAnalysis | undefined;
    
    if (hasSignificantChanges) {
      const result = await analyzeWebsiteChanges(competitor.name, previousContent, newContent, changeScore);
      summary = result.summary;
      changeAnalysis = result.analysis || undefined;
      
      const isRealChange = !summary.toLowerCase().includes("no significant");
      
      if (isRealChange && userId && tenantDomain) {
        await storage.createActivity({
          type: "website_update",
          sourceType: "competitor",
          competitorId: competitor.id,
          competitorName: competitor.name,
          description: `Website content changed (${changeScore}% change detected)`,
          summary,
          details: {
            changeScore,
            pagesMonitored: crawlResult.pages.length,
            crawledAt: crawlResult.crawledAt,
            changeAnalysis: changeAnalysis || undefined,
          },
          date: now.toISOString().split("T")[0],
          impact: changeScore >= 40 ? "High" : changeScore >= 25 ? "Medium" : "Low",
          userId,
          tenantDomain,
          marketId: competitor.marketId,
        });
      }
    }
    
    const monitorUpdates: any = {
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
    };

    await storage.updateCompetitor(competitor.id, monitorUpdates);

    if (competitor.organizationId) {
      await storage.updateOrganization(competitor.organizationId, {
        previousWebsiteContent: monitorUpdates.previousWebsiteContent,
        lastWebsiteMonitor: now,
        crawlData: monitorUpdates.crawlData,
        lastFullCrawl: now,
        blogSnapshot: monitorUpdates.blogSnapshot,
        linkedInUrl: monitorUpdates.linkedInUrl,
        instagramUrl: monitorUpdates.instagramUrl,
      }).catch(err => console.error("[Org Update] Monitor sync failed:", err.message));
    }
    
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      hasChanges: hasSignificantChanges && !summary?.toLowerCase().includes("no significant"),
      changeScore,
      summary: hasSignificantChanges ? summary : undefined,
      changeAnalysis: hasSignificantChanges ? changeAnalysis : undefined,
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

interface CompanyProfileMonitoringResult {
  companyProfileId: string;
  companyName: string;
  hasChanges: boolean;
  changeScore: number;
  summary?: string;
  changeAnalysis?: StructuredChangeAnalysis;
  status: "success" | "error" | "no_content";
  message?: string;
  pagesMonitored: number;
}

export async function monitorCompanyProfileWebsite(
  companyProfileId: string,
  userId: string,
  tenantDomain: string,
  marketId?: string
): Promise<CompanyProfileMonitoringResult> {
  const companyProfile = await storage.getCompanyProfile(companyProfileId);
  if (!companyProfile) {
    throw new Error("Company profile not found");
  }
  
  const now = new Date();
  
  try {
    await delay(REQUEST_DELAY_MS + Math.random() * 500);
    
    const crawlResult = await crawlCompetitorWebsite(companyProfile.websiteUrl);
    
    if (crawlResult.pages.length === 0) {
      return {
        companyProfileId: companyProfile.id,
        companyName: companyProfile.companyName,
        hasChanges: false,
        changeScore: 0,
        status: "no_content",
        message: "Unable to crawl website - site may be unavailable",
        pagesMonitored: 0,
      };
    }
    
    const newContent = getCombinedContent(crawlResult);
    const previousContent = companyProfile.previousWebsiteContent || "";
    
    const changeScore = calculateChangeScore(previousContent, newContent);
    const hasSignificantChanges = previousContent.length > 0 && changeScore >= MIN_CHANGE_THRESHOLD;
    
    let summary: string | undefined;
    let changeAnalysis: StructuredChangeAnalysis | undefined;
    
    if (hasSignificantChanges) {
      const result = await analyzeWebsiteChanges(companyProfile.companyName, previousContent, newContent, changeScore);
      summary = result.summary;
      changeAnalysis = result.analysis || undefined;
      
      const isRealChange = !summary.toLowerCase().includes("no significant");
      
      if (isRealChange) {
        await storage.createActivity({
          type: "website_update",
          sourceType: "baseline",
          companyProfileId: companyProfile.id,
          competitorName: companyProfile.companyName,
          description: `Your website content changed (${changeScore}% change detected)`,
          summary,
          details: {
            changeScore,
            pagesMonitored: crawlResult.pages.length,
            crawledAt: crawlResult.crawledAt,
            changeAnalysis: changeAnalysis || undefined,
          },
          date: now.toISOString().split("T")[0],
          impact: changeScore >= 40 ? "High" : changeScore >= 25 ? "Medium" : "Low",
          userId,
          tenantDomain,
          marketId: marketId || companyProfile.marketId || undefined,
        });
      }
    }
    
    const profileMonitorUpdates: any = {
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
      linkedInUrl: companyProfile.linkedInUrl || crawlResult.socialLinks.linkedIn,
      instagramUrl: companyProfile.instagramUrl || crawlResult.socialLinks.instagram,
      twitterUrl: companyProfile.twitterUrl || crawlResult.socialLinks.twitter,
    };

    await storage.updateCompanyProfile(companyProfile.id, profileMonitorUpdates);

    if (companyProfile.organizationId) {
      await storage.updateOrganization(companyProfile.organizationId, {
        previousWebsiteContent: profileMonitorUpdates.previousWebsiteContent,
        lastWebsiteMonitor: now,
        crawlData: profileMonitorUpdates.crawlData,
        lastFullCrawl: now,
        blogSnapshot: profileMonitorUpdates.blogSnapshot,
        linkedInUrl: profileMonitorUpdates.linkedInUrl,
        instagramUrl: profileMonitorUpdates.instagramUrl,
      }).catch(err => console.error("[Org Update] Baseline monitor sync failed:", err.message));
    }
    
    return {
      companyProfileId: companyProfile.id,
      companyName: companyProfile.companyName,
      hasChanges: hasSignificantChanges && !summary?.toLowerCase().includes("no significant"),
      changeScore,
      summary: hasSignificantChanges ? summary : undefined,
      changeAnalysis: hasSignificantChanges ? changeAnalysis : undefined,
      status: "success",
      pagesMonitored: crawlResult.pages.length,
    };
    
  } catch (error: any) {
    console.error(`Error monitoring website for ${companyProfile.companyName}:`, error);
    return {
      companyProfileId: companyProfile.id,
      companyName: companyProfile.companyName,
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

interface ProductMonitoringResult {
  productId: string;
  productName: string;
  hasChanges: boolean;
  changeScore: number;
  summary?: string;
  changeAnalysis?: StructuredChangeAnalysis;
  status: "success" | "error" | "no_content" | "no_url";
  message?: string;
  pagesMonitored: number;
}

export async function monitorProductWebsite(
  productId: string,
  userId: string,
  tenantDomain: string,
  marketId?: string
): Promise<ProductMonitoringResult> {
  const product = await storage.getProduct(productId);
  if (!product) {
    throw new Error("Product not found");
  }

  if (!product.url) {
    return {
      productId: product.id,
      productName: product.name,
      hasChanges: false,
      changeScore: 0,
      status: "no_url",
      message: "Product has no URL configured",
      pagesMonitored: 0,
    };
  }

  const now = new Date();

  try {
    await delay(REQUEST_DELAY_MS + Math.random() * 500);

    const crawlResult = await crawlCompetitorWebsite(product.url);

    if (crawlResult.pages.length === 0) {
      return {
        productId: product.id,
        productName: product.name,
        hasChanges: false,
        changeScore: 0,
        status: "no_content",
        message: "Unable to crawl website - site may be unavailable or URL is invalid",
        pagesMonitored: 0,
      };
    }

    const newContent = getCombinedContent(crawlResult);
    const previousContent = product.previousWebsiteContent || "";

    const changeScore = calculateChangeScore(previousContent, newContent);
    const hasSignificantChanges = previousContent.length > 0 && changeScore >= MIN_CHANGE_THRESHOLD;

    let summary: string | undefined;
    let changeAnalysis: StructuredChangeAnalysis | undefined;

    if (hasSignificantChanges) {
      const result = await analyzeWebsiteChanges(product.name, previousContent, newContent, changeScore);
      summary = result.summary;
      changeAnalysis = result.analysis || undefined;

      const isRealChange = !summary.toLowerCase().includes("no significant");

      if (isRealChange) {
        await storage.createActivity({
          type: "website_update",
          sourceType: "product",
          competitorName: product.name,
          description: `Product website content changed (${changeScore}% change detected)`,
          summary,
          details: {
            productId: product.id,
            changeScore,
            pagesMonitored: crawlResult.pages.length,
            crawledAt: crawlResult.crawledAt,
            changeAnalysis: changeAnalysis || undefined,
          },
          date: now.toISOString().split("T")[0],
          impact: changeScore >= 40 ? "High" : changeScore >= 25 ? "Medium" : "Low",
          userId,
          tenantDomain,
          marketId,
        });
      }
    }

    await storage.updateProduct(product.id, {
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
    });

    const isRealChange = hasSignificantChanges && !summary?.toLowerCase().includes("no significant");

    return {
      productId: product.id,
      productName: product.name,
      hasChanges: isRealChange,
      changeScore,
      summary: hasSignificantChanges ? summary : undefined,
      changeAnalysis: hasSignificantChanges ? changeAnalysis : undefined,
      status: "success",
      message: isRealChange
        ? `Detected ${changeScore}% content change` 
        : "No significant changes detected",
      pagesMonitored: crawlResult.pages.length,
    };
  } catch (error: any) {
    console.error(`Error monitoring website for product ${product.name}:`, error);
    return {
      productId: product.id,
      productName: product.name,
      hasChanges: false,
      changeScore: 0,
      status: "error",
      message: error.message || "Unknown error occurred",
      pagesMonitored: 0,
    };
  }
}
