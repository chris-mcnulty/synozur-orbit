import { storage } from "../storage";
import { crawlCompetitorWebsite, getCombinedContent } from "./web-crawler";
import { captureVisualAssets } from "./visual-capture";
import { monitorCompetitorSocialMedia, monitorCompanyProfileSocialMedia, monitorProductSocialMedia } from "./social-monitoring";
import { monitorCompetitorWebsite, monitorCompanyProfileWebsite } from "./website-monitoring";
import { analyzeCompetitorWebsite } from "../ai-service";
import { processTrialReminders } from "./trial-service";
import { sendWeeklyDigestEmail } from "./email-service";

interface JobStatus {
  lastRun: Date | null;
  isRunning: boolean;
  nextRun: Date | null;
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

const jobStatus: Record<string, JobStatus> = {
  websiteCrawl: { lastRun: null, isRunning: false, nextRun: null },
  socialMonitor: { lastRun: null, isRunning: false, nextRun: null },
  websiteMonitor: { lastRun: null, isRunning: false, nextRun: null },
  trialReminder: { lastRun: null, isRunning: false, nextRun: null },
  weeklyDigest: { lastRun: null, isRunning: false, nextRun: null },
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

  jobStatus.websiteCrawl.isRunning = true;
  console.log("[Scheduled Job] Starting website crawl job...");

  try {
    const tenants = await storage.getAllTenants();

    for (const tenant of tenants) {
      if (tenant.status !== "active") continue;
      
      const frequency = tenant.monitoringFrequency || "weekly";
      if (frequency === "disabled") continue;

      const intervalMs = getIntervalMs(frequency);
      if (intervalMs === 0) continue;

      const competitors = await storage.getCompetitorsByTenantDomain(tenant.domain);

      for (const competitor of competitors) {
        // Skip competitors with manual research to avoid triggering bot detection
        const existingAnalysis = competitor.analysisData as any;
        if (existingAnalysis?.source === "manual") {
          console.log(`[Scheduled Job] Skipping ${competitor.name} - has manual research`);
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

        try {
          const crawlResult = await crawlCompetitorWebsite(competitor.url);

          if (crawlResult.pages.length === 0) {
            console.log(`[Scheduled Job] No pages found for ${competitor.name}`);
            continue;
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
          if (!competitor.faviconUrl || !competitor.screenshotUrl) {
            captureVisualAssets(competitor.url, competitor.id).then(async (visualAssets) => {
              if (visualAssets.faviconUrl || visualAssets.screenshotUrl) {
                await storage.updateCompetitor(competitor.id, {
                  faviconUrl: visualAssets.faviconUrl || competitor.faviconUrl,
                  screenshotUrl: visualAssets.screenshotUrl || competitor.screenshotUrl,
                });
              }
            }).catch(err => console.error(`Visual capture failed for ${competitor.name}:`, err));
          }

          const websiteContent = getCombinedContent(crawlResult);
          if (websiteContent.length > 100) {
            try {
              const analysis = await analyzeCompetitorWebsite(
                competitor.name,
                competitor.url,
                websiteContent
              );
              await storage.updateCompetitorAnalysis(competitor.id, analysis);

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

          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`[Scheduled Job] Failed to crawl ${competitor.name}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Website crawl job failed:", error);
  } finally {
    jobStatus.websiteCrawl.isRunning = false;
    jobStatus.websiteCrawl.lastRun = new Date();
    console.log("[Scheduled Job] Website crawl job completed");
  }
}

async function runSocialMonitorJob(): Promise<void> {
  if (jobStatus.socialMonitor.isRunning) {
    console.log("[Scheduled Job] Social monitor already running, skipping...");
    return;
  }

  jobStatus.socialMonitor.isRunning = true;
  console.log("[Scheduled Job] Starting social monitor job...");

  try {
    const tenants = await storage.getAllTenants();

    for (const tenant of tenants) {
      if (tenant.status !== "active") continue;
      if (!tenant.socialMonitoringEnabled) continue;

      const frequency = tenant.monitoringFrequency || "weekly";
      if (frequency === "disabled") continue;

      const intervalMs = getIntervalMs(frequency);
      if (intervalMs === 0) continue;

      const competitors = await storage.getCompetitorsByTenantDomain(tenant.domain);

      for (const competitor of competitors) {
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

        try {
          await monitorCompetitorSocialMedia(competitor.id, tenant.domain);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
          console.error(`[Scheduled Job] Failed social monitoring for ${competitor.name}:`, error);
        }
      }

      // Monitor company profiles (baseline) for social changes
      const companyProfiles = await storage.getCompanyProfilesByTenantDomain(tenant.domain);
      for (const profile of companyProfiles) {
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

        try {
          await monitorCompanyProfileSocialMedia(
            profile.id,
            profile.userId,
            tenant.domain,
            profile.marketId || undefined
          );
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
          console.error(`[Scheduled Job] Failed baseline social monitoring for ${profile.companyName}:`, error);
        }
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

        try {
          await monitorProductSocialMedia(
            product.id,
            product.createdBy,
            tenant.domain,
            product.marketId || undefined
          );
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
          console.error(`[Scheduled Job] Failed product social monitoring for ${product.name}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Social monitor job failed:", error);
  } finally {
    jobStatus.socialMonitor.isRunning = false;
    jobStatus.socialMonitor.lastRun = new Date();
    console.log("[Scheduled Job] Social monitor job completed");
  }
}

async function runWebsiteMonitorJob(): Promise<void> {
  if (jobStatus.websiteMonitor.isRunning) {
    console.log("[Scheduled Job] Website monitor already running, skipping...");
    return;
  }

  jobStatus.websiteMonitor.isRunning = true;
  console.log("[Scheduled Job] Starting website change monitor job...");

  try {
    const tenants = await storage.getAllTenants();

    for (const tenant of tenants) {
      if (tenant.status !== "active") continue;
      if (tenant.plan === "free" || tenant.plan === "trial") continue;

      const frequency = tenant.monitoringFrequency || "weekly";
      if (frequency === "disabled") continue;

      const intervalMs = getIntervalMs(frequency);
      if (intervalMs === 0) continue;

      const competitors = await storage.getCompetitorsByTenantDomain(tenant.domain);

      for (const competitor of competitors) {
        const lastWebsiteMonitor = competitor.lastWebsiteMonitor
          ? new Date(competitor.lastWebsiteMonitor).getTime()
          : 0;
        const now = Date.now();

        if (now - lastWebsiteMonitor < intervalMs) {
          continue;
        }

        console.log(`[Scheduled Job] Monitoring website changes for ${competitor.name}...`);

        try {
          await monitorCompetitorWebsite(
            competitor.id, 
            competitor.userId,
            tenant.domain
          );
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
          console.error(`[Scheduled Job] Failed website monitoring for ${competitor.name}:`, error);
        }
      }

      // Monitor company profiles (baseline) for website changes
      const companyProfiles = await storage.getCompanyProfilesByTenantDomain(tenant.domain);
      for (const profile of companyProfiles) {
        const lastWebsiteMonitor = profile.lastWebsiteMonitor
          ? new Date(profile.lastWebsiteMonitor).getTime()
          : 0;
        const now = Date.now();

        if (now - lastWebsiteMonitor < intervalMs) {
          continue;
        }

        console.log(`[Scheduled Job] Monitoring baseline website changes for ${profile.companyName}...`);

        try {
          await monitorCompanyProfileWebsite(
            profile.id,
            profile.userId,
            tenant.domain,
            profile.marketId || undefined
          );
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
          console.error(`[Scheduled Job] Failed baseline website monitoring for ${profile.companyName}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("[Scheduled Job] Website monitor job failed:", error);
  } finally {
    jobStatus.websiteMonitor.isRunning = false;
    jobStatus.websiteMonitor.lastRun = new Date();
    console.log("[Scheduled Job] Website change monitor job completed");
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
let trialReminderInterval: NodeJS.Timeout | null = null;
let weeklyDigestInterval: NodeJS.Timeout | null = null;

export function startScheduledJobs(): void {
  console.log("[Scheduled Jobs] Initializing scheduled jobs...");

  if (websiteCrawlInterval) clearInterval(websiteCrawlInterval);
  if (socialMonitorInterval) clearInterval(socialMonitorInterval);
  if (websiteMonitorInterval) clearInterval(websiteMonitorInterval);
  if (trialReminderInterval) clearInterval(trialReminderInterval);
  if (weeklyDigestInterval) clearInterval(weeklyDigestInterval);

  websiteCrawlInterval = setInterval(() => {
    runWebsiteCrawlJob();
  }, 60 * 60 * 1000);

  socialMonitorInterval = setInterval(() => {
    runSocialMonitorJob();
  }, 60 * 60 * 1000);

  websiteMonitorInterval = setInterval(() => {
    runWebsiteMonitorJob();
  }, 60 * 60 * 1000);

  trialReminderInterval = setInterval(() => {
    runTrialReminderJob();
  }, 6 * 60 * 60 * 1000);

  // Weekly digest runs once per week (every 7 days)
  // Check daily, but only send on Sundays at the scheduled time
  weeklyDigestInterval = setInterval(() => {
    const now = new Date();
    // Run on Sunday (day 0) between 9-10 AM
    if (now.getDay() === 0 && now.getHours() >= 9 && now.getHours() < 10) {
      runWeeklyDigestJob();
    }
  }, 60 * 60 * 1000); // Check every hour

  setTimeout(() => {
    runWebsiteCrawlJob();
  }, 30 * 1000);

  setTimeout(() => {
    runSocialMonitorJob();
  }, 60 * 1000);

  setTimeout(() => {
    runWebsiteMonitorJob();
  }, 90 * 1000);

  setTimeout(() => {
    runTrialReminderJob();
  }, 120 * 1000);

  console.log("[Scheduled Jobs] Jobs scheduled - website crawl, social monitor, website change monitor (hourly), trial reminders (every 6 hours), weekly digest (Sundays)");
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

export function getJobStatus(): Record<string, JobStatus> {
  return { ...jobStatus };
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
