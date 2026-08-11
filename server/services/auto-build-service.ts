import { storage } from "../storage";
import { analyzeCompetitorWebsite, generateGapAnalysis, generateRecommendations, aiCompanyResearch } from "../ai-service";
import { calculateScores, getCurrentWeeklyPeriod } from "./scoring-service";
import { runWithConcurrency, AI_CONCURRENCY } from "./promise-pool";
import { generateBriefing } from "./intelligence-briefing-service";
import { generateExecutiveSummary } from "./executive-summary-service";
import { monitorCompetitorPricing } from "./pricing-intelligence";
import { crawlCompetitorWebsite, getCombinedContent, buildCrawlData } from "./web-crawler";
import { monitorCompetitorSocialMedia, monitorCompanyProfileSocialMedia } from "./social-monitoring";
import { generateBattlecardForCompetitor } from "./battlecard-generator";
import { checkFeatureAccessAsync } from "./plan-policy";
import { validateCompetitorUrl } from "../utils/url-validator";
import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "./ai-usage-logger";

export interface EnrichmentGap {
  companyName: string;
  companyId: string;
  entityType: "baseline" | "competitor";
  missingFields: string[];
}

export interface AutoBuildProgress {
  status: "pending" | "running" | "completed" | "failed";
  currentStep: string;
  stepsCompleted: number;
  totalSteps: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  discoveredCompetitors: string[];
  details: string[];
  tenantDomain: string;
  marketId: string;
  userId: string;
  enrichmentGaps?: EnrichmentGap[];
}

const activeJobs = new Map<string, AutoBuildProgress>();

export function getAutoBuildStatus(jobId: string, tenantDomain?: string): AutoBuildProgress | null {
  const job = activeJobs.get(jobId);
  if (!job) return null;
  if (tenantDomain && job.tenantDomain !== tenantDomain) return null;
  return job;
}

export function getActiveJobForMarket(tenantDomain: string, marketId: string): { jobId: string; progress: AutoBuildProgress } | null {
  for (const [jobId, progress] of Array.from(activeJobs.entries())) {
    if (progress.tenantDomain === tenantDomain && progress.marketId === marketId && (progress.status === "running" || progress.status === "pending")) {
      return { jobId, progress };
    }
  }
  return null;
}

export async function startAutoBuild(
  userId: string,
  tenantDomain: string,
  marketId: string,
  options: {
    generateBriefing?: boolean;
    competitorCount?: number;
  } = {}
): Promise<string> {
  const { randomUUID } = await import("crypto");
  const jobId = `ab_${randomUUID()}`;

  const progress: AutoBuildProgress = {
    status: "pending",
    currentStep: "Initializing",
    stepsCompleted: 0,
    totalSteps: 14,
    startedAt: new Date(),
    discoveredCompetitors: [],
    details: [],
    tenantDomain,
    marketId,
    userId,
  };

  activeJobs.set(jobId, progress);

  runAutoBuildInBackground(jobId, userId, tenantDomain, marketId, options)
    .catch((err) => {
      const p = activeJobs.get(jobId);
      if (p) {
        p.status = "failed";
        p.error = err.message;
        p.details.push(`Failed: ${err.message}`);
      }
    });

  return jobId;
}

async function runAutoBuildInBackground(
  jobId: string,
  userId: string,
  tenantDomain: string,
  marketId: string,
  options: { generateBriefing?: boolean; competitorCount?: number }
): Promise<void> {
  const progress = activeJobs.get(jobId)!;
  progress.status = "running";
  const maxCompetitors = options.competitorCount || 6;

  try {
    const tenant = await storage.getTenantByDomain(tenantDomain);
    if (!tenant) {
      throw new Error(`Tenant not found for domain: ${tenantDomain}`);
    }

    // Resolve isDefaultMarket by comparing the requested marketId against the
    // tenant's default market (matches the pattern in server/context.ts). Storage
    // methods rely on this flag to OR-in `isNull(marketId)` for legacy NULL-market
    // baseline rows; hardcoding false silently excludes them.
    const defaultMarket = await storage.getDefaultMarket(tenant.id);
    const isDefaultMarket = !!defaultMarket && defaultMarket.id === marketId;

    const profile = await storage.getCompanyProfileByContext({
      tenantId: tenant.id,
      tenantDomain,
      marketId,
      isDefaultMarket,
    });

    if (!profile) {
      const allProfiles = await storage.getCompanyProfilesByTenantDomain(tenantDomain);
      const marketProfile = allProfiles.find((p: any) => p.marketId === marketId);
      if (!marketProfile) {
        throw new Error("No company profile found for this market. Please set up your company profile first.");
      }
      return runAutoBuildWithProfile(jobId, userId, tenantDomain, marketId, marketProfile, maxCompetitors, options, progress);
    }

    return runAutoBuildWithProfile(jobId, userId, tenantDomain, marketId, profile, maxCompetitors, options, progress);
  } catch (error: any) {
    progress.status = "failed";
    progress.error = error.message;
    progress.details.push(`Failed: ${error.message}`);
    throw error;
  }
}

