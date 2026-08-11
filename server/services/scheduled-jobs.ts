import { storage } from "../storage";
import { crawlCompetitorWebsite, getCombinedContent, buildCrawlData } from "./web-crawler";
import { captureVisualAssets } from "./visual-capture";
import { monitorCompetitorSocialMedia, monitorCompanyProfileSocialMedia, monitorProductSocialMedia } from "./social-monitoring";
import { monitorCompetitorWebsite, monitorCompanyProfileWebsite, monitorProductWebsite } from "./website-monitoring";
import { monitorCompetitorPricing, monitorBaselinePricing } from "./pricing-intelligence";
import { analyzeCompetitorWebsite, type LinkedInContext } from "../ai-service";
import { processTrialReminders } from "./trial-service";
import { sendWeeklyDigestEmail, sendScheduledBriefingEmail, type BriefingDigestData } from "./email-service";
import { generateBriefing, type BriefingData } from "./intelligence-briefing-service";
import { notifications } from "./notifications";
import { enqueueCrawl, enqueueMonitor } from "./job-queue";
import { crawlOps } from "./crawl-db";
import { checkFeatureAccessAsync } from "./plan-policy";
import { identifySuggestedAssets } from "./asset-suggestion-service";
import {
  getValidGraphToken,
  renewGraphSubscription,
} from "./planner-graph-client";
import { tickMarketingPublishWorker, sweepMissedPosts } from "./marketing-publish-worker";
import { tickEmailSendWorker } from "./email-campaign-sender";
import { tickAbTestEvaluationWorker } from "./email-ab-test";
import { tickHubspotEmailSyncBackfill } from "./hubspot-email-backfill";
import { tickWorkflowEngine, sweepAllTenantWorkflowTriggers, evaluateSegmentTriggers } from "./marketing-workflow-service";
import { refreshSeoForContext } from "../routes/seo";
import { db, crawlDb } from "../db";
import { marketingPlans, seoMetrics, trackedKeywords, collaborationComments, collaborationThreads, annotations, generatedPosts, scheduledJobRuns, type SeoMetric } from "@shared/schema";
import { eq, and, desc, isNull, lt, sql, inArray } from "drizzle-orm";
import type { SeoMover } from "./webhook-formatters";

// Cache for market status to avoid repeated DB queries
const marketStatusCache: Map<string, { status: string; timestamp: number }> = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute (reduced TTL for faster response to status changes)

async function isMarketArchived(marketId: string | null): Promise<boolean> {
  if (!marketId) return false; // Default market or no market = not archived
  
  // Check cache first
  const cached = marketStatusCache.get(marketId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.status === "archived";
  }
  
  // Fetch from DB
  const market = await storage.getMarket(marketId);
  if (market) {
    marketStatusCache.set(marketId, { status: market.status, timestamp: Date.now() });
    return market.status === "archived";
  }
  
  return false;
}

// Invalidate cache entry when market status changes
export function invalidateMarketStatusCache(marketId: string): void {
  marketStatusCache.delete(marketId);
}

interface JobStatus {
  lastRun: Date | null;
  isRunning: boolean;
  nextRun: Date | null;
  abortController: AbortController | null;
}

interface JobRunContext {
  jobRunId: string;
  tenantDomain?: string;
  targetId?: string;
}

async function trackJobStart(
  jobType: string,
  tenantDomain?: string,
  targetId?: string,
  targetName?: string
): Promise<string> {
  try {
    // Job-lifecycle telemetry goes through the dedicated crawl pool, never the
    // primary pool — these writes fire on every scheduled crawl/monitor job and
    // must not compete with time-sensitive workers (publish/email).
    const [jobRun] = await crawlDb
      .insert(scheduledJobRuns)
      .values({
        jobType,
        tenantDomain: tenantDomain || null,
        targetId: targetId || null,
        targetName: targetName || null,
        status: "running",
        startedAt: new Date(),
      })
      .returning();
    return jobRun.id;
  } catch (error) {
    console.error(`[Job Tracking] Failed to track job start:`, error);
    return "";
  }
}

async function trackJobComplete(
  jobRunId: string,
  status: "completed" | "failed",
  result?: Record<string, any>,
  errorMessage?: string
): Promise<void> {
  if (!jobRunId) return;
  try {
    const [updated] = await crawlDb
      .update(scheduledJobRuns)
      .set({
        status,
        completedAt: new Date(),
        result: result || null,
        errorMessage: errorMessage || null,
      })
      .where(eq(scheduledJobRuns.id, jobRunId))
      .returning();

    if (status === "failed" && updated?.tenantDomain) {
      await notifications.dispatch(updated.tenantDomain, "job_failed", {
        jobType: updated.jobType || "scheduled_job",
        targetName: updated.targetName || undefined,
        error: errorMessage || "Unknown error",
        attempts: 1,
      });
    }
  } catch (error) {
    console.error(`[Job Tracking] Failed to track job completion:`, error);
  }
}

// Clean up jobs that have been running for too long (stuck jobs)
async function cleanupStuckJobs(): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  // Read/write stuck-job telemetry through the crawl pool (keeps the primary
  // pool free for time-sensitive work).
  const stuckJobs = await crawlDb
    .select()
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.status, "running"));
  
  const jobsToFail = stuckJobs.filter(job => {
    if (!job.startedAt) return true;
    return new Date(job.startedAt) < oneHourAgo;
  });
  
  if (jobsToFail.length > 0) {
    console.log(`[Scheduled Jobs] Cleaning up ${jobsToFail.length} stuck job(s)...`);
    for (const job of jobsToFail) {
      try {
        await crawlDb
          .update(scheduledJobRuns)
          .set({
            status: "failed",
            completedAt: new Date(),
            result: { error: "Stale job record swept - the job was likely interrupted by a server restart or its completion was never recorded" },
            errorMessage: "Interrupted or unrecorded (stale record swept after 1 hour)",
          })
          .where(eq(scheduledJobRuns.id, job.id));
        console.log(`[Scheduled Jobs] Marked stuck job ${job.id} (${job.jobType}) as failed`);
      } catch (error) {
        console.error(`[Scheduled Jobs] Failed to clean up stuck job ${job.id}:`, error);
      }
    }
  } else {
    console.log("[Scheduled Jobs] No stuck jobs to clean up");
  }
}

async function trackJobRun<T>(
  jobType: string,
  tenantDomain: string,
  targetId: string,
  targetName: string,
  work: () => Promise<T>,
  options?: { onError?: () => Promise<void> }
): Promise<string | null> {
  const jobRunId = await trackJobStart(jobType, tenantDomain, targetId, targetName);
  if (!jobRunId) return null;
  
  try {
    const result = await work();
    await trackJobComplete(jobRunId, "completed", result as Record<string, any>);
    return jobRunId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await trackJobComplete(jobRunId, "failed", undefined, errorMessage);
    console.error(`[Scheduled Job] Job failed for ${targetName}:`, error);
    if (options?.onError) {
      try { await options.onError(); } catch (e) { console.error(`[Scheduled Job] onError callback failed:`, e); }
    }
    return jobRunId;
  }
}

const jobStatus: Record<string, JobStatus> = {
  websiteCrawl: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  socialMonitor: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  websiteMonitor: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  productMonitor: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  pricingMonitor: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  trialReminder: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  weeklyDigest: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  seoRefresh: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  hubspotSync: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  outreachCadence: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
};

