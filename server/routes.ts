import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import bcrypt from "bcrypt";
import { insertUserSchema, insertCompetitorSchema, insertActivitySchema, insertRecommendationSchema, insertReportSchema, insertAnalysisSchema, insertGroundingDocumentSchema, insertCompanyProfileSchema, insertAssessmentSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";
import { analyzeCompetitorWebsite, generateGapAnalysis, generateRecommendations } from "./ai-service";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { documentExtractionService } from "./services/document-extraction";
import { registerEntraRoutes } from "./auth/entra-routes";

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
      const domain = email.split("@")[1];
      
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
          plan: "free",
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

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      if (competitor.userId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { linkedInUrl, instagramUrl, name, url } = req.body;
      const updateData: any = {};
      
      if (linkedInUrl !== undefined) updateData.linkedInUrl = linkedInUrl || null;
      if (instagramUrl !== undefined) updateData.instagramUrl = instagramUrl || null;
      if (name) updateData.name = name;
      if (url) updateData.url = url;

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

      const parsed = insertCompetitorSchema.safeParse({
        ...req.body,
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

      // Fetch website content
      let websiteContent = "";
      let rawHtml = "";
      try {
        const response = await fetch(competitor.url, {
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
        if ((discoveredLinkedIn && !competitor.linkedInUrl) || (discoveredInstagram && !competitor.instagramUrl)) {
          const socialUpdates: any = {};
          if (discoveredLinkedIn && !competitor.linkedInUrl) {
            socialUpdates.linkedInUrl = discoveredLinkedIn;
          }
          if (discoveredInstagram && !competitor.instagramUrl) {
            socialUpdates.instagramUrl = discoveredInstagram;
          }
          await storage.updateCompetitor(competitor.id, socialUpdates);
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
      }

      const now = new Date();
      const lastCrawl = now.toLocaleString();
      
      await storage.updateCompetitorLastCrawl(req.params.id, lastCrawl);
      
      // If we have content, analyze it with AI
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
            description: `${analysis.summary}`,
            date: lastCrawl,
            impact: "Medium",
          });
          
          res.json({ success: true, lastCrawl, analysis });
        } catch (aiError) {
          console.error("AI analysis failed:", aiError);
          res.json({ success: true, lastCrawl, message: "Crawled but AI analysis unavailable" });
        }
      } else {
        res.json({ success: true, lastCrawl, message: "Website content could not be fetched" });
      }
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

      // Save recommendations to database
      for (const rec of recommendations) {
        await storage.createRecommendation({
          title: rec.title,
          description: rec.description,
          area: rec.area,
          impact: rec.impact,
        });
      }

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
        messaging: analyses.slice(0, 3).map(a => ({
          category: a.targetAudience,
          us: companyProfile?.description?.slice(0, 100) || "Our messaging",
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

      const reports = await storage.getAllReports();
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

      const parsed = insertReportSchema.safeParse(req.body);
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

  return httpServer;
}
