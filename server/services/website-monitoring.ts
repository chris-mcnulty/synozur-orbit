import { storage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import { crawlCompetitorWebsite, getCombinedContent, buildCrawlData } from "./web-crawler";
import { notifications } from "./notifications";

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
  status: "success" | "error" | "no_content" | "timeout";
  message?: string;
  pagesMonitored: number;
}

const MIN_CHANGE_THRESHOLD = 5;
const REQUEST_DELAY_MS = 1500;

// Empty/near-empty crawl guard thresholds. A page that comes back essentially
// empty (a JS-only shell, a temporary outage, a bot block, or a mid-deploy
// blank page) or that collapses to a tiny fraction of the previously-seen
// content is treated like an unreachable crawl, so it never produces a false
// "complete content removal" alert or overwrites a good baseline snapshot.
export const MIN_ABSOLUTE_CONTENT_WORDS = 50; // fewer real words than this = essentially empty
export const MIN_ABSOLUTE_CONTENT_CHARS = 200; // combined content shorter than this = essentially empty
export const MIN_PREV_CONTENT_FOR_COLLAPSE = 500; // only flag a collapse when we had substantial prior content
export const COLLAPSE_FRACTION = 0.15; // new content under this fraction of previous = suspicious collapse

// Returns true when a crawl looks like an unreachable/failed fetch rather than a
// genuine content change: either it is below a sane absolute size, or it dropped
// to a tiny fraction of the previously-stored content.
export function isEmptyOrCollapsedCrawl(
  newContent: string,
  previousContent: string,
  totalWordCount: number,
): boolean {
  const newLen = newContent.trim().length;

  // Absolute floor: a real site page has more than a few dozen words.
  if (totalWordCount < MIN_ABSOLUTE_CONTENT_WORDS || newLen < MIN_ABSOLUTE_CONTENT_CHARS) {
    return true;
  }

  // Relative collapse: previously had substantial content, now a tiny fraction.
  const prevLen = previousContent.trim().length;
  if (prevLen >= MIN_PREV_CONTENT_FOR_COLLAPSE && newLen < prevLen * COLLAPSE_FRACTION) {
    return true;
  }

  return false;
}

// Page-coverage collapse: when a site was previously crawled across several pages
// but this run only reached a fraction of them, whole sections (services, about,
// insights, etc.) vanish from the comparison and the AI wrongly concludes the
// company "removed" or "abandoned" those themes. This almost always means the
// crawler failed to reach the sub-pages this time — not that the site changed.
// e.g. a multi-page site that suddenly yields only its homepage.
export const MIN_PREV_PAGES_FOR_COVERAGE = 3; // only guard sites we've seen as multi-page
export const COVERAGE_COLLAPSE_FRACTION = 0.4; // this run reached < 40% of prior pages = partial
// Escape hatch: transient partial crawls self-heal (the next full crawl refreshes
// the baseline within days). If the richer baseline has NOT been refreshed by a
// good crawl in this long, the reduced coverage is the site's real new shape, so
// stop guarding and let it become the new baseline — otherwise monitoring would be
// stuck comparing against a stale page count forever and miss real future changes.
export const COVERAGE_COLLAPSE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getPrevPageCount(prevCrawlData: any): number {
  const pages = prevCrawlData?.pagesCrawled;
  return Array.isArray(pages) ? pages.length : 0;
}

