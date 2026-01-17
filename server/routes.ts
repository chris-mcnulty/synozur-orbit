import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import bcrypt from "bcrypt";
import { insertUserSchema, insertCompetitorSchema, insertActivitySchema, insertRecommendationSchema, insertReportSchema, insertAnalysisSchema, insertGroundingDocumentSchema, insertCompanyProfileSchema, insertAssessmentSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";
import { analyzeCompetitorWebsite, generateGapAnalysis, generateRecommendations } from "./ai-service";
import Anthropic from "@anthropic-ai/sdk";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { documentExtractionService } from "./services/document-extraction";
import { registerEntraRoutes } from "./auth/entra-routes";
import { monitorCompetitorSocialMedia, monitorAllCompetitorsForTenant } from "./services/social-monitoring";
import { crawlCompetitorWebsite, getCombinedContent } from "./services/web-crawler";
import { captureVisualAssets } from "./services/visual-capture";
import { getJobStatus, triggerWebsiteCrawlNow, triggerSocialMonitorNow } from "./services/scheduled-jobs";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Register object storage routes
  registerObjectStorageRoutes(app);
  
  // Register Entra SSO routes
  registerEntraRoutes(app);
  
  // ==================== AUTH ROUTES ====================
  
  app.post("/api/register", async (req, res) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const { email, password, name, company, companySize, jobTitle, industry, country, avatar } = parsed.data;
      
      // Validate required demographic fields
      const requiredDemographics = { company, companySize, jobTitle, industry, country };
      for (const [field, value] of Object.entries(requiredDemographics)) {
        if (!value || !value.trim()) {
          return res.status(400).json({ error: `${field} is required` });
        }
      }
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
      }

      // Determine role based on business logic
      let role = "Standard User";
      const domain = email.split("@")[1].toLowerCase();
      
      // Check if domain is blocked from auto-provisioning
      const existingTenantForBlock = await storage.getTenantByDomain(domain);
      if (!existingTenantForBlock) {
        const isBlocked = await storage.isdomainBlocked(domain);
        if (isBlocked) {
          return res.status(403).json({ 
            error: "This email domain is not allowed for self-registration. Please contact your administrator to set up your organization." 
          });
        }
      }
      
      const globalAdmin = await storage.getGlobalAdmin();
      if (!globalAdmin) {
        role = "Global Admin";
      } else {
        const domainAdmin = await storage.getDomainAdmin(domain);
        if (!domainAdmin) {
          role = "Domain Admin";
        }
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user first
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        name,
        company,
        companySize,
        jobTitle,
        industry,
        country,
        avatar,
        role
      });

      // Create tenant for this domain if it doesn't exist (after user creation to ensure consistency)
      const existingTenant = await storage.getTenantByDomain(domain);
      if (!existingTenant) {
        await storage.createTenant({
          domain,
          name: company,
          plan: "trial",
          status: "active",
          userCount: 0,
          competitorLimit: 3,
          analysisLimit: 5,
        });
      }

      // Set session
      req.session.userId = user.id;

      // Don't send password back
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (user.authProvider === "entra") {
        return res.status(401).json({ error: "Please use Microsoft SSO to sign in" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      req.session.userId = user.id;

      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not log out" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  });

  // ==================== COMPETITOR ROUTES ====================

  app.get("/api/competitors", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Return only user's own competitors for tenant isolation
      const competitors = await storage.getCompetitorsByUserId(req.session.userId);
      res.json(competitors);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/competitors/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Verify ownership for tenant isolation
      if (competitor.userId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(competitor);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/competitors/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      if (competitor.userId !== req.session.userId && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const { linkedInUrl, instagramUrl, name, url, projectId } = req.body;
      const updateData: any = {};
      
      if (linkedInUrl !== undefined) updateData.linkedInUrl = linkedInUrl || null;
      if (instagramUrl !== undefined) updateData.instagramUrl = instagramUrl || null;
      if (name) updateData.name = name;
      if (url) updateData.url = url;

      // Handle projectId changes with security validation
      if (projectId !== undefined) {
        if (projectId === null || projectId === "") {
          updateData.projectId = null;
        } else {
          const project = await storage.getClientProject(projectId);
          if (!project) {
            return res.status(400).json({ error: "Project not found" });
          }

          const tenantDomain = user.email.split("@")[1];
          
          // Security: Verify the project belongs to the user's tenant
          if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
            return res.status(403).json({ error: "Access denied - project belongs to another tenant" });
          }

          // Plan-gating: Only Pro/Enterprise can use projects
          const tenant = await storage.getTenantByDomain(tenantDomain);
          if (!tenant || (tenant.plan !== "professional" && tenant.plan !== "enterprise")) {
            return res.status(403).json({ 
              error: "Client Projects require a Professional or Enterprise plan",
              upgradeRequired: true
            });
          }

          updateData.projectId = projectId;
        }
      }

      const updated = await storage.updateCompetitor(req.params.id, updateData);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/competitors", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { projectId, ...competitorData } = req.body;
      
      // If projectId is provided, validate ownership and plan-gating
      if (projectId) {
        const project = await storage.getClientProject(projectId);
        if (!project) {
          return res.status(400).json({ error: "Project not found" });
        }

        const tenantDomain = user.email.split("@")[1];
        
        // Security: Verify the project belongs to the user's tenant
        if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
          return res.status(403).json({ error: "Access denied - project belongs to another tenant" });
        }

        // Plan-gating: Only Pro/Enterprise can use projects
        const tenant = await storage.getTenantByDomain(tenantDomain);
        if (!tenant || (tenant.plan !== "professional" && tenant.plan !== "enterprise")) {
          return res.status(403).json({ 
            error: "Client Projects require a Professional or Enterprise plan",
            upgradeRequired: true
          });
        }
      }

      const parsed = insertCompetitorSchema.safeParse({
        ...competitorData,
        projectId: projectId || null,
        userId: req.session.userId
      });

      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const competitor = await storage.createCompetitor(parsed.data);
      res.json(competitor);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/competitors/:id/crawl", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Verify ownership for tenant isolation
      if (competitor.userId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Use the robust web crawler service
      const crawlResult = await crawlCompetitorWebsite(competitor.url);
      
      if (crawlResult.pages.length === 0) {
        return res.json({ success: false, message: "Website could not be crawled" });
      }

      // Capture visual assets (favicon and screenshot) in background
      captureVisualAssets(competitor.url, competitor.id).then(async (visualAssets) => {
        if (visualAssets.faviconUrl || visualAssets.screenshotUrl) {
          await storage.updateCompetitor(competitor.id, {
            faviconUrl: visualAssets.faviconUrl,
            screenshotUrl: visualAssets.screenshotUrl,
          });
        }
      }).catch(err => console.error("Visual capture failed:", err));

      const now = new Date();
      const lastCrawl = now.toLocaleString();
      
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
      
      if (Object.keys(socialUpdates).length > 0) {
        await storage.updateCompetitor(competitor.id, socialUpdates);
      }
      
      await storage.updateCompetitorLastCrawl(req.params.id, lastCrawl);
      
      // Get combined content for AI analysis
      const websiteContent = getCombinedContent(crawlResult);
      
      if (websiteContent.length > 100) {
        try {
          const analysis = await analyzeCompetitorWebsite(
            competitor.name,
            competitor.url,
            websiteContent
          );
          
          // Store analysis data on the competitor record
          await storage.updateCompetitorAnalysis(competitor.id, analysis);
          
          // Create activity entry for the crawl
          await storage.createActivity({
            type: "crawl",
            competitorId: competitor.id,
            competitorName: competitor.name,
            description: `Analyzed ${crawlResult.pages.length} pages (${crawlResult.totalWordCount.toLocaleString()} words): ${analysis.summary}`,
            date: lastCrawl,
            impact: "Medium",
          });
          
          res.json({ 
            success: true, 
            lastCrawl, 
            analysis,
            pagesCrawled: crawlResult.pages.length,
            totalWordCount: crawlResult.totalWordCount,
          });
        } catch (aiError) {
          console.error("AI analysis failed:", aiError);
          res.json({ 
            success: true, 
            lastCrawl, 
            message: "Crawled but AI analysis unavailable",
            pagesCrawled: crawlResult.pages.length,
            totalWordCount: crawlResult.totalWordCount,
          });
        }
      } else {
        res.json({ success: true, lastCrawl, message: "Website content could not be extracted" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== SOCIAL MEDIA MONITORING (PREMIUM) ====================

  // Monitor social media for a single competitor (on-demand)
  app.post("/api/competitors/:id/monitor-social", async (req, res) => {
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

      if (!tenant || tenant.plan === "free") {
        return res.status(403).json({ 
          error: "Social media monitoring is a premium feature. Please upgrade your plan.",
          upgradeRequired: true 
        });
      }

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      if (competitor.userId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!competitor.linkedInUrl && !competitor.instagramUrl) {
        return res.status(400).json({ error: "No social media URLs configured for this competitor" });
      }

      const results = await monitorCompetitorSocialMedia(req.params.id, user.id, tenantDomain);
      res.json({ success: true, results });
    } catch (error: any) {
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

      if (tenant.plan === "free") {
        return res.status(403).json({ 
          error: "Social media monitoring settings require a premium plan",
          upgradeRequired: true 
        });
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
  
  // Generate AI analysis for all competitors
  app.post("/api/analysis/generate", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];

      // Get tenant-scoped competitors
      const userCompetitors = await storage.getCompetitorsByUserId(user.id);
      if (userCompetitors.length === 0) {
        return res.status(400).json({ error: "No competitors to analyze. Add competitors first." });
      }

      // Get company profile for "our" positioning
      const companyProfile = await storage.getCompanyProfileByTenant(tenantDomain);
      
      // Get grounding documents for additional context
      const groundingDocs = await storage.getGroundingDocumentsByTenant(tenantDomain);
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

      // Analyze each competitor (crawl fresh or use cached analysis)
      const analyses = [];
      for (const competitor of userCompetitors.slice(0, 5)) {
        try {
          // Use cached analysis if available and recent
          if (competitor.analysisData) {
            analyses.push({ competitor: competitor.name, ...(competitor.analysisData as any) });
            continue;
          }

          // Otherwise crawl fresh
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
            const analysis = await analyzeCompetitorWebsite(
              competitor.name,
              competitor.url,
              content
            );
            // Store analysis on competitor
            await storage.updateCompetitorAnalysis(competitor.id, analysis);
            await storage.updateCompetitorLastCrawl(competitor.id, new Date().toLocaleString());
            analyses.push({ competitor: competitor.name, ...analysis });
          }
        } catch (e) {
          console.error(`Failed to analyze ${competitor.name}:`, e);
        }
      }

      if (analyses.length === 0) {
        return res.status(400).json({ error: "Could not analyze any competitors" });
      }

      // Generate gap analysis using our positioning
      const gaps = await generateGapAnalysis(ourPositioning, analyses);

      // Generate recommendations
      const recommendations = await generateRecommendations(gaps, analyses);

      // Save recommendations to database with tenant scoping
      for (const rec of recommendations) {
        await storage.createRecommendation({
          title: rec.title,
          description: rec.description,
          area: rec.area,
          impact: rec.impact,
          userId: user.id,
          tenantDomain,
        });
      }

      // Get our company's positioning from analysis data if available
      const ourAnalysisData = companyProfile?.analysisData as any;
      const ourSummary = ourAnalysisData?.summary || companyProfile?.description || "Our positioning";
      const ourKeyMessages = ourAnalysisData?.keyMessages || [];

      // Save tenant-scoped analysis
      const savedAnalysis = await storage.createAnalysis({
        userId: user.id,
        tenantDomain,
        themes: analyses.map(a => ({
          theme: a.valueProposition,
          us: companyProfile ? "Based on profile" : "Medium",
          competitorA: "High",
          competitorB: "Medium",
        })),
        messaging: analyses.slice(0, 3).map((a, i) => ({
          category: a.targetAudience || "Market Positioning",
          us: ourKeyMessages[i] || ourSummary,
          competitorA: a.keyMessages[0] || "",
          competitorB: a.keyMessages[1] || "",
        })),
        gaps: gaps,
      });

      res.json({ success: true, analysis: savedAnalysis, recommendations, analyzedCount: analyses.length });
    } catch (error: any) {
      console.error("Analysis generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/competitors/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Verify ownership for tenant isolation
      if (competitor.userId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteCompetitor(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== BATTLECARD ROUTES ====================

  app.get("/api/competitors/:competitorId/battlecard", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Verify user has access (tenant isolation)
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tenantDomain = user.email.split("@")[1];

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Verify competitor belongs to user's tenant
      const competitorUser = await storage.getUser(competitor.userId);
      if (!competitorUser || competitorUser.email.split("@")[1] !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      const battlecard = await storage.getBattlecardByCompetitor(req.params.competitorId);
      res.json(battlecard || null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/competitors/:competitorId/battlecard/generate", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tenantDomain = user.email.split("@")[1];

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Verify competitor belongs to user's tenant
      const competitorUser = await storage.getUser(competitor.userId);
      if (!competitorUser || competitorUser.email.split("@")[1] !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get company profile for comparison
      const companyProfile = await storage.getCompanyProfileByTenant(tenantDomain);
      
      // Get existing analysis data
      const analysisData = competitor.analysisData as any;
      const crawlData = competitor.crawlData as any;

      // Build context for AI
      const competitorContext = {
        name: competitor.name,
        url: competitor.url,
        analysis: analysisData,
        crawlData: crawlData,
      };

      const ourContext = companyProfile ? {
        name: companyProfile.companyName,
        url: companyProfile.websiteUrl,
        analysis: companyProfile.analysisData,
      } : null;

      // Use Claude to generate battlecard content
      const anthropic = new Anthropic();
      const prompt = `You are a competitive intelligence analyst. Generate a comprehensive sales battlecard for competing against "${competitor.name}".

${ourContext ? `Our Company: ${ourContext.name} (${ourContext.url})
Our Analysis: ${JSON.stringify(ourContext.analysis, null, 2)}` : ""}

Competitor: ${competitor.name} (${competitor.url})
Competitor Analysis: ${JSON.stringify(competitorContext.analysis, null, 2)}
Competitor Website Content: ${JSON.stringify(competitorContext.crawlData?.pages?.slice(0, 3), null, 2) || "Not crawled yet"}

Generate a battlecard with the following sections in valid JSON format:
{
  "strengths": ["strength1", "strength2", ...], // 3-5 competitor strengths
  "weaknesses": ["weakness1", "weakness2", ...], // 3-5 competitor weaknesses  
  "ourAdvantages": ["advantage1", "advantage2", ...], // 3-5 ways we beat this competitor
  "objections": [
    {"objection": "Common customer objection", "response": "How to respond"},
    ...
  ], // 3-4 common objections and responses
  "talkTracks": [
    {"scenario": "When customer mentions X", "script": "Say this..."},
    ...
  ], // 2-3 sales talk tracks
  "quickStats": {
    "pricing": "Their pricing model/range if known",
    "marketPosition": "Leader/Challenger/Niche",
    "targetAudience": "Who they target",
    "keyProducts": "Main products/services"
  }
}

Return ONLY valid JSON, no markdown or explanation.`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      let battlecardContent;
      try {
        battlecardContent = JSON.parse(content.text);
      } catch {
        // Try to extract JSON from response
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          battlecardContent = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Failed to parse AI response as JSON");
        }
      }

      // Check if battlecard already exists
      const existingBattlecard = await storage.getBattlecardByCompetitor(req.params.competitorId);
      
      let battlecard;
      if (existingBattlecard) {
        // Update existing
        battlecard = await storage.updateBattlecard(existingBattlecard.id, {
          strengths: battlecardContent.strengths,
          weaknesses: battlecardContent.weaknesses,
          ourAdvantages: battlecardContent.ourAdvantages,
          objections: battlecardContent.objections,
          talkTracks: battlecardContent.talkTracks,
          quickStats: battlecardContent.quickStats,
          lastGeneratedAt: new Date(),
        });
      } else {
        // Create new
        battlecard = await storage.createBattlecard({
          competitorId: req.params.competitorId,
          tenantDomain,
          strengths: battlecardContent.strengths,
          weaknesses: battlecardContent.weaknesses,
          ourAdvantages: battlecardContent.ourAdvantages,
          objections: battlecardContent.objections,
          talkTracks: battlecardContent.talkTracks,
          quickStats: battlecardContent.quickStats,
          status: "draft",
          createdBy: req.session.userId,
        });
      }

      res.json(battlecard);
    } catch (error: any) {
      console.error("Battlecard generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/battlecards/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const battlecard = await storage.getBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battlecard not found" });
      }

      // Verify user has access (belongs to their tenant)
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tenantDomain = user.email.split("@")[1];
      
      if (battlecard.tenantDomain !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { strengths, weaknesses, ourAdvantages, objections, talkTracks, quickStats, customNotes, status } = req.body;
      
      const updatedBattlecard = await storage.updateBattlecard(req.params.id, {
        ...(strengths !== undefined && { strengths }),
        ...(weaknesses !== undefined && { weaknesses }),
        ...(ourAdvantages !== undefined && { ourAdvantages }),
        ...(objections !== undefined && { objections }),
        ...(talkTracks !== undefined && { talkTracks }),
        ...(quickStats !== undefined && { quickStats }),
        ...(customNotes !== undefined && { customNotes }),
        ...(status !== undefined && { status }),
      });

      res.json(updatedBattlecard);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/battlecards/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const battlecard = await storage.getBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battlecard not found" });
      }

      // Verify user has access
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tenantDomain = user.email.split("@")[1];
      
      if (battlecard.tenantDomain !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteBattlecard(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ACTIVITY ROUTES ====================

  app.get("/api/activity", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Get user's tenant domain for tenant scoping
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tenantDomain = user.email.split("@")[1];

      const activities = await storage.getActivityByTenant(tenantDomain);
      res.json(activities);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/activity", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Get user's tenant domain for tenant scoping
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tenantDomain = user.email.split("@")[1];

      const parsed = insertActivitySchema.safeParse({
        ...req.body,
        userId: req.session.userId,
        tenantDomain
      });
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const newActivity = await storage.createActivity(parsed.data);
      res.json(newActivity);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== RECOMMENDATION ROUTES ====================

  app.get("/api/recommendations", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Get user's tenant domain for tenant scoping
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tenantDomain = user.email.split("@")[1];

      const recommendations = await storage.getRecommendationsByTenant(tenantDomain);
      res.json(recommendations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/recommendations", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Get user's tenant domain for tenant scoping
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tenantDomain = user.email.split("@")[1];

      const parsed = insertRecommendationSchema.safeParse({
        ...req.body,
        userId: req.session.userId,
        tenantDomain
      });
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const recommendation = await storage.createRecommendation(parsed.data);
      res.json(recommendation);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== REPORT ROUTES ====================

  app.get("/api/reports", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const reports = await storage.getReportsByTenant(tenantDomain);
      res.json(reports);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/reports", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const { scope, projectId, name } = req.body;

      // Validate scope
      if (scope && !["baseline", "project"].includes(scope)) {
        return res.status(400).json({ error: "Invalid scope. Must be 'baseline' or 'project'" });
      }

      // If project scope, validate project access (owner or Global Admin only)
      if (scope === "project") {
        if (!projectId) {
          return res.status(400).json({ error: "Project ID is required for project scope" });
        }
        const project = await storage.getClientProject(projectId);
        if (!project) {
          return res.status(404).json({ error: "Project not found" });
        }
        // Require project owner or Global Admin for project-scoped reports
        const isOwner = project.ownerUserId === req.session.userId;
        const isGlobalAdmin = user.role === "Global Admin";
        const isTenantMember = project.tenantDomain === tenantDomain;
        if (!isTenantMember || (!isOwner && !isGlobalAdmin)) {
          return res.status(403).json({ error: "Access denied. Only project owners can generate project reports." });
        }
      }

      const reportData = {
        name: name || `Report - ${new Date().toLocaleDateString()}`,
        date: new Date().toLocaleDateString(),
        type: "PDF",
        size: "Generating...",
        author: user.name || user.email,
        status: "Generating",
        scope: scope || "baseline",
        projectId: scope === "project" ? projectId : null,
        tenantDomain,
        createdBy: req.session.userId,
      };

      const parsed = insertReportSchema.safeParse(reportData);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const report = await storage.createReport(parsed.data);
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ANALYSIS ROUTES ====================

  app.get("/api/analysis", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const tenantAnalysis = await storage.getLatestAnalysisByTenant(tenantDomain);
      res.json(tenantAnalysis || null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/analysis", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Get user's tenant domain for tenant scoping
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const tenantDomain = user.email.split("@")[1];

      const parsed = insertAnalysisSchema.safeParse({
        ...req.body,
        userId: req.session.userId,
        tenantDomain
      });
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const analysis = await storage.createAnalysis(parsed.data);
      res.json(analysis);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== USER MANAGEMENT ROUTES ====================

  app.get("/api/users", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser || (currentUser.role !== "Global Admin" && currentUser.role !== "Domain Admin")) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      const users = await storage.getAllUsers();
      const usersWithoutPasswords = users.map(({ password, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== GROUNDING DOCUMENTS ROUTES ====================

  app.get("/api/documents", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const documents = await storage.getGroundingDocumentsByTenant(tenantDomain);
      res.json(documents);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/documents/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const document = await storage.getGroundingDocument(req.params.id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (document.tenantDomain !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(document);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      
      const parsed = insertGroundingDocumentSchema.safeParse({
        ...req.body,
        userId: req.session.userId,
        tenantDomain,
      });

      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const document = await storage.createGroundingDocument(parsed.data);

      // Extract text asynchronously
      if (document.fileUrl && document.fileType) {
        documentExtractionService
          .extractTextFromDocument(document.fileUrl, document.fileType)
          .then(async (extractedText) => {
            await storage.updateGroundingDocumentText(document.id, extractedText);
          })
          .catch((err) => {
            console.error(`Failed to extract text from document ${document.id}:`, err);
          });
      }

      res.json(document);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/documents/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const document = await storage.getGroundingDocument(req.params.id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (document.tenantDomain !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteGroundingDocument(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get grounding context for AI prompts
  app.get("/api/documents/context/ai", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const documents = await storage.getGroundingDocumentsByTenant(tenantDomain);

      const context = documentExtractionService.prepareGroundingContext(
        documents.map((d) => ({
          name: d.name,
          extractedText: d.extractedText,
          scope: d.scope,
        }))
      );

      res.json({ context });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== COMPANY PROFILE ROUTES (Baseline Own Website) ====================

  // Get company profile for current tenant
  app.get("/api/company-profile", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const profile = await storage.getCompanyProfileByTenant(tenantDomain);
      
      res.json(profile || null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create or update company profile
  app.post("/api/company-profile", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      
      // Validate input
      const parsed = insertCompanyProfileSchema.safeParse({
        ...req.body,
        userId: user.id,
        tenantDomain,
      });
      
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const { companyName, websiteUrl, description, linkedInUrl, instagramUrl } = parsed.data;

      const existingProfile = await storage.getCompanyProfileByTenant(tenantDomain);

      if (existingProfile) {
        const updated = await storage.updateCompanyProfile(existingProfile.id, {
          companyName,
          websiteUrl,
          linkedInUrl: linkedInUrl || null,
          instagramUrl: instagramUrl || null,
          description,
        });
        res.json(updated);
      } else {
        const profile = await storage.createCompanyProfile({
          userId: user.id,
          tenantDomain,
          companyName,
          websiteUrl,
          linkedInUrl: linkedInUrl || null,
          instagramUrl: instagramUrl || null,
          description,
        });
        res.json(profile);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Analyze company website (baseline)
  app.post("/api/company-profile/analyze", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const profile = await storage.getCompanyProfileByTenant(tenantDomain);

      if (!profile) {
        return res.status(404).json({ error: "Company profile not found. Please set up your company profile first." });
      }

      // Fetch website content
      let websiteContent = "";
      let rawHtml = "";
      try {
        const response = await fetch(profile.websiteUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; OrbitBot/1.0; +https://orbit.synozur.com)",
          },
        });
        rawHtml = await response.text();
        
        // Extract social media links from raw HTML before cleaning
        const linkedInMatch = rawHtml.match(/href=["'](https?:\/\/(www\.)?linkedin\.com\/company\/[^"']+)["']/i);
        const instagramMatch = rawHtml.match(/href=["'](https?:\/\/(www\.)?instagram\.com\/[^"']+)["']/i);
        
        const discoveredLinkedIn = linkedInMatch ? linkedInMatch[1] : null;
        const discoveredInstagram = instagramMatch ? instagramMatch[1] : null;
        
        // Update social links only if not already set
        if ((discoveredLinkedIn && !profile.linkedInUrl) || (discoveredInstagram && !profile.instagramUrl)) {
          const socialUpdates: any = {};
          if (discoveredLinkedIn && !profile.linkedInUrl) {
            socialUpdates.linkedInUrl = discoveredLinkedIn;
          }
          if (discoveredInstagram && !profile.instagramUrl) {
            socialUpdates.instagramUrl = discoveredInstagram;
          }
          await storage.updateCompanyProfile(profile.id, socialUpdates);
        }
        
        // Extract text content from HTML (basic extraction)
        websiteContent = rawHtml
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      } catch (fetchError) {
        console.error("Failed to fetch website:", fetchError);
        return res.status(400).json({ error: "Could not fetch website content. Please check the URL." });
      }

      // Use the same AI analysis service as competitors
      const analysisResult = await analyzeCompetitorWebsite(profile.companyName, profile.websiteUrl, websiteContent);

      // Update profile with analysis data
      const updated = await storage.updateCompanyProfile(profile.id, {
        lastAnalysis: new Date(),
        analysisData: analysisResult,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete company profile
  app.delete("/api/company-profile", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const profile = await storage.getCompanyProfileByTenant(tenantDomain);

      if (!profile) {
        return res.status(404).json({ error: "Company profile not found" });
      }

      await storage.deleteCompanyProfile(profile.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ASSESSMENT ROUTES (Snapshots & Proxy) ====================

  // Get all assessments for current tenant
  app.get("/api/assessments", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const assessments = await storage.getAssessmentsByTenant(tenantDomain);
      res.json(assessments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single assessment
  app.get("/api/assessments/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const assessment = await storage.getAssessment(req.params.id);
      if (!assessment) {
        return res.status(404).json({ error: "Assessment not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (assessment.tenantDomain !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(assessment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create new assessment (snapshot current state)
  app.post("/api/assessments", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      
      // Gather current state for snapshot (tenant-scoped)
      // Only capture user's own competitors for tenant isolation
      const competitors = await storage.getCompetitorsByUserId(user.id);
      // Note: Analysis and recommendations tables are not yet tenant-scoped
      // Capturing empty objects/arrays until these are refactored for multi-tenancy
      // to prevent cross-tenant data leakage
      const latestAnalysis = { themes: [], messaging: [], gaps: [] };
      const recommendations: any[] = [];
      const companyProfile = await storage.getCompanyProfileByTenant(tenantDomain);

      // Validate input with proxy fields
      const parsed = insertAssessmentSchema.safeParse({
        name: req.body.name,
        description: req.body.description,
        userId: user.id,
        tenantDomain,
        companyProfileSnapshot: companyProfile || null,
        competitorsSnapshot: competitors,
        analysisSnapshot: latestAnalysis || {},
        recommendationsSnapshot: recommendations,
        isProxy: req.body.isProxy || false,
        proxyName: req.body.proxyName,
        proxyCompany: req.body.proxyCompany,
        proxyJobTitle: req.body.proxyJobTitle,
        proxyIndustry: req.body.proxyIndustry,
        proxyCompanySize: req.body.proxyCompanySize,
        proxyCountry: req.body.proxyCountry,
      });

      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      // Only admins can create proxy assessments
      if (parsed.data.isProxy && user.role === "Standard User") {
        return res.status(403).json({ error: "Only admins can create proxy assessments" });
      }

      const assessment = await storage.createAssessment(parsed.data);
      res.json(assessment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update assessment
  app.put("/api/assessments/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const assessment = await storage.getAssessment(req.params.id);
      if (!assessment) {
        return res.status(404).json({ error: "Assessment not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (assessment.tenantDomain !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateAssessment(req.params.id, {
        name: req.body.name,
        description: req.body.description,
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete assessment
  app.delete("/api/assessments/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const assessment = await storage.getAssessment(req.params.id);
      if (!assessment) {
        return res.status(404).json({ error: "Assessment not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (assessment.tenantDomain !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteAssessment(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Compare two assessments
  app.get("/api/assessments/compare/:id1/:id2", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];

      const assessment1 = await storage.getAssessment(req.params.id1);
      const assessment2 = await storage.getAssessment(req.params.id2);

      if (!assessment1 || !assessment2) {
        return res.status(404).json({ error: "One or both assessments not found" });
      }

      if (assessment1.tenantDomain !== tenantDomain || assessment2.tenantDomain !== tenantDomain) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json({
        assessment1,
        assessment2,
        comparison: {
          timeDiff: new Date(assessment2.createdAt).getTime() - new Date(assessment1.createdAt).getTime(),
          competitorCountChange: (assessment2.competitorsSnapshot as any[]).length - (assessment1.competitorsSnapshot as any[]).length,
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== TENANT MANAGEMENT ROUTES (Global Admin Only) ====================

  app.get("/api/tenants", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const tenantsWithCounts = await storage.getTenantsWithUserCounts();
      res.json(tenantsWithCounts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tenants/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const tenant = await storage.getTenant(req.params.id);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const users = await storage.getUsersByDomain(tenant.domain);
      res.json({ ...tenant, users });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/tenants/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const validPlans = ["free", "pro", "enterprise"];
      const validStatuses = ["active", "suspended"];
      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      
      const { plan, status, competitorLimit, analysisLimit, name, logoUrl, faviconUrl, primaryColor, secondaryColor } = req.body;
      const updateData: { plan?: string; status?: string; competitorLimit?: number; analysisLimit?: number; name?: string; logoUrl?: string | null; faviconUrl?: string | null; primaryColor?: string; secondaryColor?: string } = {};
      
      if (plan && validPlans.includes(plan)) updateData.plan = plan;
      if (status && validStatuses.includes(status)) updateData.status = status;
      if (typeof competitorLimit === "number" && competitorLimit >= 0) updateData.competitorLimit = competitorLimit;
      if (typeof analysisLimit === "number" && analysisLimit >= 0) updateData.analysisLimit = analysisLimit;
      if (name && typeof name === "string" && name.trim()) updateData.name = name.trim();
      if (logoUrl !== undefined) updateData.logoUrl = logoUrl || null;
      if (faviconUrl !== undefined) updateData.faviconUrl = faviconUrl || null;
      if (primaryColor && hexColorRegex.test(primaryColor)) updateData.primaryColor = primaryColor;
      if (secondaryColor && hexColorRegex.test(secondaryColor)) updateData.secondaryColor = secondaryColor;

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const updated = await storage.updateTenant(req.params.id, updateData);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tenants/:id/users", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const tenant = await storage.getTenant(req.params.id);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const users = await storage.getUsersByDomain(tenant.domain);
      res.json(users.map(u => {
        const { password: _, ...userWithoutPassword } = u;
        return userWithoutPassword;
      }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create tenant manually (Global Admin only)
  app.post("/api/tenants", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const { domain, name, plan, competitorLimit, analysisLimit, primaryColor, secondaryColor } = req.body;
      
      if (!domain || typeof domain !== "string" || !domain.includes(".")) {
        return res.status(400).json({ error: "Valid domain is required (e.g., 'acme.com')" });
      }
      
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Company name is required" });
      }

      const normalizedDomain = domain.toLowerCase().trim();
      
      // Check if tenant already exists
      const existing = await storage.getTenantByDomain(normalizedDomain);
      if (existing) {
        return res.status(400).json({ error: "Tenant already exists for this domain" });
      }

      const tenant = await storage.createTenant({
        domain: normalizedDomain,
        name: name.trim(),
        plan: plan || "trial",
        status: "active",
        userCount: 0,
        competitorLimit: competitorLimit || 3,
        analysisLimit: analysisLimit || 5,
        primaryColor: primaryColor || "#810FFB",
        secondaryColor: secondaryColor || "#E60CB3",
      });

      res.status(201).json(tenant);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== DOMAIN BLOCKLIST (Global Admin) ====================

  // Get all blocked domains
  app.get("/api/admin/domain-blocklist", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const blocklist = await storage.getDomainBlocklist();
      res.json(blocklist);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add domain to blocklist
  app.post("/api/admin/domain-blocklist", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const { domain, reason } = req.body;
      
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ error: "Domain is required" });
      }

      const normalizedDomain = domain.toLowerCase().trim();
      
      // Check if already blocked
      const isBlocked = await storage.isdomainBlocked(normalizedDomain);
      if (isBlocked) {
        return res.status(400).json({ error: "Domain is already blocked" });
      }

      const entry = await storage.addBlockedDomain({
        domain: normalizedDomain,
        reason: reason || null,
        createdBy: user.id,
      });

      res.status(201).json(entry);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove domain from blocklist
  app.delete("/api/admin/domain-blocklist/:domain", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const domain = req.params.domain.toLowerCase();
      await storage.removeBlockedDomain(domain);
      res.json({ success: true, message: `Domain ${domain} removed from blocklist` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CLIENT PROJECTS (Pro/Enterprise only) ====================
  
  // Get all client projects for current tenant
  app.get("/api/projects", async (req, res) => {
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
      
      // Plan-gating: only Pro and Enterprise tenants can use client projects
      if (!tenant || (tenant.plan !== "professional" && tenant.plan !== "enterprise")) {
        return res.status(403).json({ 
          error: "Client Projects require a Professional or Enterprise plan",
          upgradeRequired: true
        });
      }

      const projects = await storage.getClientProjectsByTenant(tenantDomain);
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single client project with its competitors
  app.get("/api/projects/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Verify tenant ownership
      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get associated competitors
      const projectCompetitors = await storage.getCompetitorsByProject(project.id);

      res.json({ ...project, competitors: projectCompetitors });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create client project
  app.post("/api/projects", async (req, res) => {
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
      
      // Plan-gating
      if (!tenant || (tenant.plan !== "professional" && tenant.plan !== "enterprise")) {
        return res.status(403).json({ 
          error: "Client Projects require a Professional or Enterprise plan",
          upgradeRequired: true
        });
      }

      const { name, clientName, clientDomain, description, analysisType, notifyOnUpdates } = req.body;
      
      if (!name || !clientName) {
        return res.status(400).json({ error: "Project name and client name are required" });
      }

      const project = await storage.createClientProject({
        name: name.trim(),
        clientName: clientName.trim(),
        clientDomain: clientDomain?.trim().toLowerCase() || null,
        description: description?.trim() || null,
        analysisType: analysisType === "product" ? "product" : "company",
        notifyOnUpdates: notifyOnUpdates === true,
        status: "active",
        tenantDomain,
        ownerUserId: user.id,
      });

      res.status(201).json(project);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update client project
  app.patch("/api/projects/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Verify tenant ownership
      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const { name, clientName, clientDomain, description, status } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (clientName !== undefined) updates.clientName = clientName.trim();
      if (clientDomain !== undefined) updates.clientDomain = clientDomain?.trim().toLowerCase() || null;
      if (description !== undefined) updates.description = description?.trim() || null;
      if (status !== undefined && ["active", "completed", "archived"].includes(status)) {
        updates.status = status;
      }

      const updated = await storage.updateClientProject(req.params.id, updates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete client project (cascades to unlink competitors)
  app.delete("/api/projects/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Verify tenant ownership or admin
      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      // Only owner or admin can delete
      if (project.ownerUserId !== user.id && user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Only project owner or admin can delete" });
      }

      await storage.deleteClientProject(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Assign competitor to project
  app.post("/api/projects/:projectId/competitors/:competitorId", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Verify tenant ownership
      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Update competitor with project ID
      const updated = await storage.updateCompetitor(req.params.competitorId, {
        projectId: req.params.projectId,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove competitor from project
  app.delete("/api/projects/:projectId/competitors/:competitorId", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      // Unlink competitor from project
      await storage.updateCompetitor(req.params.competitorId, { projectId: null });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== PRODUCT MANAGEMENT ====================

  // Get all products for tenant
  app.get("/api/products", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const products = await storage.getProductsByTenant(tenantDomain);
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single product
  app.get("/api/products/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (product.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create product
  app.post("/api/products", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const { name, description, url, companyName, competitorId } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Product name is required" });
      }

      const product = await storage.createProduct({
        name,
        description,
        url,
        companyName,
        competitorId,
        tenantDomain,
        createdBy: req.session.userId,
      });

      res.json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update product
  app.patch("/api/products/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (product.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateProduct(req.params.id, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete product
  app.delete("/api/products/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (product.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteProduct(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get products for a project
  app.get("/api/projects/:projectId/products", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const products = await storage.getProjectProducts(req.params.projectId);
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add product to project
  app.post("/api/projects/:projectId/products", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const { productId, role, source } = req.body;
      if (!productId) {
        return res.status(400).json({ error: "Product ID is required" });
      }

      const result = await storage.addProductToProject({
        projectId: req.params.projectId,
        productId,
        role: role || "competitor",
        source: source || "manual",
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update product role in project (with single baseline enforcement)
  app.patch("/api/projects/:projectId/products/:productId", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const { role } = req.body;
      if (!role) {
        return res.status(400).json({ error: "Role is required" });
      }

      // If setting as baseline, clear any existing baselines first (server-side enforcement)
      if (role === "baseline") {
        const existingProducts = await storage.getProjectProducts(req.params.projectId);
        for (const pp of existingProducts) {
          if (pp.role === "baseline" && pp.productId !== req.params.productId) {
            await storage.updateProjectProductRole(req.params.projectId, pp.productId, "competitor");
          }
        }
      }

      await storage.updateProjectProductRole(req.params.projectId, req.params.productId, role);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove product from project
  app.delete("/api/projects/:projectId/products/:productId", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.removeProductFromProject(req.params.projectId, req.params.productId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI-suggest competitor products for a baseline product
  app.post("/api/products/:productId/suggest-competitors", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const product = await storage.getProduct(req.params.productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (product.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      // Use AI service to suggest competitor products
      const prompt = `Analyze this product and suggest 5 competing products in the market:

Product: ${product.name}
Company: ${product.companyName || "Unknown"}
Description: ${product.description || "No description provided"}
URL: ${product.url || "No URL"}

Return a JSON array of suggested competitor products with this structure:
[
  {
    "name": "Competitor Product Name",
    "companyName": "Company that makes it",
    "description": "Brief description of the product",
    "url": "Product page URL if known",
    "rationale": "Why this is a competitor"
  }
]

Only return the JSON array, no other text.`;

      const anthropic = new Anthropic();
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      let suggestions: any[] = [];
      try {
        // Try to parse the AI response as JSON
        const responseText = message.content[0].type === "text" ? message.content[0].text : "";
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          suggestions = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        // If parsing fails, return empty suggestions
        console.error("Failed to parse AI suggestions:", e);
      }

      res.json(suggestions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== TENANT ADMIN - TEAM MANAGEMENT ====================

  // Get team members for current tenant (Domain Admin or Global Admin)
  app.get("/api/team/members", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Only Domain Admin or Global Admin can view team
      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const domain = user.email.split("@")[1];
      const members = await storage.getUsersByDomain(domain);
      
      res.json(members.map(u => {
        const { password: _, ...userWithoutPassword } = u;
        return userWithoutPassword;
      }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update team member role (Domain Admin or Global Admin)
  app.patch("/api/team/members/:userId/role", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (currentUser.role !== "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({ error: "Target user not found" });
      }

      // Verify same domain (unless Global Admin)
      const currentDomain = currentUser.email.split("@")[1];
      const targetDomain = targetUser.email.split("@")[1];
      if (currentUser.role !== "Global Admin" && currentDomain !== targetDomain) {
        return res.status(403).json({ error: "Cannot modify users from another tenant" });
      }

      const { role } = req.body;
      const validRoles = ["Standard User", "Domain Admin"];
      if (!role || !validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role. Must be 'Standard User' or 'Domain Admin'" });
      }

      // Cannot demote self
      if (targetUser.id === currentUser.id && role !== currentUser.role) {
        return res.status(400).json({ error: "Cannot change your own role" });
      }

      // Cannot promote to Global Admin (only via database)
      if (role === "Global Admin") {
        return res.status(400).json({ error: "Cannot promote to Global Admin" });
      }

      const updated = await storage.updateUser(req.params.userId, { role });
      const { password: _, ...userWithoutPassword } = updated;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove team member (Domain Admin or Global Admin)
  app.delete("/api/team/members/:userId", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (currentUser.role !== "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({ error: "Target user not found" });
      }

      // Cannot delete self
      if (targetUser.id === currentUser.id) {
        return res.status(400).json({ error: "Cannot remove yourself" });
      }

      // Verify same domain (unless Global Admin)
      const currentDomain = currentUser.email.split("@")[1];
      const targetDomain = targetUser.email.split("@")[1];
      if (currentUser.role !== "Global Admin" && currentDomain !== targetDomain) {
        return res.status(403).json({ error: "Cannot remove users from another tenant" });
      }

      // Cannot remove Domain Admin (must demote first)
      if (targetUser.role === "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(400).json({ error: "Cannot remove Domain Admin. Demote first." });
      }

      await storage.deleteUser(req.params.userId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== TENANT ADMIN - INVITATIONS ====================

  // Get pending invites for current tenant
  app.get("/api/team/invites", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const domain = user.email.split("@")[1];
      const invites = await storage.getTenantInvitesByDomain(domain);
      res.json(invites);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Send team invite
  app.post("/api/team/invites", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const { email, role } = req.body;
      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "Valid email required" });
      }

      const domain = user.email.split("@")[1];
      const inviteeDomain = email.split("@")[1];
      
      // Must invite users to same domain
      if (inviteeDomain !== domain) {
        return res.status(400).json({ error: `Invitees must have an @${domain} email address` });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
      }

      // Check for existing pending invite
      const existingInvites = await storage.getTenantInvitesByDomain(domain);
      const pendingInvite = existingInvites.find(i => i.email === email && i.status === "pending");
      if (pendingInvite) {
        return res.status(400).json({ error: "Invite already pending for this email" });
      }

      const validRoles = ["Standard User", "Domain Admin"];
      const invitedRole = validRoles.includes(role) ? role : "Standard User";

      // Check user role limits
      const tenant = await storage.getTenantByDomain(domain);
      if (tenant) {
        const tenantUsers = await storage.getUsersByDomain(domain);
        const adminUserLimit = (tenant as any).adminUserLimit ?? 1;
        const readWriteUserLimit = (tenant as any).readWriteUserLimit ?? 2;
        const readOnlyUserLimit = (tenant as any).readOnlyUserLimit ?? 5;
        
        // Count existing users by role
        const adminCount = tenantUsers.filter(u => u.role === "Domain Admin" || u.role === "Global Admin").length;
        const standardCount = tenantUsers.filter(u => u.role === "Standard User").length;
        
        // Also count pending invites
        const pendingInvites = existingInvites.filter(i => i.status === "pending");
        const pendingAdmins = pendingInvites.filter(i => i.invitedRole === "Domain Admin").length;
        const pendingStandard = pendingInvites.filter(i => i.invitedRole === "Standard User").length;
        
        if (invitedRole === "Domain Admin") {
          if (adminCount + pendingAdmins >= adminUserLimit) {
            return res.status(400).json({ 
              error: `Admin user limit (${adminUserLimit}) reached for this tenant. Upgrade your plan to add more admin users.` 
            });
          }
        } else {
          // Standard User - check read-write limit (Standard Users are read-write by default)
          if (standardCount + pendingStandard >= readWriteUserLimit) {
            return res.status(400).json({ 
              error: `Read-write user limit (${readWriteUserLimit}) reached for this tenant. Upgrade your plan to add more users.` 
            });
          }
        }
      }

      // Generate token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invite = await storage.createTenantInvite({
        token,
        email,
        tenantDomain: domain,
        invitedRole,
        invitedBy: user.id,
        status: "pending",
        expiresAt,
      });

      // TODO: Send invite email with token link
      // For now, return the invite with token for testing
      res.json({ ...invite, inviteLink: `/auth/accept-invite?token=${token}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Revoke invite
  app.delete("/api/team/invites/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const invite = await storage.getTenantInvite(req.params.id);
      if (!invite) {
        return res.status(404).json({ error: "Invite not found" });
      }

      const domain = user.email.split("@")[1];
      if (invite.tenantDomain !== domain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Cannot revoke invites from another tenant" });
      }

      await storage.updateTenantInvite(req.params.id, { status: "revoked" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Accept invite (public endpoint for invitee)
  app.post("/api/team/invites/accept", async (req, res) => {
    try {
      const { token, password, name } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token required" });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Name required" });
      }

      const invite = await storage.getTenantInviteByToken(token);
      if (!invite) {
        return res.status(404).json({ error: "Invite not found" });
      }

      if (invite.status !== "pending") {
        return res.status(400).json({ error: "Invite is no longer valid" });
      }

      if (new Date() > new Date(invite.expiresAt)) {
        await storage.updateTenantInvite(invite.id, { status: "expired" });
        return res.status(400).json({ error: "Invite has expired" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(invite.email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists" });
      }

      // Get tenant info
      const tenant = await storage.getTenantByDomain(invite.tenantDomain);
      if (!tenant) {
        return res.status(400).json({ error: "Tenant not found" });
      }

      // Re-check user role limits at acceptance time (limits may have changed since invite)
      const tenantUsers = await storage.getUsersByDomain(invite.tenantDomain);
      const adminUserLimit = (tenant as any).adminUserLimit ?? 1;
      const readWriteUserLimit = (tenant as any).readWriteUserLimit ?? 2;
      
      const adminCount = tenantUsers.filter(u => u.role === "Domain Admin" || u.role === "Global Admin").length;
      const standardCount = tenantUsers.filter(u => u.role === "Standard User").length;
      
      if (invite.invitedRole === "Domain Admin") {
        if (adminCount >= adminUserLimit) {
          return res.status(400).json({ 
            error: `Admin user limit (${adminUserLimit}) reached. Contact your administrator.` 
          });
        }
      } else {
        if (standardCount >= readWriteUserLimit) {
          return res.status(400).json({ 
            error: `User limit (${readWriteUserLimit}) reached. Contact your administrator.` 
          });
        }
      }

      // Hash password and create user
      const hashedPassword = await bcrypt.hash(password, 10);
      const avatar = name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

      const newUser = await storage.createUser({
        email: invite.email,
        password: hashedPassword,
        name: name.trim(),
        role: invite.invitedRole,
        company: tenant.name,
        companySize: "",
        jobTitle: "",
        industry: "",
        country: "",
        avatar,
        emailVerified: true,
        status: "active",
      });

      // Mark invite as accepted
      await storage.updateTenantInvite(invite.id, { 
        status: "accepted",
        acceptedAt: new Date(),
      });

      // Update tenant user count
      await storage.updateTenant(tenant.id, { 
        userCount: tenant.userCount + 1 
      });

      // Set session
      req.session.userId = newUser.id;

      const { password: _, ...userWithoutPassword } = newUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== TENANT ADMIN - SETTINGS ====================

  // Get current tenant settings (Domain Admin or Global Admin)
  app.get("/api/tenant/settings", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const domain = user.email.split("@")[1];
      const tenant = await storage.getTenantByDomain(domain);
      
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      res.json(tenant);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update tenant settings (Domain Admin or Global Admin)
  app.patch("/api/tenant/settings", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const domain = user.email.split("@")[1];
      const tenant = await storage.getTenantByDomain(domain);
      
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      const validFrequencies = ["daily", "weekly", "disabled"];
      
      const { name, logoUrl, faviconUrl, primaryColor, secondaryColor, monitoringFrequency } = req.body;
      const updateData: Record<string, any> = {};
      
      if (name && typeof name === "string" && name.trim()) {
        updateData.name = name.trim();
      }
      if (logoUrl !== undefined) {
        updateData.logoUrl = logoUrl || null;
      }
      if (faviconUrl !== undefined) {
        updateData.faviconUrl = faviconUrl || null;
      }
      if (primaryColor && hexColorRegex.test(primaryColor)) {
        updateData.primaryColor = primaryColor;
      }
      if (secondaryColor && hexColorRegex.test(secondaryColor)) {
        updateData.secondaryColor = secondaryColor;
      }
      if (monitoringFrequency && validFrequencies.includes(monitoringFrequency)) {
        updateData.monitoringFrequency = monitoringFrequency;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const updated = await storage.updateTenant(tenant.id, updateData);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== SCHEDULED JOBS (GLOBAL ADMIN) ====================

  app.get("/api/admin/jobs/status", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const status = getJobStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/jobs/trigger-crawl", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      triggerWebsiteCrawlNow();
      res.json({ success: true, message: "Website crawl job triggered" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/jobs/trigger-social", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      triggerSocialMonitorNow();
      res.json({ success: true, message: "Social monitor job triggered" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