function getIntervalMs(frequency: string): number {
  switch (frequency) {
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

async function runWebsiteCrawlJob(): Promise<void> {
  if (jobStatus.websiteCrawl.isRunning) {
    console.log("[Scheduled Job] Website crawl already running, skipping...");
    return;
  }

  const abortController = new AbortController();
  jobStatus.websiteCrawl.abortController = abortController;
  jobStatus.websiteCrawl.isRunning = true;
  console.log("[Scheduled Job] Starting website crawl job...");

  const sweepMetrics = { totalChecked: 0, crawlsExecuted: 0, crawlsSkippedOrgFresh: 0, crawlsSkippedOrgQueued: 0 };
  const orgsQueuedThisSweep = new Set<string>();

  try {
    const tenants = await storage.getAllTenants();

    for (const tenant of tenants) {
      // Check for abort signal
      if (abortController.signal.aborted) {
        console.log("[Scheduled Job] Website crawl job was cancelled");
        break;
      }
      if (tenant.status !== "active") continue;
      
      const frequency = tenant.monitoringFrequency || "weekly";
      if (frequency === "disabled") continue;

      const intervalMs = getIntervalMs(frequency);
      if (intervalMs === 0) continue;

      const competitors = await storage.getCompetitorsByTenantDomain(tenant.domain);

      for (const competitor of competitors) {
        sweepMetrics.totalChecked++;

        // Skip competitors in archived markets
        if (await isMarketArchived(competitor.marketId)) {
          console.log(`[Scheduled Job] Skipping ${competitor.name} - market is archived`);
          continue;
        }
        
        // Skip competitors with manual research or excluded from crawl
        const existingAnalysis = competitor.analysisData as any;
        if (existingAnalysis?.source === "manual" || competitor.excludeFromCrawl === true) {
          console.log(`[Scheduled Job] Skipping ${competitor.name} - manual research or excluded`);
          continue;
        }

        const lastCrawl = competitor.lastFullCrawl 
          ? new Date(competitor.lastFullCrawl).getTime() 
          : 0;
        const now = Date.now();

        if (now - lastCrawl < intervalMs) {
          continue;
        }

        // Baseline safety-net: skip sites that have already been crawled at least once.
        // Recurring crawls are handled entirely by the merged website-monitor pass.
        if (competitor.crawlData || competitor.previousWebsiteContent) {
          continue;
        }

        if (competitor.organizationId) {
          try {
            const org = await storage.getOrganization(competitor.organizationId);

            if (orgsQueuedThisSweep.has(competitor.organizationId)) {
              sweepMetrics.crawlsSkippedOrgQueued++;
              console.log(`[Scheduled Job] Skipping baseline crawl for ${competitor.name} - org already queued this sweep`);
              continue;
            }

            if (org?.crawlData) {
              // Org already has a baseline — sync it to the competitor and skip
              const syncUpdates: any = {};
              if (org.crawlData) syncUpdates.crawlData = org.crawlData;
              if (org.lastFullCrawl) syncUpdates.lastFullCrawl = org.lastFullCrawl;
              if (org.lastCrawl) syncUpdates.lastCrawl = org.lastCrawl;
              // Propagate lastWebsiteMonitor so monitor sweep freshness gate
              // suppresses a same-cycle second fetch for org siblings.
              if (org.lastWebsiteMonitor) syncUpdates.lastWebsiteMonitor = org.lastWebsiteMonitor;
              if (org.previousWebsiteContent) syncUpdates.previousWebsiteContent = org.previousWebsiteContent;
              if (org.blogSnapshot) syncUpdates.blogSnapshot = org.blogSnapshot;
              if (org.linkedInUrl && !competitor.linkedInUrl) syncUpdates.linkedInUrl = org.linkedInUrl;
              if (org.instagramUrl && !competitor.instagramUrl) syncUpdates.instagramUrl = org.instagramUrl;
              if (org.faviconUrl && !competitor.faviconUrl) syncUpdates.faviconUrl = org.faviconUrl;
              if (org.screenshotUrl && !competitor.screenshotUrl) syncUpdates.screenshotUrl = org.screenshotUrl;

              if (Object.keys(syncUpdates).length > 0) {
                await storage.updateCompetitor(competitor.id, syncUpdates);
              }

              sweepMetrics.crawlsSkippedOrgFresh++;
              console.log(`[Scheduled Job] Skipping baseline crawl for ${competitor.name} - org ${org.name} already has a baseline, synced data`);
              continue;
            }
          } catch (orgErr) {
            console.error(`[Scheduled Job] Org freshness check failed for ${competitor.name}:`, (orgErr as Error).message);
          }

          orgsQueuedThisSweep.add(competitor.organizationId);
        }

        sweepMetrics.crawlsExecuted++;
        console.log(`[Scheduled Job] Queuing crawl for ${competitor.name} (${competitor.url})...`);

        enqueueCrawl(`crawl:${competitor.name}`, (signal) => trackJobRun(
          "websiteCrawl",
          tenant.domain,
          competitor.id,
          competitor.name,
          async () => {
            let crawlResult;
            try {
              crawlResult = await crawlCompetitorWebsite(competitor.url, { signal });
            } catch (crawlError: any) {
              if (!signal?.aborted) {
                await storage.incrementCompetitorCrawlFailures(competitor.id).catch(() => {});
              }
              throw crawlError;
            }

            if (crawlResult.pages.length === 0) {
              await storage.incrementCompetitorCrawlFailures(competitor.id);
              console.log(`[Scheduled Job] No pages crawled for ${competitor.name} - incrementing failure count`);
              return { status: "no_pages", message: `No pages found for ${competitor.name}` };
            }

            await crawlOps.resetCompetitorCrawlFailures(competitor.id);

            const updates: any = {
              crawlData: buildCrawlData(crawlResult),
              lastFullCrawl: new Date(),
              // Stamp lastWebsiteMonitor so the monitor sweep freshness gate
              // suppresses a same-cycle second fetch for newly onboarded sites.
              lastWebsiteMonitor: new Date(),
            };

            if (crawlResult.socialLinks.linkedIn && !competitor.linkedInUrl) {
              updates.linkedInUrl = crawlResult.socialLinks.linkedIn;
            }
            if (crawlResult.socialLinks.instagram && !competitor.instagramUrl) {
              updates.instagramUrl = crawlResult.socialLinks.instagram;
            }
            if (crawlResult.socialLinks.twitter && !competitor.twitterUrl) {
              updates.twitterUrl = crawlResult.socialLinks.twitter;
            }
            if (crawlResult.socialLinks.facebook && !competitor.facebookUrl) {
              updates.facebookUrl = crawlResult.socialLinks.facebook;
            }

            if (crawlResult.blogSnapshot) {
              const previousSnapshot = competitor.blogSnapshot as any;
              const previousCount = previousSnapshot?.postCount || 0;
              const newPosts = crawlResult.blogSnapshot.postCount - previousCount;

              updates.blogSnapshot = {
                ...crawlResult.blogSnapshot,
                capturedAt: new Date().toISOString(),
              };

              if (previousCount > 0 && newPosts > 0) {
                await storage.createActivity({
                  type: "blog_update",
                  competitorId: competitor.id,
                  competitorName: competitor.name,
                  description: `Published ${newPosts} new blog post${newPosts > 1 ? 's' : ''}: "${crawlResult.blogSnapshot.latestTitles[0]}"${newPosts > 1 ? ' and more' : ''}`,
                  date: new Date().toISOString(),
                  impact: newPosts >= 3 ? "High" : "Medium",
                  tenantDomain: tenant.domain,
                  marketId: competitor.marketId,
                });
              }
            }

            await crawlOps.updateCompetitor(competitor.id, updates);
            await crawlOps.updateCompetitorLastCrawl(competitor.id, new Date().toLocaleString());

            if (competitor.organizationId) {
              await crawlOps.updateOrganization(competitor.organizationId, {
                crawlData: updates.crawlData,
                lastFullCrawl: updates.lastFullCrawl,
                lastCrawl: new Date().toISOString(),
                // Stamp org's lastWebsiteMonitor so sibling fan-out propagates it
                // and monitor freshness gate suppresses same-cycle re-fetch.
                lastWebsiteMonitor: updates.lastWebsiteMonitor,
                linkedInUrl: updates.linkedInUrl,
                instagramUrl: updates.instagramUrl,
                blogSnapshot: updates.blogSnapshot,
              }).catch(err => console.error(`[Scheduled Job] Org sync failed for ${competitor.name}:`, err.message));

              try {
                const freshOrg = await crawlOps.getOrganization(competitor.organizationId);
                if (freshOrg) {
                  const siblings = await crawlOps.getCompetitorsByOrganizationId(competitor.organizationId);
                  for (const sibling of siblings) {
                    if (sibling.id === competitor.id) continue;
                    const siblingSync: any = {};
                    if (freshOrg.crawlData) siblingSync.crawlData = freshOrg.crawlData;
                    if (freshOrg.lastFullCrawl) siblingSync.lastFullCrawl = freshOrg.lastFullCrawl;
                    if (freshOrg.lastCrawl) siblingSync.lastCrawl = freshOrg.lastCrawl;
                    // Propagate lastWebsiteMonitor so monitor freshness gate
                    // suppresses same-cycle re-fetch for all org siblings.
                    if (freshOrg.lastWebsiteMonitor) siblingSync.lastWebsiteMonitor = freshOrg.lastWebsiteMonitor;
                    if (freshOrg.previousWebsiteContent) siblingSync.previousWebsiteContent = freshOrg.previousWebsiteContent;
                    if (freshOrg.blogSnapshot) siblingSync.blogSnapshot = freshOrg.blogSnapshot;
                    if (freshOrg.linkedInUrl && !sibling.linkedInUrl) siblingSync.linkedInUrl = freshOrg.linkedInUrl;
                    if (freshOrg.instagramUrl && !sibling.instagramUrl) siblingSync.instagramUrl = freshOrg.instagramUrl;
                    if (freshOrg.faviconUrl && !sibling.faviconUrl) siblingSync.faviconUrl = freshOrg.faviconUrl;
                    if (freshOrg.screenshotUrl && !sibling.screenshotUrl) siblingSync.screenshotUrl = freshOrg.screenshotUrl;
                    if (Object.keys(siblingSync).length > 0) {
                      await crawlOps.updateCompetitor(sibling.id, siblingSync);
                    }
                  }
                  if (siblings.length > 1) {
                    console.log(`[Scheduled Job] Post-crawl fan-out: synced fresh data to ${siblings.length - 1} sibling competitor(s) for org ${competitor.organizationId}`);
                  }
                }
              } catch (fanOutErr) {
                console.error(`[Scheduled Job] Post-crawl fan-out failed for org ${competitor.organizationId}:`, (fanOutErr as Error).message);
              }
            }

            if (!competitor.faviconUrl || !competitor.screenshotUrl) {
              captureVisualAssets(competitor.url, competitor.id).then(async (visualAssets) => {
                if (visualAssets.faviconUrl || visualAssets.screenshotUrl) {
                  await storage.updateCompetitor(competitor.id, {
                    faviconUrl: visualAssets.faviconUrl || competitor.faviconUrl,
                    screenshotUrl: visualAssets.screenshotUrl || competitor.screenshotUrl,
                  });
                  if (competitor.organizationId) {
                    await storage.updateOrganization(competitor.organizationId, {
                      faviconUrl: visualAssets.faviconUrl || undefined,
                      screenshotUrl: visualAssets.screenshotUrl || undefined,
                    }).catch(() => {});
                  }
                }
              }).catch(err => console.error(`Visual capture failed for ${competitor.name}:`, err));
            }

            const websiteContent = getCombinedContent(crawlResult);
            let analysisResult = null;
            if (websiteContent.length > 100) {
              try {
                const linkedInEngagement = competitor.linkedInEngagement as {
                  followers?: number;
                  posts?: number;
                  employees?: number;
                  recentPosts?: Array<{ text: string; reactions?: number; comments?: number }>;
                } | null;
                
                const linkedInData: LinkedInContext | undefined = linkedInEngagement ? {
                  followerCount: linkedInEngagement.followers,
                  employeeCount: linkedInEngagement.employees,
                  recentPosts: linkedInEngagement.recentPosts,
                } : undefined;
                
                const analysis = await analyzeCompetitorWebsite(
                  competitor.name,
                  competitor.url,
                  websiteContent,
                  undefined,
                  linkedInData
                );
                await storage.updateCompetitorAnalysis(competitor.id, analysis);
                analysisResult = { summary: analysis.summary };

                if (competitor.organizationId) {
                  const orgEnrichment: any = {};
                  if (analysis.description) orgEnrichment.description = analysis.description;
                  if (analysis.category) orgEnrichment.category = analysis.category;
                  if (analysis.industry) orgEnrichment.industry = analysis.industry;
                  if (Object.keys(orgEnrichment).length > 0) {
                    await crawlOps.updateOrganization(competitor.organizationId, orgEnrichment)
                      .catch(err => console.error(`[Scheduled Job] Org enrichment failed for ${competitor.name}:`, err.message));
                  }
                }

                await storage.createActivity({
                  type: "scheduled_crawl",
                  competitorId: competitor.id,
                  competitorName: competitor.name,
                  description: `Scheduled analysis of ${crawlResult.pages.length} pages: ${analysis.summary}`,
                  date: new Date().toISOString(),
                  impact: "Low",
                  tenantDomain: tenant.domain,
                  marketId: competitor.marketId,
                });
              } catch (aiError) {
                console.error(`[Scheduled Job] AI analysis failed for ${competitor.name}:`, aiError);
              }
            }

            return {
              status: "success",
              pagesCrawled: crawlResult.pages.length,
              totalWordCount: crawlResult.totalWordCount,
              blogPostsDetected: crawlResult.blogSnapshot?.postCount || 0,
              socialLinksFound: Object.keys(crawlResult.socialLinks).filter(k => crawlResult.socialLinks[k as keyof typeof crawlResult.socialLinks]).length,
              analysis: analysisResult,
            };
          },
        )).catch(async (err) => {
          console.error(`[Scheduled Job] Queued crawl failed for ${competitor.name}:`, err.message);
          if (err.message?.includes("timed out")) {
            await storage.incrementCompetitorCrawlFailures(competitor.id).catch(() => {});
          }
        });
      }

      // Crawl baseline company profiles on the same frequency as competitors
      const companyProfiles = await storage.getCompanyProfilesByTenantDomain(tenant.domain);
      for (const profile of companyProfiles) {
        // Skip profiles in archived markets
        if (await isMarketArchived(profile.marketId)) {
          console.log(`[Scheduled Job] Skipping baseline ${profile.companyName} - market is archived`);
          continue;
        }

        if (!profile.websiteUrl) continue;

        // Baseline safety-net: only crawl profiles that have never been crawled.
        // Recurring crawls are handled entirely by the merged website-monitor pass.
        if (profile.crawlData || profile.previousWebsiteContent) {
          continue;
        }

        console.log(`[Scheduled Job] Queuing first-time baseline crawl for ${profile.companyName} (${profile.websiteUrl})...`);

        enqueueCrawl(`crawl:baseline:${profile.companyName}`, () => trackJobRun(
          "websiteCrawl",
          tenant.domain,
          profile.id,
          `Baseline: ${profile.companyName}`,
          async () => {
            const crawlResult = await crawlCompetitorWebsite(profile.websiteUrl!);

            if (crawlResult.pages.length === 0) {
              return { status: "no_pages", message: `No pages found for baseline ${profile.companyName}` };
            }

            const updates: any = {
              crawlData: buildCrawlData(crawlResult),
              lastFullCrawl: new Date(),
              lastCrawl: new Date().toISOString(),
              // Stamp lastWebsiteMonitor so the monitor sweep freshness gate
              // suppresses a same-cycle second fetch for newly onboarded baseline profiles.
              lastWebsiteMonitor: new Date(),
            };

            // Update social links if found
            if (crawlResult.socialLinks.linkedIn && !profile.linkedInUrl) {
              updates.linkedInUrl = crawlResult.socialLinks.linkedIn;
            }
            if (crawlResult.socialLinks.instagram && !profile.instagramUrl) {
              updates.instagramUrl = crawlResult.socialLinks.instagram;
            }
            if (crawlResult.socialLinks.twitter && !profile.twitterUrl) {
              updates.twitterUrl = crawlResult.socialLinks.twitter;
            }
            if (crawlResult.socialLinks.facebook && !profile.facebookUrl) {
              updates.facebookUrl = crawlResult.socialLinks.facebook;
            }

            // Update blog snapshot if found
            if (crawlResult.blogSnapshot) {
              updates.blogSnapshot = {
                ...crawlResult.blogSnapshot,
                capturedAt: new Date().toISOString(),
              };
            }

            // Store combined content for website monitoring change detection
            const combinedContent = getCombinedContent(crawlResult);
            updates.previousWebsiteContent = combinedContent.substring(0, 100000);

            await crawlOps.updateCompanyProfile(profile.id, updates);

            if (profile.organizationId) {
              await crawlOps.updateOrganization(profile.organizationId, {
                crawlData: updates.crawlData,
                lastFullCrawl: updates.lastFullCrawl,
                lastCrawl: updates.lastCrawl,
                previousWebsiteContent: updates.previousWebsiteContent,
                linkedInUrl: updates.linkedInUrl,
                instagramUrl: updates.instagramUrl,
                twitterUrl: updates.twitterUrl,
                blogSnapshot: updates.blogSnapshot,
              }).catch(err => console.error(`[Scheduled Job] Org sync failed for baseline ${profile.companyName}:`, err.message));
            }

            // Run AI analysis on the crawled content
            const websiteContent = getCombinedContent(crawlResult);
            let analysisResult = null;
            if (websiteContent.length > 100) {
              try {
                // Get LinkedIn engagement data if available
                const linkedInEngagement = profile.linkedInEngagement as {
                  followers?: number;
                  posts?: number;
                  employees?: number;
                  recentPosts?: Array<{ text: string; reactions?: number; comments?: number }>;
                } | null;

                const linkedInData: LinkedInContext | undefined = linkedInEngagement ? {
                  followerCount: linkedInEngagement.followers,
                  employeeCount: linkedInEngagement.employees,
                  recentPosts: linkedInEngagement.recentPosts,
                } : undefined;

                const analysis = await analyzeCompetitorWebsite(
                  profile.companyName,
                  profile.websiteUrl!,
                  websiteContent,
                  undefined, // groundingContext
                  linkedInData
                );

                // Save analysis to company profile
                await crawlOps.updateCompanyProfile(profile.id, { analysisData: analysis });
                analysisResult = analysis;
              } catch (analysisError: any) {
                console.error(`[Scheduled Job] AI analysis failed for baseline ${profile.companyName}:`, analysisError.message);
              }
            }

            try {
              await identifySuggestedAssets(
                crawlResult,
                profile.id,
                tenant.domain,
                profile.marketId || undefined
              );
            } catch (assetSuggestError: any) {
              console.error(`[Scheduled Job] Asset suggestion failed for ${profile.companyName}:`, assetSuggestError.message);
            }

            return {
              status: "success",
              entityType: "baseline",
              pagesCrawled: crawlResult.pages.length,
              totalWordCount: crawlResult.totalWordCount,
              blogPostsDetected: crawlResult.blogSnapshot?.postCount || 0,
              socialLinksFound: Object.keys(crawlResult.socialLinks).filter(k => crawlResult.socialLinks[k as keyof typeof crawlResult.socialLinks]).length,
              analysis: analysisResult,
            };
          }
        )).catch(err => console.error(`[Scheduled Job] Queued baseline crawl failed for ${profile.companyName}:`, err.message));
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Website crawl job failed:", error);
  } finally {
    jobStatus.websiteCrawl.isRunning = false;
    jobStatus.websiteCrawl.abortController = null;
    jobStatus.websiteCrawl.lastRun = new Date();
    const crawlsSkipped = sweepMetrics.crawlsSkippedOrgFresh + sweepMetrics.crawlsSkippedOrgQueued;
    const estTimeSavedSec = crawlsSkipped * 60;
    console.log(`[Scheduled Job] Website crawl sweep completed — total checked: ${sweepMetrics.totalChecked}, crawls queued: ${sweepMetrics.crawlsExecuted}, skipped (org fresh): ${sweepMetrics.crawlsSkippedOrgFresh}, skipped (org queued): ${sweepMetrics.crawlsSkippedOrgQueued}, est. time saved: ${estTimeSavedSec}s`);
  }
}

async function runSocialMonitorJob(): Promise<void> {
  if (jobStatus.socialMonitor.isRunning) {
    console.log("[Scheduled Job] Social monitor already running, skipping...");
    return;
  }

  const abortController = new AbortController();
  jobStatus.socialMonitor.abortController = abortController;
  jobStatus.socialMonitor.isRunning = true;
  console.log("[Scheduled Job] Starting social monitor job...");

  const sweepMetrics = { totalChecked: 0, fetchesExecuted: 0, fetchesSkippedOrgFresh: 0, fetchesSkippedOrgQueued: 0 };
  const orgsQueuedThisSweep = new Set<string>();

  try {
    const tenants = await storage.getAllTenants();

    for (const tenant of tenants) {
      if (abortController.signal.aborted) {
        console.log("[Scheduled Job] Social monitor job was cancelled");
        break;
      }
      if (tenant.status !== "active") continue;
      if (!tenant.socialMonitoringEnabled) continue;

      const frequency = tenant.monitoringFrequency || "weekly";
      if (frequency === "disabled") continue;

      const intervalMs = getIntervalMs(frequency);
      if (intervalMs === 0) continue;

      const competitors = await storage.getCompetitorsByTenantDomain(tenant.domain);

      for (const competitor of competitors) {
        sweepMetrics.totalChecked++;

        // Skip competitors in archived markets
        if (await isMarketArchived(competitor.marketId)) {
          console.log(`[Scheduled Job] Skipping social for ${competitor.name} - market is archived`);
          continue;
        }
        
        if (!competitor.linkedInUrl && !competitor.instagramUrl) continue;

        // Use per-competitor frequency, defaulting to "daily"
        const competitorFrequency = (competitor as any).socialCheckFrequency || "daily";
        const competitorIntervalMs = getIntervalMs(competitorFrequency);
        if (competitorIntervalMs === 0) continue;

        const lastSocialCrawl = competitor.lastSocialCrawl
          ? new Date(competitor.lastSocialCrawl).getTime()
          : 0;
        const now = Date.now();

        if (now - lastSocialCrawl < competitorIntervalMs) {
          continue;
        }

        if (competitor.organizationId) {
          try {
            const org = await storage.getOrganization(competitor.organizationId);

            const hasOrgSocialPayload = org && (org.linkedInContent || org.linkedInEngagement || org.instagramContent || org.instagramEngagement || org.twitterContent || org.twitterEngagement);

            if (orgsQueuedThisSweep.has(competitor.organizationId)) {
              sweepMetrics.fetchesSkippedOrgQueued++;
              console.log(`[Scheduled Job] Skipping social fetch for ${competitor.name} - org already queued this sweep, will receive fresh data via post-fetch fan-out`);
              continue;
            }

            if (org?.lastSocialCrawl && hasOrgSocialPayload) {
              const orgLastSocial = new Date(org.lastSocialCrawl).getTime();
              if (Number.isFinite(orgLastSocial) && now - orgLastSocial < competitorIntervalMs) {
                const syncUpdates: any = { lastSocialCrawl: org.lastSocialCrawl };
                if (org.linkedInContent) syncUpdates.linkedInContent = org.linkedInContent;
                if (org.linkedInEngagement) syncUpdates.linkedInEngagement = org.linkedInEngagement;
                if (org.instagramContent) syncUpdates.instagramContent = org.instagramContent;
                if (org.instagramEngagement) syncUpdates.instagramEngagement = org.instagramEngagement;
                if (org.twitterContent) syncUpdates.twitterContent = org.twitterContent;
                if (org.twitterEngagement) syncUpdates.twitterEngagement = org.twitterEngagement;

                await storage.updateCompetitor(competitor.id, syncUpdates);

                sweepMetrics.fetchesSkippedOrgFresh++;
                console.log(`[Scheduled Job] Skipping social fetch for ${competitor.name} - org already monitored recently, synced data`);
                continue;
              }
            }
          } catch (orgErr) {
            console.error(`[Scheduled Job] Org social freshness check failed for ${competitor.name}:`, (orgErr as Error).message);
          }

          orgsQueuedThisSweep.add(competitor.organizationId);
        }

        sweepMetrics.fetchesExecuted++;
        console.log(`[Scheduled Job] Queuing social monitor for ${competitor.name} (${competitorFrequency})...`);

        enqueueMonitor(`social:${competitor.name}`, () => trackJobRun(
          "socialMonitor",
          tenant.domain,
          competitor.id,
          `Competitor: ${competitor.name}`,
          async () => {
            await monitorCompetitorSocialMedia(competitor.id, tenant.domain);

            if (competitor.organizationId) {
              try {
                const freshOrg = await storage.getOrganization(competitor.organizationId);
                if (freshOrg) {
                  const siblings = await storage.getCompetitorsByOrganizationId(competitor.organizationId);
                  for (const sibling of siblings) {
                    if (sibling.id === competitor.id) continue;
                    const siblingSync: any = {};
                    if (freshOrg.lastSocialCrawl) siblingSync.lastSocialCrawl = freshOrg.lastSocialCrawl;
                    if (freshOrg.linkedInContent) siblingSync.linkedInContent = freshOrg.linkedInContent;
                    if (freshOrg.linkedInEngagement) siblingSync.linkedInEngagement = freshOrg.linkedInEngagement;
                    if (freshOrg.instagramContent) siblingSync.instagramContent = freshOrg.instagramContent;
                    if (freshOrg.instagramEngagement) siblingSync.instagramEngagement = freshOrg.instagramEngagement;
                    if (freshOrg.twitterContent) siblingSync.twitterContent = freshOrg.twitterContent;
                    if (freshOrg.twitterEngagement) siblingSync.twitterEngagement = freshOrg.twitterEngagement;
                    if (Object.keys(siblingSync).length > 0) {
                      await storage.updateCompetitor(sibling.id, siblingSync);
                    }
                  }
                  if (siblings.length > 1) {
                    console.log(`[Scheduled Job] Post-social fan-out: synced fresh data to ${siblings.length - 1} sibling competitor(s) for org ${competitor.organizationId}`);
                  }
                }
              } catch (fanOutErr) {
                console.error(`[Scheduled Job] Post-social fan-out failed for org ${competitor.organizationId}:`, (fanOutErr as Error).message);
              }
            }

            return {
              status: "success",
              entityType: "competitor",
              linkedIn: !!competitor.linkedInUrl,
              instagram: !!competitor.instagramUrl,
            };
          }
        ), 5 * 60 * 1000).catch(err => console.error(`[Scheduled Job] Queued social monitor failed for ${competitor.name}:`, err.message));
      }

      // Monitor company profiles (baseline) for social changes
      const companyProfiles = await storage.getCompanyProfilesByTenantDomain(tenant.domain);
      for (const profile of companyProfiles) {
        // Skip profiles in archived markets
        if (await isMarketArchived(profile.marketId)) {
          console.log(`[Scheduled Job] Skipping baseline social for ${profile.companyName} - market is archived`);
          continue;
        }
        
        if (!profile.linkedInUrl && !profile.instagramUrl && !profile.twitterUrl) continue;

        // Use per-profile frequency, defaulting to "daily"
        const profileFrequency = (profile as any).socialCheckFrequency || "daily";
        const profileIntervalMs = getIntervalMs(profileFrequency);
        if (profileIntervalMs === 0) continue;

        const lastSocialCrawl = profile.lastSocialCrawl
          ? new Date(profile.lastSocialCrawl).getTime()
          : 0;
        const now = Date.now();

        if (now - lastSocialCrawl < profileIntervalMs) {
          continue;
        }

        console.log(`[Scheduled Job] Queuing baseline social monitor for ${profile.companyName} (${profileFrequency})...`);

        enqueueMonitor(`social:baseline:${profile.companyName}`, () => trackJobRun(
          "socialMonitor",
          tenant.domain,
          profile.id,
          `Baseline: ${profile.companyName}`,
          async () => {
            await monitorCompanyProfileSocialMedia(
              profile.id,
              profile.userId,
              tenant.domain,
              profile.marketId || undefined
            );
            return {
              status: "success",
              entityType: "baseline",
              linkedIn: !!profile.linkedInUrl,
              instagram: !!profile.instagramUrl,
              twitter: !!profile.twitterUrl,
            };
          }
        ), 5 * 60 * 1000).catch(err => console.error(`[Scheduled Job] Queued baseline social failed for ${profile.companyName}:`, err.message));
      }

      // Monitor products for social changes (product-level social tracking)
      const products = await storage.getProductsByTenant(tenant.domain);
      for (const product of products) {
        if (!product.linkedInUrl && !product.instagramUrl && !product.twitterUrl) continue;

        // Use per-product frequency, defaulting to "daily"
        const productFrequency = (product as any).socialCheckFrequency || "daily";
        const productIntervalMs = getIntervalMs(productFrequency);
        if (productIntervalMs === 0) continue;

        const lastSocialCrawl = product.lastSocialCrawl
          ? new Date(product.lastSocialCrawl).getTime()
          : 0;
        const now = Date.now();

        if (now - lastSocialCrawl < productIntervalMs) {
          continue;
        }

        console.log(`[Scheduled Job] Queuing product social monitor for ${product.name} (${productFrequency})...`);

        enqueueMonitor(`social:product:${product.name}`, () => trackJobRun(
          "socialMonitor",
          tenant.domain,
          product.id,
          `Product: ${product.name}`,
          async () => {
            await monitorProductSocialMedia(
              product.id,
              product.createdBy,
              tenant.domain,
              product.marketId || undefined
            );
            return {
              status: "success",
              entityType: "product",
              linkedIn: !!product.linkedInUrl,
              instagram: !!product.instagramUrl,
              twitter: !!product.twitterUrl,
            };
          }
        ), 5 * 60 * 1000).catch(err => console.error(`[Scheduled Job] Queued product social failed for ${product.name}:`, err.message));
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Social monitor job failed:", error);
  } finally {
    jobStatus.socialMonitor.isRunning = false;
    jobStatus.socialMonitor.abortController = null;
    jobStatus.socialMonitor.lastRun = new Date();
    const fetchesSkipped = sweepMetrics.fetchesSkippedOrgFresh + sweepMetrics.fetchesSkippedOrgQueued;
    const estSocialTimeSavedSec = fetchesSkipped * 30;
    console.log(`[Scheduled Job] Social monitor sweep completed — total checked: ${sweepMetrics.totalChecked}, fetches queued: ${sweepMetrics.fetchesExecuted}, skipped (org fresh): ${sweepMetrics.fetchesSkippedOrgFresh}, skipped (org queued): ${sweepMetrics.fetchesSkippedOrgQueued}, est. time saved: ${estSocialTimeSavedSec}s`);
  }
}

async function runWebsiteMonitorJob(): Promise<void> {
  if (jobStatus.websiteMonitor.isRunning) {
    console.log("[Scheduled Job] Website monitor already running, skipping...");
    return;
  }

  const abortController = new AbortController();
  jobStatus.websiteMonitor.abortController = abortController;
  jobStatus.websiteMonitor.isRunning = true;
  console.log("[Scheduled Job] Starting website change monitor job...");

  const sweepMetrics = { totalChecked: 0, monitorsExecuted: 0, monitorsSkippedOrgFresh: 0, monitorsSkippedOrgQueued: 0 };
  const orgsQueuedThisSweep = new Set<string>();

  try {
    const tenants = await storage.getAllTenants();

    for (const tenant of tenants) {
      if (abortController.signal.aborted) {
        console.log("[Scheduled Job] Website monitor job was cancelled");
        break;
      }
      if (tenant.status !== "active") continue;

      // Check if tenant's plan allows website monitoring
      const plan = await storage.getServicePlanByName(tenant.plan);
      if (!plan?.websiteMonitorEnabled) {
        continue;
      }

      const frequency = tenant.monitoringFrequency || "weekly";
      if (frequency === "disabled") continue;

      const intervalMs = getIntervalMs(frequency);
      if (intervalMs === 0) continue;

      const competitors = await storage.getCompetitorsByTenantDomain(tenant.domain);

      for (const competitor of competitors) {
        sweepMetrics.totalChecked++;

        // Skip competitors in archived markets
        if (await isMarketArchived(competitor.marketId)) {
          console.log(`[Scheduled Job] Skipping website monitor for ${competitor.name} - market is archived`);
          continue;
        }

        // Skip competitors excluded from crawl
        if (competitor.excludeFromCrawl) {
          console.log(`[Scheduled Job] Skipping website monitor for ${competitor.name} - excluded from crawl`);
          continue;
        }
        
        const lastWebsiteMonitor = competitor.lastWebsiteMonitor
          ? new Date(competitor.lastWebsiteMonitor).getTime()
          : 0;
        const now = Date.now();

        if (now - lastWebsiteMonitor < intervalMs) {
          continue;
        }

        if (competitor.organizationId) {
          try {
            const org = await storage.getOrganization(competitor.organizationId);

            if (orgsQueuedThisSweep.has(competitor.organizationId)) {
              sweepMetrics.monitorsSkippedOrgQueued++;
              console.log(`[Scheduled Job] Skipping website monitor for ${competitor.name} - org already queued this sweep, will receive fresh data via post-monitor fan-out`);
              continue;
            }

            if (org?.lastWebsiteMonitor && (org.previousWebsiteContent || org.crawlData)) {
              const orgLastMonitor = new Date(org.lastWebsiteMonitor).getTime();
              if (Number.isFinite(orgLastMonitor) && now - orgLastMonitor < intervalMs) {
                const syncUpdates: any = { lastWebsiteMonitor: org.lastWebsiteMonitor };
                if (org.previousWebsiteContent) syncUpdates.previousWebsiteContent = org.previousWebsiteContent;
                if (org.crawlData) syncUpdates.crawlData = org.crawlData;
                if (org.blogSnapshot) syncUpdates.blogSnapshot = org.blogSnapshot;

                await storage.updateCompetitor(competitor.id, syncUpdates);

                sweepMetrics.monitorsSkippedOrgFresh++;
                console.log(`[Scheduled Job] Skipping website monitor for ${competitor.name} - org already monitored recently, synced data`);
                continue;
              }
            }
          } catch (orgErr) {
            console.error(`[Scheduled Job] Org website monitor freshness check failed for ${competitor.name}:`, (orgErr as Error).message);
          }

          orgsQueuedThisSweep.add(competitor.organizationId);
        }

        sweepMetrics.monitorsExecuted++;
        console.log(`[Scheduled Job] Queuing website monitor for ${competitor.name}...`);

        enqueueMonitor(`monitor:${competitor.name}`, (signal) => trackJobRun(
          "websiteMonitor",
          tenant.domain,
          competitor.id,
          `Competitor: ${competitor.name}`,
          async () => {
            if (signal?.aborted) throw new Error("Monitor aborted");
            const result = await monitorCompetitorWebsite(
              competitor.id, 
              competitor.userId,
              tenant.domain,
              signal,
              { profileRefreshIntervalMs: intervalMs }
            );

            if (competitor.organizationId) {
              try {
                const freshOrg = await storage.getOrganization(competitor.organizationId);
                if (freshOrg) {
                  const siblings = await storage.getCompetitorsByOrganizationId(competitor.organizationId);
                  for (const sibling of siblings) {
                    if (sibling.id === competitor.id) continue;
                    const siblingSync: any = {};
                    if (freshOrg.lastWebsiteMonitor) siblingSync.lastWebsiteMonitor = freshOrg.lastWebsiteMonitor;
                    if (freshOrg.previousWebsiteContent) siblingSync.previousWebsiteContent = freshOrg.previousWebsiteContent;
                    if (freshOrg.crawlData) siblingSync.crawlData = freshOrg.crawlData;
                    if (freshOrg.blogSnapshot) siblingSync.blogSnapshot = freshOrg.blogSnapshot;
                    if (Object.keys(siblingSync).length > 0) {
                      await storage.updateCompetitor(sibling.id, siblingSync);
                    }
                  }
                  if (siblings.length > 1) {
                    console.log(`[Scheduled Job] Post-monitor fan-out: synced fresh data to ${siblings.length - 1} sibling competitor(s) for org ${competitor.organizationId}`);
                  }
                }
              } catch (fanOutErr) {
                console.error(`[Scheduled Job] Post-monitor fan-out failed for org ${competitor.organizationId}:`, (fanOutErr as Error).message);
              }
            }

            return {
              status: result.status,
              entityType: "competitor",
              url: competitor.url,
            };
          },
        )).catch(async (err) => {
          console.error(`[Scheduled Job] Queued website monitor failed for ${competitor.name}:`, err.message);
          if (err.message?.includes("timed out")) {
            await storage.incrementCompetitorCrawlFailures(competitor.id).catch(() => {});
          }
        });
      }

      // Monitor company profiles (baseline) for website changes
      const companyProfiles = await storage.getCompanyProfilesByTenantDomain(tenant.domain);
      for (const profile of companyProfiles) {
        // Skip profiles in archived markets
        if (await isMarketArchived(profile.marketId)) {
          console.log(`[Scheduled Job] Skipping website monitor for ${profile.companyName} - market is archived`);
          continue;
        }
        
        const lastWebsiteMonitor = profile.lastWebsiteMonitor
          ? new Date(profile.lastWebsiteMonitor).getTime()
          : 0;
        const now = Date.now();

        if (now - lastWebsiteMonitor < intervalMs) {
          continue;
        }

        console.log(`[Scheduled Job] Queuing baseline website monitor for ${profile.companyName}...`);

        enqueueMonitor(`monitor:baseline:${profile.companyName}`, () => trackJobRun(
          "websiteMonitor",
          tenant.domain,
          profile.id,
          `Baseline: ${profile.companyName}`,
          async () => {
            await monitorCompanyProfileWebsite(
              profile.id,
              profile.userId,
              tenant.domain,
              profile.marketId || undefined,
              { profileRefreshIntervalMs: intervalMs }
            );
            return {
              status: "success",
              entityType: "baseline",
              url: profile.websiteUrl,
            };
          }
        )).catch(err => console.error(`[Scheduled Job] Queued baseline monitor failed for ${profile.companyName}:`, err.message));
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Website monitor job failed:", error);
  } finally {
    jobStatus.websiteMonitor.isRunning = false;
    jobStatus.websiteMonitor.abortController = null;
    jobStatus.websiteMonitor.lastRun = new Date();
    const monitorsSkipped = sweepMetrics.monitorsSkippedOrgFresh + sweepMetrics.monitorsSkippedOrgQueued;
    const estMonitorTimeSavedSec = monitorsSkipped * 45;
    console.log(`[Scheduled Job] Website monitor sweep completed — total checked: ${sweepMetrics.totalChecked}, monitors queued: ${sweepMetrics.monitorsExecuted}, skipped (org fresh): ${sweepMetrics.monitorsSkippedOrgFresh}, skipped (org queued): ${sweepMetrics.monitorsSkippedOrgQueued}, est. time saved: ${estMonitorTimeSavedSec}s`);
  }
}

// Pricing pages change infrequently (weeks/months between meaningful changes), so the
// pricing monitor enforces a minimum 7-day interval per competitor regardless of the
// tenant's general monitoringFrequency. This keeps LLM spend low while still catching
// changes within a week of when they happen.
const PRICING_MIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

async function runPricingMonitorJob(): Promise<void> {
  if (jobStatus.pricingMonitor.isRunning) {
    console.log("[Scheduled Job] Pricing monitor already running, skipping...");
    return;
  }

  const abortController = new AbortController();
  jobStatus.pricingMonitor.abortController = abortController;
  jobStatus.pricingMonitor.isRunning = true;
  console.log("[Scheduled Job] Starting pricing monitor job...");

  const sweepMetrics = { totalChecked: 0, monitorsExecuted: 0, monitorsSkippedNoUrl: 0, monitorsSkippedFresh: 0, monitorsSkippedPlan: 0 };

  try {
    const tenants = await storage.getAllTenants();

    for (const tenant of tenants) {
      if (abortController.signal.aborted) {
        console.log("[Scheduled Job] Pricing monitor job was cancelled");
        break;
      }
      if (tenant.status !== "active") continue;

      // Plan gate — pricing intelligence is Pro+. Skip free / trial tenants.
      const planGate = await checkFeatureAccessAsync(tenant.plan, "pricingIntelligence");
      if (!planGate.allowed) {
        sweepMetrics.monitorsSkippedPlan++;
        continue;
      }

      const frequency = tenant.monitoringFrequency || "weekly";
      if (frequency === "disabled") continue;

      const competitors = await storage.getCompetitorsByTenantDomain(tenant.domain);

      for (const competitor of competitors) {
        sweepMetrics.totalChecked++;

        if (!competitor.pricingPageUrl) {
          sweepMetrics.monitorsSkippedNoUrl++;
          continue;
        }
        if (await isMarketArchived(competitor.marketId)) continue;
        if (competitor.excludeFromCrawl) continue;

        const lastCheck = competitor.lastPricingCheck
          ? new Date(competitor.lastPricingCheck).getTime()
          : 0;
        const now = Date.now();
        if (now - lastCheck < PRICING_MIN_INTERVAL_MS) {
          sweepMetrics.monitorsSkippedFresh++;
          continue;
        }

        sweepMetrics.monitorsExecuted++;
        console.log(`[Scheduled Job] Queuing pricing monitor for ${competitor.name}...`);

        enqueueMonitor(`pricing:${competitor.name}`, (signal) => trackJobRun(
          "pricingMonitor",
          tenant.domain,
          competitor.id,
          `Competitor: ${competitor.name}`,
          async () => {
            if (signal?.aborted) throw new Error("Pricing monitor aborted");
            const result = await monitorCompetitorPricing(competitor.id, {
              userId: competitor.userId,
              tenantDomain: tenant.domain,
              signal,
            });
            // Stamp lastPricingCheck on every outcome so persistently-failing
            // competitors don't re-queue every 6h. The service only stamps on
            // success (so the freshness UI reflects "last successful capture");
            // here we additionally stamp on no_content / error / no_url so the
            // scheduler's 7-day gate engages regardless of result.
            if (result.status !== "success") {
              await storage.updateCompetitor(competitor.id, { lastPricingCheck: new Date() })
                .catch((err) => console.error(`[Scheduled Job] lastPricingCheck stamp on ${result.status} failed for ${competitor.name}:`, err.message));
            }
            return {
              status: result.status,
              entityType: "competitor",
              url: competitor.pricingPageUrl,
              hasChanges: result.hasChanges,
              changeScore: result.changeScore,
            };
          },
        )).catch((err) => {
          console.error(`[Scheduled Job] Queued pricing monitor failed for ${competitor.name}:`, err.message);
        });
      }

      // Monitor baseline company pricing
      const companyProfiles = await storage.getCompanyProfilesByTenantDomain(tenant.domain);
      for (const profile of companyProfiles) {
        if (!profile.pricingPageUrl) continue;
        if (await isMarketArchived(profile.marketId)) continue;

        const lastCheck = profile.lastPricingCheck
          ? new Date(profile.lastPricingCheck).getTime()
          : 0;
        const now = Date.now();
        if (now - lastCheck < PRICING_MIN_INTERVAL_MS) continue;

        sweepMetrics.monitorsExecuted++;
        console.log(`[Scheduled Job] Queuing baseline pricing monitor for ${profile.companyName}...`);

        enqueueMonitor(`pricing:baseline:${profile.companyName}`, (signal) => trackJobRun(
          "pricingMonitor",
          tenant.domain,
          profile.id,
          `Baseline: ${profile.companyName}`,
          async () => {
            if (signal?.aborted) throw new Error("Baseline pricing monitor aborted");
            const result = await monitorBaselinePricing(profile.id, {
              userId: profile.userId,
              tenantDomain: tenant.domain,
              signal,
            });
            if (result.status !== "success") {
              await storage.updateCompanyProfile(profile.id, { lastPricingCheck: new Date() })
                .catch((err) => console.error(`[Scheduled Job] lastPricingCheck stamp on ${result.status} failed for baseline ${profile.companyName}:`, err.message));
            }
            return {
              status: result.status,
              entityType: "baseline",
              url: profile.pricingPageUrl,
              hasChanges: result.hasChanges,
              changeScore: result.changeScore,
            };
          },
        )).catch((err) => {
          console.error(`[Scheduled Job] Queued baseline pricing monitor failed for ${profile.companyName}:`, err.message);
        });
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Pricing monitor job failed:", error);
  } finally {
    jobStatus.pricingMonitor.isRunning = false;
    jobStatus.pricingMonitor.abortController = null;
    jobStatus.pricingMonitor.lastRun = new Date();
    console.log(
      `[Scheduled Job] Pricing monitor sweep completed — total checked: ${sweepMetrics.totalChecked}, ` +
      `queued: ${sweepMetrics.monitorsExecuted}, no_url: ${sweepMetrics.monitorsSkippedNoUrl}, ` +
      `fresh: ${sweepMetrics.monitorsSkippedFresh}, plan_blocked: ${sweepMetrics.monitorsSkippedPlan}`
    );
  }
}

async function runProductMonitorJob(): Promise<void> {
  if (jobStatus.productMonitor.isRunning) {
    console.log("[Scheduled Job] Product monitor already running, skipping...");
    return;
  }

  const abortController = new AbortController();
  jobStatus.productMonitor.abortController = abortController;
  jobStatus.productMonitor.isRunning = true;
  console.log("[Scheduled Job] Starting product monitor job...");

  try {
    const tenants = await storage.getAllTenants();

    for (const tenant of tenants) {
      if (abortController.signal.aborted) {
        console.log("[Scheduled Job] Product monitor job was cancelled");
        break;
      }
      if (tenant.status !== "active") continue;

      // Check if tenant's plan allows product monitoring
      const plan = await storage.getServicePlanByName(tenant.plan);
      if (!plan?.productMonitorEnabled) {
        continue;
      }

      const frequency = tenant.monitoringFrequency || "weekly";
      if (frequency === "disabled") continue;

      const intervalMs = getIntervalMs(frequency);
      if (intervalMs === 0) continue;

      // Get all standalone products (products with URL but no competitor/baseline link)
      const products = await storage.getProductsByTenant(tenant.domain);
      
      for (const product of products) {
        // Skip products that are linked to competitors or baselines - they're monitored via their parent
        if (product.competitorId || product.companyProfileId) continue;
        
        // Skip products without a URL
        if (!product.url) continue;

        // Skip products excluded from crawl
        if (product.excludeFromCrawl) {
          console.log(`[Scheduled Job] Skipping product monitor for ${product.name} - excluded from crawl`);
          continue;
        }

        // Skip products in archived markets
        if (await isMarketArchived(product.marketId)) {
          console.log(`[Scheduled Job] Skipping product monitor for ${product.name} - market is archived`);
          continue;
        }

        const lastMonitor = product.lastWebsiteMonitor
          ? new Date(product.lastWebsiteMonitor).getTime()
          : 0;
        const now = Date.now();

        if (now - lastMonitor < intervalMs) {
          continue;
        }

        console.log(`[Scheduled Job] Queuing product monitor for ${product.name}...`);

        enqueueMonitor(`monitor:product:${product.name}`, (signal) => trackJobRun(
          "productMonitor",
          tenant.domain,
          product.id,
          `Product: ${product.name}`,
          async () => {
            if (signal?.aborted) throw new Error("Monitor aborted");
            const result = await monitorProductWebsite(
              product.id,
              product.createdBy || "",
              tenant.domain,
              product.marketId || undefined,
              signal
            );
            return {
              status: result.status,
              entityType: "product",
              url: product.url,
            };
          },
        )).catch(async (err) => {
          console.error(`[Scheduled Job] Queued product monitor failed for ${product.name}:`, err.message);
          if (err.message?.includes("timed out")) {
            await storage.incrementProductCrawlFailures(product.id).catch(() => {});
          }
        });
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Product monitor job failed:", error);
  } finally {
    jobStatus.productMonitor.isRunning = false;
    jobStatus.productMonitor.abortController = null;
    jobStatus.productMonitor.lastRun = new Date();
    console.log("[Scheduled Job] Product monitor job completed");
  }
}

async function runTrialReminderJob(): Promise<void> {
  if (jobStatus.trialReminder.isRunning) {
    console.log("[Scheduled Job] Trial reminder already running, skipping...");
    return;
  }

  jobStatus.trialReminder.isRunning = true;
  console.log("[Scheduled Job] Starting trial reminder job...");
  const jobRunId = await trackJobStart("trial_reminder");

  try {
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.REPLIT_DEPLOYMENT_URL 
        ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
        : 'https://orbit.synozur.com';
    
    const result = await processTrialReminders(baseUrl);
    console.log(`[Scheduled Job] Trial reminder job completed: ${result.processed} processed, ${result.errors} errors`);
    await trackJobComplete(jobRunId, "completed", { processed: result.processed, errors: result.errors });
  } catch (error) {
    console.error("[Scheduled Job] Trial reminder job failed:", error);
    await trackJobComplete(jobRunId, "failed", undefined, String(error));
  } finally {
    jobStatus.trialReminder.isRunning = false;
    jobStatus.trialReminder.lastRun = new Date();
  }
}

const WEEKLY_DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function checkAndRunWeeklyDigest(): Promise<void> {
  try {
    const recentRuns = await storage.getScheduledJobRunsByType("weeklyDigest");
    const lastCompleted = recentRuns.find((r: { status: string; completedAt: Date | null }) => r.status === "completed");
    
    if (lastCompleted?.completedAt) {
      const elapsed = Date.now() - new Date(lastCompleted.completedAt).getTime();
      if (elapsed < WEEKLY_DIGEST_INTERVAL_MS) {
        return;
      }
    }
    
    console.log("[Scheduled Job] Weekly digest is overdue, triggering now...");
    await runWeeklyDigestJob();
  } catch (err) {
    console.error("[Scheduled Job] Error checking weekly digest schedule:", err);
  }
}

const tenantBriefingCache: Map<string, { briefingId: string; briefingData: BriefingData } | null> = new Map();

async function generateBriefingForTenant(tenantDomain: string): Promise<{ briefingId: string; briefingData: BriefingData } | null> {
  if (tenantBriefingCache.has(tenantDomain)) {
    return tenantBriefingCache.get(tenantDomain) || null;
  }

  try {
    console.log(`[Scheduled Job] Generating intelligence briefing for tenant ${tenantDomain}...`);
    const briefing = await generateBriefing(tenantDomain, 8);
    const result = {
      briefingId: briefing.id,
      briefingData: briefing.briefingData as BriefingData,
    };
    tenantBriefingCache.set(tenantDomain, result);
    return result;
  } catch (error) {
    console.error(`[Scheduled Job] Failed to generate briefing for ${tenantDomain}:`, error);
    tenantBriefingCache.set(tenantDomain, null);
    return null;
  }
}

async function runWeeklyDigestJob(): Promise<void> {
  if (jobStatus.weeklyDigest.isRunning) {
    console.log("[Scheduled Job] Weekly digest already running, skipping...");
    return;
  }

  jobStatus.weeklyDigest.isRunning = true;
  console.log("[Scheduled Job] Starting weekly digest job...");

  const jobRun = await storage.createScheduledJobRun({
    jobType: "weeklyDigest",
    status: "running",
    startedAt: new Date(),
  });

  try {
    const usersWithDigest = await storage.getUsersWithDigestEnabled();
    console.log(`[Scheduled Job] Found ${usersWithDigest.length} users with digest enabled`);

    tenantBriefingCache.clear();

    // Group recipients by tenant so the central dispatcher emails each
    // user and fires the tenant webhook exactly once per tenant per run.
    const tenantsToDigest = new Set<string>();
    for (const user of usersWithDigest) {
      const domain = user.email.split("@")[1];
      if (domain) tenantsToDigest.add(domain);
    }

    let dispatched = 0;
    let errorCount = 0;
    for (const domain of Array.from(tenantsToDigest)) {
      try {
        const ctx = await buildWeeklyDigestCtx(domain);
        if (!ctx) continue;
        await notifications.dispatch(domain, "weekly_digest", ctx);
        dispatched++;
      } catch (tenantErr) {
        console.error(`[Scheduled Job] Weekly digest dispatch failed for ${domain}:`, tenantErr);
        errorCount++;
      }
    }

    tenantBriefingCache.clear();

    console.log(`[Scheduled Job] Weekly digest job completed: ${dispatched} tenant(s), ${errorCount} errors`);
    await storage.updateScheduledJobRun(jobRun.id, {
      status: "completed",
      completedAt: new Date(),
      result: { tenantsDispatched: dispatched, errorCount },
    });
  } catch (error) {
    console.error("[Scheduled Job] Weekly digest job failed:", error);
    await storage.updateScheduledJobRun(jobRun.id, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    jobStatus.weeklyDigest.isRunning = false;
    jobStatus.weeklyDigest.lastRun = new Date();
    tenantBriefingCache.clear();
  }
}

function getBaseUrl(): string {
  return process.env.REPLIT_DEV_DOMAIN 
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.REPLIT_DEPLOYMENT_URL 
      ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
      : 'https://orbit.synozur.com';
}

/**
 * Build the activities + briefing payload for a tenant's weekly digest.
 * Returns null if the tenant is missing/inactive.
 */
async function buildWeeklyDigestCtx(tenantDomain: string): Promise<{
  activities: { competitorName: string; type: string; description: string; summary?: string }[];
  briefing?: BriefingDigestData;
} | null> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant || tenant.status !== "active") return null;

  const weeklyActivity = await storage.getWeeklyActivityByTenant(tenantDomain);
  const activities = weeklyActivity.map(act => ({
    competitorName: act.competitorName,
    type: act.type,
    description: act.description,
    summary: act.summary || undefined,
  }));

  const tenantBriefing = await generateBriefingForTenant(tenantDomain);
  const briefing = tenantBriefing ? {
    executiveSummary: tenantBriefing.briefingData.executiveSummary,
    actionItems: tenantBriefing.briefingData.actionItems || [],
    riskAlerts: tenantBriefing.briefingData.riskAlerts || [],
    briefingId: tenantBriefing.briefingId,
  } : undefined;

  return { activities, briefing };
}

/**
 * Admin-triggered "send digest now" for a single user. Bypasses the tenant
 * fan-out and webhook delivery — this is a UI action, not a tenant event.
 */
export async function sendDigestNowForUser(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await storage.getUser(userId);
    if (!user) return { success: false, error: "User not found" };

    const domain = user.email.split("@")[1];
    if (!domain) return { success: false, error: "Invalid email domain" };

    const tenant = await storage.getTenantByDomain(domain);
    if (!tenant || tenant.status !== "active") {
      return { success: false, error: "Tenant is not active" };
    }

    const ctx = await buildWeeklyDigestCtx(domain);
    if (!ctx) return { success: false, error: "Failed to build digest context" };

    const sent = await sendWeeklyDigestEmail({
      email: user.email,
      name: user.name,
      companyName: tenant.name,
      activities: ctx.activities,
      baseUrl: getBaseUrl(),
      briefing: ctx.briefing,
    });

    if (sent) return { success: true };
    return { success: false, error: "Failed to send email. Check that your tenant is active and email service is configured." };
  } catch (err) {
    console.error(`[Digest] Error sending on-demand digest for user ${userId}:`, err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

async function runScheduledBriefingJob(): Promise<void> {
  if (jobStatus.scheduledBriefing?.isRunning) {
    console.log("[Scheduled Job] Scheduled briefing already running, skipping...");
    return;
  }

  if (!jobStatus.scheduledBriefing) {
    jobStatus.scheduledBriefing = { lastRun: null, isRunning: false, nextRun: null, abortController: null };
  }
  jobStatus.scheduledBriefing.isRunning = true;
  console.log("[Scheduled Job] Starting scheduled briefing job...");

  const jobRun = await storage.createScheduledJobRun({
    jobType: "scheduledBriefing",
    status: "running",
    startedAt: new Date(),
  });

  try {
    const baseUrl = getBaseUrl();
    const enabledConfigs = await storage.getEnabledScheduledBriefingConfigs();
    if (enabledConfigs.length === 0) {
      console.log("[Scheduled Briefing] No enabled scheduled briefing configs found, skipping.");
      await storage.updateScheduledJobRun(jobRun.id, {
        status: "completed",
        completedAt: new Date(),
        result: { generatedCount: 0, emailsSent: 0, errorCount: 0, skipped: "no_configs" },
      });
      return;
    }

    let generatedCount = 0;
    let emailsSent = 0;
    let errorCount = 0;

    const configsByTenant = new Map<string, typeof enabledConfigs>();
    for (const config of enabledConfigs) {
      if (!configsByTenant.has(config.tenantDomain)) configsByTenant.set(config.tenantDomain, []);
      configsByTenant.get(config.tenantDomain)!.push(config);
    }

    for (const [tenantDomain, configs] of Array.from(configsByTenant.entries())) {
      const tenant = await storage.getTenantByDomain(tenantDomain);
      if (!tenant || tenant.status !== "active") continue;

      const featureCheck = await checkFeatureAccessAsync(tenant.plan, "scheduledBriefingUpdates");
      if (!featureCheck.allowed) continue;

      const podcastCheck = await checkFeatureAccessAsync(tenant.plan, "podcastBriefings");

      for (const config of configs) {
        const marketId = config.marketId || undefined;

        const subscribers = await storage.getEnabledBriefingSubscribers(tenantDomain, marketId);
        if (subscribers.length === 0) {
          console.log(`[Scheduled Briefing] No subscribers for ${tenantDomain} market=${marketId}, skipping.`);
          continue;
        }

        console.log(`[Scheduled Briefing] Processing ${tenantDomain} market=${marketId}: ${subscribers.length} subscribers`);

        try {
          const briefing = await generateBriefing(tenantDomain, 8, marketId);
          if (!briefing || !briefing.briefingData) {
            console.warn(`[Scheduled Briefing] No briefing data for ${tenantDomain} market=${marketId}`);
            continue;
          }
          generatedCount++;

          const briefingData = briefing.briefingData as BriefingData;

          // Look up baseline company for this market so emails clearly identify which market the report covers
          let baselineCompanyName: string | undefined;
          if (marketId) {
            try {
              const market = await storage.getMarket(marketId);
              const baselineProfile = await storage.getCompanyProfileByContext({
                tenantId: tenant.id,
                tenantDomain,
                marketId,
                isDefaultMarket: false,
              });
              baselineCompanyName = baselineProfile?.companyName || market?.name || undefined;
            } catch {
              // non-fatal — email still sends without the anchor label
            }
          }

          let podcastUrl: string | undefined;

          if (podcastCheck.allowed) {
            try {
              const { generatePodcastAudio } = await import("./podcast-audio-generator");
              podcastUrl = await generatePodcastAudio(briefing.id, briefingData);
              console.log(`[Scheduled Briefing] Podcast generated for ${tenantDomain} market=${marketId}`);
            } catch (podcastErr) {
              console.error(`[Scheduled Briefing] Podcast generation failed for ${tenantDomain} market=${marketId}:`, podcastErr);
            }
          }

          for (const sub of subscribers) {
            try {
              const user = await storage.getUser(sub.userId);
              if (!user || !user.email) continue;

              const sent = await sendScheduledBriefingEmail(
                user.email,
                user.name,
                tenant.name,
                {
                  executiveSummary: briefingData.executiveSummary,
                  actionItems: briefingData.actionItems || [],
                  riskAlerts: briefingData.riskAlerts || [],
                  briefingId: briefing.id,
                  periodLabel: briefingData.periodLabel,
                  podcastUrl,
                  baselineCompanyName,
                },
                baseUrl,
              );
              if (sent) emailsSent++;
            } catch (emailErr) {
              console.error(`[Scheduled Briefing] Email failed for user ${sub.userId}:`, emailErr);
              errorCount++;
            }
          }
          // Note: briefing_ready webhook fan-out happens inside
          // intelligence-briefing-service.generateBriefing(), so on-demand
          // and scheduled briefings both fire the webhook from one place.
        } catch (tenantErr) {
          console.error(`[Scheduled Briefing] Failed for ${tenantDomain} market=${marketId}:`, tenantErr);
          errorCount++;
        }
      }
    }

    console.log(`[Scheduled Briefing] Job completed: ${generatedCount} briefings, ${emailsSent} emails, ${errorCount} errors`);
    await storage.updateScheduledJobRun(jobRun.id, {
      status: "completed",
      completedAt: new Date(),
      result: { generatedCount, emailsSent, errorCount },
    });
  } catch (error) {
    console.error("[Scheduled Briefing] Job failed:", error);
    await storage.updateScheduledJobRun(jobRun.id, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    jobStatus.scheduledBriefing.isRunning = false;
    jobStatus.scheduledBriefing.lastRun = new Date();
  }
}

async function checkAndRunScheduledBriefing(): Promise<void> {
  try {
    const recentRuns = await storage.getScheduledJobRunsByType("scheduledBriefing");
    const lastCompleted = recentRuns.find((r: { status: string; completedAt: Date | null }) => r.status === "completed");

    if (lastCompleted?.completedAt) {
      const elapsed = Date.now() - new Date(lastCompleted.completedAt).getTime();
      if (elapsed < WEEKLY_DIGEST_INTERVAL_MS) {
        return;
      }
    }

    console.log("[Scheduled Job] Scheduled briefing is overdue, triggering now...");
    await runScheduledBriefingJob();
  } catch (err) {
    console.error("[Scheduled Job] Error checking scheduled briefing:", err);
  }
}

// ---------------------------------------------------------------------------
// Planner sync job — syncs all marketing plans that have Planner connected
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Planner subscription auto-renewal — Graph subscriptions on Planner expire
// after ~3 days. We refresh anything within 12 hours of expiration so
// webhook delivery never lapses (Task #104).
// ---------------------------------------------------------------------------

async function runPlannerSubscriptionRenewalJob(): Promise<void> {
  try {
    const subs = await storage.getAllPlannerSubscriptions();
    const renewWindow = Date.now() + 12 * 60 * 60 * 1000;
    let renewed = 0;
    let failed = 0;
    for (const sub of subs) {
      if (sub.expiresAt.getTime() > renewWindow) continue;
      const plan = await db.query.marketingPlans.findFirst({
        where: (p, { eq }) => eq(p.id, sub.planId),
      });
      if (!plan || !plan.plannerConnectedBy) continue;
      const token = await getValidGraphToken(plan.plannerConnectedBy);
      if (!token) {
        await storage.updatePlannerSubscription(sub.planId, {
          lastError: "Planner consent unavailable for renewal",
        });
        failed += 1;
        continue;
      }
      try {
        const renewedSub = await renewGraphSubscription(token, sub.subscriptionId);
        await storage.updatePlannerSubscription(sub.planId, {
          expiresAt: new Date(renewedSub.expirationDateTime),
          lastRenewedAt: new Date(),
          lastError: null,
        });
        renewed += 1;
      } catch (err: any) {
        console.error(`[Planner] Renewal failed for plan ${sub.planId}:`, err.message);
        await storage.updatePlannerSubscription(sub.planId, {
          lastError: err.message,
        });
        failed += 1;
      }
    }
    if (renewed > 0 || failed > 0) {
      console.log(`[Planner Subscription] Renewal sweep: ${renewed} renewed, ${failed} failed`);
    }
  } catch (err: any) {
    console.error("[Planner Subscription] Renewal sweep error:", err.message);
  }
}

let plannerSubscriptionRenewalInterval: NodeJS.Timeout | null = null;

async function runPlannerSyncJob(): Promise<void> {
  if (jobStatus.plannerSync?.isRunning) {
    console.log("[Planner Sync] Job already running, skipping sweep");
    return;
  }
  if (!jobStatus.plannerSync) {
    jobStatus.plannerSync = { lastRun: null, isRunning: false, nextRun: null, abortController: null };
  }
  jobStatus.plannerSync.isRunning = true;
  jobStatus.plannerSync.lastRun = new Date();
  console.log("[Planner Sync] Starting auto-sync sweep...");
  let synced = 0;
  let failed = 0;
  try {
    // Find all marketing plans with Planner sync enabled across all tenants
    const enabledPlans = await db
      .select()
      .from(marketingPlans)
      .where(eq(marketingPlans.plannerSyncEnabled, true));

    const { queuePlannerSyncForPlan } = await import("./planner-service");
    for (const plan of enabledPlans) {
      try {
        const ctx = { tenantDomain: plan.tenantDomain, marketId: plan.marketId };
        // Hand off to the background queue (retry/back-off + DLQ) instead of
        // running sequentially and tying up the sweep on a single slow tenant.
        queuePlannerSyncForPlan(plan.id, ctx);
        synced += 1;
      } catch (planErr: any) {
        failed += 1;
        console.error(`[Planner Sync] Plan ${plan.id} (${plan.tenantDomain}) failed to enqueue:`, planErr.message);
      }
    }
    console.log(`[Planner Sync] Auto-sync sweep complete — ${synced} queued, ${failed} failed to enqueue out of ${enabledPlans.length} connected plans`);
  } catch (err: any) {
    console.error("[Planner Sync] Sweep failed:", err.message);
  } finally {
    jobStatus.plannerSync.isRunning = false;
  }
}

let websiteCrawlInterval: NodeJS.Timeout | null = null;
let socialMonitorInterval: NodeJS.Timeout | null = null;
let websiteMonitorInterval: NodeJS.Timeout | null = null;
let productMonitorInterval: NodeJS.Timeout | null = null;
let pricingMonitorInterval: NodeJS.Timeout | null = null;
let trialReminderInterval: NodeJS.Timeout | null = null;
let weeklyDigestInterval: NodeJS.Timeout | null = null;
let scheduledBriefingInterval: NodeJS.Timeout | null = null;
let plannerSyncInterval: NodeJS.Timeout | null = null;
let seoRefreshInterval: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// SEO refresh job — weekly per (tenant, market) sweep that re-runs SERP
// queries for every tracked keyword and records a row of seo_metrics.
// ---------------------------------------------------------------------------

const SEO_REFRESH_DEFAULT_INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function getTenantSeoIntervalMs(tenant: { seoRefreshIntervalDays?: number | null }): number {
  const days = tenant.seoRefreshIntervalDays ?? SEO_REFRESH_DEFAULT_INTERVAL_DAYS;
  const clamped = Math.max(1, Math.min(days, 90));
  return clamped * DAY_MS;
}

// ---------------------------------------------------------------------------
// Movement detection — compares the metrics just recorded by a market sweep
// against the most recent prior capture for each (keyword, entity) pair and
// returns the top gainers/losers ready for `notifications.dispatch`.
// ---------------------------------------------------------------------------

const SEO_MOVEMENT_RANK_DELTA_THRESHOLD = 5;
const SEO_MOVEMENT_PAGE_ONE_THRESHOLD = 10;
const SEO_MOVEMENT_TOP_N = 5;
// SerpAPI is queried with num=100, so the worst observable rank is 100.
// Any sentinel beyond that is "worse than not appearing in results", which
// guarantees `null -> rank` is always a positive delta (gain) and
// `rank -> null` is always negative (loss), regardless of the rank value.
const SEO_MOVEMENT_NULL_SENTINEL = 1000;

function isSignificantMovement(prev: number | null, curr: number | null): boolean {
  if (prev === null && curr === null) return false;
  // Entry to / exit from page 1 is always notable.
  const prevOnPageOne = prev !== null && prev <= SEO_MOVEMENT_PAGE_ONE_THRESHOLD;
  const currOnPageOne = curr !== null && curr <= SEO_MOVEMENT_PAGE_ONE_THRESHOLD;
  if (prevOnPageOne !== currOnPageOne) return true;
  // Newly ranked or fell out of results entirely.
  if (prev === null || curr === null) return true;
  // Otherwise require at least the rank-delta threshold.
  return Math.abs(prev - curr) >= SEO_MOVEMENT_RANK_DELTA_THRESHOLD;
}

function moverDelta(prev: number | null, curr: number | null): number {
  // Positive = improvement (rank got smaller). Use a sentinel that is worse
  // than any observable rank so a transition into the SERP from `null` is
  // always a gain and a transition out of the SERP to `null` is always a
  // loss — independent of how deep in the results the ranked side sits.
  const p = prev ?? SEO_MOVEMENT_NULL_SENTINEL;
  const c = curr ?? SEO_MOVEMENT_NULL_SENTINEL;
  return p - c;
}

async function computeSeoMoversForMarket(opts: {
  tenantDomain: string;
  marketId: string | null;
  isDefaultMarket: boolean;
  sweepStart: Date;
}): Promise<{ topGainers: SeoMover[]; topLosers: SeoMover[] }> {
  const { tenantDomain, marketId, isDefaultMarket, sweepStart } = opts;

  const marketCondition = isDefaultMarket
    ? isNull(seoMetrics.marketId)
    : marketId
      ? eq(seoMetrics.marketId, marketId)
      : isNull(seoMetrics.marketId);

  // Pull every metric for the (tenant, market) sorted newest-first. We dedupe
  // down to the latest two rows per (keyword, entity) pair below, so an
  // explicit time cutoff would risk silently hiding the previous capture for
  // tenants whose `seoRefreshIntervalDays` is set to the cadence cap (90)
  // or who skipped a run. Keeping the dataset trim is the responsibility of
  // SEO retention; alerting must work whatever the cadence is.
  const rows = await db
    .select()
    .from(seoMetrics)
    .where(
      and(
        eq(seoMetrics.tenantDomain, tenantDomain),
        marketCondition,
      ),
    )
    .orderBy(desc(seoMetrics.capturedAt));

  if (rows.length === 0) return { topGainers: [], topLosers: [] };

  // Fetch keyword text in one shot for display.
  const keywordIds = Array.from(new Set(rows.map((r) => r.keywordId)));
  const keywordRows = keywordIds.length === 0
    ? []
    : await db.select().from(trackedKeywords).where(
        eq(trackedKeywords.tenantDomain, tenantDomain),
      );
  const keywordById = new Map(keywordRows.map((k) => [k.id, k.keyword]));

  type Pair = { current: SeoMetric; previous: SeoMetric | null };
  const byPair = new Map<string, Pair>();
  for (const row of rows) {
    if (!row.entityId) continue;
    const key = `${row.keywordId}::${row.entityId}`;
    const existing = byPair.get(key);
    if (!existing) {
      byPair.set(key, { current: row, previous: null });
    } else if (existing.previous === null && row.id !== existing.current.id) {
      existing.previous = row;
    }
  }

  const movers: SeoMover[] = [];
  for (const { current, previous } of Array.from(byPair.values())) {
    // Only consider pairs where the current row is actually from this sweep —
    // otherwise we'd alert on stale data for an entity that wasn't refreshed.
    if (new Date(current.capturedAt).getTime() < sweepStart.getTime()) continue;
    if (!previous) continue;
    if (!isSignificantMovement(previous.rank, current.rank)) continue;

    const entityType: "baseline" | "competitor" =
      current.entityType === "baseline" ? "baseline" : "competitor";
    movers.push({
      keyword: keywordById.get(current.keywordId) ?? "(unknown keyword)",
      entityName: current.entityName,
      entityType,
      previousRank: previous.rank,
      currentRank: current.rank,
      delta: moverDelta(previous.rank, current.rank),
    });
  }

  const sorted = movers.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topGainers = sorted.filter((m) => m.delta > 0).slice(0, SEO_MOVEMENT_TOP_N);
  const topLosers = sorted.filter((m) => m.delta < 0).slice(0, SEO_MOVEMENT_TOP_N);
  return { topGainers, topLosers };
}

async function runSeoRefreshJob(): Promise<void> {
  if (jobStatus.seoRefresh.isRunning) {
    console.log("[SEO Refresh] Job already running, skipping sweep");
    return;
  }

  jobStatus.seoRefresh.isRunning = true;
  console.log("[SEO Refresh] Starting weekly SEO refresh sweep...");

  let tenantsProcessed = 0;
  let marketsProcessed = 0;
  let keywordsProcessed = 0;
  let rowsRecorded = 0;
  let errorCount = 0;

  try {
    const tenants = await storage.getAllTenants();
    for (const tenant of tenants) {
      if (tenant.status !== "active") continue;

      const featureCheck = await checkFeatureAccessAsync(tenant.plan, "seoTracking");
      if (!featureCheck.allowed) continue;

      const allKeywords = await storage.getTrackedKeywordsByTenant(tenant.domain);
      if (allKeywords.length === 0) continue;

      const tenantIntervalMs = getTenantSeoIntervalMs(tenant);
      const tenantRuns = await storage.getScheduledJobRunsByTenant(tenant.domain, 50);
      const lastTenantRun = tenantRuns.find((r) => r.jobType === "seoRefresh" && r.status === "completed");
      if (lastTenantRun?.completedAt) {
        const elapsed = Date.now() - new Date(lastTenantRun.completedAt).getTime();
        if (elapsed < tenantIntervalMs) continue;
      }

      // Group keywords by their market context so we can run one sweep per market.
      const marketGroups = new Map<string | null, typeof allKeywords>();
      for (const k of allKeywords) {
        const key = k.marketId ?? null;
        if (!marketGroups.has(key)) marketGroups.set(key, []);
        marketGroups.get(key)!.push(k);
      }

      tenantsProcessed += 1;

      const defaultMarket = await storage.getDefaultMarket(tenant.id);
      for (const [marketId] of Array.from(marketGroups.entries())) {
        if (await isMarketArchived(marketId)) {
          console.log(`[SEO Refresh] Skipping archived market ${marketId} for ${tenant.domain}`);
          continue;
        }

        const isDefault = marketId === null;
        const effectiveMarketId = isDefault ? (defaultMarket?.id ?? "") : marketId;
        if (isDefault && !effectiveMarketId) {
          console.log(`[SEO Refresh] Skipping ${tenant.domain} default-market keywords — no default market found`);
          continue;
        }

        const targetName = `${tenant.domain}/${marketId ?? "default"}`;
        await trackJobRun(
          "seoRefresh",
          tenant.domain,
          marketId ?? "default",
          targetName,
          async () => {
            const sweepStart = new Date();
            const result = await refreshSeoForContext({
              tenantDomain: tenant.domain,
              tenantId: tenant.id,
              marketId: effectiveMarketId,
              isDefaultMarket: isDefault,
            });
            keywordsProcessed += result.keywordsProcessed;
            rowsRecorded += result.rowsRecorded;
            marketsProcessed += 1;

            // Detect significant week-over-week movement and fan out alerts
            // through the central notifications dispatcher. Failures here must
            // never abort the sweep — alerting is best-effort.
            try {
              if (result.rowsRecorded > 0) {
                const { topGainers, topLosers } = await computeSeoMoversForMarket({
                  tenantDomain: tenant.domain,
                  marketId: isDefault ? null : marketId,
                  isDefaultMarket: isDefault,
                  sweepStart,
                });
                if (topGainers.length > 0 || topLosers.length > 0) {
                  let marketName: string | undefined;
                  if (!isDefault && effectiveMarketId) {
                    const m = await storage.getMarket(effectiveMarketId);
                    marketName = m?.name;
                  } else if (defaultMarket) {
                    marketName = defaultMarket.name;
                  }
                  await notifications.dispatch(tenant.domain, "seo_movement", {
                    marketId: isDefault ? null : marketId,
                    marketName,
                    topGainers,
                    topLosers,
                  });
                }
              }
            } catch (err) {
              console.error(`[SEO Refresh] Movement alert dispatch failed for ${targetName}:`, err);
            }

            return result;
          },
        ).catch((err) => {
          errorCount += 1;
          console.error(`[SEO Refresh] Failed for ${targetName}:`, err);
        });
      }
    }
    console.log(`[SEO Refresh] Sweep complete — tenants=${tenantsProcessed}, markets=${marketsProcessed}, keywords=${keywordsProcessed}, rows=${rowsRecorded}, errors=${errorCount}`);
  } catch (err) {
    console.error("[SEO Refresh] Sweep failed:", err);
  } finally {
    jobStatus.seoRefresh.isRunning = false;
    jobStatus.seoRefresh.lastRun = new Date();
  }
}

async function checkAndRunSeoRefresh(): Promise<void> {
  try {
    await runSeoRefreshJob();
  } catch (err) {
    console.error("[SEO Refresh] Error checking schedule:", err);
  }
}

export async function triggerSeoRefreshNow(): Promise<void> {
  runSeoRefreshJob();
}

// ───────────────────────────────────────────────────────────────────────────
// HubSpot daily sync (Task #100)
// ───────────────────────────────────────────────────────────────────────────

let hubspotSyncInterval: NodeJS.Timeout | null = null;
let outreachCadenceInterval: NodeJS.Timeout | null = null;
let collabCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Sales outreach cadence sweep — advances due cadence steps + reply-floor for
 * every active tenant, then reads each seller's mailbox to auto-detect sends and
 * replies. Best-effort; tenants without outreach or mailbox consent are no-ops.
 */
async function runOutreachCadenceJob(): Promise<void> {
  if (jobStatus.outreachCadence.isRunning) {
    console.log("[Outreach Cadence] Already running, skipping...");
    return;
  }
  jobStatus.outreachCadence.isRunning = true;
  try {
    const { runCadenceForTenant } = await import("./cadence-service");
    const tenants = await storage.getAllTenants();
    let advanced = 0, replies = 0;
    for (const tenant of tenants) {
      if (tenant.status !== "active") continue;
      const planAllows = await checkFeatureAccessAsync(tenant.plan, "outreachCadence");
      if (!planAllows.allowed) continue;
      try {
        const r = await runCadenceForTenant(tenant.domain);
        advanced += r.prospectsAdvanced;
        replies += r.repliesDetected;
      } catch (err) {
        console.error(`[Outreach Cadence] ${tenant.domain} failed:`, err);
      }
    }
    console.log(`[Outreach Cadence] Sweep complete — stepsAdvanced=${advanced}, repliesDetected=${replies}`);
  } catch (err) {
    console.error("[Outreach Cadence] Sweep failed:", err);
  } finally {
    jobStatus.outreachCadence.isRunning = false;
    jobStatus.outreachCadence.lastRun = new Date();
  }
}

export async function triggerOutreachCadenceNow(): Promise<void> {
  runOutreachCadenceJob();
}

async function runHubspotSyncJob(): Promise<void> {
  if (jobStatus.hubspotSync.isRunning) {
    console.log("[HubSpot Sync] Already running, skipping...");
    return;
  }
  jobStatus.hubspotSync.isRunning = true;
  console.log("[HubSpot Sync] Starting daily HubSpot sync sweep...");
  try {
    const { syncTenant, isHubspotOauthConfigured } = await import("./hubspot-integration");
    if (!isHubspotOauthConfigured()) {
      console.log("[HubSpot Sync] OAuth not configured — skipping");
      return;
    }
    const connections = await storage.listAllHubspotConnections();
    let okCount = 0;
    let failCount = 0;
    for (const conn of connections) {
      const tenant = await storage.getTenantByDomain(conn.tenantDomain).catch(() => null);
      if (!tenant) continue;
      const planAllowsSync = await checkFeatureAccessAsync(tenant.plan, "hubspotIntegration");
      if (!planAllowsSync.allowed) {
        console.log(`[HubSpot Sync] Skipping ${conn.tenantDomain} — plan ${tenant.plan} no longer permits HubSpot integration`);
        continue;
      }
      await trackJobRun(
        "hubspotSync",
        conn.tenantDomain,
        conn.hubspotPortalId ?? conn.id,
        `${conn.tenantDomain}/hubspot`,
        async () => {
          const stats = await syncTenant(conn.tenantDomain);
          okCount += 1;
          // Best-effort: enrich marketing_contacts for this tenant using the
          // same per-tenant OAuth portal. Errors are caught inside the function.
          try {
            const { syncHubSpotContactEnrichment, pushLeadScoresToHubSpot } = await import("./hubspot-service");
            const planAllowsContacts = await checkFeatureAccessAsync(tenant.plan, "marketingContacts");
            if (planAllowsContacts.allowed) {
              await syncHubSpotContactEnrichment({ tenantDomain: conn.tenantDomain });
              // Push Orbit lead scores back to HubSpot contact properties
              await pushLeadScoresToHubSpot({ tenantDomain: conn.tenantDomain });
            }
          } catch (enrichErr: any) {
            console.warn(`[HubSpot Sync] Contact enrichment error for ${conn.tenantDomain}: ${enrichErr.message}`);
          }
          return stats;
        },
        {
          onError: async () => {
            failCount += 1;
            try {
              await storage.markHubspotSyncResult(conn.tenantDomain, { stats: null, error: "Daily sync failed" });
            } catch { /* ignore */ }
          },
        },
      );
    }
    console.log(`[HubSpot Sync] Sweep complete — connections=${connections.length}, ok=${okCount}, failed=${failCount}`);
  } catch (err) {
    console.error("[HubSpot Sync] Sweep failed:", err);
  } finally {
    jobStatus.hubspotSync.isRunning = false;
    jobStatus.hubspotSync.lastRun = new Date();
  }
}

export async function triggerHubspotSyncNow(): Promise<void> {
  runHubspotSyncJob();
}

/**
 * Task #123 — Collaboration data hygiene.
 *
 * Hard-deletes comments that have been soft-deleted for 30+ days, then
 * removes orphaned threads (no remaining comments) that aren't tied to an
 * annotation. Annotation-owned threads stay intact since their lifecycle is
 * driven by the annotation row — deleting an annotation also removes its
 * thread (and the thread's comments cascade) via the explicit DELETE in
 * the annotation route.
 */
export async function runCollaborationCleanupJob(): Promise<{
  commentsDeleted: number;
  threadsDeleted: number;
}> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  let commentsDeleted = 0;
  let threadsDeleted = 0;
  try {
    const removed = await db
      .delete(collaborationComments)
      .where(
        and(
          lt(collaborationComments.deletedAt, cutoff),
          sql`${collaborationComments.deletedAt} IS NOT NULL`,
        ),
      )
      .returning({ id: collaborationComments.id });
    commentsDeleted = removed.length;

    // Find threads with no remaining comments and not referenced by an
    // annotation. Skip annotation-targeted threads regardless.
    const orphaned = await db.execute<{ id: string }>(sql`
      SELECT t.id FROM ${collaborationThreads} t
      WHERE t.target_kind <> 'annotation'
        AND NOT EXISTS (
          SELECT 1 FROM ${collaborationComments} c WHERE c.thread_id = t.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${annotations} a WHERE a.thread_id = t.id
        )
    `);
    const orphanIds = (orphaned.rows as Array<{ id: string }>).map((r) => r.id);
    if (orphanIds.length > 0) {
      const finalRemoved = await db
        .delete(collaborationThreads)
        .where(sql`${collaborationThreads.id} = ANY(${orphanIds})`)
        .returning({ id: collaborationThreads.id });
      threadsDeleted = finalRemoved.length;
    }

    if (commentsDeleted > 0 || threadsDeleted > 0) {
      console.log(
        `[Collab Cleanup] Hard-deleted ${commentsDeleted} comment(s) and ${threadsDeleted} orphaned thread(s)`,
      );
    }
  } catch (err) {
    console.error("[Collab Cleanup] Sweep failed:", (err as Error).message);
  }
  return { commentsDeleted, threadsDeleted };
}

// WS5: keep the social-post backlog tidy. Archive draft posts that were
// generated at scale but never scheduled within ARCHIVE_AFTER_DAYS, then
// permanently purge archived/rejected/deleted posts older than PURGE_AFTER_DAYS.
// Archived posts are already excluded from planning/calendar/export.
const STALE_DRAFT_ARCHIVE_AFTER_DAYS = 30;
const STALE_DRAFT_PURGE_AFTER_DAYS = 90;

export async function runStaleDraftCleanupJob(): Promise<{ archived: number; purged: number }> {
  const now = Date.now();
  const archiveCutoff = new Date(now - STALE_DRAFT_ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const purgeCutoff = new Date(now - STALE_DRAFT_PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  let archived = 0;
  let purged = 0;
  try {
    const archivedRows = await db
      .update(generatedPosts)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(generatedPosts.status, "draft"),
        isNull(generatedPosts.scheduledDate),
        lt(generatedPosts.createdAt, archiveCutoff),
      ))
      .returning({ id: generatedPosts.id });
    archived = archivedRows.length;

    const purgedRows = await db
      .delete(generatedPosts)
      .where(and(
        inArray(generatedPosts.status, ["archived", "rejected", "deleted"]),
        lt(generatedPosts.updatedAt, purgeCutoff),
      ))
      .returning({ id: generatedPosts.id });
    purged = purgedRows.length;

    if (archived > 0 || purged > 0) {
      console.log(`[Draft Cleanup] Archived ${archived} stale draft(s), purged ${purged} old post(s)`);
    }
  } catch (err) {
    console.error("[Draft Cleanup] Sweep failed:", (err as Error).message);
  }
  return { archived, purged };
}

export function startScheduledJobs(): void {
  console.log("[Scheduled Jobs] Initializing scheduled jobs...");

  // Keep the Neon compute alive. Neon auto-suspends idle connections after
  // ~5 minutes; a lightweight ping every 4 minutes prevents that and stops
  // the "Connection terminated due to administrator command" cascade that
  // kills every background worker simultaneously.
  setInterval(async () => {
    try {
      await db.execute(sql`SELECT 1`);
    } catch (err: any) {
      console.warn("[DB Keepalive] Ping failed (will retry next tick):", err?.message);
    }
  }, 4 * 60 * 1000);

  if (websiteCrawlInterval) clearInterval(websiteCrawlInterval);
  if (socialMonitorInterval) clearInterval(socialMonitorInterval);
  if (websiteMonitorInterval) clearInterval(websiteMonitorInterval);
  if (productMonitorInterval) clearInterval(productMonitorInterval);
  if (pricingMonitorInterval) clearInterval(pricingMonitorInterval);
  if (trialReminderInterval) clearInterval(trialReminderInterval);
  if (weeklyDigestInterval) clearInterval(weeklyDigestInterval);
  if (scheduledBriefingInterval) clearInterval(scheduledBriefingInterval);
  if (plannerSyncInterval) clearInterval(plannerSyncInterval);
  if (seoRefreshInterval) clearInterval(seoRefreshInterval);
  if (hubspotSyncInterval) clearInterval(hubspotSyncInterval);
  if (outreachCadenceInterval) clearInterval(outreachCadenceInterval);

  // Sales outreach cadence sweep — hourly (advances due steps + mailbox detection).
  outreachCadenceInterval = setInterval(() => {
    runOutreachCadenceJob();
  }, 60 * 60 * 1000);

  jobStatus.scheduledBriefing = { lastRun: null, isRunning: false, nextRun: null, abortController: null };
  jobStatus.plannerSync = { lastRun: null, isRunning: false, nextRun: null, abortController: null };
  jobStatus.seoRefresh = { lastRun: null, isRunning: false, nextRun: null, abortController: null };
  jobStatus.hubspotSync = { lastRun: null, isRunning: false, nextRun: null, abortController: null };

  // HubSpot daily sync — runs every 24 hours after a 2 minute warm-up.
  hubspotSyncInterval = setInterval(() => {
    runHubspotSyncJob();
  }, 24 * 60 * 60 * 1000);

  // Segment membership refresh — runs every 15 minutes. Each segment's
  // refreshIntervalMinutes gates whether it's actually due; this tick just
  // provides the heartbeat. Uses the primary DB (contact data) which is fine
  // because segment evaluation is a read-heavy SELECT, not a crawl operation.
  setInterval(async () => {
    try {
      const { refreshDueSegments } = await import("./segment-evaluation-service");
      const { checked, refreshed, errors, refreshedSegments } = await refreshDueSegments();
      if (refreshed > 0 || errors > 0) {
        console.log(`[Segments] Refresh sweep: checked=${checked} refreshed=${refreshed} errors=${errors}`);
      }

      // Fire segment-membership workflow triggers for tenants whose segments
      // were just refreshed. Runs async so HubSpot mirror isn't delayed.
      if (refreshedSegments.length > 0) {
        const distinctTenants = [...new Set(refreshedSegments.map((s: any) => s.tenantDomain as string))];
        for (const tenantDomain of distinctTenants) {
          evaluateSegmentTriggers(tenantDomain).catch((err: any) =>
            console.warn(`[Segments] evaluateSegmentTriggers failed for ${tenantDomain}:`, err?.message),
          );
        }
      }

      // Mirror only the segments that were actually refreshed this sweep —
      // never all HubSpot-mirrored segments, to avoid spurious rate-limit pressure.
      // hubspot_list-sourced segments IMPORT membership from HubSpot — never
      // mirror them back (that would mutate the customer's source list).
      const hubspotTargets = refreshedSegments.filter((s) => s.hubspotListId && s.source !== "hubspot_list");
      if (hubspotTargets.length > 0) {
        try {
          const { syncSegmentToHubSpotList } = await import("./hubspot-service");
          const { getSegmentMemberEmails } = await import("./segment-evaluation-service");
          for (const seg of hubspotTargets) {
            const emails = await getSegmentMemberEmails(seg.id, seg.tenantDomain);
            syncSegmentToHubSpotList(seg.tenantDomain, seg.hubspotListId!, emails).catch((err: any) =>
              console.warn(`[Segments] HubSpot mirror failed for ${seg.id}: ${err.message}`),
            );
          }
        } catch (hsErr: any) {
          console.warn("[Segments] HubSpot mirror sweep failed:", hsErr.message);
        }
      }
    } catch (err: any) {
      console.error("[Segments] Refresh sweep error:", err.message);
    }
  }, 15 * 60 * 1000); // every 15 minutes

  // Set up recurring intervals
  // Hourly sweeps are staggered by 2-3 minutes each so they never all fire
  // simultaneously and flood the connection pool.
  websiteCrawlInterval = setInterval(() => {
    runWebsiteCrawlJob();
  }, 60 * 60 * 1000); // Every hour — anchor, fires at T+0min within each hour

  socialMonitorInterval = setInterval(() => {
    setTimeout(() => runSocialMonitorJob(), 2 * 60 * 1000);
  }, 60 * 60 * 1000); // fires at T+2min within each hour

  websiteMonitorInterval = setInterval(() => {
    setTimeout(() => runWebsiteMonitorJob(), 4 * 60 * 1000);
  }, 60 * 60 * 1000); // fires at T+4min within each hour

  productMonitorInterval = setInterval(() => {
    setTimeout(() => runProductMonitorJob(), 6 * 60 * 1000);
  }, 60 * 60 * 1000); // fires at T+6min within each hour

  // Pricing monitor: check every 6 hours, but each competitor is gated to a
  // minimum 7-day interval inside the job (PRICING_MIN_INTERVAL_MS).
  pricingMonitorInterval = setInterval(() => {
    runPricingMonitorJob();
  }, 6 * 60 * 60 * 1000);

  trialReminderInterval = setInterval(() => {
    runTrialReminderJob();
  }, 6 * 60 * 60 * 1000);

  weeklyDigestInterval = setInterval(() => {
    checkAndRunWeeklyDigest();
  }, 60 * 60 * 1000);

  scheduledBriefingInterval = setInterval(() => {
    // Delay briefing by 35 min within each hourly tick so the website monitor
    // (which starts at T+4min and runs ~25min) always finishes first.
    setTimeout(() => checkAndRunScheduledBriefing(), 35 * 60 * 1000);
  }, 60 * 60 * 1000);

  // Planner two-way sync — runs every 15 minutes for all connected plans
  plannerSyncInterval = setInterval(() => {
    runPlannerSyncJob();
  }, 15 * 60 * 1000);

  // SEO refresh — checks every hour but only runs when 7+ days since last run
  seoRefreshInterval = setInterval(() => {
    checkAndRunSeoRefresh();
  }, 60 * 60 * 1000);

  // Task #86: Persistent rate limit bucket cleanup — drops expired rows so
  // the table doesn't accumulate stale per-IP / per-email keys. Runs every
  // 6 hours; cheap WHERE reset_at < now() query backed by an index.
  setInterval(() => {
    import("./rate-limiter")
      .then(({ cleanupExpiredBuckets }) => cleanupExpiredBuckets())
      .catch((err) => console.error("[rate-limiter] cleanup error:", err?.message || err));
  }, 6 * 60 * 60 * 1000);

  // WS5: stale social-draft cleanup (archive unscheduled, purge old) — daily.
  setInterval(() => {
    runStaleDraftCleanupJob().catch((err) =>
      console.error("[Draft Cleanup] error:", err?.message || err),
    );
  }, 24 * 60 * 60 * 1000);

  // Task #102: Sentiment & tone backfill — drains rows where analyzedAt IS
  // NULL in small batches so the analyzer does not spike LLM spend. Runs
  // every 15 minutes; each tick processes up to 50 rows captured in the
  // last 90 days.
  setInterval(() => {
    import("./sentiment-backfill")
      .then(({ backfillSentiment }) => backfillSentiment({ limit: 50, sinceDays: 90 }))
      .catch((err) => console.error("[Sentiment Backfill] Tick error:", err?.message || err));
  }, 15 * 60 * 1000);
  // Task #101: Outcome metrics — daily GA4/UTM analytics pull (runs hourly,
  // each call is idempotent for the date being pulled). Weekly Orbit Score
  // computation runs every 6 hours; benchmark aggregation runs nightly.
  setInterval(() => {
    import("./ga-client").then(({ runDailyAnalyticsPull }) =>
      runDailyAnalyticsPull().catch((err) => console.error("[Outcome Metrics] daily pull error:", err?.message || err)),
    );
  }, 60 * 60 * 1000);
  setInterval(() => {
    import("./orbit-score").then(({ runWeeklyOrbitScoreJob }) =>
      runWeeklyOrbitScoreJob().catch((err) => console.error("[Orbit Score] weekly job error:", err?.message || err)),
    );
  }, 6 * 60 * 60 * 1000);
  setInterval(() => {
    import("./orbit-score").then(({ runBenchmarkAggregationJob }) =>
      runBenchmarkAggregationJob().catch((err) => console.error("[Orbit Score] benchmark job error:", err?.message || err)),
    );
  }, 24 * 60 * 60 * 1000);
  // Initial sweep ~ 2 minutes after boot
  setTimeout(() => {
    import("./ga-client").then(({ runDailyAnalyticsPull }) =>
      runDailyAnalyticsPull().catch((err) => console.error("[Outcome Metrics] initial daily pull error:", err?.message || err)),
    );
    import("./orbit-score").then(({ runWeeklyOrbitScoreJob }) =>
      runWeeklyOrbitScoreJob().catch((err) => console.error("[Orbit Score] initial weekly job error:", err?.message || err)),
    );
  }, 2 * 60 * 1000);

  // Task #104 — Planner Graph subscription renewal — runs hourly
  if (plannerSubscriptionRenewalInterval) clearInterval(plannerSubscriptionRenewalInterval);
  plannerSubscriptionRenewalInterval = setInterval(() => {
    runPlannerSubscriptionRenewalJob();
  }, 60 * 60 * 1000);
  setTimeout(() => {
    runPlannerSubscriptionRenewalJob();
  }, 45 * 1000);

  // Task #97: Marketing publish worker — picks up approved+scheduled posts on
  // auto-publish accounts every 2 minutes. First tick delayed to 3.5 minutes
  // after startup so it doesn't collide with the pricing / HubSpot initial
  // sweeps that fire at T+2min and saturate the connection pool.
  setTimeout(() => {
    const runPublishTick = () => {
      tickMarketingPublishWorker().catch(err => {
        console.error("[Marketing Publish Worker] Tick error:", err?.message || err);
      });
    };
    runPublishTick();
    setInterval(runPublishTick, 2 * 60 * 1000);
  }, 3.5 * 60 * 1000);

  // Missed-post sweep — marks approved posts whose scheduledDate is more than
  // 5 days in the past as "missed" so operators can review them. Runs every
  // 5 minutes; the update is a no-op when nothing qualifies.
  setInterval(() => {
    sweepMissedPosts().catch(err => {
      console.error("[Missed Post Sweep] Error:", err?.message || err);
    });
  }, 5 * 60 * 1000);
  // Run once on startup to catch anything that aged out while the server was down.
  setTimeout(() => {
    sweepMissedPosts().catch(err => {
      console.error("[Missed Post Sweep] Startup error:", err?.message || err);
    });
  }, 10_000);

  // Task #97: Email send worker — processes scheduled email_sends rows
  // whose scheduledAt has elapsed. First tick at T+4.5min, staggered from
  // the publish worker (T+3.5min) to avoid simultaneous pool contention.
  setTimeout(() => {
    const runEmailTick = () => {
      const baseUrl = process.env.PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 5000}`;
      tickEmailSendWorker({ baseUrl }).catch(err => {
        console.error("[Email Send Worker] Tick error:", err?.message || err);
      });
    };
    runEmailTick();
    setInterval(runEmailTick, 2 * 60 * 1000);
  }, 4.5 * 60 * 1000);

  // A/B test winner evaluation — checks emails whose A/B window has elapsed,
  // declares a winner, and queues the holdback cohort for the winning variant.
  // Runs every 5 minutes; cheap no-op when no tests are pending evaluation.
  setInterval(() => {
    tickAbTestEvaluationWorker().catch(err => {
      console.error("[AB Test Worker] Tick error:", err?.message || err);
    });
  }, 5 * 60 * 1000);

  // HubSpot marketing-email sync backfill (Phase 4) — retries pending/errored
  // contact resolution for recent sends, and re-pushes email_sent timeline
  // events. Resolution runs for any connected, feature-enabled tenant;
  // timeline pushes additionally require templates to be configured. The tick
  // returns early (cheap) when no recipients are pending/errored.
  setInterval(() => {
    tickHubspotEmailSyncBackfill().catch(err => {
      console.error("[HubSpot Email Backfill] Tick error:", err?.message || err);
    });
  }, 10 * 60 * 1000);

  // Marketing Workflow Engine — advance enrollments whose nextRunAt has elapsed
  // (wait steps that are now due). Runs every 60 seconds; cheap no-op when no
  // enrollments are pending.
  setInterval(() => {
    tickWorkflowEngine().catch(err => {
      console.error("[Workflow Engine] Tick error:", err?.message || err);
    });
  }, 60 * 1000);
  // First tick after 30s so initial startup doesn't add contention.
  setTimeout(() => {
    tickWorkflowEngine().catch(err => {
      console.error("[Workflow Engine] Startup tick error:", err?.message || err);
    });
  }, 30_000);

  // Segment-trigger sweep — enroll newly-added segment members into active
  // segment_membership workflows. Runs every 5 minutes; lightweight when no
  // segment-triggered workflows exist.
  setInterval(() => {
    sweepAllTenantWorkflowTriggers().catch(err => {
      console.error("[Workflow Engine] Segment trigger sweep error:", err?.message || err);
    });
  }, 5 * 60 * 1000);

  // CRITICAL: Clean up any stuck jobs from previous runs
  cleanupStuckJobs().catch(err => {
    console.error("[Scheduled Jobs] Error cleaning up stuck jobs:", err);
  });

  // Periodic stuck job cleanup every 15 minutes (catches jobs that get stuck while server is running)
  setInterval(() => {
    cleanupStuckJobs().catch(err => {
      console.error("[Scheduled Jobs] Periodic stuck job cleanup error:", err);
    });
  }, 15 * 60 * 1000);

  // Task #123: Collaboration data hygiene — daily sweep that hard-deletes
  // soft-deleted comments older than 30 days plus orphaned threads.
  if (collabCleanupInterval) clearInterval(collabCleanupInterval);
  collabCleanupInterval = setInterval(() => {
    runCollaborationCleanupJob().catch((err) =>
      console.error("[Collab Cleanup] Tick error:", err?.message || err),
    );
  }, 24 * 60 * 60 * 1000);
  setTimeout(() => {
    runCollaborationCleanupJob().catch((err) =>
      console.error("[Collab Cleanup] Initial sweep error:", err?.message || err),
    );
  }, 3 * 60 * 1000);
  
  console.log("[Scheduled Jobs] Running initial job sweep for any overdue items...");
  
  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting website crawl job sweep...");
    runWebsiteCrawlJob();
  }, 5 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting social monitor job sweep...");
    runSocialMonitorJob();
  }, 30 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting website monitor job sweep...");
    runWebsiteMonitorJob();
  }, 60 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting product monitor job sweep...");
    runProductMonitorJob();
  }, 90 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting pricing monitor job sweep...");
    runPricingMonitorJob();
  }, 120 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting trial reminder job sweep...");
    runTrialReminderJob();
  }, 15 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Checking if weekly digest is overdue...");
    checkAndRunWeeklyDigest();
  }, 20 * 1000);

  setTimeout(() => {
    // Delay startup briefing check by 35 min so the website monitor sweep
    // (starting at T+60s, running ~25min) always finishes before the briefing
    // generates. Without this delay the briefing fires at T+25s with zero
    // fresh signals and the monitor writes its activities 14-39min later.
    console.log("[Scheduled Jobs] Scheduling briefing check for T+35min (after monitor sweep)...");
    checkAndRunScheduledBriefing();
  }, 35 * 60 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Checking if SEO refresh is overdue...");
    checkAndRunSeoRefresh();
  }, 35 * 1000);

  // hourly sweep — downgrade tenants whose payment grace window has expired
  setInterval(async () => {
    try {
      const { sweepExpiredGraceWindows } = await import("./billing-service");
      const n = await sweepExpiredGraceWindows();
      if (n > 0) console.log(`[Scheduled Jobs] Billing grace sweep: downgraded ${n} tenant(s)`);
    } catch (err) {
      console.error("[Scheduled Jobs] Billing grace sweep failed:", err);
    }
  }, 60 * 60 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting initial HubSpot sync sweep...");
    runHubspotSyncJob();
  }, 120 * 1000);

  console.log("[Scheduled Jobs] Jobs scheduled - website crawl, social monitor, website monitor, product monitor (hourly), trial reminders (every 6 hours), weekly digest (checks hourly, runs when 7+ days since last), scheduled briefing (checks hourly), Planner two-way sync (every 15 minutes), SEO refresh (weekly)");
  console.log("[Scheduled Jobs] Initial job sweep will start in 5 seconds to process any overdue items");
}
export function stopScheduledJobs(): void {
  if (websiteCrawlInterval) {
    clearInterval(websiteCrawlInterval);
    websiteCrawlInterval = null;
  }
  if (socialMonitorInterval) {
    clearInterval(socialMonitorInterval);
    socialMonitorInterval = null;
  }
  if (websiteMonitorInterval) {
    clearInterval(websiteMonitorInterval);
    websiteMonitorInterval = null;
  }
  if (productMonitorInterval) {
    clearInterval(productMonitorInterval);
    productMonitorInterval = null;
  }
  if (trialReminderInterval) {
    clearInterval(trialReminderInterval);
    trialReminderInterval = null;
  }
  if (weeklyDigestInterval) {
    clearInterval(weeklyDigestInterval);
    weeklyDigestInterval = null;
  }
  if (scheduledBriefingInterval) {
    clearInterval(scheduledBriefingInterval);
    scheduledBriefingInterval = null;
  }
  if (plannerSyncInterval) {
    clearInterval(plannerSyncInterval);
    plannerSyncInterval = null;
  }
  if (seoRefreshInterval) {
    clearInterval(seoRefreshInterval);
    seoRefreshInterval = null;
  }
  if (hubspotSyncInterval) {
    clearInterval(hubspotSyncInterval);
    hubspotSyncInterval = null;
  }
  if (outreachCadenceInterval) {
    clearInterval(outreachCadenceInterval);
    outreachCadenceInterval = null;
  }
  console.log("[Scheduled Jobs] All scheduled jobs stopped");
}

export async function triggerWeeklyDigestNow(): Promise<void> {
  runWeeklyDigestJob();
}

export async function triggerPlannerSyncNow(): Promise<void> {
  runPlannerSyncJob();
}

export function getJobStatus(): Record<string, Omit<JobStatus, 'abortController'>> {
  const result: Record<string, Omit<JobStatus, 'abortController'>> = {};
  for (const [key, status] of Object.entries(jobStatus)) {
    result[key] = {
      lastRun: status.lastRun,
      isRunning: status.isRunning,
      nextRun: status.nextRun,
    };
  }
  return result;
}

export async function triggerWebsiteCrawlNow(): Promise<void> {
  runWebsiteCrawlJob();
}

export async function triggerSocialMonitorNow(): Promise<void> {
  runSocialMonitorJob();
}

export async function triggerWebsiteMonitorNow(): Promise<void> {
  runWebsiteMonitorJob();
}

export async function triggerProductMonitorNow(): Promise<void> {
  runProductMonitorJob();
}

export function resetStuckJob(jobType: string): boolean {
  if (jobStatus[jobType]) {
    // Abort if there's an active controller
    if (jobStatus[jobType].abortController) {
      jobStatus[jobType].abortController!.abort();
      jobStatus[jobType].abortController = null;
    }
    jobStatus[jobType].isRunning = false;
    console.log(`[Scheduled Job] Reset stuck job: ${jobType}`);
    return true;
  }
  return false;
}

export function resetAllStuckJobs(): string[] {
  const resetJobs: string[] = [];
  for (const [key, status] of Object.entries(jobStatus)) {
    if (status.isRunning) {
      // Abort if there's an active controller
      if (status.abortController) {
        status.abortController.abort();
        status.abortController = null;
      }
      status.isRunning = false;
      resetJobs.push(key);
      console.log(`[Scheduled Job] Reset stuck job: ${key}`);
    }
  }
  return resetJobs;
}

export function cancelJob(jobType: string): { cancelled: boolean; wasRunning: boolean } {
  const job = jobStatus[jobType];
  if (!job) {
    return { cancelled: false, wasRunning: false };
  }
  
  const wasRunning = job.isRunning;
  
  if (job.abortController) {
    job.abortController.abort();
    job.abortController = null;
    console.log(`[Scheduled Job] Cancelled running job: ${jobType}`);
  }
  
  job.isRunning = false;
  
  return { cancelled: true, wasRunning };
}
