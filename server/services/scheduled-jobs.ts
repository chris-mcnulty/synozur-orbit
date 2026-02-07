import { storage } from "../storage";
import { crawlCompetitorWebsite, getCombinedContent } from "./web-crawler";
import { captureVisualAssets } from "./visual-capture";
import { monitorCompetitorSocialMedia, monitorCompanyProfileSocialMedia, monitorProductSocialMedia } from "./social-monitoring";
import { monitorCompetitorWebsite, monitorCompanyProfileWebsite, monitorProductWebsite } from "./website-monitoring";
import { analyzeCompetitorWebsite, type LinkedInContext } from "../ai-service";
import { processTrialReminders } from "./trial-service";
import { sendWeeklyDigestEmail } from "./email-service";

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
  // Reduced from 1 hour to 30 minutes for faster recovery from hung jobs
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const stuckJobs = await storage.getRunningJobs();
  
  const jobsToFail = stuckJobs.filter(job => {
    if (!job.startedAt) return true;
    return new Date(job.startedAt) < thirtyMinutesAgo;
  });
  
  if (jobsToFail.length > 0) {
    console.log(`[Scheduled Jobs] Cleaning up ${jobsToFail.length} stuck job(s)...`);
    for (const job of jobsToFail) {
      try {
        await storage.updateScheduledJobRun(job.id, {
          status: "failed",
          completedAt: new Date(),
          result: { error: "Job timed out - automatically marked as failed after running too long" },
          errorMessage: "Job timed out after 30 minutes",
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
  work: () => Promise<T>
): Promise<string | null> {
  const jobRunId = await trackJobStart(jobType, tenantDomain, targetId, targetName);
  if (!jobRunId) return null;
  
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    // Add 30-minute timeout for individual job operations
    const timeoutMs = 30 * 60 * 1000; // 30 minutes
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Job timed out after ${timeoutMs / 1000} seconds`));
      }, timeoutMs);
    });
    
    const result = await Promise.race([work(), timeoutPromise]);
    await trackJobComplete(jobRunId, "completed", result as Record<string, any>);
    return jobRunId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await trackJobComplete(jobRunId, "failed", undefined, errorMessage);
    console.error(`[Scheduled Job] Job failed for ${targetName}:`, error);
    return jobRunId;
  } finally {
    // Always clean up timeout handle to prevent memory leaks
    clearTimeout(timeoutId);
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
        // Skip competitors in archived markets
        if (await isMarketArchived(competitor.marketId)) {
          console.log(`[Scheduled Job] Skipping ${competitor.name} - market is archived`);
          continue;
        }
        
        // Skip competitors with manual research or excluded from crawl
        const existingAnalysis = competitor.analysisData as any;
        if (existingAnalysis?.source === "manual" || (competitor as any).excludeFromCrawl === true) {
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

        console.log(`[Scheduled Job] Crawling ${competitor.name} (${competitor.url})...`);

        const jobRunId = await trackJobRun(
          "websiteCrawl",
          tenant.domain,
          competitor.id,
          competitor.name,
          async () => {
            const crawlResult = await crawlCompetitorWebsite(competitor.url);

            if (crawlResult.pages.length === 0) {
              return { status: "no_pages", message: `No pages found for ${competitor.name}` };
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

            // Capture visual assets if not already captured
            // Await the promise to ensure it completes within the job context
            if (!competitor.faviconUrl || !competitor.screenshotUrl) {
              try {
                const visualAssets = await captureVisualAssets(competitor.url, competitor.id);
                if (visualAssets.faviconUrl || visualAssets.screenshotUrl) {
                  await storage.updateCompetitor(competitor.id, {
                    faviconUrl: visualAssets.faviconUrl || competitor.faviconUrl,
                    screenshotUrl: visualAssets.screenshotUrl || competitor.screenshotUrl,
                  });
                }
              } catch (err) {
                console.error(`Visual capture failed for ${competitor.name}:`, err);
                // Visual capture failure shouldn't fail the entire job
              }
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
          }
        );

        if (jobRunId) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
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

        console.log(`[Scheduled Job] Crawling baseline ${profile.companyName} (${profile.websiteUrl})...`);

        await trackJobRun(
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
        );

        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Website crawl job failed:", error);
  } finally {
    jobStatus.websiteCrawl.isRunning = false;
    jobStatus.websiteCrawl.abortController = null;
    jobStatus.websiteCrawl.lastRun = new Date();
    console.log("[Scheduled Job] Website crawl job completed");
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

        console.log(`[Scheduled Job] Monitoring social for ${competitor.name} (${competitorFrequency})...`);

        await trackJobRun(
          "socialMonitor",
          tenant.domain,
          competitor.id,
          `Competitor: ${competitor.name}`,
          async () => {
            await monitorCompetitorSocialMedia(competitor.id, tenant.domain);
            return {
              status: "success",
              entityType: "competitor",
              linkedIn: !!competitor.linkedInUrl,
              instagram: !!competitor.instagramUrl,
            };
          }
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
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

        console.log(`[Scheduled Job] Monitoring baseline social for ${profile.companyName} (${profileFrequency})...`);

        await trackJobRun(
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
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
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

        console.log(`[Scheduled Job] Monitoring product social for ${product.name} (${productFrequency})...`);

        await trackJobRun(
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
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Social monitor job failed:", error);
  } finally {
    jobStatus.socialMonitor.isRunning = false;
    jobStatus.socialMonitor.abortController = null;
    jobStatus.socialMonitor.lastRun = new Date();
    console.log("[Scheduled Job] Social monitor job completed");
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
        // Skip competitors in archived markets
        if (await isMarketArchived(competitor.marketId)) {
          console.log(`[Scheduled Job] Skipping website monitor for ${competitor.name} - market is archived`);
          continue;
        }
        
        const lastWebsiteMonitor = competitor.lastWebsiteMonitor
          ? new Date(competitor.lastWebsiteMonitor).getTime()
          : 0;
        const now = Date.now();

        if (now - lastWebsiteMonitor < intervalMs) {
          continue;
        }

        console.log(`[Scheduled Job] Monitoring website changes for ${competitor.name}...`);

        await trackJobRun(
          "websiteMonitor",
          tenant.domain,
          competitor.id,
          `Competitor: ${competitor.name}`,
          async () => {
            await monitorCompetitorWebsite(
              competitor.id, 
              competitor.userId,
              tenant.domain
            );
            return {
              status: "success",
              entityType: "competitor",
              url: competitor.url,
            };
          }
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
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

        console.log(`[Scheduled Job] Monitoring baseline website changes for ${profile.companyName}...`);

        await trackJobRun(
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
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Website monitor job failed:", error);
  } finally {
    jobStatus.websiteMonitor.isRunning = false;
    jobStatus.websiteMonitor.abortController = null;
    jobStatus.websiteMonitor.lastRun = new Date();
    console.log("[Scheduled Job] Website change monitor job completed");
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

        console.log(`[Scheduled Job] Monitoring standalone product: ${product.name}...`);

        await trackJobRun(
          "productMonitor",
          tenant.domain,
          product.id,
          `Product: ${product.name}`,
          async () => {
            await monitorProductWebsite(
              product.id,
              product.createdBy || "",
              tenant.domain,
              product.marketId || undefined
            );
            return {
              status: "success",
              entityType: "product",
              url: product.url,
            };
          }
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
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

async function runWeeklyDigestJob(): Promise<void> {
  if (jobStatus.weeklyDigest.isRunning) {
    console.log("[Scheduled Job] Weekly digest already running, skipping...");
    return;
  }

  jobStatus.weeklyDigest.isRunning = true;
  console.log("[Scheduled Job] Starting weekly digest job...");

  try {
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.REPLIT_DEPLOYMENT_URL 
        ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
        : 'https://orbit.synozur.com';
    
    // Get all users with digest enabled
    const usersWithDigest = await storage.getUsersWithDigestEnabled();
    console.log(`[Scheduled Job] Found ${usersWithDigest.length} users with digest enabled`);
    
    let sentCount = 0;
    let errorCount = 0;
    
    for (const user of usersWithDigest) {
      try {
        // Extract domain from user email
        const domain = user.email.split('@')[1];
        if (!domain) continue;
        
        // Get tenant for this user
        const tenant = await storage.getTenantByDomain(domain);
        if (!tenant || tenant.status !== 'active') continue;
        
        // Get weekly activity for this tenant
        const weeklyActivity = await storage.getWeeklyActivityByTenant(domain);
        
        // Transform activity for email
        const activities = weeklyActivity.map(act => ({
          competitorName: act.competitorName,
          type: act.type,
          description: act.description,
          summary: act.summary || undefined,
        }));
        
        // Send digest email
        const success = await sendWeeklyDigestEmail({
          email: user.email,
          name: user.name,
          companyName: tenant.name,
          activities,
          baseUrl,
        });
        
        if (success) {
          sentCount++;
        } else {
          errorCount++;
        }
      } catch (userError) {
        console.error(`[Scheduled Job] Failed to send digest to ${user.email}:`, userError);
        errorCount++;
      }
    }
    
    console.log(`[Scheduled Job] Weekly digest job completed: ${sentCount} sent, ${errorCount} errors`);
  } catch (error) {
    console.error("[Scheduled Job] Weekly digest job failed:", error);
  } finally {
    jobStatus.weeklyDigest.isRunning = false;
    jobStatus.weeklyDigest.lastRun = new Date();
  }
}

let websiteCrawlInterval: NodeJS.Timeout | null = null;
let socialMonitorInterval: NodeJS.Timeout | null = null;
let websiteMonitorInterval: NodeJS.Timeout | null = null;
let productMonitorInterval: NodeJS.Timeout | null = null;
let trialReminderInterval: NodeJS.Timeout | null = null;
let weeklyDigestInterval: NodeJS.Timeout | null = null;

export function startScheduledJobs(): void {
  console.log("[Scheduled Jobs] Initializing scheduled jobs...");

  if (websiteCrawlInterval) clearInterval(websiteCrawlInterval);
  if (socialMonitorInterval) clearInterval(socialMonitorInterval);
  if (websiteMonitorInterval) clearInterval(websiteMonitorInterval);
  if (productMonitorInterval) clearInterval(productMonitorInterval);
  if (trialReminderInterval) clearInterval(trialReminderInterval);
  if (weeklyDigestInterval) clearInterval(weeklyDigestInterval);

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
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() >= 9 && now.getHours() < 10) {
      runWeeklyDigestJob();
    }
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
  
  // CRITICAL: Run jobs immediately on startup to catch up after app sleep
  // This ensures overdue jobs run even if app was sleeping for days
  console.log("[Scheduled Jobs] Running initial job sweep for any overdue items...");
  
  // Run immediately (staggered by 5 seconds to avoid overwhelming the system)
  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting website crawl job sweep...");
    runWebsiteCrawlJob();
  }, 5 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting social monitor job sweep...");
    runSocialMonitorJob();
  }, 10 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting website monitor job sweep...");
    runWebsiteMonitorJob();
  }, 15 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting product monitor job sweep...");
    runProductMonitorJob();
  }, 20 * 1000);

  setTimeout(() => {
    console.log("[Scheduled Jobs] Starting trial reminder job sweep...");
    runTrialReminderJob();
  }, 25 * 1000);

  console.log("[Scheduled Jobs] Jobs scheduled - website crawl, social monitor, website monitor, product monitor (hourly), trial reminders (every 6 hours), weekly digest (Sundays)");
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
