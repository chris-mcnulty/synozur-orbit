import { storage } from "../storage";
import { crawlCompetitorWebsite, getCombinedContent } from "./web-crawler";
import { captureVisualAssets } from "./visual-capture";
import { monitorCompetitorSocialMedia, monitorCompanyProfileSocialMedia, monitorProductSocialMedia } from "./social-monitoring";
import { monitorCompetitorWebsite, monitorCompanyProfileWebsite, monitorProductWebsite } from "./website-monitoring";
import { analyzeCompetitorWebsite, type LinkedInContext } from "../ai-service";
import { processTrialReminders } from "./trial-service";
import { sendWeeklyDigestEmail, sendScheduledBriefingEmail } from "./email-service";
import { generateBriefing, type BriefingData } from "./intelligence-briefing-service";
import { enqueueCrawl, enqueueMonitor } from "./job-queue";
import { checkFeatureAccessAsync } from "./plan-policy";

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
    const jobRun = await storage.createScheduledJobRun({
      jobType,
      tenantDomain: tenantDomain || null,
      targetId: targetId || null,
      targetName: targetName || null,
      status: "running",
      startedAt: new Date(),
    });
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
    await storage.updateScheduledJobRun(jobRunId, {
      status,
      completedAt: new Date(),
      result: result || null,
      errorMessage: errorMessage || null,
    });
  } catch (error) {
    console.error(`[Job Tracking] Failed to track job completion:`, error);
  }
}

