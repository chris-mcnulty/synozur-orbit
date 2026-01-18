import { storage } from "../storage";
import { crawlCompetitorWebsite, getCombinedContent } from "./web-crawler";
import { captureVisualAssets } from "./visual-capture";
import { monitorCompetitorSocialMedia } from "./social-monitoring";
import { monitorCompetitorWebsite } from "./website-monitoring";
import { analyzeCompetitorWebsite } from "../ai-service";
import { processTrialReminders } from "./trial-service";

interface JobStatus {
  lastRun: Date | null;
  isRunning: boolean;
  nextRun: Date | null;
}

const jobStatus: Record<string, JobStatus> = {
  websiteCrawl: { lastRun: null, isRunning: false, nextRun: null },
  socialMonitor: { lastRun: null, isRunning: false, nextRun: null },
  websiteMonitor: { lastRun: null, isRunning: false, nextRun: null },
  trialReminder: { lastRun: null, isRunning: false, nextRun: null },
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

        const lastSocialCrawl = competitor.lastSocialCrawl
          ? new Date(competitor.lastSocialCrawl).getTime()
          : 0;
        const now = Date.now();

        if (now - lastSocialCrawl < intervalMs) {
          continue;
        }

        console.log(`[Scheduled Job] Monitoring social for ${competitor.name}...`);

        try {
          await monitorCompetitorSocialMedia(competitor.id, tenant.domain);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
          console.error(`[Scheduled Job] Failed social monitoring for ${competitor.name}:`, error);
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

  try {
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.REPLIT_DEPLOYMENT_URL 
        ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
        : 'https://orbit.synozur.com';
    
    const result = await processTrialReminders(baseUrl);
    console.log(`[Scheduled Job] Trial reminder job completed: ${result.processed} processed, ${result.errors} errors`);
  } catch (error) {
    console.error("[Scheduled Job] Trial reminder job failed:", error);
  } finally {
    jobStatus.trialReminder.isRunning = false;
    jobStatus.trialReminder.lastRun = new Date();
  }
}

let websiteCrawlInterval: NodeJS.Timeout | null = null;
let socialMonitorInterval: NodeJS.Timeout | null = null;
let websiteMonitorInterval: NodeJS.Timeout | null = null;
let trialReminderInterval: NodeJS.Timeout | null = null;

export function startScheduledJobs(): void {
  console.log("[Scheduled Jobs] Initializing scheduled jobs...");

  if (websiteCrawlInterval) clearInterval(websiteCrawlInterval);
  if (socialMonitorInterval) clearInterval(socialMonitorInterval);
  if (websiteMonitorInterval) clearInterval(websiteMonitorInterval);
  if (trialReminderInterval) clearInterval(trialReminderInterval);

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

  console.log("[Scheduled Jobs] Jobs scheduled - website crawl, social monitor, website change monitor (hourly), trial reminders (every 6 hours)");
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
  console.log("[Scheduled Jobs] All scheduled jobs stopped");
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
