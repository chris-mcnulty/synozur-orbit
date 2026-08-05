import type { Express } from "express";
import { storage, type ContextFilter } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, parseManualResearch, computeLatestSourceDataTimestamp, guardFeature, guardCompetitorLimit, guardAnalysisLimit, guardManualAction } from "./helpers";
import { parsePaginationParams, buildPaginatedEnvelope } from "../utils/pagination";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { insertCompetitorSchema, competitorSocialLinksUpdateSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";
import { analyzeCompetitorWebsite, generateGapAnalysis, generateRecommendations, aiCompanyResearch, type CompetitorAnalysis, type LinkedInContext } from "../ai-service";
import { buildCompetitorDocumentContextForCompetitors, mergeGroundingContext } from "../services/competitor-document-context";
import Anthropic from "@anthropic-ai/sdk";
import { captureVisualAssets } from "../services/visual-capture";
import { enqueueMonitor } from "../services/job-queue";
import { testBlogUrl, monitorBlogForCompetitor, monitorBlogForCompanyProfile } from "../services/rss-service";
import { validateCompetitorUrl, validateBlogUrl } from "../utils/url-validator";
import { logAiUsage } from "./helpers";
import { buildCompetitorDocumentContext } from "../services/competitor-document-context";

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
      facebookUrl: competitor.facebookUrl || org.facebookUrl || null,
    };
  }

  app.get("/api/competitors", async (req, res) => {
    const startedAt = Date.now();
    try {
      const ctx = await getRequestContext(req);
      const competitorsList = await storage.getCompetitorsByContext(toContextFilter(ctx));

      const orgIds = competitorsList
        .map(c => c.organizationId)
        .filter((id): id is string => Boolean(id));
      const orgMap = await storage.getOrganizationsByIds(orgIds);

      const enriched = competitorsList.map(c =>
        c.organizationId ? enrichWithOrgData(c, orgMap.get(c.organizationId)) : c
      );

      const pagination = parsePaginationParams(req);

      // Apply optional search filter (after enrichment so org-derived fields are searchable too)
      let filtered = enriched;
      if (pagination.q) {
        const term = pagination.q.toLowerCase();
        filtered = enriched.filter((c: any) => {
          return (
            (c.name && c.name.toLowerCase().includes(term)) ||
            (c.url && c.url.toLowerCase().includes(term)) ||
            (c.industry && c.industry.toLowerCase().includes(term))
          );
        });
      }

      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[Perf] GET /api/competitors items=${competitorsList.length} orgs=${orgMap.size} paginated=${pagination.isPaginated} took=${elapsedMs}ms`
      );

      if (!pagination.isPaginated) {
        return res.json(filtered);
      }

      const total = filtered.length;
      const items = filtered.slice(pagination.offset, pagination.offset + pagination.limit);
      res.json(buildPaginatedEnvelope(items, total, pagination));
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

      const { linkedInUrl, instagramUrl, twitterUrl, facebookUrl, blogUrl, blogFeedUrl, socialCheckFrequency, excludeFromCrawl, name, url, projectId, headquarters, founded, employeeCount, revenue, fundingRaised, industry } = req.body;

      // Task #79 — validate social URLs server-side for parity with the
      // client-side zod refinements added in task #67. Only the keys
      // actually present in the request body are validated; empty strings
      // are accepted to allow clearing a link.
      const socialPayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries({ linkedInUrl, instagramUrl, twitterUrl, facebookUrl, blogUrl })) {
        if (v !== undefined) socialPayload[k] = v;
      }
      if (Object.keys(socialPayload).length > 0) {
        const socialParsed = competitorSocialLinksUpdateSchema.safeParse(socialPayload);
        if (!socialParsed.success) {
          const fieldErrors: Record<string, string> = {};
          for (const issue of socialParsed.error.issues) {
            const field = issue.path[0];
            if (typeof field === "string" && !fieldErrors[field]) {
              fieldErrors[field] = issue.message;
            }
          }
          return res.status(400).json({
            error: "Invalid social URL",
            fieldErrors,
          });
        }
      }

      const updateData: any = {};
      
      if (linkedInUrl !== undefined) updateData.linkedInUrl = linkedInUrl || null;
      if (instagramUrl !== undefined) updateData.instagramUrl = instagramUrl || null;
      if (twitterUrl !== undefined) updateData.twitterUrl = twitterUrl || null;
      if (facebookUrl !== undefined) updateData.facebookUrl = facebookUrl || null;
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
        facebookUrl: org.facebookUrl,
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
        if (!await guardCompetitorLimit(req, res)) return;
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
        // Task #79 — extract per-field errors so the create form can render
        // field-specific messages for malformed social URLs (and other fields).
        const socialFieldKeys = new Set([
          "linkedInUrl",
          "twitterUrl",
          "instagramUrl",
          "facebookUrl",
          "blogUrl",
        ]);
        const fieldErrors: Record<string, string> = {};
        let hasSocialError = false;
        for (const issue of parsed.error.issues) {
          const field = issue.path[0];
          if (typeof field === "string" && !fieldErrors[field]) {
            fieldErrors[field] = issue.message;
            if (socialFieldKeys.has(field)) hasSocialError = true;
          }
        }
        return res.status(400).json({
          error: hasSocialError
            ? "Invalid social URL"
            : fromError(parsed.error).toString(),
          fieldErrors,
        });
      }

      const org = await storage.findOrCreateOrganization(normalizedUrl, competitorData.name, {
        linkedInUrl: competitorData.linkedInUrl,
        instagramUrl: competitorData.instagramUrl,
        twitterUrl: competitorData.twitterUrl,
        facebookUrl: competitorData.facebookUrl,
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

      // Task #102 — kick an immediate per-competitor sentiment backfill so
      // the tone & sentiment panel has trend data on day one for any
      // pre-existing activity rows tied to this competitor.
      (async () => {
        try {
          const { backfillSentiment } = await import("../services/sentiment-backfill");
          await backfillSentiment({
            competitorId: competitor.id,
            tenantDomain: competitor.tenantDomain ?? undefined,
            limit: 200,
            sinceDays: 90,
          });
        } catch (err) {
          console.warn(
            `[sentiment] day-one backfill failed for competitor ${competitor.id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      })();

      // Auto-populate global directory metadata for new orgs (description / category / sicCode).
      // Fire-and-forget so the create response stays fast.
      if (org.wasCreated || !org.description || !org.category || !org.sicCode) {
        (async () => {
          try {
            const research = await aiCompanyResearch(parsed.data.name, normalizedUrl);
            const directoryUpdates: Record<string, string> = {};
            if (!org.description && research.description) directoryUpdates.description = research.description;
            if (!org.category && research.category) directoryUpdates.category = research.category;
            if (!org.sicCode && research.sicCode) directoryUpdates.sicCode = research.sicCode;
            if (!org.industry && research.industry) directoryUpdates.industry = research.industry;
            if (Object.keys(directoryUpdates).length > 0) {
              await storage.updateOrganization(org.id, directoryUpdates);
            }
          } catch (err) {
            console.error("[Directory] AI enrichment failed:", err);
          }
        })();
      }

      // Fire an immediate background crawl so new competitors have data right away
      // instead of waiting for the next hourly sweep. Fire-and-forget; does not
      // consume manual crawl quota.
      const competitorSnapshot = { ...competitor, organizationId: org.id };
      enqueueMonitor(`crawl:initial:${competitor.name}`, async () => {
        console.log(`[Initial Crawl] Starting crawl for new competitor: ${competitor.name} (${normalizedUrl})`);
        let crawlResult;
        try {
          crawlResult = await crawlCompetitorWebsite(normalizedUrl);
        } catch (err) {
          console.warn(`[Initial Crawl] Crawl failed for ${competitor.name}:`, (err as Error).message);
          return;
        }

        if (crawlResult.pages.length === 0) {
          console.warn(`[Initial Crawl] No pages crawled for ${competitor.name}`);
          return;
        }

        const updates: any = {
          crawlData: buildCrawlData(crawlResult),
          lastFullCrawl: new Date(),
        };

        if (crawlResult.socialLinks.linkedIn && !competitorSnapshot.linkedInUrl) {
          updates.linkedInUrl = crawlResult.socialLinks.linkedIn;
        }
        if (crawlResult.socialLinks.instagram && !competitorSnapshot.instagramUrl) {
          updates.instagramUrl = crawlResult.socialLinks.instagram;
        }
        if (crawlResult.socialLinks.twitter && !competitorSnapshot.twitterUrl) {
          updates.twitterUrl = crawlResult.socialLinks.twitter;
        }
        if (crawlResult.socialLinks.facebook && !competitorSnapshot.facebookUrl) {
          updates.facebookUrl = crawlResult.socialLinks.facebook;
        }
        if (crawlResult.blogSnapshot) {
          updates.blogSnapshot = { ...crawlResult.blogSnapshot, capturedAt: new Date().toISOString() };
        }

        await storage.updateCompetitor(competitor.id, updates);
        await storage.updateCompetitorLastCrawl(competitor.id, new Date().toISOString());

        // Sync to the org so future sibling competitors (and the freshness check)
        // see the crawl data.
        if (competitorSnapshot.organizationId) {
          await storage.updateOrganization(competitorSnapshot.organizationId, {
            crawlData: updates.crawlData,
            lastFullCrawl: updates.lastFullCrawl,
            lastCrawl: new Date().toISOString(),
            ...(updates.linkedInUrl ? { linkedInUrl: updates.linkedInUrl } : {}),
            ...(updates.instagramUrl ? { instagramUrl: updates.instagramUrl } : {}),
            ...(updates.blogSnapshot ? { blogSnapshot: updates.blogSnapshot } : {}),
          }).catch(err => console.error(`[Initial Crawl] Org sync failed for ${competitor.name}:`, (err as Error).message));
        }

        // Capture favicon / screenshot in the background.
        captureVisualAssets(normalizedUrl, competitor.id).then(async (visualAssets) => {
          if (visualAssets.faviconUrl || visualAssets.screenshotUrl) {
            await storage.updateCompetitor(competitor.id, {
              faviconUrl: visualAssets.faviconUrl || undefined,
              screenshotUrl: visualAssets.screenshotUrl || undefined,
            });
            if (competitorSnapshot.organizationId) {
              await storage.updateOrganization(competitorSnapshot.organizationId, {
                faviconUrl: visualAssets.faviconUrl || undefined,
                screenshotUrl: visualAssets.screenshotUrl || undefined,
              }).catch(() => {});
            }
          }
        }).catch(err => console.error(`[Initial Crawl] Visual capture failed for ${competitor.name}:`, err));

        console.log(`[Initial Crawl] Completed for ${competitor.name}`);
      }).catch(err => console.error(`[Initial Crawl] Enqueue failed for ${competitor.name}:`, (err as Error).message));

      res.json(competitor);
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
      if (!await guardAnalysisLimit(req, res)) return;

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
          // full_with_change: social/website monitoring removed from Orbit
          if (analysisType === "full_with_change") {
            console.log(`[Analysis] Skipping social/website monitoring for ${competitor.name} (feature removed)`);
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
            
            // Per-competitor uploaded documents context
            const competitorDocCtx = await buildCompetitorDocumentContext(
              ctx.tenantDomain,
              competitor.id,
            );
            const combinedGrounding = [groundingContext, competitorDocCtx.context]
              .filter((s) => s && s.trim())
              .join("\n\n") || undefined;

            const baseAnalysis = await analyzeCompetitorWebsite(
              competitor.name,
              competitor.url,
              content,
              combinedGrounding,
              linkedInData
            );
            // Store analysis on competitor (annotate sources used)
            const analysis = {
              ...baseAnalysis,
              competitorDocSources: competitorDocCtx.sources,
            };
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

      // Aggregate competitor-uploaded documents across all analyzed
      // competitors so the gap analysis is grounded in first-party intel.
      // Scope competitor-doc grounding to ONLY those competitors that were
      // actually analyzed in this request — never pull in private docs from
      // unrelated competitors.
      const analyzedNames = new Set(analyses.map((a: any) => a.competitor));
      const analyzedCompetitorIds = eligibleCompetitors
        .filter((c) => analyzedNames.has(c.name))
        .map((c) => c.id);
      const aggregatedCompetitorDocs = await buildCompetitorDocumentContextForCompetitors(
        ctx.tenantDomain,
        analyzedCompetitorIds,
      );
      const gapGrounding = mergeGroundingContext(groundingContext, aggregatedCompetitorDocs.context);

      // Generate gap analysis with baseline and grounding context
      const gaps = await generateGapAnalysis(
        ourPositioning,
        analyses,
        baselineAnalysis,
        gapGrounding,
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
      ].filter((id): id is string => Boolean(id));
      const orgMap = await storage.getOrganizationsByIds(allOrgIds);

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

  // Task #102: Sentiment & tone summary for a competitor.
  // Plan-gated via the `sentimentAnalysis` feature key — analyzer always
  // runs server-side, but this endpoint (UI surface) is plan-gated.
  app.get("/api/competitors/:id/tone", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) return res.status(403).json({ error: "Access denied" });
      if (!await guardFeature(req, res, "sentimentAnalysis")) return;

      const sinceParam = req.query.sinceDays ? parseInt(String(req.query.sinceDays), 10) : 90;
      const sinceDays = Number.isFinite(sinceParam) && sinceParam > 0 ? Math.min(sinceParam, 365) : 90;

      const { getCompetitorToneSummary } = await import("../services/sentiment-context");
      const summary = await getCompetitorToneSummary(competitor.id, sinceDays);
      res.json({ competitorId: competitor.id, sinceDays, ...summary });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Task #102: Admin-triggered backfill that scores activities lacking
  // sentiment/tone metadata. Returns counts so the caller can decide
  // whether to run again.
  app.post("/api/admin/sentiment/backfill", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      // Reuse role check: only Domain Admin / Global Admin can trigger backfills
      if (ctx.userRole !== "Domain Admin" && ctx.userRole !== "Global Admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const limit = req.body?.limit ? Math.min(parseInt(String(req.body.limit), 10), 200) : 50;
      const sinceDays = req.body?.sinceDays ? Math.min(parseInt(String(req.body.sinceDays), 10), 365) : 90;
      const competitorId = typeof req.body?.competitorId === "string" ? req.body.competitorId : undefined;

      // Domain Admins can only backfill their own tenant. Global Admins
      // may pass an explicit tenantDomain to target another tenant.
      let tenantDomain: string | undefined = ctx.tenantDomain;
      if (ctx.userRole === "Global Admin" && typeof req.body?.tenantDomain === "string") {
        tenantDomain = req.body.tenantDomain;
      }

      const { backfillSentiment } = await import("../services/sentiment-backfill");
      const result = await backfillSentiment({ limit, sinceDays, tenantDomain, competitorId });
      res.json(result);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
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