export function isCoverageCollapse(
  prevCrawlData: any,
  currentPageCount: number,
  rowFallbackTimestamp?: Date | null,
): boolean {
  const prevPages = getPrevPageCount(prevCrawlData);
  if (prevPages < MIN_PREV_PAGES_FOR_COVERAGE) return false;
  if (currentPageCount >= prevPages * COVERAGE_COLLAPSE_FRACTION) return false;

  // Only guard while the richer baseline is still fresh. A stale baseline means
  // no full crawl has succeeded in a long time, so treat the reduction as real.
  const crawledAtRaw = prevCrawlData?.crawledAt;

  // When crawledAt is absent (rows written before this guard existed), fall back
  // to the row-level last_full_crawl / last_website_monitor timestamp so that
  // the 30-day escape hatch can still disarm the guard.  Without this, legacy
  // rows stay stuck in permanent-guard-active state and silently skip every crawl.
  const crawledAt = crawledAtRaw
    ? new Date(crawledAtRaw).getTime()
    : rowFallbackTimestamp
      ? rowFallbackTimestamp.getTime()
      : 0;

  // If we still have no timestamp at all, keep the guard active (conservative)
  // but this should now only happen for rows with no crawl timestamps whatsoever.
  if (!crawledAt) return true;

  if (Date.now() - crawledAt > COVERAGE_COLLAPSE_MAX_AGE_MS) return false;

  return true;
}

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
  const isMassiveChange = changeScore >= 70;
  const migrationGuidance = isMassiveChange
    ? `
IMPORTANT — HIGH CHANGE SCORE CONTEXT:
A ${changeScore}% change score often indicates a website platform migration, CMS change, or full redesign rather than a strategic pivot. Before concluding the company changed its strategy, ask yourself:
- Do both versions still serve the same general market or industry?
- Do both versions still describe similar core services or capabilities (even if phrased differently)?
- Is the structure/template dramatically different (suggesting a new CMS or theme)?

If the SAME core services and market positioning are present in both versions (even described with different words), classify this as a "design" change (platform/redesign) and set noSignificantChanges to true — do NOT report it as a strategic pivot away from those services.
Only report a genuine strategic pivot if specific service lines, product categories, or target markets are clearly PRESENT in the previous version and clearly ABSENT from the current version.
`
    : "";

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `Analyze changes to ${competitorName}'s website content.

Change magnitude: ${changeScore}% different from previous crawl
${migrationGuidance}
CRAWL COVERAGE CAVEAT — READ FIRST:
This comparison only samples a subset of the site's pages, and the exact pages captured can differ from one crawl to the next. A topic, service, product, or theme that appears in the PREVIOUS excerpt but not the CURRENT excerpt may simply not have been crawled this time — it is NOT evidence the company removed, dropped, or abandoned it. Only report that something was removed or abandoned when the CURRENT content actively replaces, contradicts, or clearly discontinues it on a page that still exists. When a theme is merely missing from the current excerpt, do NOT claim it was removed or abandoned — treat it as "not captured this crawl" and, if that is the only apparent change, set noSignificantChanges to true.

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
- design: Visual redesigns, layout changes, UX updates (including platform migrations and full site rebuilds)

Only include categories where actual changes were detected in the "categories" array.

If changes appear to be only dynamic content (dates, counters, copyright years), minor formatting, or a platform/CMS migration where the same core services remain, respond with:
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
  tenantDomain?: string,
  signal?: AbortSignal
): Promise<WebsiteMonitoringResult> {
  const competitor = await storage.getCompetitor(competitorId);
  if (!competitor) {
    throw new Error("Competitor not found");
  }
  
  const now = new Date();
  
  try {
    await delay(REQUEST_DELAY_MS + Math.random() * 500);
    
    const crawlResult = await crawlCompetitorWebsite(competitor.url, { signal });
    
    if (crawlResult.pages.length === 0) {
      await storage.incrementCompetitorCrawlFailures(competitor.id);
      // Stamp lastWebsiteMonitor even on failure so the sweep freshness gate
      // (now - lastWebsiteMonitor < intervalMs) engages and prevents re-queueing
      // on every sweep — mirrors the pricing monitor's explicit non-success stamping.
      await storage.updateCompetitor(competitor.id, { lastWebsiteMonitor: now }).catch(() => {});
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
    // Use the snapshot that was current at load time as the initial reference,
    // but we will re-read from the DB below (after the network crawl) to catch
    // any accept-baseline that fired while we were crawling.
    const previousContentAtLoad = competitor.previousWebsiteContent || "";

    // Treat an essentially-empty or collapsed crawl like an unreachable site:
    // skip change detection + alert creation and leave the stored baseline
    // untouched so a transient blank fetch never overwrites a good snapshot.
    if (isEmptyOrCollapsedCrawl(newContent, previousContentAtLoad, crawlResult.totalWordCount)) {
      await storage.incrementCompetitorCrawlFailures(competitor.id).catch(() => {});
      await storage.updateCompetitor(competitor.id, { lastWebsiteMonitor: now }).catch(() => {});
      return {
        competitorId: competitor.id,
        competitorName: competitor.name,
        hasChanges: false,
        changeScore: 0,
        status: "no_content",
        message: "Crawl returned near-empty content - site may be unavailable",
        pagesMonitored: crawlResult.pages.length,
      };
    }

    // Page-coverage collapse: this run reached far fewer pages than before, so
    // whole sections are missing and would read as false "removals". Skip
    // analysis and preserve the richer baseline for the next full crawl.
    if (isCoverageCollapse(competitor.crawlData, crawlResult.pages.length, competitor.lastFullCrawl ?? competitor.lastWebsiteMonitor)) {
      console.log(`[WebsiteMonitoring] Skipping ${competitor.name}: coverage collapse (${crawlResult.pages.length} of ${getPrevPageCount(competitor.crawlData)} pages)`);
      await storage.updateCompetitor(competitor.id, { lastWebsiteMonitor: now }).catch(() => {});
      return {
        competitorId: competitor.id,
        competitorName: competitor.name,
        hasChanges: false,
        changeScore: 0,
        status: "no_content",
        message: "Crawl reached fewer pages than usual - skipped to avoid a false change",
        pagesMonitored: crawlResult.pages.length,
      };
    }

    await storage.resetCompetitorCrawlFailures(competitor.id);

    // Re-read previousWebsiteContent from the DB now that the network crawl is
    // done.  A crawl can take 10-30 s; during that window an accept-baseline
    // request may have cleared previousWebsiteContent.  The in-memory snapshot
    // we loaded at the top of this function would still hold the old content,
    // causing a diff + alert against data the user just dismissed.  Refreshing
    // here closes that race: if the baseline was cleared mid-crawl we get an
    // empty string, the fresh-baseline fast-path below stores the new snapshot
    // silently, and no alert is emitted.
    const refreshed = await storage.getCompetitor(competitorId);
    const previousContent = refreshed?.previousWebsiteContent || "";

    // Explicit fast-path for a null/cleared baseline (either set from the start
    // or just cleared by an accept-baseline while we were crawling).  Store the
    // fresh crawl as the new baseline and return immediately — no diff, no alert.
    if (!previousContent) {
      console.log(`[WebsiteMonitoring] ${competitor.name}: no prior baseline — storing fresh snapshot without alerting`);
      const baselineUpdates: any = {
        previousWebsiteContent: newContent.substring(0, 100000),
        lastWebsiteMonitor: now,
        crawlData: buildCrawlData(crawlResult),
        lastFullCrawl: now,
        blogSnapshot: crawlResult.blogSnapshot ? {
          ...crawlResult.blogSnapshot,
          capturedAt: now.toISOString(),
        } : undefined,
        linkedInUrl: competitor.linkedInUrl || crawlResult.socialLinks.linkedIn,
        instagramUrl: competitor.instagramUrl || crawlResult.socialLinks.instagram,
        twitterUrl: competitor.twitterUrl || crawlResult.socialLinks.twitter,
        facebookUrl: competitor.facebookUrl || crawlResult.socialLinks.facebook,
      };
      await storage.updateCompetitor(competitor.id, baselineUpdates);
      if (competitor.organizationId) {
        await storage.updateOrganization(competitor.organizationId, {
          previousWebsiteContent: baselineUpdates.previousWebsiteContent,
          lastWebsiteMonitor: now,
          crawlData: baselineUpdates.crawlData,
          lastFullCrawl: now,
          blogSnapshot: baselineUpdates.blogSnapshot,
          linkedInUrl: baselineUpdates.linkedInUrl,
          instagramUrl: baselineUpdates.instagramUrl,
        }).catch(err => console.error("[Org Update] Baseline sync failed:", err.message));
      }
      return {
        competitorId: competitor.id,
        competitorName: competitor.name,
        hasChanges: false,
        changeScore: 0,
        status: "success",
        pagesMonitored: crawlResult.pages.length,
      };
    }

    const changeScore = calculateChangeScore(previousContent, newContent);
    const hasSignificantChanges = changeScore >= MIN_CHANGE_THRESHOLD;
    
    let summary: string | undefined;
    let changeAnalysis: StructuredChangeAnalysis | undefined;
    
    if (hasSignificantChanges) {
      const result = await analyzeWebsiteChanges(competitor.name, previousContent, newContent, changeScore);
      summary = result.summary;
      changeAnalysis = result.analysis || undefined;
      
      const isRealChange = !summary.toLowerCase().includes("no significant");
      
      const impactLevel = changeScore >= 40 ? "High" : changeScore >= 25 ? "Medium" : "Low";

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
          impact: impactLevel,
          userId,
          tenantDomain,
          marketId: competitor.marketId,
        });
      }

      const resolvedTenantDomain = tenantDomain || competitor.tenantDomain;
      if (isRealChange && resolvedTenantDomain) {
        const highestSignificance = changeAnalysis?.changes?.length
          ? (() => {
              if (changeAnalysis.changes.some(c => c.significance === "high")) return "high" as const;
              if (changeAnalysis.changes.some(c => c.significance === "medium")) return "medium" as const;
              return "low" as const;
            })()
          : impactLevel === "High" ? "high" as const
          : impactLevel === "Medium" ? "medium" as const
          : "low" as const;

        notifications.dispatch(resolvedTenantDomain, "competitor_change", {
          competitorId: competitor.id,
          competitorName: competitor.name,
          summary: summary || `Website content changed (${changeScore}% change detected)`,
          significance: highestSignificance,
        }).catch(err => console.error("[WebsiteMonitoring] Notification dispatch failed:", err));
      }
    }
    
    const monitorUpdates: any = {
      previousWebsiteContent: newContent.substring(0, 100000),
      lastWebsiteMonitor: now,
      crawlData: buildCrawlData(crawlResult),
      lastFullCrawl: now,
      blogSnapshot: crawlResult.blogSnapshot ? {
        ...crawlResult.blogSnapshot,
        capturedAt: now.toISOString(),
      } : undefined,
      linkedInUrl: competitor.linkedInUrl || crawlResult.socialLinks.linkedIn,
      instagramUrl: competitor.instagramUrl || crawlResult.socialLinks.instagram,
      twitterUrl: competitor.twitterUrl || crawlResult.socialLinks.twitter,
      facebookUrl: competitor.facebookUrl || crawlResult.socialLinks.facebook,
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
    if (!signal?.aborted) {
      await storage.incrementCompetitorCrawlFailures(competitor.id).catch(() => {});
      await storage.updateCompetitor(competitor.id, { lastWebsiteMonitor: now }).catch(() => {});
    }
    return {
      competitorId: competitor.id,
      competitorName: competitor.name,
      hasChanges: false,
      changeScore: 0,
      status: signal?.aborted ? "timeout" : "error",
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
      // Stamp lastWebsiteMonitor even on a skipped run so the sweep freshness
      // gate (now - lastWebsiteMonitor < intervalMs) engages and the profile is
      // not re-queued every scheduler pass.
      await storage.updateCompanyProfile(companyProfile.id, { lastWebsiteMonitor: now }).catch(() => {});
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
    // Use the snapshot that was current at load time for the size-collapse
    // guards below, then re-read from DB after the crawl to catch any
    // accept-baseline that fired while we were crawling.
    const previousContentAtLoad = companyProfile.previousWebsiteContent || "";

    // Treat an essentially-empty or collapsed crawl like an unreachable site:
    // skip change detection + alert creation and leave the stored baseline
    // untouched so a transient blank fetch never overwrites a good snapshot.
    if (isEmptyOrCollapsedCrawl(newContent, previousContentAtLoad, crawlResult.totalWordCount)) {
      await storage.updateCompanyProfile(companyProfile.id, { lastWebsiteMonitor: now }).catch(() => {});
      return {
        companyProfileId: companyProfile.id,
        companyName: companyProfile.companyName,
        hasChanges: false,
        changeScore: 0,
        status: "no_content",
        message: "Crawl returned near-empty content - site may be unavailable",
        pagesMonitored: crawlResult.pages.length,
      };
    }

    // Page-coverage collapse: this run reached far fewer pages than before, so
    // whole sections are missing and would read as false "removals". Skip
    // analysis and preserve the richer baseline for the next full crawl.
    if (isCoverageCollapse(companyProfile.crawlData, crawlResult.pages.length, companyProfile.lastFullCrawl ?? companyProfile.lastWebsiteMonitor)) {
      console.log(`[WebsiteMonitoring] Skipping baseline ${companyProfile.companyName}: coverage collapse (${crawlResult.pages.length} of ${getPrevPageCount(companyProfile.crawlData)} pages)`);
      await storage.updateCompanyProfile(companyProfile.id, { lastWebsiteMonitor: now }).catch(() => {});
      return {
        companyProfileId: companyProfile.id,
        companyName: companyProfile.companyName,
        hasChanges: false,
        changeScore: 0,
        status: "no_content",
        message: "Crawl reached fewer pages than usual - skipped to avoid a false change",
        pagesMonitored: crawlResult.pages.length,
      };
    }

    // Re-read previousWebsiteContent from the DB now that the network crawl is
    // done.  An accept-baseline request may have cleared the field while we were
    // crawling; re-reading here closes that race.
    const refreshedProfile = await storage.getCompanyProfile(companyProfileId);
    const previousContent = refreshedProfile?.previousWebsiteContent || "";

    // Explicit fast-path for a null/cleared baseline — store the fresh crawl as
    // the new baseline and return immediately without diffing or alerting.
    if (!previousContent) {
      console.log(`[WebsiteMonitoring] Baseline ${companyProfile.companyName}: no prior baseline — storing fresh snapshot without alerting`);
      const baselineUpdates: any = {
        previousWebsiteContent: newContent.substring(0, 100000),
        lastWebsiteMonitor: now,
        crawlData: buildCrawlData(crawlResult),
        lastFullCrawl: now,
        blogSnapshot: crawlResult.blogSnapshot ? {
          ...crawlResult.blogSnapshot,
          capturedAt: now.toISOString(),
        } : undefined,
      };
      await storage.updateCompanyProfile(companyProfile.id, baselineUpdates);
      return {
        companyProfileId: companyProfile.id,
        companyName: companyProfile.companyName,
        hasChanges: false,
        changeScore: 0,
        status: "success",
        pagesMonitored: crawlResult.pages.length,
      };
    }

    const changeScore = calculateChangeScore(previousContent, newContent);
    const hasSignificantChanges = changeScore >= MIN_CHANGE_THRESHOLD;
    
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
      crawlData: buildCrawlData(crawlResult),
      lastFullCrawl: now,
      blogSnapshot: crawlResult.blogSnapshot ? {
        ...crawlResult.blogSnapshot,
        capturedAt: now.toISOString(),
      } : undefined,
      linkedInUrl: companyProfile.linkedInUrl || crawlResult.socialLinks.linkedIn,
      instagramUrl: companyProfile.instagramUrl || crawlResult.socialLinks.instagram,
      twitterUrl: companyProfile.twitterUrl || crawlResult.socialLinks.twitter,
      facebookUrl: companyProfile.facebookUrl || crawlResult.socialLinks.facebook,
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
    // Stamp so a persistently failing site doesn't get re-queued every sweep.
    await storage.updateCompanyProfile(companyProfile.id, { lastWebsiteMonitor: now }).catch(() => {});
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
  status: "success" | "error" | "no_content" | "no_url" | "timeout";
  message?: string;
  pagesMonitored: number;
}

export async function monitorProductWebsite(
  productId: string,
  userId: string,
  tenantDomain: string,
  marketId?: string,
  signal?: AbortSignal
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

    const crawlResult = await crawlCompetitorWebsite(product.url, { signal });

    if (crawlResult.pages.length === 0) {
      await storage.incrementProductCrawlFailures(product.id);
      await storage.updateProduct(product.id, { lastWebsiteMonitor: now }).catch(() => {});
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

    // Treat an essentially-empty or collapsed crawl like an unreachable site:
    // skip change detection + alert creation and leave the stored baseline
    // untouched so a transient blank fetch never overwrites a good snapshot.
    if (isEmptyOrCollapsedCrawl(newContent, previousContent, crawlResult.totalWordCount)) {
      await storage.incrementProductCrawlFailures(product.id).catch(() => {});
      await storage.updateProduct(product.id, { lastWebsiteMonitor: now }).catch(() => {});
      return {
        productId: product.id,
        productName: product.name,
        hasChanges: false,
        changeScore: 0,
        status: "no_content",
        message: "Crawl returned near-empty content - site may be unavailable",
        pagesMonitored: crawlResult.pages.length,
      };
    }

    // Page-coverage collapse: this run reached far fewer pages than before, so
    // whole sections are missing and would read as false "removals". Skip
    // analysis and preserve the richer baseline for the next full crawl.
    if (isCoverageCollapse(product.crawlData, crawlResult.pages.length, product.lastWebsiteMonitor)) {
      console.log(`[WebsiteMonitoring] Skipping product ${product.name}: coverage collapse (${crawlResult.pages.length} of ${getPrevPageCount(product.crawlData)} pages)`);
      await storage.updateProduct(product.id, { lastWebsiteMonitor: now }).catch(() => {});
      return {
        productId: product.id,
        productName: product.name,
        hasChanges: false,
        changeScore: 0,
        status: "no_content",
        message: "Crawl reached fewer pages than usual - skipped to avoid a false change",
        pagesMonitored: crawlResult.pages.length,
      };
    }

    await storage.resetProductCrawlFailures(product.id);

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
      crawlData: buildCrawlData(crawlResult),
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
    if (!signal?.aborted) {
      await storage.incrementProductCrawlFailures(product.id).catch(() => {});
      await storage.updateProduct(product.id, { lastWebsiteMonitor: now }).catch(() => {});
    }
    return {
      productId: product.id,
      productName: product.name,
      hasChanges: false,
      changeScore: 0,
      status: signal?.aborted ? "timeout" : "error",
      message: error.message || "Unknown error occurred",
      pagesMonitored: 0,
    };
  }
}