async function runAutoBuildWithProfile(
  jobId: string,
  userId: string,
  tenantDomain: string,
  marketId: string,
  profile: any,
  maxCompetitors: number,
  options: { generateBriefing?: boolean },
  progress: AutoBuildProgress
): Promise<void> {
  const updateStep = (step: string) => {
    progress.currentStep = step;
    progress.details.push(step);
    console.log(`[Auto Build ${jobId}] ${step}`);
  };

  updateStep("Step 1/14: Crawling baseline company website...");
  try {
    if (profile.websiteUrl) {
      const crawlResult = await crawlCompetitorWebsite(profile.websiteUrl);
      if (crawlResult) {
        const socialLinks = crawlResult.socialLinks || {};
        const detectedBlogUrl = crawlResult.pages?.find(p => p.pageType === "blog")?.url ?? null;
        const profileUpdates: any = {
          crawlData: buildCrawlData(crawlResult),
          lastCrawl: new Date().toISOString(),
          lastFullCrawl: new Date(),
          // Stamp lastWebsiteMonitor + baseline content so scheduled sweeps
          // skip this freshly crawled profile instead of double-crawling.
          lastWebsiteMonitor: new Date(),
          previousWebsiteContent: getCombinedContent(crawlResult).substring(0, 100000),
          linkedInUrl: profile.linkedInUrl || socialLinks.linkedIn || null,
          instagramUrl: profile.instagramUrl || socialLinks.instagram || null,
          twitterUrl: profile.twitterUrl || socialLinks.twitter || null,
          facebookUrl: profile.facebookUrl || socialLinks.facebook || null,
          blogUrl: profile.blogUrl || detectedBlogUrl,
        };

        if (!profile.organizationId) {
          try {
            const org = await storage.findOrCreateOrganization(profile.websiteUrl, profile.companyName);
            profileUpdates.organizationId = org.id;
            await storage.incrementOrgRefCount(org.id);
            progress.details.push(`Linked baseline to organization directory: ${org.id}`);
          } catch (orgErr: any) {
            progress.details.push(`Organization linking warning: ${orgErr.message}`);
          }
        }

        await storage.updateCompanyProfile(profile.id, profileUpdates);
        progress.details.push(`Crawled ${crawlResult.pages?.length || 0} pages from ${profile.websiteUrl}`);
      }
    }
  } catch (err: any) {
    progress.details.push(`Baseline crawl warning: ${err.message}`);
  }
  progress.stepsCompleted = 1;

  updateStep("Step 2/14: Refreshing baseline social media...");
  try {
    await monitorCompanyProfileSocialMedia(profile.id, userId, tenantDomain, marketId);
    progress.details.push("Baseline social media refreshed");
  } catch (err: any) {
    progress.details.push(`Social refresh warning: ${err.message}`);
  }
  progress.stepsCompleted = 2;

  updateStep("Step 3/14: Discovering competitors with AI...");
  let suggestions: Array<{ name: string; url: string; description: string; rationale: string }> = [];
  try {
    const refreshedProfile = await storage.getCompanyProfile(profile.id);
    const analysisData = (refreshedProfile?.analysisData || refreshedProfile?.crawlData) as any || {};
    const crawlData = (refreshedProfile?.crawlData) as any || {};

    const crawlPages = Array.isArray(crawlData.pages) ? crawlData.pages : [];
    const websiteContentSummary = crawlPages.length > 0
      ? crawlPages.map((p: any) => `Page: ${p.title || p.url}\n${(p.content || p.text || "").substring(0, 500)}`).join("\n---\n").substring(0, 3000)
      : "";

    const buildDiscoveryPrompt = (broader: boolean) => {
      const scopeInstruction = broader
        ? `Find companies that operate in the same general business space, serve similar customers, or offer overlapping products/services. Cast a wide net — include adjacent competitors, indirect competitors, and companies that a customer might evaluate alongside ${profile.companyName}.`
        : `Focus on direct competitors in the same market segment. Include well-known industry leaders and emerging challengers.`;

      return `Analyze this company and suggest ${maxCompetitors} competing companies in the market:

Company: ${profile.companyName}
Website: ${profile.websiteUrl}
Industry: ${analysisData.industry || "Unknown"}
Description: ${analysisData.companyDescription || analysisData.valueProposition || profile.description || "No description available"}
Key offerings: ${analysisData.keyOfferings?.join(", ") || "Not specified"}
Value proposition: ${analysisData.valueProposition || "Not specified"}
Target audience: ${analysisData.targetAudience || analysisData.targetMarket || "Not specified"}

## Website Content Summary (crawled from ${profile.websiteUrl}):
${websiteContentSummary || "No website content available"}

Use ALL of the above context — especially the website content — to understand what this company actually does. The company name "${profile.companyName}" may be ambiguous, so rely on the website content and description to determine the correct industry and competitive landscape.

Return a JSON array of suggested competitor companies with this structure:
[
  {
    "name": "Competitor Company Name",
    "url": "https://competitor-website.com",
    "description": "Brief description of the company and what they do",
    "rationale": "Why this company is a direct competitor"
  }
]

${scopeInstruction}
Only return the JSON array, no other text.`;
    };

    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });

    const tryDiscovery = async (prompt: string): Promise<typeof suggestions> => {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      void logAiUsage({ tenantDomain, marketId }, "auto_build_discover_competitors", "anthropic", "claude-sonnet-4-5", message.usage);
      const responseText = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]).slice(0, maxCompetitors);
      }
      return [];
    };

    suggestions = await tryDiscovery(buildDiscoveryPrompt(false));

    if (suggestions.length === 0) {
      progress.details.push("No competitors found on first attempt, retrying with broader search...");
      suggestions = await tryDiscovery(buildDiscoveryPrompt(true));
    }

    progress.discoveredCompetitors = suggestions.map((s) => s.name);
    if (suggestions.length > 0) {
      progress.details.push(`Discovered ${suggestions.length} competitors: ${suggestions.map((s) => s.name).join(", ")}`);
    } else {
      progress.details.push("WARNING: Could not discover any competitors after retry. The auto-build will continue without competitor data.");
    }
  } catch (err: any) {
    progress.details.push(`Competitor discovery error: ${err.message}`);
  }
  progress.stepsCompleted = 3;

  updateStep("Step 4/14: Adding competitors...");
  const createdCompetitors: any[] = [];
  for (const suggestion of suggestions) {
    try {
      let normalizedUrl = suggestion.url;
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      const urlValidation = await validateCompetitorUrl(normalizedUrl);
      if (!urlValidation.isValid) {
        progress.details.push(`Skipped ${suggestion.name}: URL validation failed (${urlValidation.error})`);
        continue;
      }
      normalizedUrl = urlValidation.normalizedUrl || normalizedUrl;

      const org = await storage.findOrCreateOrganization(normalizedUrl, suggestion.name);

      const competitor = await storage.createCompetitor({
        name: suggestion.name,
        url: normalizedUrl,
        tenantDomain,
        marketId,
        organizationId: org.id,
        userId,
      });
      if (org) {
        await storage.incrementOrgRefCount(org.id);
      }
      createdCompetitors.push(competitor);
      progress.details.push(`Added competitor: ${suggestion.name}`);
    } catch (err: any) {
      progress.details.push(`Failed to add ${suggestion.name}: ${err.message}`);
    }
  }
  progress.stepsCompleted = 4;

  const hasCompetitors = createdCompetitors.length > 0;
  if (!hasCompetitors) {
    progress.details.push("WARNING: No competitors were successfully added. Skipping competitor-dependent steps (crawl, social, analysis, scoring). Reports will be baseline-only.");
  }

  updateStep("Step 5/14: Crawling competitor websites...");
  for (const competitor of createdCompetitors) {
    try {
      const crawlResult = await crawlCompetitorWebsite(competitor.url);
      if (crawlResult) {
        const socialLinks = crawlResult.socialLinks || {};
        const detectedBlogUrl = crawlResult.pages?.find(p => p.pageType === "blog")?.url ?? null;
        await storage.updateCompetitor(competitor.id, {
          crawlData: buildCrawlData(crawlResult),
          lastCrawl: new Date().toISOString(),
          lastFullCrawl: new Date(),
          // Stamp lastWebsiteMonitor + baseline content so scheduled sweeps
          // skip this freshly crawled competitor instead of double-crawling.
          lastWebsiteMonitor: new Date(),
          previousWebsiteContent: getCombinedContent(crawlResult).substring(0, 100000),
          linkedInUrl: socialLinks.linkedIn || null,
          instagramUrl: socialLinks.instagram || null,
          twitterUrl: socialLinks.twitter || null,
          facebookUrl: socialLinks.facebook || null,
          blogUrl: detectedBlogUrl,
          blogSnapshot: crawlResult.blogSnapshot || null,
        });

        const pageCount = crawlResult.pages?.length || 0;
        const totalWords = crawlResult.totalWordCount || 0;

        if (pageCount === 0 || totalWords < 50) {
          progress.details.push(`⚠ ${competitor.name}: crawl returned minimal data (${pageCount} page(s), ${totalWords} words) — site may block automated access`);
        } else {
          progress.details.push(`Crawled ${competitor.name}: ${pageCount} pages, ${totalWords} words`);
        }
      } else {
        progress.details.push(`⚠ ${competitor.name}: crawl returned no data — site may be unreachable or block automated access`);
      }
    } catch (err: any) {
      progress.details.push(`Crawl warning for ${competitor.name}: ${err.message}`);
    }
  }
  progress.stepsCompleted = 5;

  // Step 6 (NEW): Detect pricing pages from the crawl results, persist
  // pricingPageUrl, and capture a first pricing snapshot for any competitor
  // whose tenant plan allows it. Best-effort — failures don't abort.
  updateStep("Step 6/14: Detecting pricing pages & capturing initial snapshots...");
  try {
    const pricingGate = await checkFeatureAccessAsync(
      (await storage.getTenantByDomain(tenantDomain))?.plan || "free",
      "pricingIntelligence",
    );
    if (!pricingGate.allowed) {
      progress.details.push("Pricing capture skipped: tenant plan does not include Pricing Intelligence");
    } else {
      // Run captures in parallel with the same bounded concurrency the analysis lane
      // uses elsewhere. Each capture does an HTTP fetch + 1-2 Anthropic calls, so for
      // 10 competitors serializing this step would add minutes to wall time.
      let pricingFound = 0;
      let pricingCaptured = 0;
      await runWithConcurrency(createdCompetitors, AI_CONCURRENCY.anthropic, async (competitor) => {
        try {
          const freshComp = await storage.getCompetitor(competitor.id);
          const crawlData = freshComp?.crawlData as any;
          const pages = Array.isArray(crawlData?.pages) ? crawlData.pages : [];
          const pricingPage = pages.find((p: any) => p && p.pageType === "pricing");
          if (!pricingPage?.url) return;
          pricingFound++;
          await storage.updateCompetitor(competitor.id, { pricingPageUrl: pricingPage.url });
          const result = await monitorCompetitorPricing(competitor.id, {
            userId,
            tenantDomain,
          });
          if (result.status === "success") {
            pricingCaptured++;
            progress.details.push(`Captured pricing snapshot for ${competitor.name} (${(result.snapshot?.tiers as any[] | undefined)?.length || 0} tiers)`);
          } else {
            progress.details.push(`⚠ Pricing capture for ${competitor.name}: ${result.status}${result.message ? ` — ${result.message}` : ""}`);
          }
        } catch (err: any) {
          progress.details.push(`⚠ Pricing capture failed for ${competitor.name}: ${err.message}`);
        }
      });
      if (pricingFound === 0) {
        progress.details.push("No pricing pages detected during crawl");
      } else {
        progress.details.push(`Pricing capture summary: ${pricingCaptured}/${pricingFound} competitors with detected pricing pages snapshotted`);
      }
    }
  } catch (err: any) {
    progress.details.push(`⚠ Pricing capture step failed: ${err.message}`);
  }
  progress.stepsCompleted = 6;

  updateStep("Step 7/14: Refreshing competitor social profiles...");
  for (const competitor of createdCompetitors) {
    try {
      const socialResults = await monitorCompetitorSocialMedia(competitor.id, userId, tenantDomain);
      const failures = socialResults.filter((r: any) => r.status === "error" || r.status === "blocked");
      const successes = socialResults.filter((r: any) => r.status === "success");

      if (successes.length > 0) {
        progress.details.push(`Social refresh complete: ${competitor.name} (${successes.map((r: any) => r.platform).join(", ")})`);
      }
      for (const failure of failures) {
        const platformName = failure.platform === "twitter" ? "Twitter/X" : failure.platform.charAt(0).toUpperCase() + failure.platform.slice(1);
        progress.details.push(`⚠ ${competitor.name} ${platformName}: ${failure.message || `${failure.status} — monitoring unavailable`}`);
      }
      if (socialResults.length === 0) {
        progress.details.push(`Social refresh: ${competitor.name} — no social profiles configured`);
      }
    } catch (err: any) {
      progress.details.push(`⚠ Social monitoring failed for ${competitor.name}: ${err.message}`);
    }
  }
  progress.stepsCompleted = 7;

  updateStep("Step 8/14: Running AI analysis on competitors...");
  for (const competitor of createdCompetitors) {
    try {
      const freshComp = await storage.getCompetitor(competitor.id);
      if (!freshComp?.crawlData) continue;
      const crawlDataObj = freshComp.crawlData as any;
      const combinedContent = Array.isArray(crawlDataObj?.pages)
        ? crawlDataObj.pages.map((p: any) => `${p.title || ""}\n${p.content || p.text || ""}`).join("\n\n")
        : "";
      const analysis = await analyzeCompetitorWebsite(
        freshComp.name,
        freshComp.url,
        combinedContent,
        profile.companyName
      );
      if (analysis) {
        await storage.updateCompetitor(competitor.id, {
          analysisData: analysis as any,
        });

        const firmographicUpdates: any = {};
        if (!freshComp.headquarters && analysis.headquarters) {
          firmographicUpdates.headquarters = analysis.headquarters;
        }
        if (!freshComp.founded && analysis.foundedYear) {
          firmographicUpdates.founded = String(analysis.foundedYear);
        }
        if (!freshComp.revenue && analysis.revenueRange) {
          firmographicUpdates.revenue = analysis.revenueRange;
        }
        if (!freshComp.fundingRaised && analysis.fundingInfo) {
          firmographicUpdates.fundingRaised = analysis.fundingInfo;
        }
        if (!freshComp.industry && analysis.industry) {
          firmographicUpdates.industry = analysis.industry;
        }
        if (!freshComp.employeeCount && analysis.employeeCount) {
          firmographicUpdates.employeeCount = String(analysis.employeeCount);
        }
        if (Object.keys(firmographicUpdates).length > 0) {
          await storage.updateCompetitor(competitor.id, firmographicUpdates);
          progress.details.push(`Saved firmographic data for ${competitor.name}: ${Object.keys(firmographicUpdates).join(", ")}`);
        }
      }
      progress.details.push(`Analyzed: ${competitor.name}`);
    } catch (err: any) {
      progress.details.push(`Analysis warning for ${competitor.name}: ${err.message}`);
    }
  }
  progress.stepsCompleted = 8;

  updateStep("Step 9/14: AI Company Research (enriching metadata)...");
  try {
    const refreshedProfile = await storage.getCompanyProfile(profile.id);
    if (refreshedProfile) {
      const baselineMissing = !refreshedProfile.headquarters || !refreshedProfile.founded || 
        !refreshedProfile.employeeCount || !refreshedProfile.industry || !refreshedProfile.linkedInUrl || !refreshedProfile.blogUrl;
      if (baselineMissing) {
        try {
          const research = await aiCompanyResearch(refreshedProfile.companyName, refreshedProfile.websiteUrl);
          const baselineUpdates: any = {};
          if (!refreshedProfile.headquarters && research.headquarters) baselineUpdates.headquarters = research.headquarters;
          if (!refreshedProfile.founded && research.foundedYear) baselineUpdates.founded = research.foundedYear;
          if (!refreshedProfile.employeeCount && research.employeeCount) baselineUpdates.employeeCount = research.employeeCount;
          if (!refreshedProfile.revenue && research.revenueRange) baselineUpdates.revenue = research.revenueRange;
          if (!refreshedProfile.fundingRaised && research.fundingRaised) baselineUpdates.fundingRaised = research.fundingRaised;
          if (!refreshedProfile.industry && research.industry) baselineUpdates.industry = research.industry;
          if (!refreshedProfile.linkedInUrl && research.linkedInUrl) baselineUpdates.linkedInUrl = research.linkedInUrl;
          if (!refreshedProfile.blogUrl && research.blogUrl) baselineUpdates.blogUrl = research.blogUrl;
          if (!refreshedProfile.description && research.description) baselineUpdates.description = research.description;
          if (Object.keys(baselineUpdates).length > 0) {
            await storage.updateCompanyProfile(refreshedProfile.id, baselineUpdates);
            progress.details.push(`AI Research enriched baseline: ${Object.keys(baselineUpdates).join(", ")}`);
          } else {
            progress.details.push("AI Research: baseline already has complete metadata");
          }
        } catch (err: any) {
          progress.details.push(`AI Research warning for baseline: ${err.message}`);
        }
      } else {
        progress.details.push("AI Research: baseline already has complete metadata");
      }
    }

    const allTenantCompetitors = await storage.getCompetitorsByTenantDomain(tenantDomain);
    const allMarketCompetitors = allTenantCompetitors.filter(c => c.marketId === marketId);
    for (const comp of allMarketCompetitors) {
      try {
        const freshComp = await storage.getCompetitor(comp.id);
        if (!freshComp) continue;
        const compMissing = !freshComp.headquarters || !freshComp.founded || 
          !freshComp.employeeCount || !freshComp.industry || !freshComp.linkedInUrl || !freshComp.blogUrl;
        if (!compMissing) {
          progress.details.push(`AI Research: ${freshComp.name} already has complete metadata`);
          continue;
        }
        const research = await aiCompanyResearch(freshComp.name, freshComp.url);
        const compUpdates: any = {};
        if (!freshComp.headquarters && research.headquarters) compUpdates.headquarters = research.headquarters;
        if (!freshComp.founded && research.foundedYear) compUpdates.founded = research.foundedYear;
        if (!freshComp.employeeCount && research.employeeCount) compUpdates.employeeCount = research.employeeCount;
        if (!freshComp.revenue && research.revenueRange) compUpdates.revenue = research.revenueRange;
        if (!freshComp.fundingRaised && research.fundingRaised) compUpdates.fundingRaised = research.fundingRaised;
        if (!freshComp.industry && research.industry) compUpdates.industry = research.industry;
        if (!freshComp.linkedInUrl && research.linkedInUrl) compUpdates.linkedInUrl = research.linkedInUrl;
        if (!freshComp.blogUrl && research.blogUrl) compUpdates.blogUrl = research.blogUrl;
        if (Object.keys(compUpdates).length > 0) {
          await storage.updateCompetitor(comp.id, compUpdates);
          progress.details.push(`AI Research enriched ${freshComp.name}: ${Object.keys(compUpdates).join(", ")}`);
        }
      } catch (err: any) {
        progress.details.push(`AI Research warning for ${comp.name}: ${err.message}`);
      }
    }
  } catch (err: any) {
    progress.details.push(`AI Company Research step warning: ${err.message}`);
  }
  progress.stepsCompleted = 9;

  updateStep("Step 10/14: Calculating competitive scores...");
  try {
    // Scores live in score_history (one row per period per entity), not on the
    // competitors table — the per-row score columns were removed when scoring
    // moved to time-series. Mirrors full-regeneration-service.ts.
    const market = marketId ? await storage.getMarket(marketId) : null;
    const businessType = (market as any)?.businessType || "b2b";
    const period = getCurrentWeeklyPeriod();
    for (const competitor of createdCompetitors) {
      const freshComp = await storage.getCompetitor(competitor.id);
      if (!freshComp) continue;
      const scores = calculateScores(
        freshComp.analysisData as any,
        freshComp.linkedInEngagement as any,
        freshComp.instagramEngagement as any,
        freshComp.crawlData as any,
        freshComp.blogSnapshot as any,
        freshComp.lastCrawl,
        businessType,
      );
      const existingHistory = await storage.getScoreHistory("competitor", competitor.id, 1);
      if (!existingHistory.length || existingHistory[0].period !== period) {
        await storage.createScoreHistory({
          entityType: "competitor",
          entityId: competitor.id,
          entityName: competitor.name,
          tenantDomain,
          marketId: marketId || competitor.marketId || undefined,
          overallScore: Math.round(scores.overallScore),
          innovationScore: Math.round(scores.innovationScore),
          marketPresenceScore: Math.round(scores.marketPresenceScore),
          contentActivityScore: Math.round(scores.contentActivityScore),
          socialEngagementScore: Math.round(scores.socialEngagementScore),
          scoreBreakdown: scores,
          period,
        });
      }
    }
    progress.details.push("Competitive scores calculated");
  } catch (err: any) {
    progress.details.push(`Scoring warning: ${err.message}`);
  }
  progress.stepsCompleted = 10;

  updateStep("Step 11/14: Generating gap analysis & recommendations...");
  try {
    const tenant = await storage.getTenantByDomain(tenantDomain);
    if (!tenant) throw new Error("Tenant not found");
    const defaultMarket = await storage.getDefaultMarket(tenant.id);
    const isDefaultMarket = !!defaultMarket && defaultMarket.id === marketId;
    const allCompetitors = await storage.getCompetitorsByContext({
      tenantId: tenant.id,
      tenantDomain,
      marketId,
      isDefaultMarket,
    });
    const analyzedCompetitors = allCompetitors.filter((c: any) => c.analysisData);
    if (analyzedCompetitors.length > 0) {
      const refreshedProfile = await storage.getCompanyProfile(profile.id);
      const baselineAnalysis = refreshedProfile?.analysisData as any;
      const ourPositioning = `${profile.companyName}: ${profile.description || "No description provided"}`;
      const competitorAnalyses = analyzedCompetitors
        .map((c: any) => c.analysisData)
        .filter(Boolean);

      const gaps = await generateGapAnalysis(
        ourPositioning,
        competitorAnalyses as any,
        baselineAnalysis,
      );

      // Recommendations are persisted per-row in the recommendations table, not as a
      // JSONB blob on the company profile. Mirrors full-regeneration-service.ts.
      const recs = await generateRecommendations(gaps, competitorAnalyses as any);
      for (const rec of recs) {
        await storage.createRecommendation({
          title: rec.title,
          description: rec.description,
          area: rec.area,
          impact: rec.impact,
          userId,
          tenantDomain,
          marketId: marketId || null,
        });
      }
      progress.details.push(`Gap analysis: ${gaps.length} gaps identified, ${recs.length} recommendations created`);
    }
  } catch (err: any) {
    progress.details.push(`Gap analysis warning: ${err.message}`);
  }
  progress.stepsCompleted = 11;

  updateStep("Step 12/14: Generating executive summary...");
  try {
    await generateExecutiveSummary(tenantDomain, marketId, profile.id);
    progress.details.push("Executive summary generated");
  } catch (err: any) {
    progress.details.push(`Executive summary warning: ${err.message}`);
  }
  progress.stepsCompleted = 12;

  // Step 13 (NEW): Generate sales battlecards for each competitor. Mirrors the
  // battlecards lane in full-regeneration. Skipped when no competitors were added.
  if (!hasCompetitors) {
    updateStep("Step 13/14: Skipping battlecards (no competitors tracked)...");
    progress.details.push("Battlecards skipped: no competitors were discovered or added.");
  } else {
    updateStep(`Step 13/14: Generating battlecards (0/${createdCompetitors.length})...`);
    let battlecardsCreated = 0;
    let battlecardsFailed = 0;
    for (const competitor of createdCompetitors) {
      try {
        const freshComp = await storage.getCompetitor(competitor.id);
        if (!freshComp) continue;
        const result = await generateBattlecardForCompetitor({
          competitor: freshComp,
          ourCompanyName: profile.companyName,
          ourPositioning: profile.companyName + (profile.description ? `: ${profile.description}` : ""),
          tenantDomain,
          marketId,
          userId,
        });
        if (result.status === "failed") {
          battlecardsFailed++;
          progress.details.push(`⚠ Battlecard generation failed for ${competitor.name}: ${result.error || "unknown"}`);
        } else {
          battlecardsCreated++;
          updateStep(`Step 13/14: Generating battlecards (${battlecardsCreated}/${createdCompetitors.length})...`);
        }
      } catch (err: any) {
        battlecardsFailed++;
        progress.details.push(`⚠ Battlecard generation failed for ${competitor.name}: ${err.message}`);
      }
    }
    progress.details.push(`Battlecards generated: ${battlecardsCreated}/${createdCompetitors.length}${battlecardsFailed > 0 ? ` (${battlecardsFailed} failed)` : ""}`);
  }
  progress.stepsCompleted = 13;

  if (options.generateBriefing) {
    if (!hasCompetitors) {
      updateStep("Step 14/14: Skipping intelligence briefing (no competitors tracked)...");
      progress.details.push("Intelligence briefing skipped: no competitors were discovered or added. Add competitors manually and regenerate the briefing for competitive insights.");
    } else {
      updateStep("Step 14/14: Generating 30-day intelligence briefing...");
      try {
        const briefing = await generateBriefing(tenantDomain, 30, marketId);
        if (briefing) {
          progress.details.push("30-day intelligence briefing generated");
        }
      } catch (err: any) {
        progress.details.push(`Briefing warning: ${err.message}`);
      }
    }
  } else {
    updateStep("Step 14/14: Finalizing...");
  }
  progress.stepsCompleted = 14;

  const allCompetitorsForGaps = await storage.getCompetitorsByTenantDomain(tenantDomain);
  const marketCompetitorsForGaps = allCompetitorsForGaps.filter(c => c.marketId === marketId);
  const enrichmentGaps = await computeEnrichmentGaps(profile.id, marketCompetitorsForGaps.map(c => c.id), tenantDomain);
  progress.enrichmentGaps = enrichmentGaps;

  progress.status = "completed";
  progress.currentStep = hasCompetitors ? "Auto Build Complete" : "Auto Build Complete (Baseline Only — No Competitors Found)";
  progress.completedAt = new Date();
  if (hasCompetitors) {
    progress.details.push(`Auto Build completed: ${createdCompetitors.length} competitors added and analyzed`);
  } else {
    progress.details.push(`Auto Build completed (partial): No competitors were found or added. Baseline company data has been set up. Add competitors manually to get full competitive intelligence.`);
  }

  setTimeout(() => activeJobs.delete(jobId), 30 * 60 * 1000);
}