// Clean up jobs that have been running for too long (stuck jobs)
async function cleanupStuckJobs(): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const stuckJobs = await storage.getRunningJobs();
  
  const jobsToFail = stuckJobs.filter(job => {
    if (!job.startedAt) return true;
    return new Date(job.startedAt) < oneHourAgo;
  });
  
  if (jobsToFail.length > 0) {
    console.log(`[Scheduled Jobs] Cleaning up ${jobsToFail.length} stuck job(s)...`);
    for (const job of jobsToFail) {
      try {
        await storage.updateScheduledJobRun(job.id, {
          status: "failed",
          completedAt: new Date(),
          result: { error: "Job timed out - automatically marked as failed after running too long" },
          errorMessage: "Job timed out after 1 hour",
        });
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
  trialReminder: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
  weeklyDigest: { lastRun: null, isRunning: false, nextRun: null, abortController: null },
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

        if (competitor.organizationId) {
          try {
            const org = await storage.getOrganization(competitor.organizationId);

            if (orgsQueuedThisSweep.has(competitor.organizationId)) {
              sweepMetrics.crawlsSkippedOrgQueued++;
              console.log(`[Scheduled Job] Skipping crawl for ${competitor.name} - org already queued this sweep, will receive fresh data via post-crawl fan-out`);
              continue;
            }

            if (org?.lastFullCrawl) {
              const orgLastCrawl = new Date(org.lastFullCrawl).getTime();
              if (Number.isFinite(orgLastCrawl) && now - orgLastCrawl < intervalMs && org.crawlData) {
                const syncUpdates: any = {};
                if (org.crawlData) syncUpdates.crawlData = org.crawlData;
                if (org.lastFullCrawl) syncUpdates.lastFullCrawl = org.lastFullCrawl;
                if (org.lastCrawl) syncUpdates.lastCrawl = org.lastCrawl;
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
                console.log(`[Scheduled Job] Skipping crawl for ${competitor.name} - org ${org.name} already crawled recently, synced data`);
                continue;
              }
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

            await storage.resetCompetitorCrawlFailures(competitor.id);

            const updates: any = {
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
              lastFullCrawl: new Date(),
            };

            if (crawlResult.socialLinks.linkedIn && !competitor.linkedInUrl) {
              updates.linkedInUrl = crawlResult.socialLinks.linkedIn;
            }
            if (crawlResult.socialLinks.instagram && !competitor.instagramUrl) {
              updates.instagramUrl = crawlResult.socialLinks.instagram;
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

            await storage.updateCompetitor(competitor.id, updates);
            await storage.updateCompetitorLastCrawl(competitor.id, new Date().toLocaleString());

            if (competitor.organizationId) {
              await storage.updateOrganization(competitor.organizationId, {
                crawlData: updates.crawlData,
                lastFullCrawl: updates.lastFullCrawl,
                lastCrawl: new Date().toISOString(),
                linkedInUrl: updates.linkedInUrl,
                instagramUrl: updates.instagramUrl,
                blogSnapshot: updates.blogSnapshot,
              }).catch(err => console.error(`[Scheduled Job] Org sync failed for ${competitor.name}:`, err.message));

              try {
                const freshOrg = await storage.getOrganization(competitor.organizationId);
                if (freshOrg) {
                  const siblings = await storage.getCompetitorsByOrganizationId(competitor.organizationId);
                  for (const sibling of siblings) {
                    if (sibling.id === competitor.id) continue;
                    const siblingSync: any = {};
                    if (freshOrg.crawlData) siblingSync.crawlData = freshOrg.crawlData;
                    if (freshOrg.lastFullCrawl) siblingSync.lastFullCrawl = freshOrg.lastFullCrawl;
                    if (freshOrg.lastCrawl) siblingSync.lastCrawl = freshOrg.lastCrawl;
                    if (freshOrg.previousWebsiteContent) siblingSync.previousWebsiteContent = freshOrg.previousWebsiteContent;
                    if (freshOrg.blogSnapshot) siblingSync.blogSnapshot = freshOrg.blogSnapshot;
                    if (freshOrg.linkedInUrl && !sibling.linkedInUrl) siblingSync.linkedInUrl = freshOrg.linkedInUrl;
                    if (freshOrg.instagramUrl && !sibling.instagramUrl) siblingSync.instagramUrl = freshOrg.instagramUrl;
                    if (freshOrg.faviconUrl && !sibling.faviconUrl) siblingSync.faviconUrl = freshOrg.faviconUrl;
                    if (freshOrg.screenshotUrl && !sibling.screenshotUrl) siblingSync.screenshotUrl = freshOrg.screenshotUrl;
                    if (Object.keys(siblingSync).length > 0) {
                      await storage.updateCompetitor(sibling.id, siblingSync);
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
                    await storage.updateOrganization(competitor.organizationId, orgEnrichment)
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

        const lastCrawl = profile.lastFullCrawl
          ? new Date(profile.lastFullCrawl).getTime()
          : 0;
        const now = Date.now();

        if (now - lastCrawl < intervalMs) {
          continue;
        }

        console.log(`[Scheduled Job] Queuing baseline crawl for ${profile.companyName} (${profile.websiteUrl})...`);

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
              lastFullCrawl: new Date(),
              lastCrawl: new Date().toISOString(),
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

            await storage.updateCompanyProfile(profile.id, updates);

            if (profile.organizationId) {
              await storage.updateOrganization(profile.organizationId, {
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
                await storage.updateCompanyProfile(profile.id, { analysisData: analysis });
                analysisResult = analysis;
              } catch (analysisError: any) {
                console.error(`[Scheduled Job] AI analysis failed for baseline ${profile.companyName}:`, analysisError.message);
              }
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
              signal
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
              profile.marketId || undefined
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
    const briefing = await generateBriefing(tenantDomain, 7);
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
    const baseUrl = getBaseUrl();
    
    const usersWithDigest = await storage.getUsersWithDigestEnabled();
    console.log(`[Scheduled Job] Found ${usersWithDigest.length} users with digest enabled`);
    
    tenantBriefingCache.clear();
    
    let sentCount = 0;
    let errorCount = 0;
    
    for (const user of usersWithDigest) {
      try {
        const result = await sendDigestForUser(user, baseUrl);
        if (result) sentCount++; else errorCount++;
      } catch (userError) {
        console.error(`[Scheduled Job] Failed to send digest to ${user.email}:`, userError);
        errorCount++;
      }
    }
    
    tenantBriefingCache.clear();
    
    console.log(`[Scheduled Job] Weekly digest job completed: ${sentCount} sent, ${errorCount} errors`);
    await storage.updateScheduledJobRun(jobRun.id, {
      status: "completed",
      completedAt: new Date(),
      result: { sentCount, errorCount },
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

async function sendDigestForUser(user: { email: string; name: string }, baseUrl: string): Promise<boolean> {
  const domain = user.email.split('@')[1];
  if (!domain) return false;
  
  const tenant = await storage.getTenantByDomain(domain);
  if (!tenant || tenant.status !== 'active') return false;
  
  const weeklyActivity = await storage.getWeeklyActivityByTenant(domain);
  
  const activities = weeklyActivity.map(act => ({
    competitorName: act.competitorName,
    type: act.type,
    description: act.description,
    summary: act.summary || undefined,
  }));

  const tenantBriefing = await generateBriefingForTenant(domain);
  
  const briefingDigest = tenantBriefing ? {
    executiveSummary: tenantBriefing.briefingData.executiveSummary,
    actionItems: tenantBriefing.briefingData.actionItems || [],
    riskAlerts: tenantBriefing.briefingData.riskAlerts || [],
    briefingId: tenantBriefing.briefingId,
  } : undefined;
  
  return await sendWeeklyDigestEmail({
    email: user.email,
    name: user.name,
    companyName: tenant.name,
    activities,
    baseUrl,
    briefing: briefingDigest,
  });
}

export async function sendDigestNowForUser(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await storage.getUser(userId);
    if (!user) return { success: false, error: "User not found" };
    
    const baseUrl = getBaseUrl();
    const sent = await sendDigestForUser(user, baseUrl);
    
    if (sent) {
      return { success: true };
    }
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
          const briefing = await generateBriefing(tenantDomain, 7, marketId);
          if (!briefing || !briefing.briefingData) {
            console.warn(`[Scheduled Briefing] No briefing data for ${tenantDomain} market=${marketId}`);
            continue;
          }
          generatedCount++;

          const briefingData = briefing.briefingData as BriefingData;
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
                },
                baseUrl,
              );
              if (sent) emailsSent++;
            } catch (emailErr) {
              console.error(`[Scheduled Briefing] Email failed for user ${sub.userId}:`, emailErr);
              errorCount++;
            }
          }
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

let websiteCrawlInterval: NodeJS.Timeout | null = null;
let socialMonitorInterval: NodeJS.Timeout | null = null;
let websiteMonitorInterval: NodeJS.Timeout | null = null;
let productMonitorInterval: NodeJS.Timeout | null = null;
let trialReminderInterval: NodeJS.Timeout | null = null;
let weeklyDigestInterval: NodeJS.Timeout | null = null;
let scheduledBriefingInterval: NodeJS.Timeout | null = null;

export function startScheduledJobs(): void {
  console.log("[Scheduled Jobs] Initializing scheduled jobs...");

  if (websiteCrawlInterval) clearInterval(websiteCrawlInterval);
  if (socialMonitorInterval) clearInterval(socialMonitorInterval);
  if (websiteMonitorInterval) clearInterval(websiteMonitorInterval);
  if (productMonitorInterval) clearInterval(productMonitorInterval);
  if (trialReminderInterval) clearInterval(trialReminderInterval);
  if (weeklyDigestInterval) clearInterval(weeklyDigestInterval);
  if (scheduledBriefingInterval) clearInterval(scheduledBriefingInterval);

  jobStatus.scheduledBriefing = { lastRun: null, isRunning: false, nextRun: null, abortController: null };

  // Set up recurring intervals
  websiteCrawlInterval = setInterval(() => {
    runWebsiteCrawlJob();
  }, 60 * 60 * 1000); // Every hour

  socialMonitorInterval = setInterval(() => {
    runSocialMonitorJob();
  }, 60 * 60 * 1000);

  websiteMonitorInterval = setInterval(() => {
    runWebsiteMonitorJob();
  }, 60 * 60 * 1000);

  productMonitorInterval = setInterval(() => {
    runProductMonitorJob();
  }, 60 * 60 * 1000);

  trialReminderInterval = setInterval(() => {
    runTrialReminderJob();
  }, 6 * 60 * 60 * 1000);

  weeklyDigestInterval = setInterval(() => {
    checkAndRunWeeklyDigest();
  }, 60 * 60 * 1000);

  scheduledBriefingInterval = setInterval(() => {
    checkAndRunScheduledBriefing();
  }, 60 * 60 * 1000);

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
    console.log("[Scheduled Jobs] Starting trial reminder job sweep...");
    runTrialReminderJob();
  }, 15 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Checking if weekly digest is overdue...");
    checkAndRunWeeklyDigest();
  }, 20 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Checking if scheduled briefing is overdue...");
    checkAndRunScheduledBriefing();
  }, 25 * 1000);

  console.log("[Scheduled Jobs] Jobs scheduled - website crawl, social monitor, website monitor, product monitor (hourly), trial reminders (every 6 hours), weekly digest (checks hourly, runs when 7+ days since last), scheduled briefing (checks hourly)");
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
  console.log("[Scheduled Jobs] All scheduled jobs stopped");
}

export async function triggerWeeklyDigestNow(): Promise<void> {
  runWeeklyDigestJob();
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
