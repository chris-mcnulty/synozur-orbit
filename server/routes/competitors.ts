import type { Express } from "express";
import { storage, type ContextFilter } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, parseManualResearch, computeLatestSourceDataTimestamp, guardFeature } from "./helpers";
import { checkCompetitorLimitAsync, checkFeatureAccessAsync, getTenantCompetitorCount, getMonthlyAnalysisCount, checkAnalysisLimitAsync } from "../services/plan-policy";
import { insertCompetitorSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";
import { analyzeCompetitorWebsite, generateGapAnalysis, generateRecommendations, type CompetitorAnalysis, type LinkedInContext } from "../ai-service";
import Anthropic from "@anthropic-ai/sdk";
import { monitorCompetitorSocialMedia, monitorAllCompetitorsForTenant } from "../services/social-monitoring";
import { monitorCompetitorWebsite, monitorCompanyProfileWebsite, monitorProductWebsite, monitorAllCompetitorsForTenant as monitorAllWebsitesForTenant } from "../services/website-monitoring";
import { crawlCompetitorWebsite, getCombinedContent } from "../services/web-crawler";
import { captureVisualAssets } from "../services/visual-capture";
import { testBlogUrl, monitorBlogForCompetitor, monitorBlogForCompanyProfile } from "../services/rss-service";
import { validateCompetitorUrl, validateBlogUrl } from "../utils/url-validator";
import { logAiUsage } from "./helpers";

export function registerCompetitorRoutes(app: Express) {
  // ==================== COMPETITOR ROUTES ====================

  function enrichWithOrgData(competitor: any, org: any): any {
    if (!org) return competitor;
    const pick = (local: any, orgVal: any) => {
      if (local && orgVal) {
        return new Date(orgVal) > new Date(local) ? orgVal : local;
      }
      return local || orgVal || null;
    };
    return {
      ...competitor,
      faviconUrl: competitor.faviconUrl || org.faviconUrl || null,
      screenshotUrl: competitor.screenshotUrl || org.screenshotUrl || null,
      lastCrawl: pick(competitor.lastCrawl, org.lastCrawl),
      lastFullCrawl: pick(competitor.lastFullCrawl, org.lastFullCrawl),
      lastWebsiteMonitor: pick(competitor.lastWebsiteMonitor, org.lastWebsiteMonitor),
      lastSocialCrawl: pick(competitor.lastSocialCrawl, org.lastSocialCrawl),
      linkedInUrl: competitor.linkedInUrl || org.linkedInUrl || null,
      instagramUrl: competitor.instagramUrl || org.instagramUrl || null,
      twitterUrl: competitor.twitterUrl || org.twitterUrl || null,
    };
  }

  app.get("/api/competitors", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const competitorsList = await storage.getCompetitorsByContext(toContextFilter(ctx));

      const orgIds = [...new Set(competitorsList.map(c => c.organizationId).filter(Boolean))];
      const orgMap = new Map<string, any>();
      for (const orgId of orgIds) {
        const org = await storage.getOrganization(orgId!);
        if (org) orgMap.set(orgId!, org);
      }

      const enriched = competitorsList.map(c =>
        c.organizationId ? enrichWithOrgData(c, orgMap.get(c.organizationId)) : c
      );

      res.json(enriched);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/competitors/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      let enriched = competitor;
      if (competitor.organizationId) {
        const org = await storage.getOrganization(competitor.organizationId);
        enriched = enrichWithOrgData(competitor, org);
      }
      res.json(enriched);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/competitors/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { linkedInUrl, instagramUrl, twitterUrl, blogUrl, blogFeedUrl, socialCheckFrequency, excludeFromCrawl, name, url, projectId, headquarters, founded, employeeCount, revenue, fundingRaised, industry } = req.body;
      const updateData: any = {};
      
      if (linkedInUrl !== undefined) updateData.linkedInUrl = linkedInUrl || null;
      if (instagramUrl !== undefined) updateData.instagramUrl = instagramUrl || null;
      if (twitterUrl !== undefined) updateData.twitterUrl = twitterUrl || null;
      if (blogUrl !== undefined) updateData.blogUrl = blogUrl || null;
      if (blogFeedUrl !== undefined) updateData.blogFeedUrl = blogFeedUrl || null;
      if (socialCheckFrequency !== undefined) updateData.socialCheckFrequency = socialCheckFrequency || null;
      if (excludeFromCrawl !== undefined) updateData.excludeFromCrawl = excludeFromCrawl;
      if (name) updateData.name = name;
      if (url) updateData.url = url;
      
      // Company profile fields
      if (headquarters !== undefined) updateData.headquarters = headquarters || null;
      if (founded !== undefined) updateData.founded = founded || null;
      if (employeeCount !== undefined) updateData.employeeCount = employeeCount || null;
      if (revenue !== undefined) updateData.revenue = revenue || null;
      if (fundingRaised !== undefined) updateData.fundingRaised = fundingRaised || null;
      if (industry !== undefined) updateData.industry = industry || null;

      // Handle projectId changes with security validation
      if (projectId !== undefined) {
        if (projectId === null || projectId === "") {
          updateData.projectId = null;
        } else {
          const project = await storage.getClientProject(projectId);
          if (!project) {
            return res.status(400).json({ error: "Project not found" });
          }

          // Security: Verify the project belongs to current context
          if (!validateResourceContext(project, ctx)) {
            return res.status(403).json({ error: "Access denied - project belongs to another tenant" });
          }

          if (!await guardFeature(req, res, "clientProjects")) return;

          updateData.projectId = projectId;
        }
      }

      const updated = await storage.updateCompetitor(req.params.id, updateData);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Test blog/RSS URL and optionally save to competitor
  app.post("/api/competitors/:id/test-blog", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.id);
      
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }
      
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const { blogUrl, save } = req.body;
      
      if (!blogUrl) {
        return res.status(400).json({ error: "Blog URL is required" });
      }
      
      // Validate blog URL for security (SSRF protection)
      const urlValidation = await validateBlogUrl(blogUrl);
      if (!urlValidation.isValid) {
        return res.status(400).json({ error: urlValidation.error });
      }
      
      // Test the blog URL
      const result = await testBlogUrl(urlValidation.normalizedUrl!);
      
      // If save is true and test was successful, update the competitor with validated URL
      if (save && result.valid) {
        await storage.updateCompetitor(competitor.id, { blogUrl: urlValidation.normalizedUrl });
        
        // Also update the blog snapshot with initial data
        if (result.postCount > 0) {
          await storage.updateCompetitor(competitor.id, {
            blogSnapshot: {
              postCount: result.postCount,
              latestTitles: result.sampleTitles,
              feedType: result.feedType,
              capturedAt: new Date().toISOString(),
              blogUrl,
            }
          });
        }
      }
      
      res.json({
        ...result,
        saved: save && result.valid,
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Monitor blog for a specific competitor (trigger immediate check)
  app.post("/api/competitors/:id/monitor-blog", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.id);
      
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }
      
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      if (!competitor.blogUrl) {
        return res.status(400).json({ error: "No blog URL configured for this competitor" });
      }
      
      const result = await monitorBlogForCompetitor(
        competitor.id,
        competitor.blogUrl,
        competitor.name,
        ctx.userId,
        ctx.tenantDomain,
        ctx.marketId
      );
      
      res.json(result);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/organizations/search", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const q = (req.query.q as string || "").trim();
      if (!q || q.length < 2) {
        return res.json([]);
      }

      const orgs = await storage.searchOrganizations(q, 10);
      const results = orgs.map(org => ({
        id: org.id,
        name: org.name,
        canonicalDomain: org.canonicalDomain,
        faviconUrl: org.faviconUrl,
        industry: org.industry,
        description: org.description,
        category: org.category,
        url: org.url,
        linkedInUrl: org.linkedInUrl,
        instagramUrl: org.instagramUrl,
        twitterUrl: org.twitterUrl,
        blogUrl: org.blogUrl,
      }));

      res.json(results);
    } catch (error: any) {
      console.error("[Organizations Search] Error:", error.message);
      res.status(500).json({ error: "Failed to search organizations" });
    }
  });

  app.post("/api/competitors", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const { projectId, ...competitorData } = req.body;
      
      // If projectId is provided, validate ownership and plan-gating
      if (projectId) {
        const project = await storage.getClientProject(projectId);
        if (!project) {
          return res.status(400).json({ error: "Project not found" });
        }

        // Security: Verify the project belongs to current context
        if (!validateResourceContext(project, ctx)) {
          return res.status(403).json({ error: "Access denied - project belongs to another tenant" });
        }

        if (!await guardFeature(req, res, "clientProjects")) return;
      }

      if (!projectId) {
        const tenant = await storage.getTenant(ctx.tenantId);
        if (tenant) {
          const currentCount = await getTenantCompetitorCount(ctx.tenantDomain);
          const limitCheck = await checkCompetitorLimitAsync(tenant.plan, currentCount);
          if (!limitCheck.allowed) {
            return res.status(403).json({
              error: limitCheck.reason,
              upgradeRequired: true,
              requiredPlan: limitCheck.requiredPlan,
              currentUsage: limitCheck.currentUsage,
              limit: limitCheck.limit,
            });
          }
        }
      }

      // Validate and normalize URL using comprehensive security validator
      const urlValidation = await validateCompetitorUrl(competitorData.url || "");
      if (!urlValidation.isValid) {
        return res.status(400).json({ error: urlValidation.error });
      }
      const normalizedUrl = urlValidation.normalizedUrl!;

      const parsed = insertCompetitorSchema.safeParse({
        ...competitorData,
        url: normalizedUrl,
        projectId: projectId || null,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });

      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const org = await storage.findOrCreateOrganization(normalizedUrl, competitorData.name, {
        linkedInUrl: competitorData.linkedInUrl,
        instagramUrl: competitorData.instagramUrl,
        twitterUrl: competitorData.twitterUrl,
        blogUrl: competitorData.blogUrl,
        headquarters: competitorData.headquarters,
        founded: competitorData.founded,
        employeeCount: competitorData.employeeCount,
        revenue: competitorData.revenue,
        fundingRaised: competitorData.fundingRaised,
        industry: competitorData.industry,
      });

      const competitor = await storage.createCompetitor({
        ...parsed.data,
        organizationId: org.id,
        faviconUrl: parsed.data.faviconUrl || org.faviconUrl,
        screenshotUrl: parsed.data.screenshotUrl || org.screenshotUrl,
      });

      await storage.incrementOrgRefCount(org.id);

      res.json(competitor);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/competitors/:id/crawl", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get analysis type from request body (default to 'full' for backward compatibility)
      const analysisType = req.body?.analysisType || "full";
      
      // Validate analysis type
      if (!["quick", "full", "full_with_change"].includes(analysisType)) {
        return res.status(400).json({ error: "Invalid analysis type. Must be 'quick', 'full', or 'full_with_change'" });
      }

      if (analysisType === "full_with_change") {
        if (!await guardFeature(req, res, "websiteMonitoring")) return;
      }

      // Use the robust web crawler service
      const crawlResult = await crawlCompetitorWebsite(competitor.url);
      
      // Check if competitor has existing manual research data
      const existingAnalysis = competitor.analysisData as any;
      const hasManualResearch = existingAnalysis?.source === "manual";
      
      if (crawlResult.pages.length === 0) {
        // Return with manual research option flag
        return res.json({ 
          success: false, 
          message: "Website could not be crawled",
          canUseManualResearch: true,
          hasExistingManualResearch: hasManualResearch,
        });
      }

      captureVisualAssets(competitor.url, competitor.id).then(async (visualAssets) => {
        if (visualAssets.faviconUrl || visualAssets.screenshotUrl) {
          await storage.updateCompetitor(competitor.id, {
            faviconUrl: visualAssets.faviconUrl,
            screenshotUrl: visualAssets.screenshotUrl,
          });
          if (competitor.organizationId) {
            await storage.updateOrganization(competitor.organizationId, {
              faviconUrl: visualAssets.faviconUrl || undefined,
              screenshotUrl: visualAssets.screenshotUrl || undefined,
            }).catch(() => {});
          }
        }
      }).catch(err => console.error("Visual capture failed:", err));

      const now = new Date();
      const lastCrawl = now.toISOString();
      
      // Update social links only if not already set
      const socialUpdates: any = {};
      if (crawlResult.socialLinks.linkedIn && !competitor.linkedInUrl) {
        socialUpdates.linkedInUrl = crawlResult.socialLinks.linkedIn;
      }
      if (crawlResult.socialLinks.instagram && !competitor.instagramUrl) {
        socialUpdates.instagramUrl = crawlResult.socialLinks.instagram;
      }
      
      // Update blog snapshot if detected
      if (crawlResult.blogSnapshot) {
        const previousSnapshot = competitor.blogSnapshot as any;
        const previousCount = previousSnapshot?.postCount || 0;
        const newPosts = crawlResult.blogSnapshot.postCount - previousCount;
        
        socialUpdates.blogSnapshot = {
          ...crawlResult.blogSnapshot,
          capturedAt: now.toISOString(),
        };
        
        // Create activity if new posts detected
        if (previousCount > 0 && newPosts > 0) {
          await storage.createActivity({
            type: "blog_update",
            competitorId: competitor.id,
            competitorName: competitor.name,
            description: `Published ${newPosts} new blog post${newPosts > 1 ? 's' : ''}: "${crawlResult.blogSnapshot.latestTitles[0]}"${newPosts > 1 ? ' and more' : ''}`,
            date: now.toISOString(),
            impact: newPosts >= 3 ? "High" : "Medium",
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
          });
        }
      }
      
      // Store crawl data (pages summary, not full content for storage efficiency)
      socialUpdates.crawlData = {
        pagesCrawled: crawlResult.pages.map(p => ({ 
          url: p.url, 
          pageType: p.pageType, 
          title: p.title,
          wordCount: p.wordCount 
        })),
        totalWordCount: crawlResult.totalWordCount,
        crawledAt: crawlResult.crawledAt,
      };
      socialUpdates.lastFullCrawl = now;
      
      // Store blog snapshot if discovered
      if (crawlResult.blogSnapshot && crawlResult.blogSnapshot.postCount > 0) {
        const existingBlogSnapshot = competitor.blogSnapshot as any;
        const previousCount = existingBlogSnapshot?.postCount || 0;
        const newCount = crawlResult.blogSnapshot.postCount;
        
        socialUpdates.blogSnapshot = {
          ...crawlResult.blogSnapshot,
          capturedAt: new Date().toISOString(),
        };
        
        // Create activity entry for blog discovery or significant changes
        const isFirstDiscovery = !existingBlogSnapshot || !existingBlogSnapshot.postCount;
        const hasNewPosts = newCount > previousCount;
        
        if (isFirstDiscovery || hasNewPosts) {
          const newPostCount = newCount - previousCount;
          await storage.createActivity({
            type: "blog_activity",
            sourceType: "competitor",
            competitorId: competitor.id,
            competitorName: competitor.name,
            description: isFirstDiscovery 
              ? `Discovered ${newCount} blog post${newCount > 1 ? 's' : ''}`
              : `Published ${newPostCount} new blog post${newPostCount > 1 ? 's' : ''}`,
            summary: crawlResult.blogSnapshot.latestTitles.length > 0 
              ? `Latest: "${crawlResult.blogSnapshot.latestTitles[0]}"${crawlResult.blogSnapshot.latestTitles.length > 1 ? ` and ${crawlResult.blogSnapshot.latestTitles.length - 1} more` : ''}`
              : `Found ${newCount} blog posts on the website`,
            details: {
              postCount: newCount,
              previousCount,
              newPosts: newPostCount,
              latestTitles: crawlResult.blogSnapshot.latestTitles,
            },
            date: new Date().toISOString(),
            impact: isFirstDiscovery 
              ? (newCount >= 10 ? "High" : newCount >= 5 ? "Medium" : "Low")
              : (newPostCount >= 3 ? "High" : "Medium"),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
          });
        }
      }
      
      if (Object.keys(socialUpdates).length > 0) {
        await storage.updateCompetitor(competitor.id, socialUpdates);
      }
      
      await storage.updateCompetitorLastCrawl(req.params.id, lastCrawl);

      if (competitor.organizationId) {
        const orgUpdates: any = {
          crawlData: socialUpdates.crawlData,
          lastFullCrawl: socialUpdates.lastFullCrawl,
          lastCrawl,
        };
        if (socialUpdates.linkedInUrl) orgUpdates.linkedInUrl = socialUpdates.linkedInUrl;
        if (socialUpdates.instagramUrl) orgUpdates.instagramUrl = socialUpdates.instagramUrl;
        if (socialUpdates.blogSnapshot) orgUpdates.blogSnapshot = socialUpdates.blogSnapshot;
        await storage.updateOrganization(competitor.organizationId, orgUpdates).catch(err =>
          console.error("[Org Update] Failed to sync crawl to org:", err.message)
        );
      }
      
      // Quick analysis: just refresh webpage data, no AI analysis
      if (analysisType === "quick") {
        await storage.createActivity({
          type: "crawl",
          competitorId: competitor.id,
          competitorName: competitor.name,
          description: `Quick refresh: crawled ${crawlResult.pages.length} pages (${crawlResult.totalWordCount.toLocaleString()} words)`,
          date: lastCrawl,
          impact: "Low",
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
        });
        
        return res.json({ 
          success: true, 
          lastCrawl, 
          analysisType: "quick",
          message: "Quick refresh completed - webpage data updated",
          pagesCrawled: crawlResult.pages.length,
          totalWordCount: crawlResult.totalWordCount,
        });
      }
      
      // Full and full_with_change: perform AI analysis
      const websiteContent = getCombinedContent(crawlResult);
      
      if (websiteContent.length > 100) {
        try {
          // Extract LinkedIn data from competitor record if available
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
            undefined, // grounding context
            linkedInData
          );
          
          // Store analysis data on the competitor record
          // But protect manual research data from being overwritten
          if (hasManualResearch) {
            console.log(`Skipping analysis update for ${competitor.name} - has manual research data`);
          } else {
            await storage.updateCompetitorAnalysis(competitor.id, analysis);
          }
          
          if (competitor.organizationId) {
            const orgEnrichment: any = {};
            if (analysis.description) orgEnrichment.description = analysis.description;
            if (analysis.category) orgEnrichment.category = analysis.category;
            if (analysis.industry) orgEnrichment.industry = analysis.industry;
            if (Object.keys(orgEnrichment).length > 0) {
              await storage.updateOrganization(competitor.organizationId, orgEnrichment)
                .catch(err => console.error(`[Crawl] Org enrichment failed for ${competitor.name}:`, err.message));
            }
          }
          
          // Extract company profile data from about/homepage content (if not already set)
          if (!competitor.headquarters && !competitor.founded && !competitor.revenue && !competitor.fundingRaised) {
            try {
              // Find about page content for company info extraction
              const aboutPage = crawlResult.pages.find(p => p.pageType === "about");
              const homePage = crawlResult.pages.find(p => p.pageType === "homepage");
              const contentForProfile = (aboutPage?.content || "") + "\n\n" + (homePage?.content || "");
              
              if (contentForProfile.length > 200) {
                const profilePrompt = `Extract company profile information from this website content. Return ONLY a JSON object with these fields (use null if not found):
{
  "headquarters": "City, State/Country or null",
  "founded": "Year as string or null",
  "revenue": "Revenue range or null", 
  "fundingRaised": "Funding amount or null"
}

Website content:
${contentForProfile.substring(0, 8000)}

Return ONLY the JSON object, no other text.`;

                const anthropic = new Anthropic({
                  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
                });
                
                const profileResponse = await anthropic.messages.create({
                  model: "claude-sonnet-4-20250514",
                  max_tokens: 500,
                  messages: [{ role: "user", content: profilePrompt }],
                });
                
                const profileText = (profileResponse.content[0] as any).text;
                const jsonMatch = profileText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const profileData = JSON.parse(jsonMatch[0]);
                  const profileUpdates: any = {};
                  
                  if (profileData.headquarters && profileData.headquarters !== "null") {
                    profileUpdates.headquarters = profileData.headquarters;
                  }
                  if (profileData.founded && profileData.founded !== "null") {
                    profileUpdates.founded = String(profileData.founded);
                  }
                  if (profileData.revenue && profileData.revenue !== "null") {
                    profileUpdates.revenue = profileData.revenue;
                  }
                  if (profileData.fundingRaised && profileData.fundingRaised !== "null") {
                    profileUpdates.fundingRaised = profileData.fundingRaised;
                  }
                  
                  if (Object.keys(profileUpdates).length > 0) {
                    await storage.updateCompetitor(competitor.id, profileUpdates);
                    console.log(`[Crawl] Extracted company profile for ${competitor.name}:`, profileUpdates);
                  }
                }
              }
            } catch (profileError) {
              console.error(`[Crawl] Failed to extract company profile for ${competitor.name}:`, profileError);
              // Non-blocking - continue even if profile extraction fails
            }
          }
          
          // Create activity entry for the crawl
          await storage.createActivity({
            type: "crawl",
            competitorId: competitor.id,
            competitorName: competitor.name,
            description: `Analyzed ${crawlResult.pages.length} pages (${crawlResult.totalWordCount.toLocaleString()} words): ${analysis.summary}`,
            date: lastCrawl,
            impact: "Medium",
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
          });
          
          // For full_with_change, also trigger social media monitoring
          let socialMonitoringResult = null;
          if (analysisType === "full_with_change") {
            if (competitor.linkedInUrl || competitor.instagramUrl) {
              try {
                socialMonitoringResult = await monitorCompetitorSocialMedia(competitor.id, ctx.userId, ctx.tenantDomain);
              } catch (socialError) {
                console.error("Social monitoring failed:", socialError);
                socialMonitoringResult = { error: "Social monitoring unavailable" };
              }
            }
          }
          
          res.json({ 
            success: true, 
            lastCrawl, 
            analysisType,
            analysis,
            pagesCrawled: crawlResult.pages.length,
            totalWordCount: crawlResult.totalWordCount,
            socialMonitoring: socialMonitoringResult,
          });
        } catch (aiError) {
          console.error("AI analysis failed:", aiError);
          res.json({ 
            success: true, 
            lastCrawl, 
            analysisType,
            message: "Crawled but AI analysis unavailable",
            pagesCrawled: crawlResult.pages.length,
            totalWordCount: crawlResult.totalWordCount,
          });
        }
      } else {
        res.json({ success: true, lastCrawl, analysisType, message: "Website content could not be extracted" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save manual AI research for a competitor (when crawl fails)
  app.post("/api/competitors/:id/manual-research", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.id);
      
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { researchContent } = req.body;
      if (!researchContent || researchContent.trim().length < 100) {
        return res.status(400).json({ error: "Research content is required (minimum 100 characters)" });
      }

      // Parse the manual research content into structured data
      const analysisData = parseManualResearch(researchContent, competitor.name);
      
      // Mark as manual source to protect from crawl overwrites
      analysisData.source = "manual";
      analysisData.manualResearchDate = new Date().toISOString();

      await storage.updateCompetitorAnalysis(competitor.id, analysisData);
      
      // Also update the competitor record with company profile fields if extracted
      if (analysisData.companyProfile) {
        const profileUpdates: any = {};
        if (analysisData.companyProfile.headquarters) {
          profileUpdates.headquarters = analysisData.companyProfile.headquarters;
        }
        if (analysisData.companyProfile.founded) {
          profileUpdates.founded = analysisData.companyProfile.founded;
        }
        if (analysisData.companyProfile.revenue) {
          profileUpdates.revenue = analysisData.companyProfile.revenue;
        }
        if (analysisData.companyProfile.fundingRaised) {
          profileUpdates.fundingRaised = analysisData.companyProfile.fundingRaised;
        }
        if (Object.keys(profileUpdates).length > 0) {
          await storage.updateCompetitor(competitor.id, profileUpdates);
        }
      }
      
      // Create activity entry
      await storage.createActivity({
        type: "manual_research",
        competitorId: competitor.id,
        competitorName: competitor.name,
        description: `Manual AI research saved: ${analysisData.summary?.substring(0, 100) || "Company intelligence gathered via external AI assistant"}...`,
        date: new Date().toLocaleString(),
        impact: "Medium",
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });

      // Capture visual assets (screenshot/favicon) if not already captured
      if (!competitor.screenshotUrl && competitor.url) {
        try {
          console.log(`[Manual Research] Capturing visual assets for ${competitor.name}...`);
          const visualAssets = await captureVisualAssets(competitor.url, competitor.id);
          if (visualAssets.faviconUrl || visualAssets.screenshotUrl) {
            await storage.updateCompetitor(competitor.id, {
              faviconUrl: visualAssets.faviconUrl || competitor.faviconUrl,
              screenshotUrl: visualAssets.screenshotUrl,
            });
            console.log(`[Manual Research] Visual assets captured: favicon=${!!visualAssets.faviconUrl}, screenshot=${!!visualAssets.screenshotUrl}`);
          }
        } catch (visualError) {
          console.error(`[Manual Research] Failed to capture visual assets:`, visualError);
          // Non-blocking - continue even if visual capture fails
        }
      }

      res.json({ success: true, analysisData });
    } catch (error: any) {
      console.error("Manual research save error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== SOCIAL MEDIA MONITORING (PREMIUM) ====================

  // Monitor social media for a single competitor (on-demand)
  app.post("/api/competitors/:id/monitor-social", async (req, res) => {
    if (!await guardFeature(req, res, "socialMonitoring")) return;
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!competitor.linkedInUrl && !competitor.instagramUrl) {
        return res.status(400).json({ error: "No social media URLs configured for this competitor" });
      }

      const results = await monitorCompetitorSocialMedia(req.params.id, ctx.userId, ctx.tenantDomain);
      res.json({ success: true, results });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Monitor all competitors' social media for tenant (scheduled/bulk)
  app.post("/api/social-monitoring/run", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Global Admin" && user.role !== "Domain Admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const tenantDomain = user.email.split("@")[1];
      
      const results = await monitorAllCompetitorsForTenant(tenantDomain);
      res.json({ success: true, results });
    } catch (error: any) {
      if (error.message.includes("premium feature")) {
        return res.status(403).json({ error: error.message, upgradeRequired: true });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get social monitoring settings for tenant
  app.get("/api/social-monitoring/settings", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const tenant = await storage.getTenantByDomain(tenantDomain);

      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      res.json({
        plan: tenant.plan,
        monitoringFrequency: tenant.monitoringFrequency || "weekly",
        socialMonitoringEnabled: tenant.plan !== "free",
        isPremium: tenant.plan !== "free",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update social monitoring settings (admin only)
  app.patch("/api/social-monitoring/settings", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Global Admin" && user.role !== "Domain Admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const tenantDomain = user.email.split("@")[1];
      const tenant = await storage.getTenantByDomain(tenantDomain);

      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const featureCheck = await checkFeatureAccessAsync(tenant.plan, "socialMonitoring");
      if (!featureCheck.allowed) {
        return res.status(403).json({ error: featureCheck.reason, upgradeRequired: true, requiredPlan: featureCheck.requiredPlan });
      }

      const { monitoringFrequency } = req.body;
      if (monitoringFrequency && !["weekly", "daily", "disabled"].includes(monitoringFrequency)) {
        return res.status(400).json({ error: "Invalid monitoring frequency" });
      }

      const updated = await storage.updateTenant(tenant.id, {
        monitoringFrequency: monitoringFrequency || tenant.monitoringFrequency,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== WEBSITE CHANGE MONITORING (PREMIUM) ====================

  // Monitor website for a single competitor (on-demand)
  app.post("/api/competitors/:id/monitor-website", async (req, res) => {
    if (!await guardFeature(req, res, "websiteMonitoring")) return;
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const result = await monitorCompetitorWebsite(req.params.id, ctx.userId, ctx.tenantDomain);
      res.json({ success: true, result });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Monitor all competitors' websites for tenant (scheduled/bulk)
  app.post("/api/website-monitoring/run", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Global Admin" && user.role !== "Domain Admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const tenantDomain = user.email.split("@")[1];
      
      const results = await monitorAllWebsitesForTenant(tenantDomain);
      res.json({ success: true, results });
    } catch (error: any) {
      if (error.message.includes("premium feature")) {
        return res.status(403).json({ error: error.message, upgradeRequired: true });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Batch monitor: Company profile + all market competitors
  app.post("/api/company-profile/:id/monitor-all", async (req, res) => {
    if (!await guardFeature(req, res, "websiteMonitoring")) return;
    try {
      const ctx = await getRequestContext(req);

      const profile = await storage.getCompanyProfile(req.params.id);
      if (!profile) {
        return res.status(404).json({ error: "Company profile not found" });
      }

      if (!validateResourceContext(profile, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const results: { type: string; name: string; success: boolean; error?: string }[] = [];

      // Monitor baseline company profile
      try {
        await monitorCompanyProfileWebsite(
          profile.id,
          ctx.userId,
          ctx.tenantDomain,
          profile.marketId || undefined
        );
        results.push({ type: "baseline", name: profile.companyName, success: true });
      } catch (error: any) {
        results.push({ type: "baseline", name: profile.companyName, success: false, error: error.message });
      }

      // Get all competitors in the same market context
      const competitors = await storage.getCompetitorsByContext({
        tenantId: ctx.tenantId,
        tenantDomain: ctx.tenantDomain,
        marketId: profile.marketId || ctx.marketId,
      });

      for (const competitor of competitors) {
        try {
          await monitorCompetitorWebsite(competitor.id, ctx.userId, ctx.tenantDomain);
          results.push({ type: "competitor", name: competitor.name, success: true });
        } catch (error: any) {
          results.push({ type: "competitor", name: competitor.name, success: false, error: error.message });
        }
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({ 
        success: true, 
        message: `Monitored ${successCount} of ${results.length} targets`,
        successCount,
        failCount,
        results 
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Simple baseline refresh: Crawl company profile website and LinkedIn
  app.post("/api/company-profile/:id/refresh", async (req, res) => {
    console.log(`[Baseline Refresh] Endpoint called for profile ID: ${req.params.id}`);
    try {
      const ctx = await getRequestContext(req);
      console.log(`[Baseline Refresh] Context obtained for user: ${ctx.userId}, tenant: ${ctx.tenantId}`);
      const profileId = req.params.id;
      const profile = await storage.getCompanyProfile(profileId);
      
      if (!profile) {
        return res.status(404).json({ error: "Company profile not found" });
      }
      
      const results: any = { website: null, linkedin: null, blog: null, errors: [] };
      
      console.log(`[Baseline Refresh] Starting refresh for ${profile.companyName} (${profile.id})`);
      console.log(`[Baseline Refresh] URLs: website=${profile.websiteUrl}, linkedin=${profile.linkedInUrl}, blog=${profile.blogUrl}`);
      
      // Crawl website - wrapped in try/catch so LinkedIn still runs even if this fails
      if (profile.websiteUrl) {
        try {
          console.log(`[Baseline Refresh] Starting website crawl for ${profile.websiteUrl}`);
          const { crawlCompetitorWebsite, getCombinedContent } = await import("../services/web-crawler");
          const crawlResult = await crawlCompetitorWebsite(profile.websiteUrl);
          
          if (crawlResult.pages.length > 0) {
            const combinedContent = getCombinedContent(crawlResult);
            const updateData: any = {
              crawlData: {
                pagesCrawled: crawlResult.pages.map(p => ({
                  url: p.url,
                  pageType: p.pageType,
                  title: p.title,
                  wordCount: p.wordCount,
                })),
                totalWordCount: crawlResult.pages.reduce((sum, p) => sum + p.wordCount, 0),
                crawledAt: crawlResult.crawledAt,
                socialLinks: crawlResult.socialLinks,
              },
              previousWebsiteContent: combinedContent.substring(0, 100000),
              lastCrawl: new Date().toISOString(),
              lastFullCrawl: new Date(),
            };
            
            // Capture blog snapshot if found
            if (crawlResult.blogSnapshot) {
              updateData.blogSnapshot = {
                ...crawlResult.blogSnapshot,
                capturedAt: new Date().toISOString(),
              };
            }
            
            // Update social URLs if discovered during crawl and not already set
            if (crawlResult.socialLinks) {
              if (crawlResult.socialLinks.linkedIn && !profile.linkedInUrl) {
                updateData.linkedInUrl = crawlResult.socialLinks.linkedIn;
              }
              if (crawlResult.socialLinks.twitter && !profile.twitterUrl) {
                updateData.twitterUrl = crawlResult.socialLinks.twitter;
              }
              if (crawlResult.socialLinks.instagram && !profile.instagramUrl) {
                updateData.instagramUrl = crawlResult.socialLinks.instagram;
              }
            }
            
            await storage.updateCompanyProfile(profile.id, updateData);

            if (profile.organizationId) {
              await storage.updateOrganization(profile.organizationId, {
                crawlData: updateData.crawlData,
                previousWebsiteContent: updateData.previousWebsiteContent,
                lastCrawl: updateData.lastCrawl,
                lastFullCrawl: updateData.lastFullCrawl,
                blogSnapshot: updateData.blogSnapshot,
                linkedInUrl: updateData.linkedInUrl,
                twitterUrl: updateData.twitterUrl,
                instagramUrl: updateData.instagramUrl,
              }).catch(err => console.error("[Org Update] Baseline crawl sync failed:", err.message));
            }

            results.website = { 
              success: true, 
              pages: crawlResult.pages.length,
              blogPosts: crawlResult.blogSnapshot?.postCount || 0,
            };
            console.log(`[Baseline Refresh] Website crawl success: ${crawlResult.pages.length} pages`);
          } else {
            console.log(`[Baseline Refresh] Website crawl returned no pages`);
            results.website = { success: false, error: "No pages found" };
          }
        } catch (websiteError: any) {
          console.error(`[Baseline Refresh] Website crawl failed:`, websiteError.message);
          results.website = { success: false, error: websiteError.message };
          results.errors.push(`Website: ${websiteError.message}`);
        }
      }
      
      // Refresh LinkedIn - using company profile social monitoring
      if (profile.linkedInUrl) {
        try {
          console.log(`[Baseline Refresh] Fetching LinkedIn data for ${profile.linkedInUrl}`);
          const { monitorCompanyProfileSocialMedia } = await import("../services/social-monitoring");
          await monitorCompanyProfileSocialMedia(profile.id, ctx.userId, ctx.tenantDomain, ctx.marketId);
          
          // Verify data was saved
          const updatedProfile = await storage.getCompanyProfile(profile.id);
          const linkedInData = updatedProfile?.linkedInEngagement as any;
          console.log(`[Baseline Refresh] LinkedIn result: followers=${linkedInData?.followers || 'none'}, posts=${linkedInData?.posts || 'none'}`);
          results.linkedin = { 
            success: !!linkedInData?.followers, 
            followers: linkedInData?.followers || 0,
            posts: linkedInData?.posts || 0,
          };
        } catch (linkedInError: any) {
          console.error(`[Baseline Refresh] LinkedIn error:`, linkedInError.message);
          results.linkedin = { success: false, error: linkedInError.message };
          results.errors.push(`LinkedIn: ${linkedInError.message}`);
        }
      } else {
        console.log(`[Baseline Refresh] No LinkedIn URL configured`);
      }
      
      console.log(`[Baseline Refresh] Completed for ${profile.companyName}:`, JSON.stringify(results));
      res.json({ success: true, results });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Social-only refresh: Just LinkedIn/blog without website crawl (faster)
  app.post("/api/company-profile/:id/refresh-social", async (req, res) => {
    console.log(`[Social Refresh] Endpoint called for profile ID: ${req.params.id}`);
    try {
      const ctx = await getRequestContext(req);
      const profileId = req.params.id;
      const profile = await storage.getCompanyProfile(profileId);
      
      if (!profile) {
        return res.status(404).json({ error: "Company profile not found" });
      }
      
      const results: any = { linkedin: null, errors: [] };
      
      console.log(`[Social Refresh] Starting social refresh for ${profile.companyName}`);
      
      // Refresh LinkedIn only
      if (profile.linkedInUrl) {
        try {
          console.log(`[Social Refresh] Fetching LinkedIn data for ${profile.linkedInUrl}`);
          const { monitorCompanyProfileSocialMedia } = await import("../services/social-monitoring");
          await monitorCompanyProfileSocialMedia(profile.id, ctx.userId, ctx.tenantDomain, ctx.marketId);
          
          const updatedProfile = await storage.getCompanyProfile(profile.id);
          const linkedInData = updatedProfile?.linkedInEngagement as any;
          console.log(`[Social Refresh] LinkedIn result: followers=${linkedInData?.followers || 'none'}, posts=${linkedInData?.posts || 'none'}`);
          results.linkedin = { 
            success: !!linkedInData?.followers, 
            followers: linkedInData?.followers || 0,
            posts: linkedInData?.posts || 0,
          };
        } catch (linkedInError: any) {
          console.error(`[Social Refresh] LinkedIn error:`, linkedInError.message);
          results.linkedin = { success: false, error: linkedInError.message };
          results.errors.push(`LinkedIn: ${linkedInError.message}`);
        }
      } else {
        console.log(`[Social Refresh] No LinkedIn URL configured`);
        results.linkedin = { success: false, error: "No LinkedIn URL configured" };
      }
      
      console.log(`[Social Refresh] Completed for ${profile.companyName}:`, JSON.stringify(results));
      res.json({ success: true, results });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Batch monitor: All competitor products in a project
  app.post("/api/projects/:id/monitor-all", async (req, res) => {
    if (!await guardFeature(req, res, "websiteMonitoring")) return;
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(project.id);
      const results: { type: string; name: string; success: boolean; error?: string }[] = [];

      for (const pp of projectProducts) {
        const product = pp.product;
        if (!product?.url) continue;

        // Check if this is a competitor product (has competitorId)
        if (product.competitorId) {
          try {
            await monitorCompetitorWebsite(product.competitorId, ctx.userId, ctx.tenantDomain);
            results.push({ type: pp.role, name: product.name, success: true });
          } catch (error: any) {
            results.push({ type: pp.role, name: product.name, success: false, error: error.message });
          }
        } else if (product.companyProfileId) {
          // Baseline product - monitor the company profile
          try {
            await monitorCompanyProfileWebsite(
              product.companyProfileId,
              ctx.userId,
              ctx.tenantDomain,
              project.marketId || undefined
            );
            results.push({ type: pp.role, name: product.name, success: true });
          } catch (error: any) {
            results.push({ type: pp.role, name: product.name, success: false, error: error.message });
          }
        } else {
          // Standalone product - monitor directly by product URL
          try {
            await monitorProductWebsite(
              product.id,
              ctx.userId,
              ctx.tenantDomain,
              project.marketId || undefined
            );
            results.push({ type: pp.role, name: product.name, success: true });
          } catch (error: any) {
            results.push({ type: pp.role, name: product.name, success: false, error: error.message });
          }
        }
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({ 
        success: true, 
        message: `Monitored ${successCount} of ${results.length} products`,
        successCount,
        failCount,
        results 
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });
  
  // Generate AI analysis for all competitors
  app.post("/api/analysis/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const user = await storage.getUser(ctx.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = ctx.tenantDomain;
      const analysisType = req.body?.analysisType || "full";
      const selectedCompetitorIds: string[] | undefined = req.body?.selectedCompetitorIds;

      // Check premium for full_with_change mode
      const tenant = await storage.getTenantByDomain(tenantDomain);
      if (analysisType === "full_with_change") {
        const isPremium = tenant?.plan === "pro" || tenant?.plan === "enterprise" || tenant?.plan === "unlimited";
        if (!isPremium) {
          return res.status(403).json({ error: "Change detection requires a Pro, Enterprise, or Unlimited plan", upgradeRequired: true });
        }
      }

      // Plan gating: check monthly analysis limit
      if (tenant) {
        const monthlyCount = await getMonthlyAnalysisCount(tenantDomain);
        const analysisCheck = await checkAnalysisLimitAsync(tenant.plan, monthlyCount);
        if (!analysisCheck.allowed) {
          return res.status(403).json({
            error: analysisCheck.reason,
            upgradeRequired: true,
            requiredPlan: analysisCheck.requiredPlan,
            currentUsage: analysisCheck.currentUsage,
            limit: analysisCheck.limit,
          });
        }
      }

      // Get context-scoped competitors (includes market filtering)
      const userCompetitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      if (userCompetitors.length === 0) {
        return res.status(400).json({ error: "No competitors to analyze. Add competitors first." });
      }

      // Get company profile for "our" positioning (context-scoped)
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      // Get grounding documents for additional context (context-scoped, competitive_analysis only)
      const groundingDocs = await storage.getGroundingDocumentsByContext(toContextFilter(ctx), "competitive_analysis");
      const groundingContext = groundingDocs
        .filter(doc => doc.extractedText)
        .map(doc => doc.extractedText)
        .join("\n\n");

      // Build "our positioning" from company profile and grounding docs
      let ourPositioning = companyProfile 
        ? `${companyProfile.companyName}: ${companyProfile.description || 'No description provided'}`
        : "Our company positioning";
      
      if (groundingContext) {
        ourPositioning += `\n\nAdditional context from positioning documents:\n${groundingContext.slice(0, 5000)}`;
      }

      // Filter out competitors excluded from crawl, then apply user selection if provided
      let eligibleCompetitors = userCompetitors.filter(c => !c.excludeFromCrawl);
      if (selectedCompetitorIds && Array.isArray(selectedCompetitorIds) && selectedCompetitorIds.length > 0) {
        eligibleCompetitors = eligibleCompetitors.filter(c => selectedCompetitorIds.includes(c.id));
      }
      if (eligibleCompetitors.length === 0) {
        return res.status(400).json({ error: "No eligible competitors to analyze. All competitors are excluded from crawl or deselected." });
      }

      // Analyze each competitor based on analysis type
      const analyses: (CompetitorAnalysis & { competitor: string })[] = [];
      for (const competitor of eligibleCompetitors) {
        try {
          // Quick mode: Use cached analysis only
          if (analysisType === "quick") {
            if (competitor.analysisData) {
              analyses.push({ competitor: competitor.name, ...(competitor.analysisData as any) });
            }
            continue;
          }

          // Full mode: Re-crawl and analyze
          // Full with change mode: Also include social/blog monitoring
          if (analysisType === "full_with_change") {
            // Trigger social and blog monitoring for this competitor
            try {
              await monitorCompetitorSocialMedia(competitor.id);
              await monitorCompetitorWebsite(competitor.id);
            } catch (monitorError) {
              console.error(`Monitoring failed for ${competitor.name}:`, monitorError);
            }
          }

          // Crawl website fresh
          const response = await fetch(competitor.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; OrbitBot/1.0)",
            },
          });
          let content = await response.text();
          content = content
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          if (content.length > 100) {
            // Extract LinkedIn data from competitor record if available
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
              content,
              undefined, // grounding context
              linkedInData
            );
            // Store analysis on competitor
            await storage.updateCompetitorAnalysis(competitor.id, analysis);
            await storage.updateCompetitorLastCrawl(competitor.id, new Date().toISOString());
            analyses.push({ competitor: competitor.name, ...analysis });
          }
        } catch (e) {
          console.error(`Failed to analyze ${competitor.name}:`, e);
        }
      }

      if (analyses.length === 0) {
        return res.status(400).json({ error: "Could not analyze any competitors" });
      }

      // Get baseline analysis from company profile if available
      const baselineAnalysis = companyProfile?.analysisData as CompetitorAnalysis | undefined;

      // Fetch dismissed gaps to avoid regenerating them
      const dismissedGapRecords = await storage.getGapDismissalsByContext(toContextFilter(ctx));
      const dismissedGapsForAI = dismissedGapRecords
        .filter(d => d.status === "dismissed")
        .map(d => ({ title: d.gapIdentifier, reason: d.reason }));

      // Generate gap analysis with baseline and grounding context
      const gaps = await generateGapAnalysis(
        ourPositioning, 
        analyses,
        baselineAnalysis,
        groundingContext || undefined,
        dismissedGapsForAI.length > 0 ? dismissedGapsForAI : undefined
      );

      // Fetch existing recommendations to avoid regenerating dismissed or duplicates (context-scoped)
      // Include feedback scores for AI learning
      const existingRecs = await storage.getRecommendationsByContext(toContextFilter(ctx));
      const existingForAI = existingRecs.map(r => ({
        title: r.title,
        description: r.description,
        area: r.area,
        status: r.status,
        dismissedReason: r.dismissedReason || undefined,
        thumbsUp: r.thumbsUp || 0,
        thumbsDown: r.thumbsDown || 0,
      }));

      // Generate recommendations, passing existing ones to avoid duplicates
      const recommendations = await generateRecommendations(gaps, analyses, existingForAI);

      // Save recommendations to database with context scoping (includes marketId)
      for (const rec of recommendations) {
        await storage.createRecommendation({
          title: rec.title,
          description: rec.description,
          area: rec.area,
          impact: rec.impact,
          userId: user.id,
          tenantDomain,
          marketId: ctx.marketId,
        });
      }

      // Get our company's positioning from analysis data if available
      const ourAnalysisData = companyProfile?.analysisData as Partial<CompetitorAnalysis> | null;
      const ourSummary = ourAnalysisData?.summary || companyProfile?.description || "Our positioning";
      const ourKeyMessages = ourAnalysisData?.keyMessages || [];

      // Build N-competitor themes: derive theme relevance from each competitor's analysis
      // Themes are extracted from each competitor's value propositions
      // Level is determined by keyword overlap and analysis depth for each competitor
      const allThemes: string[] = [];
      for (const a of analyses) {
        if (a.valueProposition) allThemes.push(a.valueProposition);
      }
      const uniqueThemes = Array.from(new Set(allThemes)).filter(Boolean);

      const themesForSave = uniqueThemes.map(theme => {
        const scores: Record<string, { level: string; details: string }> = {};

        // Score baseline ("Us") against this theme
        const ourVP = ourAnalysisData?.valueProposition || "";
        const ourKW = (ourAnalysisData?.keywords || []).join(" ").toLowerCase();
        const themeLower = theme.toLowerCase();
        const ourRelevance = ourVP.toLowerCase().includes(themeLower.substring(0, 20))
          || ourKW.includes(themeLower.substring(0, 15));
        scores["Us"] = {
          level: ourRelevance ? "High" : (ourVP ? "Medium" : "Low"),
          details: ourVP || ourSummary,
        };

        // Score each competitor based on whether this theme matches their value proposition
        for (const comp of analyses) {
          const compVP = (comp.valueProposition || "").toLowerCase();
          const compKW = (comp.keywords || []).join(" ").toLowerCase();
          const isDirectMatch = compVP === themeLower || comp.valueProposition === theme;
          const hasOverlap = compVP.includes(themeLower.substring(0, 20))
            || compKW.includes(themeLower.substring(0, 15));
          scores[comp.competitor] = {
            level: isDirectMatch ? "High" : (hasOverlap ? "Medium" : "Low"),
            details: comp.valueProposition || comp.summary || "",
          };
        }
        return { theme, scores };
      });

      // Build N-competitor messaging: each analysis contributes messaging entries per competitor
      const messagingForSave = analyses.map((a) => {
        const entries: Record<string, string> = {};
        entries["Us"] = ourKeyMessages.length > 0 ? ourKeyMessages.join("; ") : ourSummary;
        for (const comp of analyses) {
          entries[comp.competitor] = comp.keyMessages?.length > 0
            ? comp.keyMessages.join("; ")
            : comp.summary || "";
        }
        return {
          category: a.targetAudience || "Market Positioning",
          entries,
        };
      });

      const sourceDataAsOf = await computeLatestSourceDataTimestamp(ctx);
      const savedAnalysis = await storage.createAnalysis({
        userId: user.id,
        tenantDomain,
        marketId: ctx.marketId,
        themes: themesForSave,
        messaging: messagingForSave,
        gaps: gaps,
        generatedFromDataAsOf: sourceDataAsOf,
      });

      res.json({ success: true, analysis: savedAnalysis, recommendations, analyzedCount: analyses.length });
    } catch (error: any) {
      console.error("Analysis generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/analysis/source-freshness", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const ctxFilter = toContextFilter(ctx);

      const competitorsList = await storage.getCompetitorsByContext(ctxFilter);
      const companyProfile = await storage.getCompanyProfileByContext(ctxFilter);

      const eligibleCompetitors = competitorsList.filter(c => !c.excludeFromCrawl);

      const allOrgIds = [
        ...eligibleCompetitors.map(c => c.organizationId),
        companyProfile?.organizationId,
      ].filter(Boolean) as string[];
      const orgIds = Array.from(new Set(allOrgIds));
      const orgMap = new Map<string, any>();
      for (const orgId of orgIds) {
        const org = await storage.getOrganization(orgId);
        if (org) orgMap.set(orgId, org);
      }

      const pickFresher = (a: any, b: any) => {
        if (a && b) return new Date(b) > new Date(a) ? b : a;
        return a || b || null;
      };

      const competitorFreshness = eligibleCompetitors.map((c) => {
        const org = c.organizationId ? orgMap.get(c.organizationId) : null;
        return {
          id: c.id,
          name: c.name,
          lastCrawl: pickFresher(c.lastFullCrawl || c.lastCrawl, org?.lastFullCrawl || org?.lastCrawl),
          lastWebsiteMonitor: pickFresher(c.lastWebsiteMonitor, org?.lastWebsiteMonitor),
          lastSocialMonitor: pickFresher(c.lastSocialCrawl, org?.lastSocialCrawl),
        };
      });

      const baselineFreshness = companyProfile
        ? (() => {
            const org = companyProfile.organizationId ? orgMap.get(companyProfile.organizationId) : null;
            return {
              id: companyProfile.id,
              name: companyProfile.companyName,
              lastCrawl: pickFresher(companyProfile.lastFullCrawl || companyProfile.lastCrawl, org?.lastFullCrawl || org?.lastCrawl),
              lastWebsiteMonitor: pickFresher(companyProfile.lastWebsiteMonitor, org?.lastWebsiteMonitor),
              lastSocialMonitor: pickFresher(companyProfile.lastSocialCrawl, org?.lastSocialCrawl),
            };
          })()
        : null;

      const allTimestamps: (string | Date | null)[] = [];
      for (const c of competitorFreshness) {
        allTimestamps.push(c.lastCrawl, c.lastWebsiteMonitor, c.lastSocialMonitor);
      }
      if (baselineFreshness) {
        allTimestamps.push(baselineFreshness.lastCrawl, baselineFreshness.lastWebsiteMonitor, baselineFreshness.lastSocialMonitor);
      }

      let overallStaleness: "fresh" | "aging" | "stale" = "fresh";
      const now = Date.now();
      for (const ts of allTimestamps) {
        if (!ts) {
          overallStaleness = "stale";
          break;
        }
        const diffMs = now - new Date(ts).getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays >= 7) {
          overallStaleness = "stale";
          break;
        } else if (diffDays >= 1 && overallStaleness === "fresh") {
          overallStaleness = "aging";
        }
      }

      res.json({
        competitors: competitorFreshness,
        baseline: baselineFreshness,
        overallStaleness,
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/competitors/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (competitor.organizationId) {
        await storage.decrementOrgRefCount(competitor.organizationId);
      }
      await storage.deleteCompetitor(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });


}