async function computeEnrichmentGaps(
  profileId: string,
  competitorIds: string[],
  tenantDomain: string
): Promise<EnrichmentGap[]> {
  const gaps: EnrichmentGap[] = [];
  const keyFields = ["headquarters", "founded", "employeeCount", "industry", "linkedInUrl", "blogUrl", "revenue", "fundingRaised"];
  const fieldLabels: Record<string, string> = {
    headquarters: "Headquarters",
    founded: "Founded Year",
    employeeCount: "Employee Count",
    industry: "Industry",
    linkedInUrl: "LinkedIn URL",
    blogUrl: "Blog URL",
    revenue: "Revenue",
    fundingRaised: "Funding Raised",
  };

  try {
    const profile = await storage.getCompanyProfile(profileId);
    if (profile) {
      const missing = keyFields.filter(f => !(profile as any)[f]);
      if (missing.length > 0) {
        gaps.push({
          companyName: profile.companyName,
          companyId: profile.id,
          entityType: "baseline",
          missingFields: missing.map(f => fieldLabels[f] || f),
        });
      }
    }
  } catch (err: any) {
    console.error("[Enrichment Gaps] Failed to check baseline profile:", err.message);
  }

  for (const compId of competitorIds) {
    try {
      const comp = await storage.getCompetitor(compId);
      if (comp) {
        const missing = keyFields.filter(f => !(comp as any)[f]);
        if (missing.length > 0) {
          gaps.push({
            companyName: comp.name,
            companyId: comp.id,
            entityType: "competitor",
            missingFields: missing.map(f => fieldLabels[f] || f),
          });
        }
      }
    } catch (err: any) {
      console.error(`[Enrichment Gaps] Failed to check competitor ${compId}:`, err.message);
    }
  }

  return gaps;
}
