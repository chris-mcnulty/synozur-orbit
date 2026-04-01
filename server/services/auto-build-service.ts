import { storage } from "../storage";
import { analyzeCompetitorWebsite, generateGapAnalysis, generateRecommendations } from "../ai-service";
import { crawlCompetitorWebsite, getCombinedContent } from "./web-crawler";
import { monitorCompanyProfileSocialMedia } from "./social-monitoring";
import { monitorCompetitorSocialMedia } from "./social-monitoring";
import { calculateScores } from "./scoring-service";
import { generateBriefing } from "./intelligence-briefing-service";
import { validateCompetitorUrl } from "../utils/url-validator";
import Anthropic from "@anthropic-ai/sdk";

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
}

const activeJobs = new Map<string, AutoBuildProgress>();

export function getAutoBuildStatus(jobId: string, tenantDomain?: string): AutoBuildProgress | null {
  const job = activeJobs.get(jobId);
  if (!job) return null;
  if (tenantDomain && job.tenantDomain !== tenantDomain) return null;
  return job;
}

export function getActiveJobForMarket(tenantDomain: string, marketId: string): { jobId: string; progress: AutoBuildProgress } | null {
  for (const [jobId, progress] of activeJobs.entries()) {
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
    totalSteps: 10,
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
    const profile = await storage.getCompanyProfileByContext({
      tenantDomain,
      marketId,
      isDefaultMarket: false,
    });

    if (!profile) {
      const allProfiles = await storage.getCompanyProfilesByTenant(tenantDomain);
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

  updateStep("Step 1/10: Crawling baseline company website...");
  try {
    if (profile.websiteUrl) {
      const crawlResult = await crawlCompetitorWebsite(profile.websiteUrl, { maxPages: 15, timeout: 60000 });
      if (crawlResult) {
        const combinedContent = getCombinedContent(crawlResult);
        const socialLinks = crawlResult.socialLinks || {};
        await storage.updateCompanyProfile(profile.id, {
          crawlData: crawlResult as any,
          lastCrawl: new Date().toISOString(),
          linkedInUrl: profile.linkedInUrl || socialLinks.linkedIn || null,
          instagramUrl: profile.instagramUrl || socialLinks.instagram || null,
          twitterUrl: profile.twitterUrl || socialLinks.twitter || null,
          blogUrl: profile.blogUrl || socialLinks.blog || null,
        });
        progress.details.push(`Crawled ${crawlResult.pages?.length || 0} pages from ${profile.websiteUrl}`);
      }
    }
  } catch (err: any) {
    progress.details.push(`Baseline crawl warning: ${err.message}`);
  }
  progress.stepsCompleted = 1;

  updateStep("Step 2/10: Refreshing baseline social media...");
  try {
    await monitorCompanyProfileSocialMedia(profile.id, userId, tenantDomain, marketId);
    progress.details.push("Baseline social media refreshed");
  } catch (err: any) {
    progress.details.push(`Social refresh warning: ${err.message}`);
  }
  progress.stepsCompleted = 2;

  updateStep("Step 3/10: Discovering competitors with AI...");
  let suggestions: Array<{ name: string; url: string; description: string; rationale: string }> = [];
  try {
    const refreshedProfile = await storage.getCompanyProfile(profile.id);
    const analysisData = (refreshedProfile?.analysisData || refreshedProfile?.crawlData) as any || {};

    const prompt = `Analyze this company and suggest ${maxCompetitors} competing companies in the market:

Company: ${profile.companyName}
Website: ${profile.websiteUrl}
Industry: ${analysisData.industry || "Unknown"}
Description: ${analysisData.companyDescription || analysisData.valueProposition || profile.description || "No description available"}
Key offerings: ${analysisData.keyOfferings?.join(", ") || "Not specified"}

Return a JSON array of suggested competitor companies with this structure:
[
  {
    "name": "Competitor Company Name",
    "url": "https://competitor-website.com",
    "description": "Brief description of the company and what they do",
    "rationale": "Why this company is a direct competitor"
  }
]

Focus on direct competitors in the same market segment. Include well-known industry leaders and emerging challengers.
Only return the JSON array, no other text.`;

    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      suggestions = JSON.parse(jsonMatch[0]).slice(0, maxCompetitors);
    }
    progress.discoveredCompetitors = suggestions.map((s) => s.name);
    progress.details.push(`Discovered ${suggestions.length} competitors: ${suggestions.map((s) => s.name).join(", ")}`);
  } catch (err: any) {
    progress.details.push(`Competitor discovery error: ${err.message}`);
  }
  progress.stepsCompleted = 3;

  updateStep("Step 4/10: Adding competitors...");
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
        addedBy: userId,
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

  updateStep("Step 5/10: Crawling competitor websites...");
  for (const competitor of createdCompetitors) {
    try {
      const crawlResult = await crawlCompetitorWebsite(competitor.url, { maxPages: 10, timeout: 60000 });
      if (crawlResult) {
        const socialLinks = crawlResult.socialLinks || {};
        await storage.updateCompetitor(competitor.id, {
          crawlData: crawlResult as any,
          lastCrawl: new Date().toISOString(),
          linkedInUrl: socialLinks.linkedIn || null,
          instagramUrl: socialLinks.instagram || null,
          twitterUrl: socialLinks.twitter || null,
          blogUrl: socialLinks.blog || null,
          blogSnapshot: crawlResult.blogSnapshot || null,
        });
        progress.details.push(`Crawled ${competitor.name}: ${crawlResult.pages?.length || 0} pages`);
      }
    } catch (err: any) {
      progress.details.push(`Crawl warning for ${competitor.name}: ${err.message}`);
    }
  }
  progress.stepsCompleted = 5;

  updateStep("Step 6/10: Refreshing competitor social profiles...");
  for (const competitor of createdCompetitors) {
    try {
      await monitorCompetitorSocialMedia(competitor.id, userId, tenantDomain);
      progress.details.push(`Social refresh complete: ${competitor.name}`);
    } catch (err: any) {
      progress.details.push(`Social warning for ${competitor.name}: ${err.message}`);
    }
  }
  progress.stepsCompleted = 6;

  updateStep("Step 7/10: Running AI analysis on competitors...");
  for (const competitor of createdCompetitors) {
    try {
      const freshComp = await storage.getCompetitor(competitor.id);
      if (!freshComp?.crawlData) continue;
      const combinedContent = getCombinedContent(freshComp.crawlData as any);
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
      }
      progress.details.push(`Analyzed: ${competitor.name}`);
    } catch (err: any) {
      progress.details.push(`Analysis warning for ${competitor.name}: ${err.message}`);
    }
  }
  progress.stepsCompleted = 7;

  updateStep("Step 8/10: Calculating competitive scores...");
  try {
    for (const competitor of createdCompetitors) {
      const freshComp = await storage.getCompetitor(competitor.id);
      if (!freshComp) continue;
      const scores = calculateScores(
        freshComp.analysisData || null,
        freshComp.crawlData || null,
        freshComp.linkedInEngagement as any || null,
        freshComp.blogSnapshot as any || null
      );
      await storage.updateCompetitor(competitor.id, {
        overallScore: Math.round(scores.overallScore),
        innovationScore: Math.round(scores.innovationScore),
        marketPresenceScore: Math.round(scores.marketPresenceScore),
        contentScore: Math.round(scores.contentScore),
        socialEngagementScore: Math.round(scores.socialEngagementScore),
      });
    }
    progress.details.push("Competitive scores calculated");
  } catch (err: any) {
    progress.details.push(`Scoring warning: ${err.message}`);
  }
  progress.stepsCompleted = 8;

  updateStep("Step 9/10: Generating gap analysis & recommendations...");
  try {
    const allCompetitors = await storage.getCompetitorsByContext({ tenantDomain, marketId, isDefaultMarket: false });
    const analyzedCompetitors = allCompetitors.filter((c: any) => c.analysisData);
    if (analyzedCompetitors.length > 0) {
      const refreshedProfile = await storage.getCompanyProfile(profile.id);
      const baselineData = refreshedProfile?.analysisData || refreshedProfile?.crawlData || {};

      const competitorAnalyses = analyzedCompetitors.map((c: any) => ({
        name: c.name,
        analysis: c.analysisData,
      }));

      const gaps = await generateGapAnalysis(
        profile.companyName,
        baselineData as any,
        competitorAnalyses as any
      );
      if (gaps) {
        await storage.updateCompanyProfile(profile.id, {
          gapAnalysis: gaps as any,
        });
      }

      const recs = await generateRecommendations(
        profile.companyName,
        baselineData as any,
        competitorAnalyses as any,
        gaps
      );
      if (recs) {
        await storage.updateCompanyProfile(profile.id, {
          recommendations: recs as any,
        });
      }
      progress.details.push("Gap analysis and recommendations generated");
    }
  } catch (err: any) {
    progress.details.push(`Gap analysis warning: ${err.message}`);
  }
  progress.stepsCompleted = 9;

  if (options.generateBriefing) {
    updateStep("Step 10/10: Generating 30-day intelligence briefing...");
    try {
      const briefing = await generateBriefing(tenantDomain, 30, marketId);
      if (briefing) {
        progress.details.push("30-day intelligence briefing generated");
      }
    } catch (err: any) {
      progress.details.push(`Briefing warning: ${err.message}`);
    }
  } else {
    updateStep("Step 10/10: Finalizing...");
  }
  progress.stepsCompleted = 10;

  progress.status = "completed";
  progress.currentStep = "Auto Build Complete";
  progress.completedAt = new Date();
  progress.details.push(`Auto Build completed: ${createdCompetitors.length} competitors added and analyzed`);

  setTimeout(() => activeJobs.delete(jobId), 30 * 60 * 1000);
}
