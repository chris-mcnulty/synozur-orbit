import type { Express } from "express";
import { createServer, type Server } from "http";
import { createHash, randomBytes, randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import fileUpload, { UploadedFile } from "express-fileupload";
import { storage, type ContextFilter } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { objectStorageClient } from "./replit_integrations/object_storage/objectStorage";
import { getRequestContext, type RequestContext, ContextError } from "./context";
import bcrypt from "bcrypt";
import { insertUserSchema, insertCompetitorSchema, insertActivitySchema, insertRecommendationSchema, insertReportSchema, insertAnalysisSchema, insertGroundingDocumentSchema, insertCompanyProfileSchema, insertAssessmentSchema, Competitor, User } from "@shared/schema";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { analyzeCompetitorWebsite, generateGapAnalysis, generateRecommendations, generateRoadmapRecommendations, type CompetitorAnalysis, type LinkedInContext } from "./ai-service";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { documentExtractionService } from "./services/document-extraction";
import { registerEntraRoutes } from "./auth/entra-routes";
import { monitorCompetitorSocialMedia, monitorAllCompetitorsForTenant } from "./services/social-monitoring";
import { monitorCompetitorWebsite, monitorCompanyProfileWebsite, monitorAllCompetitorsForTenant as monitorAllWebsitesForTenant } from "./services/website-monitoring";
import { crawlCompetitorWebsite, getCombinedContent } from "./services/web-crawler";
import { captureVisualAssets } from "./services/visual-capture";
import { getJobStatus, triggerWebsiteCrawlNow, triggerSocialMonitorNow, invalidateMarketStatusCache } from "./services/scheduled-jobs";
import { syncNewAccountToHubSpot } from "./services/hubspot-service";
import { startFullRegeneration, getRegenerationStatus } from "./services/full-regeneration-service";
import { calculateScores, calculateBaselineScore, getCurrentPeriod, type ScoreBreakdown } from "./services/scoring-service";
import { monitorCompetitorNews, monitorMultipleCompetitorsNews, type NewsMonitoringResult } from "./services/news-monitoring";
import { calculateEstimatedCost } from "./services/ai-pricing";
import { testBlogUrl, monitorBlogForCompetitor } from "./services/rss-service";
import { validateCompetitorUrl, validateBlogUrl } from "./utils/url-validator";
import { validateDocumentUpload } from "./utils/file-validator";

// Helper to log AI usage after any AI call
async function logAiUsage(
  ctx: { tenantDomain: string; marketId: string; userId: string },
  operation: string,
  provider: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  durationMs?: number
) {
  try {
    const inputTokens = usage?.input_tokens || 0;
    const outputTokens = usage?.output_tokens || 0;
    const estimatedCost = calculateEstimatedCost(model, inputTokens, outputTokens);
    
    await storage.logAiUsage({
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      userId: ctx.userId,
      provider,
      model,
      operation,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCost,
      durationMs: durationMs || null,
    });
  } catch (error) {
    console.error("Failed to log AI usage:", error);
  }
}

// Helper: Check if user has cross-tenant READ access
// Global Admin and Consultant roles can read across tenants
// Only Global Admin can WRITE across tenants
function hasCrossTenantReadAccess(role: string): boolean {
  return role === "Global Admin" || role === "Consultant";
}

// Helper: Check if user has admin privileges
// Global Admin and Domain Admin can perform admin operations
// Consultant does NOT have admin privileges
function hasAdminAccess(role: string): boolean {
  return role === "Global Admin" || role === "Domain Admin";
}

// Helper to convert RequestContext to ContextFilter for storage methods
function toContextFilter(ctx: RequestContext): ContextFilter {
  return {
    tenantId: ctx.tenantId,
    marketId: ctx.marketId,
    tenantDomain: ctx.tenantDomain,
    isDefaultMarket: ctx.isDefaultMarket,
  };
}

// Helper to validate resource belongs to current context
function validateResourceContext(
  resource: { tenantDomain?: string | null; marketId?: string | null },
  ctx: RequestContext
): boolean {
  // Must match tenant
  if (resource.tenantDomain && resource.tenantDomain !== ctx.tenantDomain) {
    return false;
  }
  // If resource has a marketId, it must match the current market
  if (resource.marketId && resource.marketId !== ctx.marketId) {
    return false;
  }
  // If resource has null marketId, only allow in default market (legacy data)
  if (!resource.marketId && !ctx.isDefaultMarket) {
    return false;
  }
  return true;
}

// Zod schemas for context/market endpoints
const switchTenantSchema = z.object({
  tenantId: z.string().uuid("Invalid tenant ID format"),
});

const switchMarketSchema = z.object({
  marketId: z.string().uuid("Invalid market ID format"),
});

const createMarketSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  description: z.string().max(500).optional(),
});

const updateMarketSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const grantConsultantAccessSchema = z.object({
  consultantUserId: z.string().uuid("Invalid user ID format"),
});

// Parse manual AI research content into structured analysis data
function parseManualResearch(content: string, entityName: string): any {
  // List of known section headers to use as delimiters
  const knownHeaders = [
    "Company Summary", "Summary", "Overview",
    "Value Proposition", "Main Value Proposition",
    "Target Audience", "Target Market",
    "Key Messages", "Main Messages",
    "Keywords", "Themes", "Keywords/Themes",
    "Tone", "Brand Voice",
    "Strengths", "Weaknesses"
  ];
  
  const headerPattern = knownHeaders.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  
  const extractSection = (content: string, header: string): string => {
    const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      // Match **Header:** or **Header** followed by content until next known header
      new RegExp(`\\*\\*${escapedHeader}[:\\s]*\\*\\*[:\\s]*([\\s\\S]*?)(?=\\*\\*(?:${headerPattern})[:\\s]*\\*\\*|$)`, 'i'),
      // Match Header: at start of line followed by content until next known header
      new RegExp(`^${escapedHeader}[:\\s]+([\\s\\S]*?)(?=\\n(?:${headerPattern})[:\\s]|$)`, 'im'),
      // Match ## Header or # Header (markdown format)
      new RegExp(`##?\\s*${escapedHeader}[:\\s]*([\\s\\S]*?)(?=##?\\s*(?:${headerPattern})|$)`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]?.trim()) {
        // Clean up the extracted content - remove trailing markdown or headers
        let result = match[1].trim();
        // Remove any bold markdown formatting from the result
        result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
        return result;
      }
    }
    return "";
  };

  const extractList = (content: string, header: string): string[] => {
    const section = extractSection(content, header);
    if (!section) return [];
    
    const items = section.split(/\n/).filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.match(/^\d+\./);
    }).map(line => line.replace(/^[-•\d.]+\s*/, '').trim()).filter(Boolean);
    
    return items.length > 0 ? items : section.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  };

  const summary = extractSection(content, "Company Summary") || 
                  extractSection(content, "Summary") ||
                  extractSection(content, "Overview") ||
                  `${entityName} - Intelligence gathered via manual AI research`;

  const valueProposition = extractSection(content, "Value Proposition") ||
                           extractSection(content, "Main Value Proposition");

  const targetAudience = extractSection(content, "Target Audience") ||
                         extractSection(content, "Target Market");

  const keyMessages = extractList(content, "Key Messages") ||
                      extractList(content, "Main Messages");

  const keywords = extractSection(content, "Keywords") ||
                   extractSection(content, "Themes");
  const keywordsList = keywords ? keywords.split(/[,\n]/).map(k => k.replace(/^[-•]\s*/, '').trim()).filter(Boolean) : [];

  const tone = extractSection(content, "Tone") ||
               extractSection(content, "Brand Voice");

  const strengths = extractList(content, "Strengths");
  const weaknesses = extractList(content, "Weaknesses");

  return {
    summary: summary.substring(0, 500),
    valueProposition: valueProposition.substring(0, 500),
    targetAudience: targetAudience.substring(0, 500),
    keyMessages: keyMessages.slice(0, 5),
    keywords: keywordsList.slice(0, 10),
    tone: tone.substring(0, 200),
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5),
    rawContent: content.substring(0, 5000),
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Register object storage routes
  registerObjectStorageRoutes(app);
  
  // Register Entra SSO routes
  registerEntraRoutes(app);
  
  // ==================== PUBLIC CONTENT ROUTES ====================
  
  // Serve markdown files as raw text (for changelog, backlog, etc.)
  app.get("/api/content/:filename", (req, res) => {
    const allowedFiles = ["changelog.md", "backlog.md", "user_guide.md"];
    const filename = req.params.filename;
    
    if (!allowedFiles.includes(filename)) {
      return res.status(404).json({ error: "File not found" });
    }
    
    const filePath = join(process.cwd(), "public", filename);
    
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    
    try {
      const content = readFileSync(filePath, "utf-8");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(content);
    } catch (error) {
      console.error("Error reading file:", error);
      res.status(500).json({ error: "Failed to read file" });
    }
  });
  
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
      // SECURITY: Consultant and Global Admin are privileged roles assigned only by existing admins
      // Domain Admin is auto-assigned to the FIRST user who creates a new tenant (self-service account owner)
      const domain = email.split("@")[1].toLowerCase();
      
      // Check if tenant already exists for this domain
      const existingTenantForDomain = await storage.getTenantByDomain(domain);
      
      // If no tenant exists, check if domain is blocked
      if (!existingTenantForDomain) {
        const isBlocked = await storage.isdomainBlocked(domain);
        if (isBlocked) {
          return res.status(403).json({ 
            error: "This email domain is not allowed for self-registration. Please contact your administrator to set up your organization." 
          });
        }
      }
      
      // First user for a new domain becomes Domain Admin (can configure their account)
      // Subsequent users get Standard User role
      let role = existingTenantForDomain ? "Standard User" : "Domain Admin";

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
      if (!existingTenantForDomain) {
        const trialStartDate = new Date();
        const trialEndsAt = new Date(trialStartDate);
        trialEndsAt.setDate(trialEndsAt.getDate() + 60);
        
        const newTenant = await storage.createTenant({
          domain,
          name: company,
          plan: "trial",
          status: "active",
          trialStartDate,
          trialEndsAt,
          userCount: 0,
          competitorLimit: 3,
          analysisLimit: 5,
        });
        
        // Create default market for the new tenant
        await storage.createMarket({
          tenantId: newTenant.id,
          name: "Default",
          description: `Default market for ${company}`,
          isDefault: true,
          status: "active",
          createdBy: user.id,
        });
      }

      // Sync to HubSpot CRM (async, don't block signup)
      const nameParts = name.split(' ');
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(' ') || '';
      syncNewAccountToHubSpot({
        email,
        firstName,
        lastName,
        companyName: company,
        companyDomain: domain,
        jobTitle: jobTitle || undefined,
        industry: industry || undefined,
        companySize: companySize || undefined,
        country: country || undefined,
        plan: 'trial',
      }).catch(err => console.error('[HubSpot] Background sync failed:', err));

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

  // Forgot password - request reset link
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      
      // Always return success to prevent email enumeration attacks
      if (!user) {
        return res.json({ success: true, message: "If an account exists, a reset link has been sent" });
      }

      // SSO users can't reset password through this flow
      if (user.authProvider === "entra") {
        return res.json({ success: true, message: "If an account exists, a reset link has been sent" });
      }

      // Generate reset token
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await storage.createPasswordResetToken({
        token,
        userId: user.id,
        email: user.email,
        expiresAt,
      });

      // Send email
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      const { sendPasswordResetEmail } = await import("./services/email-service");
      await sendPasswordResetEmail(user.email, user.name, token, baseUrl);

      res.json({ success: true, message: "If an account exists, a reset link has been sent" });
    } catch (error: any) {
      console.error("[Forgot Password] Error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  // Reset password - verify token and set new password
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ error: "Token and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const resetToken = await storage.getPasswordResetToken(token);
      
      if (!resetToken) {
        return res.status(400).json({ error: "Invalid or expired reset link" });
      }

      if (resetToken.used) {
        return res.status(400).json({ error: "This reset link has already been used" });
      }

      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ error: "Reset link has expired" });
      }

      // Hash and update password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(resetToken.userId, { password: hashedPassword });

      // Mark token as used
      await storage.markPasswordResetTokenUsed(token);

      res.json({ success: true, message: "Password has been reset successfully" });
    } catch (error: any) {
      console.error("[Reset Password] Error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // Change password for local auth users
  app.patch("/api/me/password", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // SSO users cannot change password here
      if (user.authProvider === "entra") {
        return res.status(400).json({ error: "SSO users must change password through their identity provider" });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current password and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      }

      // Verify current password
      const validPassword = await bcrypt.compare(currentPassword, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Hash and update new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(user.id, { password: hashedPassword });

      res.json({ success: true, message: "Password updated successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
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

  // Update user demographics (for SSO profile completion)
  app.patch("/api/me/demographics", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const { jobTitle, industry, companySize, country } = req.body;

      // Validate required fields
      if (!jobTitle || !industry || !companySize || !country) {
        return res.status(400).json({ error: "All fields are required" });
      }

      const updatedUser = await storage.updateUser(req.session.userId, {
        jobTitle,
        industry,
        companySize,
        country,
      });

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const { password: _, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Error updating user demographics:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // Update user notification preferences (weekly digest opt-in/out)
  app.patch("/api/me/notifications", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const { weeklyDigestEnabled } = req.body;

      if (typeof weeklyDigestEnabled !== "boolean") {
        return res.status(400).json({ error: "weeklyDigestEnabled must be a boolean" });
      }

      const updatedUser = await storage.updateUser(req.session.userId, {
        weeklyDigestEnabled,
      });

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const { password: _, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ error: "Failed to update notification preferences" });
    }
  });

  // ==================== COMPETITOR ROUTES ====================

  app.get("/api/competitors", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      res.json(competitors);
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

      res.json(competitor);
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

      const { linkedInUrl, instagramUrl, twitterUrl, blogUrl, name, url, projectId } = req.body;
      const updateData: any = {};
      
      if (linkedInUrl !== undefined) updateData.linkedInUrl = linkedInUrl || null;
      if (instagramUrl !== undefined) updateData.instagramUrl = instagramUrl || null;
      if (twitterUrl !== undefined) updateData.twitterUrl = twitterUrl || null;
      if (blogUrl !== undefined) updateData.blogUrl = blogUrl || null;
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

          // Security: Verify the project belongs to current context
          if (!validateResourceContext(project, ctx)) {
            return res.status(403).json({ error: "Access denied - project belongs to another tenant" });
          }

          // Plan-gating: Only Pro/Enterprise can use projects
          const tenant = await storage.getTenant(ctx.tenantId);
          if (!tenant || (tenant.plan !== "pro" && tenant.plan !== "professional" && tenant.plan !== "enterprise")) {
            return res.status(403).json({ 
              error: "Client Projects require a Pro or Enterprise plan",
              upgradeRequired: true
            });
          }

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

        // Plan-gating: Only Pro/Enterprise can use projects
        const tenant = await storage.getTenant(ctx.tenantId);
        if (!tenant || (tenant.plan !== "pro" && tenant.plan !== "professional" && tenant.plan !== "enterprise")) {
          return res.status(403).json({ 
            error: "Client Projects require a Pro or Enterprise plan",
            upgradeRequired: true
          });
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

      const competitor = await storage.createCompetitor(parsed.data);
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

      // Check plan for full_with_change analysis
      if (analysisType === "full_with_change") {
        const tenant = await storage.getTenant(ctx.tenantId);
        
        if (!tenant || (tenant.plan !== "pro" && tenant.plan !== "professional" && tenant.plan !== "enterprise")) {
          return res.status(403).json({ 
            error: "Full Analysis with Change Monitoring requires a Pro or Enterprise plan",
            upgradeRequired: true
          });
        }
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
            // Preserve manual research, only update crawl metadata
            console.log(`Skipping analysis update for ${competitor.name} - has manual research data`);
          } else {
            await storage.updateCompetitorAnalysis(competitor.id, analysis);
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
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenant(ctx.tenantId);

      if (!tenant || tenant.plan === "free" || tenant.plan === "trial") {
        return res.status(403).json({ 
          error: "Social media monitoring is a premium feature. Please upgrade your plan.",
          upgradeRequired: true 
        });
      }

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

      if (tenant.plan === "free" || tenant.plan === "trial") {
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

  // ==================== WEBSITE CHANGE MONITORING (PREMIUM) ====================

  // Monitor website for a single competitor (on-demand)
  app.post("/api/competitors/:id/monitor-website", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenant(ctx.tenantId);

      if (!tenant || tenant.plan === "free" || tenant.plan === "trial") {
        return res.status(403).json({ 
          error: "Website change monitoring is a premium feature. Please upgrade your plan.",
          upgradeRequired: true 
        });
      }

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
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenant(ctx.tenantId);

      if (!tenant || tenant.plan === "free" || tenant.plan === "trial") {
        return res.status(403).json({ 
          error: "Website change monitoring is a premium feature. Please upgrade your plan.",
          upgradeRequired: true 
        });
      }

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
    try {
      const ctx = await getRequestContext(req);
      const profileId = parseInt(req.params.id);
      const profile = await storage.getCompanyProfile(profileId);
      
      if (!profile) {
        return res.status(404).json({ error: "Company profile not found" });
      }
      
      const results: any = { website: null, linkedin: null };
      
      // Crawl website
      if (profile.websiteUrl) {
        const { crawlCompetitorWebsite, getCombinedContent } = await import("./services/web-crawler");
        const crawlResult = await crawlCompetitorWebsite(profile.websiteUrl);
        
        if (crawlResult.pages.length > 0) {
          const combinedContent = getCombinedContent(crawlResult);
          await storage.updateCompanyProfile(profileId, {
            crawlData: {
              pagesCrawled: crawlResult.pages.map(p => ({
                url: p.url,
                pageType: p.pageType,
                title: p.title,
                wordCount: p.wordCount,
              })),
              totalWordCount: crawlResult.pages.reduce((sum, p) => sum + p.wordCount, 0),
              crawledAt: crawlResult.crawledAt,
            },
            previousWebsiteContent: combinedContent.substring(0, 100000),
            lastCrawl: new Date(),
            lastFullCrawl: new Date(),
          });
          results.website = { success: true, pages: crawlResult.pages.length };
        }
      }
      
      // Refresh LinkedIn
      if (profile.linkedInUrl) {
        const { monitorCompetitorSocialMedia } = await import("./services/social-monitoring");
        await monitorCompetitorSocialMedia(
          { id: profile.id, linkedInUrl: profile.linkedInUrl } as any,
          { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId }
        );
        results.linkedin = { success: true };
      }
      
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
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenant(ctx.tenantId);

      if (!tenant || tenant.plan === "free" || tenant.plan === "trial") {
        return res.status(403).json({ 
          error: "Website change monitoring is a premium feature. Please upgrade your plan.",
          upgradeRequired: true 
        });
      }

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
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const analysisType = req.body?.analysisType || "full";

      // Check premium for full_with_change mode
      if (analysisType === "full_with_change") {
        const tenant = await storage.getTenantByDomain(tenantDomain);
        const isPremium = tenant?.plan === "pro" || tenant?.plan === "enterprise";
        if (!isPremium) {
          return res.status(403).json({ error: "Change detection requires a Pro or Enterprise plan", upgradeRequired: true });
        }
      }

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

      // Analyze each competitor based on analysis type
      const analyses = [];
      for (const competitor of userCompetitors.slice(0, 5)) {
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

      // Generate gap analysis with baseline and grounding context
      const gaps = await generateGapAnalysis(
        ourPositioning, 
        analyses,
        baselineAnalysis,
        groundingContext || undefined
      );

      // Fetch existing recommendations to avoid regenerating dismissed or duplicates
      const existingRecs = await storage.getRecommendationsByTenant(tenantDomain);
      const existingForAI = existingRecs.map(r => ({
        title: r.title,
        description: r.description,
        area: r.area,
        status: r.status,
        dismissedReason: r.dismissedReason || undefined,
      }));

      // Generate recommendations, passing existing ones to avoid duplicates
      const recommendations = await generateRecommendations(gaps, analyses, existingForAI);

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
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
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

  // ==================== BATTLECARD ROUTES ====================

  app.get("/api/competitors/:competitorId/battlecard", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const battlecard = await storage.getBattlecardByCompetitor(req.params.competitorId);
      res.json(battlecard || null);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/competitors/:competitorId/battlecard/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get company profile for comparison
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
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
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });
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
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      // Log AI usage
      await logAiUsage(ctx, "generate_battlecard", "anthropic", "claude-sonnet-4-5", response.usage);

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      let battlecardContent;
      try {
        let text = content.text.trim();
        if (text.startsWith("```json")) text = text.slice(7);
        else if (text.startsWith("```")) text = text.slice(3);
        if (text.endsWith("```")) text = text.slice(0, -3);
        battlecardContent = JSON.parse(text.trim());
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
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          strengths: battlecardContent.strengths,
          weaknesses: battlecardContent.weaknesses,
          ourAdvantages: battlecardContent.ourAdvantages,
          objections: battlecardContent.objections,
          talkTracks: battlecardContent.talkTracks,
          quickStats: battlecardContent.quickStats,
          status: "draft",
          createdBy: ctx.userId,
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
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battlecard not found" });
      }

      // Validate battlecard belongs to current context
      if (!validateResourceContext(battlecard, ctx)) {
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
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/battlecards/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battlecard not found" });
      }

      // Validate battlecard belongs to current context
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteBattlecard(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ACTIVITY ROUTES ====================

  app.get("/api/activity", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const activities = await storage.getActivityByContext(toContextFilter(ctx));
      res.json(activities);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/activity", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const parsed = insertActivitySchema.safeParse({
        ...req.body,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const newActivity = await storage.createActivity(parsed.data);
      res.json(newActivity);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== RECOMMENDATION ROUTES ====================

  app.get("/api/recommendations", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const recommendations = await storage.getRecommendationsByContext(toContextFilter(ctx));
      res.json(recommendations);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/recommendations", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const parsed = insertRecommendationSchema.safeParse({
        ...req.body,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const recommendation = await storage.createRecommendation(parsed.data);
      res.json(recommendation);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== REPORT ROUTES ====================

  app.get("/api/reports", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const reports = await storage.getReportsByContext(toContextFilter(ctx));
      res.json(reports);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/reports/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
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
        
        // Validate project belongs to current context
        if (!validateResourceContext(project, ctx)) {
          return res.status(403).json({ error: "Access denied" });
        }
        
        const user = await storage.getUser(ctx.userId);
        const isOwner = project.ownerUserId === ctx.userId;
        const isGlobalAdmin = user?.role === "Global Admin";
        if (!isOwner && !isGlobalAdmin) {
          return res.status(403).json({ error: "Access denied. Only project owners can generate project reports." });
        }
      }

      const { generatePdfReport } = await import("./services/pdf-generator");
      const reportName = name || `Competitive Analysis - ${new Date().toLocaleDateString()}`;
      const { pdfBuffer, report } = await generatePdfReport(
        ctx.tenantDomain,
        ctx.userId,
        reportName,
        scope || "baseline",
        projectId,
        false,
        ctx.marketId || undefined
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${reportName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf"`);
      res.setHeader("X-Report-Id", report.id);
      res.send(pdfBuffer);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("PDF generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Full analysis PDF report (includes GTM Plan and Messaging Framework)
  app.get("/api/reports/full-analysis/pdf", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const { generatePdfReport } = await import("./services/pdf-generator");
      const reportName = `Full Analysis Report - ${new Date().toLocaleDateString()}`;
      
      const { pdfBuffer, report } = await generatePdfReport(
        ctx.tenantDomain,
        ctx.userId,
        reportName,
        "baseline",
        undefined,
        true, // includeStrategicPlans
        ctx.marketId || undefined
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Full_Analysis_Report_${new Date().toISOString().split('T')[0]}.pdf"`);
      res.setHeader("X-Report-Id", report.id);
      res.send(pdfBuffer);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Full analysis PDF generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/reports", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
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
        
        // Validate project belongs to current context
        if (!validateResourceContext(project, ctx)) {
          return res.status(403).json({ error: "Access denied" });
        }
        
        // Require project owner or Global Admin for project-scoped reports
        const user = await storage.getUser(ctx.userId);
        const isOwner = project.ownerUserId === ctx.userId;
        const isGlobalAdmin = user?.role === "Global Admin";
        if (!isOwner && !isGlobalAdmin) {
          return res.status(403).json({ error: "Access denied. Only project owners can generate project reports." });
        }
      }

      const user = await storage.getUser(ctx.userId);
      const reportData = {
        name: name || `Report - ${new Date().toLocaleDateString()}`,
        date: new Date().toLocaleDateString(),
        type: "PDF",
        size: "Generating...",
        author: user?.name || user?.email || "Unknown",
        status: "Generating",
        scope: scope || "baseline",
        projectId: scope === "project" ? projectId : null,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        createdBy: ctx.userId,
      };

      const parsed = insertReportSchema.safeParse(reportData);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const report = await storage.createReport(parsed.data);
      res.json(report);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ANALYSIS ROUTES ====================

  app.get("/api/analysis", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const tenantAnalysis = await storage.getLatestAnalysisByContext(toContextFilter(ctx));
      res.json(tenantAnalysis || null);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/analysis", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const parsed = insertAnalysisSchema.safeParse({
        ...req.body,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const analysis = await storage.createAnalysis(parsed.data);
      res.json(analysis);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== BATTLECARD ROUTES ====================

  app.get("/api/battlecards", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const battlecards = await storage.getBattlecardsByContext(toContextFilter(ctx));
      
      // Enrich with competitor names
      const enriched = await Promise.all(battlecards.map(async (bc) => {
        const competitor = await storage.getCompetitor(bc.competitorId);
        return {
          ...bc,
          competitorName: competitor?.name || "Unknown Competitor",
        };
      }));
      
      res.json(enriched);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/battlecards/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battle card not found" });
      }

      // Validate battlecard belongs to current context
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const competitor = await storage.getCompetitor(battlecard.competitorId);
      res.json({
        ...battlecard,
        competitorName: competitor?.name || "Unknown Competitor",
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/battlecards/generate/:competitorId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const competitorId = req.params.competitorId;

      const competitor = await storage.getCompetitor(competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get company profile for comparison
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));

      // Generate AI content for battle card
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });
      const competitorData = competitor.analysisData as any || {};
      const companyData = companyProfile?.analysisData as any || {};

      const prompt = `Generate a sales battle card comparing our company against a competitor. 

OUR COMPANY:
- Name: ${companyProfile?.companyName || "Our Company"}
- Key messaging: ${JSON.stringify(companyData.messaging || {})}
- Value proposition: ${companyData.valueProposition || "N/A"}

COMPETITOR:
- Name: ${competitor.name}
- Website: ${competitor.url}
- Key messaging: ${JSON.stringify(competitorData.messaging || {})}
- Value proposition: ${competitorData.valueProposition || "N/A"}

Generate a comprehensive battle card in the following JSON format:
{
  "strengths": ["Array of 3-5 competitor strengths"],
  "weaknesses": ["Array of 3-5 competitor weaknesses"],
  "ourAdvantages": ["Array of 4-6 key advantages we have over this competitor"],
  "comparison": [
    {"category": "Feature category name", "us": "full|three-quarter|half|quarter|empty", "them": "full|three-quarter|half|quarter|empty", "notes": "Brief explanation of the comparison"}
  ],
  "objections": [
    {"objection": "Common objection customers raise about us vs competitor", "response": "How to respond effectively"}
  ],
  "talkTracks": [
    {"scenario": "Sales scenario description", "script": "What to say in this scenario"}
  ],
  "quickStats": {
    "pricing": "Competitor pricing model/tier",
    "marketPosition": "Where they sit in the market",
    "targetAudience": "Who they primarily target",
    "keyProducts": "Their main products/services"
  }
}

For the "comparison" array, include 4-6 key feature categories and rate each using Harvey balls:
- "full" = Excellent/Complete capability
- "three-quarter" = Strong capability
- "half" = Adequate/Partial capability  
- "quarter" = Weak capability
- "empty" = No capability

Return ONLY valid JSON, no markdown or explanations.`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      // Log AI usage
      await logAiUsage(ctx, "generate_battlecard", "anthropic", "claude-sonnet-4-5", response.usage);

      const textContent = response.content.find(c => c.type === "text");
      if (!textContent || textContent.type !== "text") {
        throw new Error("No text response from AI");
      }

      let battlecardContent;
      try {
        let text = textContent.text.trim();
        // Remove markdown code blocks
        if (text.startsWith("```json")) text = text.slice(7);
        else if (text.startsWith("```")) text = text.slice(3);
        if (text.endsWith("```")) text = text.slice(0, -3);
        text = text.trim();
        
        // Try to find JSON object in the response if it contains other text
        if (!text.startsWith("{")) {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            text = jsonMatch[0];
          }
        }
        
        battlecardContent = JSON.parse(text);
      } catch (parseError) {
        console.error("Failed to parse AI response as JSON. Raw response:", textContent.text.substring(0, 500));
        throw new Error("Failed to parse AI response as JSON");
      }

      // Check if battle card already exists for this competitor
      const existing = await storage.getBattlecardByCompetitor(competitorId);
      
      let battlecard;
      if (existing) {
        battlecard = await storage.updateBattlecard(existing.id, {
          ...battlecardContent,
          lastGeneratedAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        battlecard = await storage.createBattlecard({
          competitorId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          ...battlecardContent,
          status: "published",
          lastGeneratedAt: new Date(),
          createdBy: ctx.userId,
        });
      }

      res.json({
        ...battlecard,
        competitorName: competitor.name,
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Battle card generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/battlecards/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battle card not found" });
      }

      // Validate battlecard belongs to current context
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteBattlecard(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Battlecard PDF export
  app.get("/api/battlecards/:id/pdf", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const battlecard = await storage.getBattlecard(req.params.id);
      
      if (!battlecard) {
        return res.status(404).json({ error: "Battle card not found" });
      }
      
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const competitor = await storage.getCompetitor(battlecard.competitorId);
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      
      const { generateBattlecardPdf } = await import("./services/battlecard-export");
      const pdfBuffer = await generateBattlecardPdf(
        battlecard,
        competitor?.name || "Competitor",
        companyProfile?.companyName || "Your Company",
        tenant,
        battlecard.lastGeneratedAt || battlecard.createdAt
      );
      
      const filename = `Battlecard_${competitor?.name || "Competitor"}_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Battlecard PDF export error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Battlecard text export (for Word, PowerPoint, etc.)
  app.get("/api/battlecards/:id/txt", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const battlecard = await storage.getBattlecard(req.params.id);
      
      if (!battlecard) {
        return res.status(404).json({ error: "Battle card not found" });
      }
      
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const competitor = await storage.getCompetitor(battlecard.competitorId);
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      const { generateBattlecardText } = await import("./services/battlecard-export");
      const textBuffer = generateBattlecardText(
        battlecard,
        competitor?.name || "Competitor",
        companyProfile?.companyName || "Your Company"
      );
      
      const filename = `Battlecard_${competitor?.name || "Competitor"}_${new Date().toISOString().split('T')[0]}.txt`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
      res.send(textBuffer);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Battlecard text export error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Product Battlecard PDF export
  app.get("/api/product-battlecards/:id/pdf", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const battlecard = await storage.getProductBattlecard(req.params.id);
      
      if (!battlecard) {
        return res.status(404).json({ error: "Product battle card not found" });
      }
      
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const baselineProduct = await storage.getProduct(battlecard.baselineProductId);
      const competitorProduct = await storage.getProduct(battlecard.competitorProductId);
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      
      const { generateProductBattlecardPdf } = await import("./services/battlecard-export");
      const pdfBuffer = await generateProductBattlecardPdf(
        battlecard,
        competitorProduct?.name || "Competitor Product",
        baselineProduct?.name || "Your Product",
        tenant
      );
      
      const filename = `Battlecard_${competitorProduct?.name || "Product"}_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Product battlecard PDF export error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Product Battlecard text export
  app.get("/api/product-battlecards/:id/txt", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const battlecard = await storage.getProductBattlecard(req.params.id);
      
      if (!battlecard) {
        return res.status(404).json({ error: "Product battle card not found" });
      }
      
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const baselineProduct = await storage.getProduct(battlecard.baselineProductId);
      const competitorProduct = await storage.getProduct(battlecard.competitorProductId);
      
      const { generateProductBattlecardText } = await import("./services/battlecard-export");
      const textBuffer = generateProductBattlecardText(
        battlecard,
        competitorProduct?.name || "Competitor Product",
        baselineProduct?.name || "Your Product"
      );
      
      const filename = `Battlecard_${competitorProduct?.name || "Product"}_${new Date().toISOString().split('T')[0]}.txt`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
      res.send(textBuffer);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Product battlecard text export error:", error);
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
      // Allow Admins to manage users, Consultants to view users (read-only cross-tenant)
      if (!currentUser || (!hasAdminAccess(currentUser.role) && currentUser.role !== "Consultant")) {
        return res.status(403).json({ error: "Forbidden: Admin or Consultant access required" });
      }

      const tenantDomain = currentUser.email.split("@")[1];
      
      // Security: Domain Admins can only see users in their own tenant
      // Global Admins and Consultants from Synozur can see all users across all tenants (read-only for Consultants)
      let users;
      if ((currentUser.role === "Global Admin" || currentUser.role === "Consultant") && tenantDomain === "synozur.com") {
        // Platform super-admin or consultant: can see all users across all tenants
        users = await storage.getAllUsers();
      } else {
        // Domain Admin: only see users in their tenant
        users = await storage.getUsersByDomain(tenantDomain);
      }
      
      const usersWithoutPasswords = users.map(({ password, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== GROUNDING DOCUMENTS ROUTES ====================

  app.get("/api/documents", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const documents = await storage.getGroundingDocumentsByContext(toContextFilter(ctx));
      res.json(documents);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/documents/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const document = await storage.getGroundingDocument(req.params.id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Validate document belongs to current context
      if (!validateResourceContext(document, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(document);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const parsed = insertGroundingDocumentSchema.safeParse({
        ...req.body,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
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
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/documents/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const document = await storage.getGroundingDocument(req.params.id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Validate document belongs to current context
      if (!validateResourceContext(document, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteGroundingDocument(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get grounding context for AI prompts
  app.get("/api/documents/context/ai", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const documents = await storage.getGroundingDocumentsByContext(toContextFilter(ctx));

      const context = documentExtractionService.prepareGroundingContext(
        documents.map((d) => ({
          name: d.name,
          extractedText: d.extractedText,
          scope: d.scope,
        }))
      );

      res.json({ context });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== GLOBAL GROUNDING DOCUMENTS ROUTES (Global Admin Only) ====================

  // Get all global grounding documents (Global Admin only)
  app.get("/api/admin/global-documents", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Only Global Admins can manage global documents" });
      }

      const documents = await storage.getAllGlobalGroundingDocuments();
      res.json(documents);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Extract text from uploaded file (authenticated users only)
  app.post("/api/documents/extract-text", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { fileUrl, fileType } = req.body;
      if (!fileUrl || !fileType) {
        return res.status(400).json({ error: "Missing required fields: fileUrl, fileType" });
      }

      const text = await documentExtractionService.extractTextFromDocument(fileUrl, fileType);
      res.json({ text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create global grounding document (Global Admin only)
  app.post("/api/admin/global-documents", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Only Global Admins can manage global documents" });
      }

      const { name, description, category, fileType, originalFileName, content } = req.body;

      // Validate required fields - content is now required
      if (!name || !category || !content) {
        return res.status(400).json({ error: "Missing required fields: name, category, content" });
      }

      // Validate category
      const validCategories = ["brand_voice", "marketing_guidelines", "digital_assets", "methodology"];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
      }

      const wordCount = content.split(/\s+/).filter(Boolean).length;

      const document = await storage.createGlobalGroundingDocument({
        name,
        description: description || null,
        category,
        fileType: fileType || "txt",
        originalFileName: originalFileName || `${name}.txt`,
        extractedText: content,
        wordCount,
        uploadedBy: user.id,
        isActive: true,
      });

      res.status(201).json(document);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update global grounding document (Global Admin only)
  app.patch("/api/admin/global-documents/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Only Global Admins can manage global documents" });
      }

      const document = await storage.getGlobalGroundingDocument(req.params.id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const { name, description, category, isActive } = req.body;

      // Validate category if provided
      if (category) {
        const validCategories = ["brand_voice", "marketing_guidelines", "digital_assets", "methodology"];
        if (!validCategories.includes(category)) {
          return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
        }
      }

      const updatedDocument = await storage.updateGlobalGroundingDocument(req.params.id, {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive }),
      });

      res.json(updatedDocument);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete global grounding document (Global Admin only)
  app.delete("/api/admin/global-documents/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Only Global Admins can manage global documents" });
      }

      const document = await storage.getGlobalGroundingDocument(req.params.id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      await storage.deleteGlobalGroundingDocument(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get active global documents for AI context (internal use, any authenticated user)
  app.get("/api/global-documents/context", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const documents = await storage.getActiveGlobalGroundingDocuments();
      
      // Group by category for organized context
      const contextByCategory: Record<string, string[]> = {};
      for (const doc of documents) {
        if (!contextByCategory[doc.category]) {
          contextByCategory[doc.category] = [];
        }
        contextByCategory[doc.category].push(`[${doc.name}]\n${doc.extractedText}`);
      }

      res.json({
        totalDocuments: documents.length,
        categories: Object.keys(contextByCategory),
        context: contextByCategory,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== COMPANY PROFILE ROUTES (Baseline Own Website) ====================

  // Fetch company info from a domain for onboarding pre-population
  app.get("/api/company-info/from-domain", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const websiteUrl = `https://www.${tenantDomain}`;

      // Try to fetch homepage and extract company info
      try {
        const response = await fetch(websiteUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; OrbitBot/1.0)" },
          redirect: "follow",
        });

        if (!response.ok) {
          return res.json({
            domain: tenantDomain,
            websiteUrl,
            companyName: tenantDomain.split(".")[0].charAt(0).toUpperCase() + tenantDomain.split(".")[0].slice(1),
            description: "",
            fetchSuccess: false,
          });
        }

        const html = await response.text();

        // Extract title for company name
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        let companyName = titleMatch ? titleMatch[1].trim() : "";
        
        // Clean up title - remove common suffixes
        companyName = companyName
          .replace(/\s*[-|–—]\s*.*(home|homepage|welcome|official site|official website).*/i, "")
          .replace(/\s*[-|–—]\s*$/i, "")
          .trim();
        
        // If title is too long or empty, try OG title or default to domain
        if (!companyName || companyName.length > 50) {
          const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                               html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
          if (ogTitleMatch) {
            companyName = ogTitleMatch[1].trim();
          } else {
            companyName = tenantDomain.split(".")[0].charAt(0).toUpperCase() + tenantDomain.split(".")[0].slice(1);
          }
        }

        // Extract meta description
        const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                          html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
        let description = descMatch ? descMatch[1].trim() : "";

        // Try OG description if meta description is empty
        if (!description) {
          const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
                              html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
          if (ogDescMatch) {
            description = ogDescMatch[1].trim();
          }
        }

        // Extract social links
        const linkedInMatch = html.match(/href=["'](https?:\/\/(www\.)?linkedin\.com\/company\/[^"']+)["']/i);
        const instagramMatch = html.match(/href=["'](https?:\/\/(www\.)?instagram\.com\/[^"']+)["']/i);

        res.json({
          domain: tenantDomain,
          websiteUrl: response.url || websiteUrl,
          companyName,
          description,
          linkedInUrl: linkedInMatch ? linkedInMatch[1] : null,
          instagramUrl: instagramMatch ? instagramMatch[1] : null,
          fetchSuccess: true,
        });
      } catch (fetchError) {
        // Website not reachable - return basic info
        res.json({
          domain: tenantDomain,
          websiteUrl,
          companyName: tenantDomain.split(".")[0].charAt(0).toUpperCase() + tenantDomain.split(".")[0].slice(1),
          description: "",
          fetchSuccess: false,
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get company profile for current tenant
  app.get("/api/company-profile", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const profile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      res.json(profile || null);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get baseline Orbit Score (company profile score)
  app.get("/api/company-profile/score", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const profile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      if (!profile) {
        return res.json({ hasScore: false, score: null });
      }
      
      // Calculate baseline score
      const scoreBreakdown = calculateBaselineScore({
        description: profile.description,
        crawlData: profile.crawlData as any,
        blogSnapshot: profile.blogSnapshot as any,
        linkedInEngagement: profile.linkedInEngagement as any,
        instagramEngagement: profile.instagramEngagement as any,
        lastCrawl: profile.lastCrawl,
      });
      
      // Get previous score for trend
      const previousScore = await storage.getLatestScoreForEntity("baseline", profile.id);
      const trend = previousScore 
        ? {
            previousScore: previousScore.overallScore,
            delta: Math.round((scoreBreakdown.overallScore - previousScore.overallScore) * 100) / 100,
            direction: scoreBreakdown.overallScore > previousScore.overallScore ? "up" : 
                       scoreBreakdown.overallScore < previousScore.overallScore ? "down" : "stable"
          }
        : null;
      
      res.json({
        hasScore: true,
        score: scoreBreakdown,
        trend,
        companyName: profile.companyName,
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Record baseline score to history (called after analysis/crawl)
  app.post("/api/company-profile/score/record", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const profile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      if (!profile) {
        return res.status(404).json({ error: "Company profile not found" });
      }
      
      const scoreBreakdown = calculateBaselineScore({
        description: profile.description,
        crawlData: profile.crawlData as any,
        blogSnapshot: profile.blogSnapshot as any,
        linkedInEngagement: profile.linkedInEngagement as any,
        instagramEngagement: profile.instagramEngagement as any,
        lastCrawl: profile.lastCrawl,
      });
      
      const period = getCurrentPeriod();
      
      // Check if we already have a record for this period
      const existingHistory = await storage.getScoreHistory("baseline", profile.id, 1);
      if (existingHistory.length > 0 && existingHistory[0].period === period) {
        return res.json({ recorded: false, message: "Score already recorded for this period", score: scoreBreakdown });
      }
      
      // Record to history
      await storage.createScoreHistory({
        entityType: "baseline",
        entityId: profile.id,
        entityName: profile.companyName,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        overallScore: Math.round(scoreBreakdown.overallScore),
        innovationScore: Math.round(scoreBreakdown.innovationScore),
        marketPresenceScore: Math.round(scoreBreakdown.marketPresenceScore),
        contentActivityScore: Math.round(scoreBreakdown.contentActivityScore),
        socialEngagementScore: Math.round(scoreBreakdown.socialEngagementScore),
        scoreBreakdown: scoreBreakdown,
        period,
      });
      
      res.json({ recorded: true, score: scoreBreakdown, period });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get score history for an entity (baseline or competitor)
  app.get("/api/score-history/:entityType/:entityId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const { entityType, entityId } = req.params;
      const limit = parseInt(req.query.limit as string) || 12;
      
      if (!["baseline", "competitor"].includes(entityType)) {
        return res.status(400).json({ error: "Invalid entity type. Must be 'baseline' or 'competitor'" });
      }
      
      const history = await storage.getScoreHistory(entityType, entityId, limit);
      res.json(history);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get all score history for current market context
  app.get("/api/score-history", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const entityType = req.query.entityType as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const history = await storage.getScoreHistoryByContext(toContextFilter(ctx), entityType, limit);
      res.json(history);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get products owned by the baseline company profile
  app.get("/api/company-profile/products", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const profile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      if (!profile) {
        return res.json([]);
      }
      const companyProducts = await storage.getProductsByCompanyProfile(profile.id);
      res.json(companyProducts);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Create or update company profile
  app.post("/api/company-profile", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      // Validate input
      const parsed = insertCompanyProfileSchema.safeParse({
        ...req.body,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });
      
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const { companyName, websiteUrl, description, linkedInUrl, instagramUrl, twitterUrl, logoUrl } = parsed.data;
      
      // Validate websiteUrl for security (SSRF protection)
      const urlValidation = await validateCompetitorUrl(websiteUrl);
      if (!urlValidation.isValid) {
        return res.status(400).json({ error: urlValidation.error });
      }
      const validatedWebsiteUrl = urlValidation.normalizedUrl!;
      
      // Plan-gating: Trial/Free plans can only baseline their own domain
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (tenant && (tenant.plan === "trial" || tenant.plan === "free")) {
        try {
          const websiteDomain = new URL(validatedWebsiteUrl).hostname.replace(/^www\./, "").toLowerCase();
          if (websiteDomain !== ctx.tenantDomain.toLowerCase()) {
            return res.status(403).json({ 
              error: `Your ${tenant.plan} plan only allows analyzing your own company website (${ctx.tenantDomain}). Upgrade to Pro or Enterprise to analyze other companies.`,
              upgradeRequired: true
            });
          }
        } catch {
          return res.status(400).json({ error: "Invalid website URL" });
        }
      }

      const existingProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));

      if (existingProfile) {
        const updated = await storage.updateCompanyProfile(existingProfile.id, {
          companyName,
          websiteUrl: validatedWebsiteUrl,
          logoUrl: logoUrl || null,
          linkedInUrl: linkedInUrl || null,
          instagramUrl: instagramUrl || null,
          twitterUrl: twitterUrl || null,
          description,
        });
        res.json(updated);
      } else {
        const profile = await storage.createCompanyProfile({
          userId: ctx.userId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          companyName,
          websiteUrl: validatedWebsiteUrl,
          logoUrl: logoUrl || null,
          linkedInUrl: linkedInUrl || null,
          instagramUrl: instagramUrl || null,
          twitterUrl: twitterUrl || null,
          description,
        });
        res.json(profile);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Analyze company website (baseline) - uses robust web crawler like competitors
  app.post("/api/company-profile/analyze", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const profile = await storage.getCompanyProfileByContext(toContextFilter(ctx));

      if (!profile) {
        return res.status(404).json({ error: "Company profile not found. Please set up your company profile first." });
      }

      // Plan-gating: Re-validate domain restriction at analysis time for Trial/Free plans
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (tenant && (tenant.plan === "trial" || tenant.plan === "free")) {
        try {
          const websiteDomain = new URL(profile.websiteUrl).hostname.replace(/^www\./, "").toLowerCase();
          if (websiteDomain !== ctx.tenantDomain.toLowerCase()) {
            return res.status(403).json({ 
              error: `Your ${tenant.plan} plan only allows analyzing your own company website (${ctx.tenantDomain}). Upgrade to Pro or Enterprise to analyze other companies.`,
              upgradeRequired: true
            });
          }
        } catch {
          return res.status(400).json({ error: "Invalid website URL in company profile" });
        }
      }

      // Use the robust multi-page web crawler (same as competitors)
      const crawlResult = await crawlCompetitorWebsite(profile.websiteUrl);
      
      // Check if profile has existing manual research data
      const existingAnalysis = profile.analysisData as any;
      const hasManualResearch = existingAnalysis?.source === "manual";
      
      if (crawlResult.pages.length === 0) {
        // Return with manual research option flag (like competitors)
        return res.json({ 
          success: false, 
          message: "Website could not be crawled",
          canUseManualResearch: true,
          hasExistingManualResearch: hasManualResearch,
        });
      }

      // Update social links if discovered
      const socialUpdates: any = {};
      if (crawlResult.socialLinks.linkedIn && !profile.linkedInUrl) {
        socialUpdates.linkedInUrl = crawlResult.socialLinks.linkedIn;
      }
      if (crawlResult.socialLinks.instagram && !profile.instagramUrl) {
        socialUpdates.instagramUrl = crawlResult.socialLinks.instagram;
      }
      
      // Store crawl data for future reference
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
      socialUpdates.lastFullCrawl = new Date();
      
      // Store blog snapshot if discovered
      if (crawlResult.blogSnapshot && crawlResult.blogSnapshot.postCount > 0) {
        const existingBlogSnapshot = profile.blogSnapshot as any;
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
            sourceType: "baseline",
            companyProfileId: profile.id,
            competitorName: profile.companyName,
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
        await storage.updateCompanyProfile(profile.id, socialUpdates);
      }

      // Get combined content from all crawled pages
      const websiteContent = getCombinedContent(crawlResult);
      
      // Fetch grounding documents for this tenant to include in analysis
      const groundingDocs = await storage.getGroundingDocumentsByTenant(ctx.tenantDomain);
      const globalDocs = await storage.getAllGlobalGroundingDocuments();
      
      // Build grounding context from documents
      let groundingContext = "";
      if (groundingDocs.length > 0 || globalDocs.length > 0) {
        const allDocs = [...groundingDocs, ...globalDocs];
        groundingContext = allDocs
          .filter(doc => doc.extractedText)
          .map(doc => `[${doc.name}]: ${doc.extractedText?.substring(0, 5000)}`)
          .join("\n\n");
      }

      // Extract LinkedIn data from profile if available
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
      
      // Use AI analysis with grounding context and LinkedIn data
      const analysisResult = await analyzeCompetitorWebsite(
        profile.companyName, 
        profile.websiteUrl, 
        websiteContent,
        groundingContext || undefined,
        linkedInData
      );

      // Update profile with analysis data
      // But protect manual research data from being overwritten
      if (hasManualResearch) {
        // Preserve manual research, only update crawl metadata
        console.log(`Skipping analysis update for ${profile.companyName} - has manual research data`);
        await storage.updateCompanyProfile(profile.id, {
          lastAnalysis: new Date(),
        });
      } else {
        await storage.updateCompanyProfile(profile.id, {
          lastAnalysis: new Date(),
          analysisData: analysisResult,
        });
      }
      
      // Refetch the profile for response
      const updated = await storage.getCompanyProfileByContext(toContextFilter(ctx));

      res.json({
        ...updated,
        crawlStats: {
          pagesCrawled: crawlResult.pages.length,
          totalWordCount: crawlResult.totalWordCount,
          groundingDocsUsed: groundingDocs.length + globalDocs.length,
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete company profile
  app.delete("/api/company-profile", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const profile = await storage.getCompanyProfileByContext(toContextFilter(ctx));

      if (!profile) {
        return res.status(404).json({ error: "Company profile not found" });
      }

      await storage.deleteCompanyProfile(profile.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Save manual AI research for company profile (when crawl fails)
  app.post("/api/company-profile/manual-research", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const profile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      if (!profile) {
        return res.status(404).json({ error: "Company profile not found" });
      }

      const { researchContent } = req.body;
      if (!researchContent || researchContent.trim().length < 100) {
        return res.status(400).json({ error: "Research content is required (minimum 100 characters)" });
      }

      // Parse the manual research content into structured data
      const analysisData = parseManualResearch(researchContent, profile.companyName);
      
      // Mark as manual source to protect from crawl overwrites
      analysisData.source = "manual";
      analysisData.manualResearchDate = new Date().toISOString();

      await storage.updateCompanyProfile(profile.id, {
        analysisData,
        lastAnalysis: new Date(),
      });
      
      // Create activity entry
      await storage.createActivity({
        type: "manual_research",
        sourceType: "baseline",
        companyProfileId: profile.id,
        competitorName: profile.companyName,
        description: `Manual AI research saved for baseline: ${analysisData.summary?.substring(0, 100) || "Company intelligence gathered"}...`,
        date: new Date().toLocaleString(),
        impact: "Medium",
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });

      res.json({ success: true, analysisData });
    } catch (error: any) {
      console.error("Manual research save error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Upload company logo
  app.post("/api/upload/logo", async (req, res) => {
    try {
      // Verify context to enforce tenant security
      const ctx = await getRequestContext(req);
      
      const files = req.files;
      if (!files || !files.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const file = files.file as UploadedFile;
      
      // Validate file using comprehensive security validator
      const { validateImageUpload } = await import("./utils/file-validator");
      const fileValidation = validateImageUpload(file);
      if (!fileValidation.isValid) {
        return res.status(400).json({ error: fileValidation.error });
      }

      const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!BUCKET_ID) {
        return res.status(500).json({ error: "Object storage not configured" });
      }

      // Generate unique filename with tenant context for organization
      const ext = file.name.split('.').pop() || 'png';
      const tenantSlug = ctx.tenantDomain.replace(/[^a-z0-9]/gi, '-');
      const filename = `${tenantSlug}-logo-${randomUUID()}.${ext}`;
      
      // Upload to object storage
      const bucket = objectStorageClient.bucket(BUCKET_ID);
      const gcsFile = bucket.file(`public/logos/${filename}`);
      
      await gcsFile.save(file.data, {
        contentType: file.mimetype,
        public: true,
      });

      const url = `https://storage.googleapis.com/${BUCKET_ID}/public/logos/${filename}`;
      res.json({ url });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Logo upload error:", error);
      res.status(500).json({ error: "Failed to upload logo" });
    }
  });

  // ==================== ASSESSMENT ROUTES (Snapshots & Proxy) ====================

  // Get all assessments for current tenant
  app.get("/api/assessments", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const assessments = await storage.getAssessmentsByContext(toContextFilter(ctx));
      res.json(assessments);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get single assessment
  app.get("/api/assessments/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const assessment = await storage.getAssessment(req.params.id);
      if (!assessment) {
        return res.status(404).json({ error: "Assessment not found" });
      }

      // Validate assessment belongs to current context
      if (!validateResourceContext(assessment, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(assessment);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Create new assessment (snapshot current state)
  app.post("/api/assessments", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      // Gather current state for snapshot (context-scoped)
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      // Note: Analysis and recommendations tables are not yet tenant-scoped
      // Capturing empty objects/arrays until these are refactored for multi-tenancy
      // to prevent cross-tenant data leakage
      const latestAnalysis = { themes: [], messaging: [], gaps: [] };
      const recommendations: any[] = [];
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));

      // Validate input with proxy fields
      const parsed = insertAssessmentSchema.safeParse({
        name: req.body.name,
        description: req.body.description,
        userId: ctx.userId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
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
      const user = await storage.getUser(ctx.userId);
      if (parsed.data.isProxy && user?.role === "Standard User") {
        return res.status(403).json({ error: "Only admins can create proxy assessments" });
      }

      const assessment = await storage.createAssessment(parsed.data);
      res.json(assessment);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Update assessment
  app.put("/api/assessments/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const assessment = await storage.getAssessment(req.params.id);
      if (!assessment) {
        return res.status(404).json({ error: "Assessment not found" });
      }

      // Validate assessment belongs to current context
      if (!validateResourceContext(assessment, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateAssessment(req.params.id, {
        name: req.body.name,
        description: req.body.description,
      });
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Delete assessment
  app.delete("/api/assessments/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const assessment = await storage.getAssessment(req.params.id);
      if (!assessment) {
        return res.status(404).json({ error: "Assessment not found" });
      }

      // Validate assessment belongs to current context
      if (!validateResourceContext(assessment, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteAssessment(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
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

  // Create a new tenant (Global Admin only)
  app.post("/api/tenants", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const { 
        domain, name, plan, status, 
        competitorLimit, analysisLimit, 
        adminUserLimit, readWriteUserLimit, readOnlyUserLimit,
        primaryColor, secondaryColor 
      } = req.body;

      if (!domain || typeof domain !== "string" || !domain.includes(".")) {
        return res.status(400).json({ error: "Valid domain is required (e.g., company.com)" });
      }
      
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Company name is required" });
      }

      const normalizedDomain = domain.toLowerCase().trim();
      
      // Check if tenant already exists
      const existingTenant = await storage.getTenantByDomain(normalizedDomain);
      if (existingTenant) {
        return res.status(400).json({ error: "Tenant with this domain already exists" });
      }

      const effectivePlan = plan || "trial";
      const trialDates = effectivePlan === "trial" ? {
        trialStartDate: new Date(),
        trialEndsAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      } : {};
      
      const newTenant = await storage.createTenant({
        domain: normalizedDomain,
        name: name.trim(),
        plan: effectivePlan,
        status: status || "active",
        ...trialDates,
        userCount: 0,
        competitorLimit: competitorLimit ?? 3,
        analysisLimit: analysisLimit ?? 5,
        adminUserLimit: adminUserLimit ?? 1,
        readWriteUserLimit: readWriteUserLimit ?? 2,
        readOnlyUserLimit: readOnlyUserLimit ?? 5,
        primaryColor: primaryColor || "#810FFB",
        secondaryColor: secondaryColor || "#E60CB3",
      });

      res.status(201).json(newTenant);
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

      const validPlans = ["free", "pro", "enterprise", "trial"];
      const validStatuses = ["active", "suspended", "inactive"];
      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      
      const { domain, plan, status, competitorLimit, analysisLimit, name, logoUrl, faviconUrl, primaryColor, secondaryColor } = req.body;
      const updateData: { domain?: string; plan?: string; status?: string; competitorLimit?: number; analysisLimit?: number; name?: string; logoUrl?: string | null; faviconUrl?: string | null; primaryColor?: string; secondaryColor?: string } = {};
      
      if (domain && typeof domain === "string" && domain.includes(".")) {
        // Check if domain is already taken by another tenant
        const existingTenant = await storage.getTenantByDomain(domain.toLowerCase());
        if (existingTenant && existingTenant.id !== req.params.id) {
          return res.status(400).json({ error: "Domain is already used by another tenant" });
        }
        updateData.domain = domain.toLowerCase();
      }
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

  // Delete a tenant (Global Admin only)
  app.delete("/api/tenants/:id", async (req, res) => {
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

      // Prevent deleting the tenant the current user belongs to
      const userDomain = user.email.split("@")[1]?.toLowerCase();
      if (tenant.domain.toLowerCase() === userDomain) {
        return res.status(400).json({ error: "Cannot delete your own tenant" });
      }

      await storage.deleteTenant(req.params.id);
      res.json({ success: true, message: "Tenant deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting tenant:", error);
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

  // ==================== MARKET MANAGEMENT & CONTEXT SWITCHING ====================

  // Get accessible tenants for current user (for tenant switcher)
  app.get("/api/tenants/accessible", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const userDomain = user.email.split("@")[1];
      const userTenant = await storage.getTenantByDomain(userDomain);
      
      if (!userTenant) {
        return res.status(404).json({ error: "No tenant found for your organization. Please contact your administrator." });
      }
      
      const accessibleTenants = await storage.getAccessibleTenants(user.id, user.role, userDomain);
      
      res.json({
        tenants: accessibleTenants,
        activeTenantId: req.session.activeTenantId || userTenant.id,
        activeMarketId: req.session.activeMarketId || null,
        canSwitchTenants: user.role === "Global Admin" || user.role === "Consultant"
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Switch active tenant context (Global Admin and Consultant only)
  app.post("/api/context/tenant", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const parsed = switchTenantSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasCrossTenantReadAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - only Global Admin and Consultants can switch tenants" });
      }

      const { tenantId } = parsed.data;
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      if (tenant.status !== "active") {
        return res.status(400).json({ error: "Cannot switch to a suspended or inactive tenant" });
      }

      const userDomain = user.email.split("@")[1];
      const accessibleTenants = await storage.getAccessibleTenants(user.id, user.role, userDomain);
      
      if (!accessibleTenants.find(t => t.id === tenantId)) {
        return res.status(403).json({ error: "Access denied - you don't have access to this tenant" });
      }

      const defaultMarket = await storage.getDefaultMarket(tenantId);
      
      req.session.activeTenantId = tenantId;
      req.session.activeMarketId = defaultMarket?.id || undefined;
      
      res.json({
        activeTenantId: tenantId,
        activeMarketId: defaultMarket?.id || null,
        message: "Tenant context switched successfully"
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get markets for a tenant
  app.get("/api/markets", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const userDomain = user.email.split("@")[1];
      const userTenant = await storage.getTenantByDomain(userDomain);
      
      const targetTenantId = req.session.activeTenantId || userTenant?.id;
      if (!targetTenantId) {
        return res.status(400).json({ error: "No tenant context available" });
      }

      const accessibleTenants = await storage.getAccessibleTenants(user.id, user.role, userDomain);
      if (!accessibleTenants.find(t => t.id === targetTenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const tenant = await storage.getTenant(targetTenantId);
      const marketsList = await storage.getMarketsByTenant(targetTenantId);
      
      res.json({
        markets: marketsList,
        activeMarketId: req.session.activeMarketId || null,
        multiMarketEnabled: tenant?.multiMarketEnabled || false,
        marketLimit: tenant?.marketLimit || 1
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new market (Enterprise tenants with multi-market enabled)
  app.post("/api/markets", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const userDomain = user.email.split("@")[1];
      const userTenant = await storage.getTenantByDomain(userDomain);
      
      const targetTenantId = req.session.activeTenantId || userTenant?.id;
      if (!targetTenantId) {
        return res.status(400).json({ error: "No tenant context available" });
      }

      const tenant = await storage.getTenant(targetTenantId);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      if (!tenant.multiMarketEnabled) {
        return res.status(403).json({ error: "Multi-market feature is not enabled for this tenant. Please upgrade to Enterprise plan." });
      }

      const existingMarkets = await storage.getMarketsByTenant(targetTenantId);
      if (existingMarkets.length >= (tenant.marketLimit || 1)) {
        return res.status(400).json({ error: `Market limit reached (${tenant.marketLimit}). Contact support to increase your limit.` });
      }

      const { name, description, websiteUrl } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Market name is required" });
      }

      const newMarket = await storage.createMarket({
        tenantId: targetTenantId,
        name: name.trim(),
        description: description?.trim() || null,
        isDefault: false,
        status: "active",
        createdBy: user.id,
      });

      // If a website URL was provided, automatically create a company profile for this market
      if (websiteUrl) {
        try {
          await storage.createCompanyProfile({
            userId: user.id,
            tenantDomain: tenant.domain,
            marketId: newMarket.id,
            companyName: name.trim(),
            websiteUrl: websiteUrl.trim(),
            description: description?.trim() || null,
          });
          console.log(`[Market Creation] Auto-created baseline company profile for market: ${newMarket.name}`);
        } catch (profileError) {
          console.error(`[Market Creation] Failed to create baseline company profile:`, profileError);
          // Don't fail market creation if profile creation fails
        }
      }

      res.status(201).json(newMarket);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Analyze a URL for market creation (get company name and description)
  app.post("/api/markets/analyze-url", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      // Validate URL format
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          return res.status(400).json({ error: "Only HTTP/HTTPS URLs are allowed" });
        }
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }

      // Crawl the website
      const crawlResult = await crawlCompetitorWebsite(url);
      
      // Check if crawl was successful (has at least one page with content)
      if (!crawlResult.pages || crawlResult.pages.length === 0 || crawlResult.totalWordCount === 0) {
        return res.status(400).json({ error: "Could not analyze website. Please check the URL and try again." });
      }

      // Combine page content for AI analysis
      const combinedContent = crawlResult.pages.map(p => `${p.title}\n${p.content}`).join("\n\n");

      // Extract company name from URL or analysis
      let companyName = parsedUrl.hostname.replace(/^www\./, "").split(".")[0];
      companyName = companyName.charAt(0).toUpperCase() + companyName.slice(1);

      // Check if AI is configured
      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
        // Return basic info without AI analysis
        return res.json({ 
          companyName, 
          description: `Market context for ${companyName}`
        });
      }

      // Use AI to get a better company name and description
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const analysisPrompt = `Analyze this website content and provide:
1. The company/organization name
2. A brief 1-2 sentence description of what they do

Website URL: ${url}
Website Content:
${combinedContent.substring(0, 4000)}

Respond in JSON format:
{
  "companyName": "Company Name",
  "description": "Brief description of what the company does"
}`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 500,
        messages: [{ role: "user", content: analysisPrompt }],
      });

      let result = { companyName, description: "" };
      try {
        const responseText = message.content[0].type === "text" ? message.content[0].text : "";
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          result.companyName = parsed.companyName || companyName;
          result.description = parsed.description || "";
        }
      } catch (e) {
        console.error("Failed to parse AI response for market URL analysis:", e);
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update a market
  app.patch("/api/markets/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const market = await storage.getMarket(req.params.id);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      const userDomain = user.email.split("@")[1];
      const accessibleTenants = await storage.getAccessibleTenants(user.id, user.role, userDomain);
      if (!accessibleTenants.find(t => t.id === market.tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { name, description, status } = req.body;
      const updates: any = {};
      const wasArchived = market.status === "archived";
      
      if (name !== undefined) updates.name = name.trim();
      if (description !== undefined) updates.description = description?.trim() || null;
      if (status !== undefined && ["active", "archived"].includes(status)) {
        updates.status = status;
      }

      const updatedMarket = await storage.updateMarket(req.params.id, updates);
      
      // Invalidate market status cache if status was updated
      if (status !== undefined) {
        invalidateMarketStatusCache(req.params.id);
      }
      
      // If unarchiving (was archived, now active), trigger immediate refreshes
      if (wasArchived && status === "active") {
        // Get tenant domain from the market's tenant
        const tenant = await storage.getTenant(market.tenantId);
        const tenantDomain = tenant?.domain || "";
        
        if (tenantDomain) {
          // Get all competitors and company profile in this market
          const competitors = await storage.getCompetitorsByContext({ 
            tenantDomain,
            marketId: market.id 
          });
          const companyProfile = await storage.getCompanyProfileByContext({
            tenantDomain,
            marketId: market.id
          });
          
          console.log(`[Unarchive] Triggering refresh for market ${market.name} - ${competitors.length} competitors`);
          
          // Trigger website monitoring for all competitors
          for (const competitor of competitors) {
            monitorCompetitorWebsite(competitor, {
              tenantDomain,
              marketId: market.id
            }).catch(err => console.error(`Unarchive refresh error for ${competitor.name}:`, err));
          }
          
          // Trigger baseline monitoring
          if (companyProfile) {
            monitorCompanyProfileWebsite(companyProfile, {
              tenantDomain,
              marketId: market.id
            }).catch(err => console.error(`Unarchive refresh error for baseline:`, err));
          }
          
          // Trigger social monitoring for all competitors
          for (const competitor of competitors) {
            monitorCompetitorSocialMedia(competitor, {
              tenantDomain,
              marketId: market.id
            }).catch(err => console.error(`Unarchive social refresh error for ${competitor.name}:`, err));
          }
        }
      }
      
      res.json(updatedMarket);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a market (non-default only)
  app.delete("/api/markets/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const market = await storage.getMarket(req.params.id);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      // Cannot delete default market
      if (market.isDefault) {
        return res.status(400).json({ error: "Cannot delete the default market" });
      }

      // Verify user has access to this tenant
      const userDomain = user.email.split("@")[1];
      const accessibleTenants = await storage.getAccessibleTenants(user.id, user.role, userDomain);
      if (!accessibleTenants.find(t => t.id === market.tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Delete market and associated data
      await storage.deleteMarket(req.params.id);

      // If the deleted market was the active market, switch to default
      if (req.session.activeMarketId === req.params.id) {
        const defaultMarket = await storage.getDefaultMarket(market.tenantId);
        req.session.activeMarketId = defaultMarket?.id || undefined;
      }

      res.json({ success: true, message: "Market deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Comprehensive market export - exports everything in a market to markdown
  app.get("/api/markets/:marketId/export", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const market = await storage.getMarket(req.params.marketId);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      // Validate market belongs to current tenant
      if (market.tenantId !== ctx.tenantId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Build context filter for the requested market
      const marketCtx = {
        tenantId: ctx.tenantId,
        marketId: req.params.marketId,
        tenantDomain: ctx.tenantDomain,
        isDefaultMarket: market.isDefault,
      };

      // Gather all market data
      // For default market, include profiles with null marketId (legacy data)
      const companyProfiles = await storage.getCompanyProfilesByTenantDomain(ctx.tenantDomain);
      const marketCompanyProfiles = market.isDefault 
        ? companyProfiles.filter(p => p.marketId === req.params.marketId || p.marketId === null)
        : companyProfiles.filter(p => p.marketId === req.params.marketId);
      const competitors = await storage.getCompetitorsByContext(marketCtx);
      const projects = await storage.getClientProjectsByContext(marketCtx);
      const products = await storage.getProductsByContext(marketCtx);

      // Build comprehensive markdown
      let md = `# ${market.name} - Complete Market Intelligence Export\n\n`;
      md += `**Tenant:** ${ctx.tenantDomain}\n`;
      md += `**Generated:** ${new Date().toISOString()}\n\n`;
      md += `---\n\n`;

      // Gather marketing plans
      const marketingPlansData = await storage.getMarketingPlans({ 
        tenantDomain: ctx.tenantDomain, 
        marketId: req.params.marketId 
      });

      // Gather additional data
      const activityData = await storage.getActivityByContext(marketCtx);
      const assessmentsData = await storage.getAssessmentsByContext(marketCtx);
      const companyBattlecardsData = await storage.getBattlecardsByContext(marketCtx);
      const competitorScoresData = await storage.getCompetitorScoresByContext(marketCtx);

      // Table of Contents
      md += `## Table of Contents\n\n`;
      md += `1. [Market Overview](#market-overview)\n`;
      md += `2. [Company Profiles](#company-profiles) (includes executive summaries)\n`;
      md += `3. [Competitors](#competitors) (includes scores, battlecards)\n`;
      md += `4. [Projects](#projects) (includes battlecards, gap analysis, GTM plans, messaging)\n`;
      md += `5. [Products](#products) (includes features, roadmaps, AI recommendations)\n`;
      md += `6. [Marketing Plans](#marketing-plans)\n`;
      md += `7. [Assessments](#assessments)\n`;
      md += `8. [Activity Log](#activity-log)\n\n`;
      md += `---\n\n`;

      // Market Overview
      md += `## Market Overview\n\n`;
      md += `**Name:** ${market.name}\n`;
      if (market.description) {
        md += `**Description:** ${market.description}\n`;
      }
      md += `**Status:** ${market.status || "active"}\n`;
      md += `**Created:** ${market.createdAt ? new Date(market.createdAt).toLocaleDateString() : "N/A"}\n\n`;
      md += `### Summary Statistics\n\n`;
      md += `- **Company Profiles:** ${marketCompanyProfiles.length}\n`;
      md += `- **Competitors Tracked:** ${competitors.length}\n`;
      md += `- **Active Projects:** ${projects.length}\n`;
      md += `- **Products:** ${products.length}\n\n`;
      md += `---\n\n`;

      // Company Profiles
      md += `## Company Profiles\n\n`;
      if (marketCompanyProfiles.length === 0) {
        md += `*No company profiles defined in this market.*\n\n`;
      } else {
        for (const profile of marketCompanyProfiles) {
          md += `### ${profile.companyName}\n\n`;
          if (profile.websiteUrl) md += `- **Website:** ${profile.websiteUrl}\n`;
          if (profile.description) md += `\n${profile.description}\n`;
          
          // Include analysis if available
          if (profile.analysisData) {
            const analysis = typeof profile.analysisData === "string" 
              ? JSON.parse(profile.analysisData) 
              : profile.analysisData;
            if (analysis.summary) {
              md += `\n#### Analysis Summary\n\n${analysis.summary}\n`;
            }
            if (analysis.strengths?.length > 0) {
              md += `\n**Strengths:**\n`;
              analysis.strengths.forEach((s: string) => md += `- ${s}\n`);
            }
            if (analysis.weaknesses?.length > 0) {
              md += `\n**Weaknesses:**\n`;
              analysis.weaknesses.forEach((w: string) => md += `- ${w}\n`);
            }
          }

          // Include executive summary if available
          const execSummary = await storage.getExecutiveSummary(undefined, profile.id);
          if (execSummary?.summaryData) {
            md += `\n#### Executive Summary\n\n`;
            md += `*Generated: ${execSummary.lastGeneratedAt ? new Date(execSummary.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
            const summaryData = typeof execSummary.summaryData === "string" 
              ? JSON.parse(execSummary.summaryData) 
              : execSummary.summaryData;
            if (summaryData.summary) md += summaryData.summary + `\n`;
            if (execSummary.keyInsights) {
              const insights = execSummary.keyInsights as string[];
              if (insights?.length > 0) {
                md += `\n**Key Insights:**\n`;
                insights.forEach(i => md += `- ${i}\n`);
              }
            }
          }

          md += `\n`;
        }
      }
      md += `---\n\n`;

      // Competitors
      md += `## Competitors\n\n`;
      if (competitors.length === 0) {
        md += `*No competitors tracked in this market.*\n\n`;
      } else {
        for (const comp of competitors) {
          md += `### ${comp.name}\n\n`;
          if (comp.url) md += `- **Website:** ${comp.url}\n`;
          md += `- **Status:** ${comp.status || "active"}\n`;
          
          // Include analysis if available
          if (comp.analysisData) {
            const analysis = typeof comp.analysisData === "string" 
              ? JSON.parse(comp.analysisData) 
              : comp.analysisData;
            if (analysis.summary) {
              md += `\n#### Analysis Summary\n\n${analysis.summary}\n`;
            }
            if (analysis.strengths?.length > 0) {
              md += `\n**Strengths:**\n`;
              analysis.strengths.forEach((s: string) => md += `- ${s}\n`);
            }
            if (analysis.weaknesses?.length > 0) {
              md += `\n**Weaknesses:**\n`;
              analysis.weaknesses.forEach((w: string) => md += `- ${w}\n`);
            }
            if (analysis.opportunities?.length > 0) {
              md += `\n**Opportunities:**\n`;
              analysis.opportunities.forEach((o: string) => md += `- ${o}\n`);
            }
            if (analysis.threats?.length > 0) {
              md += `\n**Threats:**\n`;
              analysis.threats.forEach((t: string) => md += `- ${t}\n`);
            }
          }

          // Include competitor score if available
          const compScore = competitorScoresData.find(s => s.competitorId === comp.id);
          if (compScore) {
            md += `\n#### Orbit Score\n\n`;
            md += `- **Overall Score:** ${compScore.overallScore || "N/A"}/100\n`;
            if (compScore.marketPresenceScore) md += `- **Market Presence:** ${compScore.marketPresenceScore}\n`;
            if (compScore.innovationScore) md += `- **Innovation:** ${compScore.innovationScore}\n`;
            if (compScore.pricingScore) md += `- **Pricing:** ${compScore.pricingScore}\n`;
            if (compScore.featureBreadthScore) md += `- **Feature Breadth:** ${compScore.featureBreadthScore}\n`;
            if (compScore.contentActivityScore) md += `- **Content Activity:** ${compScore.contentActivityScore}\n`;
            if (compScore.socialEngagementScore) md += `- **Social Engagement:** ${compScore.socialEngagementScore}\n`;
            if (compScore.trendDirection) md += `- **Trend:** ${compScore.trendDirection} (${compScore.trendDelta >= 0 ? '+' : ''}${compScore.trendDelta || 0})\n`;
            md += `\n`;
          }

          // Include company battlecard if available
          const compBattlecard = companyBattlecardsData.find(b => b.competitorId === comp.id);
          if (compBattlecard) {
            md += `\n#### Battlecard\n\n`;
            const strengths = compBattlecard.strengths as string[] | null;
            const weaknesses = compBattlecard.weaknesses as string[] | null;
            const ourAdvantages = compBattlecard.ourAdvantages as string[] | null;
            const objections = compBattlecard.objections as { objection: string; response: string }[] | null;
            const talkTracks = compBattlecard.talkTracks as { scenario: string; script: string }[] | null;

            if (strengths?.length) {
              md += `**Their Strengths:**\n`;
              strengths.forEach(s => md += `- ${s}\n`);
              md += `\n`;
            }
            if (weaknesses?.length) {
              md += `**Their Weaknesses:**\n`;
              weaknesses.forEach(w => md += `- ${w}\n`);
              md += `\n`;
            }
            if (ourAdvantages?.length) {
              md += `**Our Advantages:**\n`;
              ourAdvantages.forEach(a => md += `- ${a}\n`);
              md += `\n`;
            }
            if (objections?.length) {
              md += `**Objection Handling:**\n`;
              objections.forEach(o => md += `- *"${o.objection}"* → ${o.response}\n`);
              md += `\n`;
            }
            if (talkTracks?.length) {
              md += `**Talk Tracks:**\n`;
              talkTracks.forEach(t => md += `- **${t.scenario}**: "${t.script}"\n`);
              md += `\n`;
            }
          }

          md += `\n`;
        }
      }
      md += `---\n\n`;

      // Projects with full details
      md += `## Projects\n\n`;
      if (projects.length === 0) {
        md += `*No projects in this market.*\n\n`;
      } else {
        for (const project of projects) {
          md += `### ${project.name}\n\n`;
          md += `- **Client:** ${project.clientName}\n`;
          md += `- **Type:** ${project.analysisType === "product" ? "Product Analysis" : "Company Analysis"}\n`;
          md += `- **Status:** ${project.status}\n`;
          if (project.description) md += `\n${project.description}\n`;
          md += `\n`;

          // Get project products
          const projectProducts = await storage.getProjectProducts(project.id);
          const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
          const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

          if (baselineProduct) {
            md += `#### Baseline Product\n`;
            md += `- **${baselineProduct.product?.name || "Unnamed"}** (${baselineProduct.product?.companyName || "Unknown"})\n\n`;
          }

          if (competitorProducts.length > 0) {
            md += `#### Competitor Products (${competitorProducts.length})\n`;
            for (const cp of competitorProducts) {
              md += `- ${cp.product?.name || "Unnamed"} (${cp.product?.companyName || "Unknown"})\n`;
            }
            md += `\n`;
          }

          // Get long-form recommendations for project
          const recommendations = await storage.getLongFormRecommendationsByProject(project.id);
          
          const gapAnalysis = recommendations.find(r => r.type === "gap_analysis");
          const strategicRecs = recommendations.find(r => r.type === "strategic_recommendations");
          const competitiveSummary = recommendations.find(r => r.type === "competitive_summary");
          const gtmPlan = recommendations.find(r => r.type === "gtm_plan");
          const messagingFramework = recommendations.find(r => r.type === "messaging_framework");
          const productOneSheet = recommendations.find(r => r.type === "product_one_sheet");

          if (gapAnalysis?.status === "generated" && gapAnalysis.content) {
            md += `#### Gap Analysis\n\n`;
            md += `*Generated: ${gapAnalysis.lastGeneratedAt ? new Date(gapAnalysis.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
            md += gapAnalysis.content + `\n\n`;
          }

          if (strategicRecs?.status === "generated" && strategicRecs.content) {
            md += `#### Strategic Recommendations\n\n`;
            md += `*Generated: ${strategicRecs.lastGeneratedAt ? new Date(strategicRecs.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
            md += strategicRecs.content + `\n\n`;
          }

          if (competitiveSummary?.status === "generated" && competitiveSummary.content) {
            md += `#### Competitive Summary\n\n`;
            md += `*Generated: ${competitiveSummary.lastGeneratedAt ? new Date(competitiveSummary.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
            md += competitiveSummary.content + `\n\n`;
          }

          if (gtmPlan?.status === "generated" && gtmPlan.content) {
            md += `#### Go-to-Market Plan\n\n`;
            md += `*Generated: ${gtmPlan.lastGeneratedAt ? new Date(gtmPlan.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
            md += gtmPlan.content + `\n\n`;
          }

          if (messagingFramework?.status === "generated" && messagingFramework.content) {
            md += `#### Messaging Framework\n\n`;
            md += `*Generated: ${messagingFramework.lastGeneratedAt ? new Date(messagingFramework.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
            md += messagingFramework.content + `\n\n`;
          }

          if (productOneSheet?.status === "generated" && productOneSheet.content) {
            md += `#### Product One Sheet\n\n`;
            md += `*Generated: ${productOneSheet.lastGeneratedAt ? new Date(productOneSheet.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
            md += productOneSheet.content + `\n\n`;
          }

          // Get battlecards for this project
          const battlecards = await storage.getProductBattlecardsByProject(project.id);
          const publishedBattlecards = battlecards.filter(bc => 
            bc.status === "published" || (Array.isArray(bc.strengths) && (bc.strengths as string[]).length > 0)
          );

          if (publishedBattlecards.length > 0) {
            md += `#### Battlecards\n\n`;
            for (const bc of publishedBattlecards) {
              const competitor = competitorProducts.find(cp => cp.productId === bc.competitorProductId);
              md += `##### ${competitor?.product?.name || "Competitor"}\n\n`;

              const strengths = bc.strengths as string[] | null;
              const weaknesses = bc.weaknesses as string[] | null;
              const ourAdvantages = bc.ourAdvantages as string[] | null;
              const keyDifferentiators = bc.keyDifferentiators as { feature: string; ours: string; theirs: string }[] | null;
              const objections = bc.objections as { objection: string; response: string }[] | null;
              const talkTracks = bc.talkTracks as { scenario: string; script: string }[] | null;

              if (strengths?.length) {
                md += `**Their Strengths:**\n`;
                strengths.forEach(s => md += `- ${s}\n`);
                md += `\n`;
              }
              if (weaknesses?.length) {
                md += `**Their Weaknesses:**\n`;
                weaknesses.forEach(w => md += `- ${w}\n`);
                md += `\n`;
              }
              if (ourAdvantages?.length) {
                md += `**Our Advantages:**\n`;
                ourAdvantages.forEach(a => md += `- ${a}\n`);
                md += `\n`;
              }
              if (keyDifferentiators?.length) {
                md += `**Key Differentiators:**\n`;
                keyDifferentiators.forEach(d => md += `- **${d.feature}**: Ours: ${d.ours} | Theirs: ${d.theirs}\n`);
                md += `\n`;
              }
              if (objections?.length) {
                md += `**Objection Handling:**\n`;
                objections.forEach(o => md += `- *"${o.objection}"* → ${o.response}\n`);
                md += `\n`;
              }
              if (talkTracks?.length) {
                md += `**Talk Tracks:**\n`;
                talkTracks.forEach(t => md += `- **${t.scenario}**: "${t.script}"\n`);
                md += `\n`;
              }
            }
          }
        }
      }
      md += `---\n\n`;

      // Products with Features and Roadmap
      md += `## Products\n\n`;
      if (products.length === 0) {
        md += `*No products defined in this market.*\n\n`;
      } else {
        for (const product of products) {
          md += `### ${product.name}\n\n`;
          if (product.companyName) md += `- **Company:** ${product.companyName}\n`;
          if (product.url) md += `- **URL:** ${product.url}\n`;
          md += `- **Type:** ${product.isBaseline ? "Baseline" : (product.competitorId ? "Competitor" : "Product")}\n`;
          if (product.description) md += `\n${product.description}\n`;
          md += `\n`;

          // Get features
          const features = await storage.getProductFeaturesByProduct(product.id);
          if (features.length > 0) {
            md += `#### Features (${features.length})\n\n`;
            
            // Group by category
            const byCategory: Record<string, typeof features> = {};
            for (const f of features) {
              const cat = f.category || "Uncategorized";
              if (!byCategory[cat]) byCategory[cat] = [];
              byCategory[cat].push(f);
            }
            
            for (const [category, catFeatures] of Object.entries(byCategory)) {
              md += `**${category}**\n`;
              for (const f of catFeatures) {
                const statusIcon = f.status === "available" ? "✅" : f.status === "planned" ? "🔜" : f.status === "beta" ? "🧪" : "❌";
                md += `- ${statusIcon} **${f.name}**`;
                if (f.priority) md += ` [${f.priority}]`;
                if (f.description) md += `: ${f.description}`;
                md += `\n`;
              }
              md += `\n`;
            }
          }

          // Get roadmap items
          const roadmapItems = await storage.getRoadmapItemsByProduct(product.id);
          if (roadmapItems.length > 0) {
            md += `#### Roadmap (${roadmapItems.length} items)\n\n`;
            
            // Group by quarter
            const byQuarter: Record<string, typeof roadmapItems> = {};
            for (const item of roadmapItems) {
              const q = item.quarter ? `${item.quarter} ${item.year}` : "Unscheduled";
              if (!byQuarter[q]) byQuarter[q] = [];
              byQuarter[q].push(item);
            }
            
            for (const [quarter, items] of Object.entries(byQuarter)) {
              md += `**${quarter}**\n`;
              for (const item of items) {
                const statusIcon = item.status === "completed" ? "✅" : item.status === "in_progress" ? "🔄" : "📋";
                md += `- ${statusIcon} **${item.title}**`;
                if (item.effort) md += ` [${item.effort}]`;
                if (item.description) md += `: ${item.description}`;
                md += `\n`;
              }
              md += `\n`;
            }
          }

          // Get AI feature recommendations for baseline products
          if (product.isBaseline) {
            const featureRecs = await storage.getFeatureRecommendationsByProduct(product.id);
            const pendingRecs = featureRecs.filter(r => r.status === "pending");
            if (pendingRecs.length > 0) {
              md += `#### AI Roadmap Recommendations (${pendingRecs.length})\n\n`;
              for (const rec of pendingRecs) {
                const typeIcon = rec.type === "gap" ? "🎯" : rec.type === "opportunity" ? "💡" : rec.type === "risk" ? "⚠️" : "📊";
                md += `- ${typeIcon} **${rec.title}** [${rec.type}]`;
                if (rec.suggestedPriority) md += ` (${rec.suggestedPriority} priority)`;
                if (rec.suggestedQuarter) md += ` - ${rec.suggestedQuarter}`;
                md += `\n`;
                if (rec.explanation) md += `  ${rec.explanation}\n`;
                md += `\n`;
              }
            }
          }

          // Include product analysis if available
          if (product.analysisData) {
            const analysis = typeof product.analysisData === "string" 
              ? JSON.parse(product.analysisData) 
              : product.analysisData;
            if (analysis.summary) {
              md += `#### Analysis\n\n${analysis.summary}\n\n`;
            }
          }
        }
      }

      md += `---\n\n`;

      // Marketing Plans section
      md += `## Marketing Plans\n\n`;
      if (marketingPlansData.length === 0) {
        md += `*No marketing plans in this market.*\n\n`;
      } else {
        for (const plan of marketingPlansData) {
          md += `### ${plan.name}\n\n`;
          if (plan.description) md += `${plan.description}\n\n`;
          md += `- **Fiscal Year:** ${plan.fiscalYear || "Not specified"}\n`;
          md += `- **Status:** ${plan.status || "draft"}\n`;
          md += `- **Created:** ${plan.createdAt ? new Date(plan.createdAt).toLocaleDateString() : "N/A"}\n\n`;

          // Get tasks for this plan
          const tasks = await storage.getMarketingTasks(plan.id, { 
            tenantDomain: ctx.tenantDomain, 
            marketId: req.params.marketId 
          });

          if (tasks.length > 0) {
            md += `#### Activities (${tasks.length})\n\n`;
            
            // Group by timeframe/quarter
            const byTimeframe: Record<string, typeof tasks> = {};
            for (const task of tasks) {
              const tf = task.timeframe || "Unscheduled";
              if (!byTimeframe[tf]) byTimeframe[tf] = [];
              byTimeframe[tf].push(task);
            }

            for (const [timeframe, tfTasks] of Object.entries(byTimeframe)) {
              md += `**${timeframe}**\n`;
              for (const task of tfTasks) {
                const statusIcon = task.status === "completed" ? "✅" : task.status === "in_progress" ? "🔄" : "📋";
                md += `- ${statusIcon} **${task.title}**`;
                if (task.priority) md += ` [${task.priority}]`;
                if (task.activityGroup) md += ` (${task.activityGroup})`;
                md += `\n`;
                if (task.description) md += `  ${task.description}\n`;
              }
              md += `\n`;
            }
          }
        }
      }

      md += `---\n\n`;

      // Assessments section
      md += `## Assessments\n\n`;
      if (assessmentsData.length === 0) {
        md += `*No assessments in this market.*\n\n`;
      } else {
        for (const assessment of assessmentsData) {
          md += `### ${assessment.name}\n\n`;
          md += `- **Type:** ${assessment.isProxy ? "Proxy Assessment" : "Competitive Assessment"}\n`;
          md += `- **Status:** ${assessment.status}\n`;
          md += `- **Created:** ${assessment.createdAt ? new Date(assessment.createdAt).toLocaleDateString() : "N/A"}\n`;
          if (assessment.isProxy) {
            if (assessment.proxyName) md += `- **Proxy Name:** ${assessment.proxyName}\n`;
            if (assessment.proxyCompany) md += `- **Proxy Company:** ${assessment.proxyCompany}\n`;
          }
          if (assessment.description) md += `\n${assessment.description}\n`;
          
          // Include analysis snapshot if available
          if (assessment.analysisSnapshot) {
            const data = typeof assessment.analysisSnapshot === "string" 
              ? JSON.parse(assessment.analysisSnapshot) 
              : assessment.analysisSnapshot;
            if (data.summary) {
              md += `\n#### Analysis Summary\n\n${data.summary}\n`;
            }
          }
          
          // Include recommendations snapshot if available
          if (assessment.recommendationsSnapshot) {
            const recs = typeof assessment.recommendationsSnapshot === "string" 
              ? JSON.parse(assessment.recommendationsSnapshot) 
              : assessment.recommendationsSnapshot;
            if (Array.isArray(recs) && recs.length > 0) {
              md += `\n**Key Recommendations:**\n`;
              recs.slice(0, 5).forEach((r: any) => md += `- ${r.title || r.description || r}\n`);
            }
          }
          md += `\n`;
        }
      }
      md += `---\n\n`;

      // Activity Log section
      md += `## Activity Log\n\n`;
      if (activityData.length === 0) {
        md += `*No activity recorded in this market.*\n\n`;
      } else {
        md += `*Showing ${Math.min(activityData.length, 50)} most recent activities*\n\n`;
        
        // Group by type
        const recentActivity = activityData.slice(0, 50);
        for (const item of recentActivity) {
          const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "N/A";
          const typeIcon = item.type === "website_update" ? "🌐" : 
                          item.type === "blog_update" ? "📝" : 
                          item.type === "social_update" ? "📱" : 
                          item.type === "crawl" ? "🔍" : "📋";
          md += `- ${typeIcon} **${item.competitorName || "Unknown"}** - ${item.type} (${date})\n`;
          if (item.summary) md += `  ${item.summary}\n`;
          else if (item.description) md += `  ${item.description}\n`;
        }
      }

      md += `\n---\n\n`;
      md += `*Report generated by [Orbit](https://orbit.synozur.com) - Go-to-Market Intelligence Platform*\n\n`;
      md += `*Export Date: ${new Date().toISOString()}*\n\n`;
      md += `© 2026 The Synozur Alliance LLC. All Rights Reserved.\n`;

      // Send as downloadable markdown file
      const filename = `${market.name.replace(/[^a-z0-9]/gi, "_")}_complete_export.md`;
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(md);
    } catch (error: any) {
      console.error("Market export error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Switch active market context
  app.post("/api/context/market", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const parsed = switchMarketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const { marketId } = parsed.data;
      const market = await storage.getMarket(marketId);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      if (market.status !== "active") {
        return res.status(400).json({ error: "Cannot switch to an archived market" });
      }

      const userDomain = user.email.split("@")[1];
      const accessibleTenants = await storage.getAccessibleTenants(user.id, user.role, userDomain);
      if (!accessibleTenants.find(t => t.id === market.tenantId)) {
        return res.status(403).json({ error: "Access denied - you don't have access to this tenant" });
      }

      req.session.activeTenantId = market.tenantId;
      req.session.activeMarketId = marketId;
      
      res.json({
        activeTenantId: market.tenantId,
        activeMarketId: marketId,
        message: "Market context switched successfully"
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get current context (tenant + market)
  app.get("/api/context", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const userDomain = user.email.split("@")[1];
      const userTenant = await storage.getTenantByDomain(userDomain);
      
      let activeTenantId = req.session.activeTenantId;
      let activeMarketId = req.session.activeMarketId;
      
      if (!activeTenantId && userTenant) {
        activeTenantId = userTenant.id;
        req.session.activeTenantId = activeTenantId;
      }
      
      if (activeTenantId && !activeMarketId) {
        const defaultMarket = await storage.getDefaultMarket(activeTenantId);
        if (defaultMarket) {
          activeMarketId = defaultMarket.id;
          req.session.activeMarketId = activeMarketId;
        }
      }
      
      const activeTenant = activeTenantId ? await storage.getTenant(activeTenantId) : null;
      const activeMarket = activeMarketId ? await storage.getMarket(activeMarketId) : null;
      
      res.json({
        activeTenantId,
        activeMarketId,
        activeTenant: activeTenant || null,
        activeMarket: activeMarket || null,
        canSwitchTenants: user.role === "Global Admin" || user.role === "Consultant"
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CONSULTANT ACCESS MANAGEMENT ====================

  // Get consultant access grants for current tenant (admin only)
  app.get("/api/tenant-access", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const userDomain = user.email.split("@")[1];
      const userTenant = await storage.getTenantByDomain(userDomain);
      
      const targetTenantId = req.session.activeTenantId || userTenant?.id;
      if (!targetTenantId) {
        return res.status(400).json({ error: "No tenant context available" });
      }

      const grants = await storage.getConsultantAccessByTenant(targetTenantId);
      
      const enrichedGrants = await Promise.all(grants.map(async (grant) => {
        const consultant = await storage.getUser(grant.userId);
        const grantedByUser = await storage.getUser(grant.grantedBy);
        return {
          ...grant,
          consultantEmail: consultant?.email,
          consultantName: consultant?.name,
          grantedByName: grantedByUser?.name
        };
      }));

      res.json(enrichedGrants);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Grant consultant access to current tenant
  app.post("/api/tenant-access", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const parsed = grantConsultantAccessSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const { consultantUserId } = parsed.data;
      const consultant = await storage.getUser(consultantUserId);
      if (!consultant) {
        return res.status(404).json({ error: "Consultant user not found" });
      }

      if (consultant.role !== "Consultant") {
        return res.status(400).json({ error: "User is not a Consultant. Only users with Consultant role can be granted cross-tenant access." });
      }

      const userDomain = user.email.split("@")[1];
      const userTenant = await storage.getTenantByDomain(userDomain);
      
      if (user.role === "Domain Admin" && req.session.activeTenantId && req.session.activeTenantId !== userTenant?.id) {
        return res.status(403).json({ error: "Domain Admins can only grant access to their own tenant" });
      }

      const targetTenantId = (user.role === "Domain Admin") ? userTenant?.id : (req.session.activeTenantId || userTenant?.id);
      if (!targetTenantId) {
        return res.status(400).json({ error: "No tenant context available" });
      }

      const existingAccess = await storage.getActiveConsultantAccess(consultantUserId, targetTenantId);
      if (existingAccess) {
        return res.status(400).json({ error: "Consultant already has active access to this tenant" });
      }

      const access = await storage.createConsultantAccess({
        userId: consultantUserId,
        tenantId: targetTenantId,
        status: "active",
        grantedBy: user.id,
      });

      res.status(201).json(access);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Revoke consultant access
  app.delete("/api/tenant-access/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - admin privileges required" });
      }

      const access = await storage.getConsultantAccess(req.params.id);
      if (!access) {
        return res.status(404).json({ error: "Access grant not found" });
      }

      const userDomain = user.email.split("@")[1];
      const accessibleTenants = await storage.getAccessibleTenants(user.id, user.role, userDomain);
      if (!accessibleTenants.find(t => t.id === access.tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.revokeConsultantAccess(req.params.id);
      res.json({ message: "Access revoked successfully" });
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

  // ==================== AI USAGE TRACKING (Global Admin only) ====================
  
  app.get("/api/admin/ai/usage", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      const stats = await storage.getAiUsageStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CLIENT PROJECTS (Pro/Enterprise only) ====================
  
  // Get all client projects for current tenant
  app.get("/api/projects", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenant(ctx.tenantId);
      
      // Plan-gating: only Pro and Enterprise tenants can use client projects
      if (!tenant || (tenant.plan !== "pro" && tenant.plan !== "professional" && tenant.plan !== "enterprise")) {
        return res.status(403).json({ 
          error: "Client Projects require a Pro or Enterprise plan",
          upgradeRequired: true
        });
      }

      const projects = await storage.getClientProjectsByContext(toContextFilter(ctx));
      
      // Enrich projects with their baseline product ID for Features/Roadmap links
      const enrichedProjects = await Promise.all(
        projects.map(async (project) => {
          const projectProducts = await storage.getProjectProducts(project.id);
          const baselineProduct = projectProducts.find((pp: { role: string }) => pp.role === "baseline");
          return {
            ...project,
            baselineProductId: baselineProduct?.productId || null,
          };
        })
      );
      
      res.json(enrichedProjects);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get single client project with its competitors
  app.get("/api/projects/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get associated competitors
      const projectCompetitors = await storage.getCompetitorsByProject(project.id);

      res.json({ ...project, competitors: projectCompetitors });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Create client project
  app.post("/api/projects", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenant(ctx.tenantId);
      
      // Plan-gating
      if (!tenant || (tenant.plan !== "pro" && tenant.plan !== "professional" && tenant.plan !== "enterprise")) {
        return res.status(403).json({ 
          error: "Client Projects require a Pro or Enterprise plan",
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
        analysisType: "product",
        notifyOnUpdates: notifyOnUpdates === true,
        status: "active",
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        ownerUserId: ctx.userId,
      });

      res.status(201).json(project);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Update client project
  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
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
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Delete client project (cascades to unlink competitors)
  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Only owner or admin can delete
      if (project.ownerUserId !== ctx.userId && ctx.userRole !== "Domain Admin" && ctx.userRole !== "Global Admin") {
        return res.status(403).json({ error: "Only project owner or admin can delete" });
      }

      await storage.deleteClientProject(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Assign competitor to project
  app.post("/api/projects/:projectId/competitors/:competitorId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }
      
      // Validate competitor belongs to current context
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied - competitor not in your context" });
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
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Unlink competitor from project
      await storage.updateCompetitor(req.params.competitorId, { projectId: null });
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== PRODUCT MANAGEMENT ====================

  // Get all products for tenant
  app.get("/api/products", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const products = await storage.getProductsByContext(toContextFilter(ctx));
      res.json(products);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get single product
  app.get("/api/products/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Validate product belongs to current context
      if (!validateResourceContext(product, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(product);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Create product
  app.post("/api/products", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const { name, description, url, companyName, competitorId, isBaseline, companyProfileId, createAsCompetitor } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Product name is required" });
      }

      // If creating a baseline product, automatically link to company profile
      let finalCompanyProfileId = companyProfileId;
      if (isBaseline === true && !finalCompanyProfileId) {
        const profile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
        if (profile) {
          finalCompanyProfileId = profile.id;
        }
      }

      // If createAsCompetitor is true, create a competitor company record first
      // Server-side guard: only allowed for non-baseline products without existing competitorId
      let finalCompetitorId = competitorId;
      let createdCompetitorId: string | null = null;
      if (createAsCompetitor === true && isBaseline !== true && !competitorId) {
        // Create a competitor company for this product
        const competitorName = companyName || name;
        const competitorUrl = url || "";
        
        const competitor = await storage.createCompetitor({
          name: competitorName,
          url: competitorUrl,
          status: "pending",
          userId: ctx.userId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
        });
        
        finalCompetitorId = competitor.id;
        createdCompetitorId = competitor.id;
        console.log(`Created competitor company ${competitorName} (${competitor.id}) for product ${name}`);
      }

      try {
        const product = await storage.createProduct({
          name,
          description,
          url,
          companyName,
          competitorId: finalCompetitorId,
          companyProfileId: finalCompanyProfileId,
          isBaseline: isBaseline === true,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          createdBy: ctx.userId,
        });

        res.json(product);
      } catch (productError) {
        // If product creation fails and we created a competitor, clean it up
        if (createdCompetitorId) {
          try {
            await storage.deleteCompetitor(createdCompetitorId);
            console.log(`Cleaned up orphaned competitor ${createdCompetitorId} after product creation failure`);
          } catch (cleanupError) {
            console.error(`Failed to cleanup competitor ${createdCompetitorId}:`, cleanupError);
          }
        }
        throw productError;
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Create product error:", error);
      res.status(500).json({ error: error.message || "Failed to create product" });
    }
  });

  // Update product
  app.patch("/api/products/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Validate product belongs to current context
      if (!validateResourceContext(product, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateProduct(req.params.id, req.body);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Delete product
  app.delete("/api/products/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Validate product belongs to current context
      if (!validateResourceContext(product, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteProduct(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // === Product Features CRUD ===
  
  // Get features for a product
  app.get("/api/products/:productId/features", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const features = await storage.getProductFeaturesByProduct(req.params.productId);
      res.json(features);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Create feature for a product
  app.post("/api/products/:productId/features", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const feature = await storage.createProductFeature({
        ...req.body,
        productId: req.params.productId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });
      res.status(201).json(feature);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Update feature
  app.patch("/api/products/:productId/features/:featureId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const feature = await storage.getProductFeature(req.params.featureId);
      if (!feature || feature.productId !== req.params.productId) {
        return res.status(404).json({ error: "Feature not found" });
      }
      
      const updated = await storage.updateProductFeature(req.params.featureId, req.body);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Delete feature
  app.delete("/api/products/:productId/features/:featureId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const feature = await storage.getProductFeature(req.params.featureId);
      if (!feature || feature.productId !== req.params.productId) {
        return res.status(404).json({ error: "Feature not found" });
      }
      
      await storage.deleteProductFeature(req.params.featureId);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Import features from URL
  app.post("/api/products/:productId/features/import-url", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "URL is required" });
      
      // Validate URL for SSRF protection
      const { validateUrlSoft } = await import("./utils/url-validator");
      const urlValidation = await validateUrlSoft(url);
      if (!urlValidation.isValid) {
        return res.status(400).json({ error: urlValidation.error || "Invalid URL" });
      }
      
      // Fetch and extract content from URL
      const { extractFeaturesFromContent } = await import("./ai-service");
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      
      if (!response.ok) {
        return res.status(400).json({ error: "Failed to fetch URL" });
      }
      
      const html = await response.text();
      // Extract text content from HTML - also decode HTML entities
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
      
      console.log(`[Feature Import] URL: ${url}, HTML length: ${html.length}, Text length: ${textContent.length}`);
      console.log(`[Feature Import] Text preview: ${textContent.slice(0, 500)}...`);
      
      const extractedFeatures = await extractFeaturesFromContent(textContent, "url", product.name);
      console.log(`[Feature Import] Extracted ${extractedFeatures.length} features`);
      
      if (extractedFeatures.length === 0) {
        return res.status(400).json({ error: "No features could be extracted from the URL. The page may use JavaScript rendering. Try pasting the content directly instead." });
      }
      
      // Create features in database
      const createdFeatures = [];
      for (const feature of extractedFeatures) {
        const created = await storage.createProductFeature({
          productId: req.params.productId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          name: feature.name,
          description: feature.description,
          category: feature.category,
          status: feature.status,
          sourceType: "scraped",
        });
        createdFeatures.push(created);
      }
      
      res.json({ imported: createdFeatures.length, features: createdFeatures });
    } catch (error: any) {
      console.error("Feature import from URL failed:", error);
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Import features from pasted text
  app.post("/api/products/:productId/features/import-text", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const { text } = req.body;
      if (!text || text.trim().length < 50) {
        return res.status(400).json({ error: "Text must be at least 50 characters" });
      }
      
      const { extractFeaturesFromContent } = await import("./ai-service");
      const extractedFeatures = await extractFeaturesFromContent(text, "text", product.name);
      
      // Create features in database
      const createdFeatures = [];
      for (const feature of extractedFeatures) {
        const created = await storage.createProductFeature({
          productId: req.params.productId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          name: feature.name,
          description: feature.description,
          category: feature.category,
          status: feature.status,
          sourceType: "parsed",
        });
        createdFeatures.push(created);
      }
      
      res.json({ imported: createdFeatures.length, features: createdFeatures });
    } catch (error: any) {
      console.error("Feature import from text failed:", error);
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // === Roadmap Items CRUD ===
  
  // Get roadmap items for a product
  app.get("/api/products/:productId/roadmap", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const items = await storage.getRoadmapItemsByProduct(req.params.productId);
      res.json(items);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Create roadmap item
  app.post("/api/products/:productId/roadmap", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const item = await storage.createRoadmapItem({
        ...req.body,
        productId: req.params.productId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
      });
      res.status(201).json(item);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Update roadmap item
  app.patch("/api/products/:productId/roadmap/:itemId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const item = await storage.getRoadmapItem(req.params.itemId);
      if (!item || item.productId !== req.params.productId) {
        return res.status(404).json({ error: "Roadmap item not found" });
      }
      
      const updated = await storage.updateRoadmapItem(req.params.itemId, req.body);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Delete roadmap item
  app.delete("/api/products/:productId/roadmap/:itemId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const item = await storage.getRoadmapItem(req.params.itemId);
      if (!item || item.productId !== req.params.productId) {
        return res.status(404).json({ error: "Roadmap item not found" });
      }
      
      await storage.deleteRoadmapItem(req.params.itemId);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Import roadmap items from URL
  app.post("/api/products/:productId/roadmap/import-url", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "URL is required" });
      
      // Validate URL for SSRF protection
      const { validateUrlSoft } = await import("./utils/url-validator");
      const urlValidation = await validateUrlSoft(url);
      if (!urlValidation.isValid) {
        return res.status(400).json({ error: urlValidation.error || "Invalid URL" });
      }
      
      const { extractRoadmapFromContent } = await import("./ai-service");
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      
      if (!response.ok) {
        return res.status(400).json({ error: "Failed to fetch URL" });
      }
      
      const html = await response.text();
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      
      const extractedItems = await extractRoadmapFromContent(textContent, "url", product.name);
      
      const createdItems = [];
      const currentYear = new Date().getFullYear();
      for (const item of extractedItems) {
        const created = await storage.createRoadmapItem({
          productId: req.params.productId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          title: item.title,
          description: item.description,
          quarter: item.quarter,
          year: currentYear,
          effort: item.effort,
          status: "planned",
        });
        createdItems.push(created);
      }
      
      res.json({ imported: createdItems.length, items: createdItems });
    } catch (error: any) {
      console.error("Roadmap import from URL failed:", error);
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Import roadmap items from pasted text
  app.post("/api/products/:productId/roadmap/import-text", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const { text } = req.body;
      if (!text || text.trim().length < 50) {
        return res.status(400).json({ error: "Text must be at least 50 characters" });
      }
      
      const { extractRoadmapFromContent } = await import("./ai-service");
      const extractedItems = await extractRoadmapFromContent(text, "text", product.name);
      
      const createdItems = [];
      const currentYear = new Date().getFullYear();
      for (const item of extractedItems) {
        const created = await storage.createRoadmapItem({
          productId: req.params.productId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          title: item.title,
          description: item.description,
          quarter: item.quarter,
          year: currentYear,
          effort: item.effort,
          status: "planned",
        });
        createdItems.push(created);
      }
      
      res.json({ imported: createdItems.length, items: createdItems });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // === Feature Recommendations CRUD ===
  
  // Get recommendations for a product
  app.get("/api/products/:productId/recommendations", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const recommendations = await storage.getFeatureRecommendationsByProduct(req.params.productId);
      res.json(recommendations);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Update recommendation status (accept/dismiss)
  app.patch("/api/products/:productId/recommendations/:recId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const rec = await storage.getFeatureRecommendation(req.params.recId);
      if (!rec || rec.productId !== req.params.productId) {
        return res.status(404).json({ error: "Recommendation not found" });
      }
      
      const updated = await storage.updateFeatureRecommendation(req.params.recId, { status: req.body.status });
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Add recommendation to roadmap
  app.post("/api/products/:productId/recommendations/:recId/add-to-roadmap", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      const rec = await storage.getFeatureRecommendation(req.params.recId);
      if (!rec || rec.productId !== req.params.productId) {
        return res.status(404).json({ error: "Recommendation not found" });
      }
      
      // Parse suggested quarter (e.g., "Q1 2026" -> { quarter: "Q1", year: 2026 })
      let quarter: string | null = null;
      let year = new Date().getFullYear();
      if (rec.suggestedQuarter) {
        const match = rec.suggestedQuarter.match(/^(Q[1-4])(?:\s+(\d{4}))?$/i);
        if (match) {
          quarter = match[1].toUpperCase();
          if (match[2]) year = parseInt(match[2]);
        }
      }
      
      // Map priority to effort
      const effortMap: Record<string, string> = { high: "l", medium: "m", low: "s" };
      const effort = rec.suggestedPriority ? effortMap[rec.suggestedPriority] || "m" : "m";
      
      // Create roadmap item and mark recommendation as accepted atomically
      const { roadmapItem } = await storage.addRecommendationToRoadmap(req.params.recId, {
        productId: req.params.productId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        title: rec.title,
        description: rec.explanation,
        quarter,
        year,
        effort,
        status: "planned",
        aiRecommended: true,
      });
      
      res.json({ roadmapItem, message: "Added to roadmap" });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Generate AI roadmap recommendations for a product
  app.post("/api/products/:productId/recommendations/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (!validateResourceContext(product, ctx)) return res.status(403).json({ error: "Access denied" });
      
      // Get existing features for this product
      const features = await storage.getProductFeaturesByProduct(req.params.productId);
      const featuresContext = features.map(f => ({
        name: f.name,
        status: f.status,
        category: f.category,
      }));
      
      // Get competitor data from their stored analysis data
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      const competitorData: { name: string; analysis: string }[] = [];
      
      for (const comp of competitors.slice(0, 5)) {
        // Use the competitor's stored analysis data if available
        if (comp.analysisData) {
          const analysisText = typeof comp.analysisData === 'string' 
            ? comp.analysisData 
            : JSON.stringify(comp.analysisData);
          competitorData.push({
            name: comp.name,
            analysis: analysisText,
          });
        }
      }
      
      // Generate recommendations using AI
      const recommendations = await generateRoadmapRecommendations(
        product.name,
        product.description || "",
        featuresContext,
        competitorData
      );
      
      // Save recommendations to database
      const savedRecs = [];
      for (const rec of recommendations) {
        const saved = await storage.createFeatureRecommendation({
          productId: req.params.productId,
          type: rec.type,
          title: rec.title,
          explanation: rec.explanation,
          suggestedPriority: rec.suggestedPriority,
          suggestedQuarter: rec.suggestedQuarter,
          relatedCompetitors: rec.relatedCompetitors,
          status: "pending",
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
        });
        savedRecs.push(saved);
      }
      
      res.json(savedRecs);
    } catch (error: any) {
      console.error("Failed to generate recommendations:", error);
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Get products for a project
  app.get("/api/projects/:projectId/products", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const products = await storage.getProjectProducts(req.params.projectId);
      res.json(products);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Add product to project
  app.post("/api/projects/:projectId/products", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
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
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Update product role in project (with single baseline enforcement)
  app.patch("/api/projects/:projectId/products/:productId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
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
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Remove product from project
  app.delete("/api/projects/:projectId/products/:productId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.removeProductFromProject(req.params.projectId, req.params.productId);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== PRODUCT BATTLECARDS ====================

  // Get all product battlecards for a project
  app.get("/api/projects/:projectId/battlecards", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);
      res.json(battlecards);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific product battlecard
  app.get("/api/product-battlecards/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getProductBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battlecard not found" });
      }

      // Validate battlecard belongs to current context
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(battlecard);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Generate a product battlecard for a competitor product
  app.post("/api/projects/:projectId/battlecards/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { competitorProductId } = req.body;
      if (!competitorProductId) {
        return res.status(400).json({ error: "Competitor product ID is required" });
      }

      // Get project products to find baseline
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set for this project" });
      }

      const competitorPP = projectProducts.find(pp => pp.productId === competitorProductId);
      if (!competitorPP) {
        return res.status(400).json({ error: "Competitor product not found in this project" });
      }

      // Ensure the product is actually a competitor, not the baseline
      if (competitorPP.role === "baseline") {
        return res.status(400).json({ error: "Cannot generate battlecard for the baseline product" });
      }

      // Get full product details
      const baseline = await storage.getProduct(baselineProduct.productId);
      const competitor = await storage.getProduct(competitorProductId);

      if (!baseline || !competitor) {
        return res.status(404).json({ error: "Product details not found" });
      }

      // Check if battlecard already exists
      let existingBattlecard = await storage.getProductBattlecardByProducts(baseline.id, competitor.id);

      // Use Claude to generate battlecard content
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const prompt = `You are a competitive intelligence analyst. Generate a comprehensive product comparison battlecard for "${baseline.name}" (our product) competing against "${competitor.name}".

Our Product: ${baseline.name}
Our Company: ${baseline.companyName || "Unknown"}
Our Description: ${baseline.description || "No description"}
Our URL: ${baseline.url || "No URL"}

Competitor Product: ${competitor.name}
Competitor Company: ${competitor.companyName || "Unknown"}
Competitor Description: ${competitor.description || "No description"}
Competitor URL: ${competitor.url || "No URL"}

Generate a battlecard with the following sections in valid JSON format:
{
  "strengths": ["strength1", "strength2", ...], // 3-5 competitor product strengths
  "weaknesses": ["weakness1", "weakness2", ...], // 3-5 competitor product weaknesses
  "ourAdvantages": ["advantage1", "advantage2", ...], // 3-5 ways our product beats this competitor
  "keyDifferentiators": [
    {"feature": "Feature name", "ours": "What we offer", "theirs": "What they offer"},
    ...
  ], // 4-6 key feature comparisons
  "objections": [
    {"objection": "Common customer objection about choosing us over them", "response": "How to respond"},
    ...
  ], // 3-4 common objections and responses
  "talkTracks": [
    {"scenario": "When customer mentions X", "script": "Say this..."},
    ...
  ], // 2-3 sales talk tracks
  "featureComparison": {
    "Pricing": {"ours": "Our pricing info", "theirs": "Their pricing info"},
    "Target Market": {"ours": "Who we target", "theirs": "Who they target"},
    "Key Strength": {"ours": "Our main strength", "theirs": "Their main strength"}
  }
}

Return ONLY valid JSON, no markdown or explanation.`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      });

      // Log AI usage
      await logAiUsage(ctx, "generate_product_battlecard", "anthropic", "claude-sonnet-4-5", response.usage);

      let battlecardContent: any = {};
      try {
        const responseText = response.content[0].type === "text" ? response.content[0].text : "";
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          battlecardContent = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error("Failed to parse AI battlecard response:", e);
        return res.status(500).json({ error: "Failed to generate battlecard content" });
      }

      if (existingBattlecard) {
        // Update existing battlecard
        const updated = await storage.updateProductBattlecard(existingBattlecard.id, {
          strengths: battlecardContent.strengths,
          weaknesses: battlecardContent.weaknesses,
          ourAdvantages: battlecardContent.ourAdvantages,
          keyDifferentiators: battlecardContent.keyDifferentiators,
          objections: battlecardContent.objections,
          talkTracks: battlecardContent.talkTracks,
          featureComparison: battlecardContent.featureComparison,
          lastGeneratedAt: new Date(),
        });
        res.json(updated);
      } else {
        // Create new battlecard
        const created = await storage.createProductBattlecard({
          baselineProductId: baseline.id,
          competitorProductId: competitor.id,
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          strengths: battlecardContent.strengths,
          weaknesses: battlecardContent.weaknesses,
          ourAdvantages: battlecardContent.ourAdvantages,
          keyDifferentiators: battlecardContent.keyDifferentiators,
          objections: battlecardContent.objections,
          talkTracks: battlecardContent.talkTracks,
          featureComparison: battlecardContent.featureComparison,
          status: "draft",
          createdBy: ctx.userId,
        });
        res.json(created);
      }
    } catch (error: any) {
      console.error("Product battlecard generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update a product battlecard (e.g., custom notes)
  app.patch("/api/product-battlecards/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getProductBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battlecard not found" });
      }

      // Validate battlecard belongs to current context
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { customNotes, status } = req.body;
      const updates: any = {};
      if (customNotes !== undefined) updates.customNotes = customNotes;
      if (status !== undefined) updates.status = status;

      const updated = await storage.updateProductBattlecard(req.params.id, updates);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a product battlecard
  app.delete("/api/product-battlecards/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getProductBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battlecard not found" });
      }

      // Validate battlecard belongs to current context
      if (!validateResourceContext(battlecard, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteProductBattlecard(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // Long-form Recommendation Endpoints (GTM, Messaging)
  // =====================================================
  
  // Get all long-form recommendations for a project
  app.get("/api/projects/:projectId/recommendations", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const recommendations = await storage.getLongFormRecommendationsByProject(req.params.projectId);
      res.json(recommendations);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific recommendation by type for a project
  app.get("/api/projects/:projectId/recommendations/:type", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const recommendation = await storage.getLongFormRecommendationByType(
        req.params.type,
        req.params.projectId
      );
      
      if (!recommendation) {
        // Return a placeholder if not generated yet
        return res.json({
          type: req.params.type,
          projectId: req.params.projectId,
          status: "not_generated",
          content: null,
          savedPrompts: null,
          lastGeneratedAt: null
        });
      }
      
      res.json(recommendation);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Generate GTM plan for a project
  app.post("/api/projects/:projectId/recommendations/gtm_plan/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Extract prompts from request body
      const { targetRoles, distributionChannels, customGuidance, budget, timeline } = req.body;
      const savedPrompts = { targetRoles, distributionChannels, customGuidance, budget, timeline };

      // Get project products for context
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      // Build context for AI
      let productContext = "";
      if (baselineProduct) {
        productContext += `\n\nOur Product: ${baselineProduct.product.name}\nDescription: ${baselineProduct.product.description || "N/A"}\nCompany: ${baselineProduct.product.companyName || "N/A"}`;
      }
      if (competitorProducts.length > 0) {
        productContext += "\n\nCompetitors:";
        for (const cp of competitorProducts) {
          productContext += `\n- ${cp.product.name} (${cp.product.companyName || "Unknown"})`;
        }
      }

      const prompt = `You are an expert go-to-market strategist. Create a comprehensive Go-To-Market Plan in markdown format for the following project.

Project: ${project.name}
Client: ${project.clientName}
${productContext}

User Guidance:
- Target Roles/Personas: ${targetRoles || "Not specified - suggest appropriate targets"}
- Distribution Channels: ${distributionChannels || "Not specified - recommend optimal channels"}
- Custom Guidance: ${customGuidance || "None"}
- Budget Considerations: ${budget || "Not specified"}
- Timeline: ${timeline || "Not specified"}

Create a detailed, actionable GTM plan with the following sections:

# Go-To-Market Plan: ${project.clientName}

## Executive Summary
Brief overview of the GTM strategy

## Target Market & Buyer Personas
Define ideal customer profiles, decision-makers, and influencers

## Value Proposition & Positioning
Core messaging and differentiation from competitors

## Distribution Strategy
${distributionChannels ? `Focus on: ${distributionChannels}` : "Recommend: Direct sales, Digital marketing, Channel partnerships"}

## Marketing Tactics
- Content marketing
- Demand generation
- Campaigns and initiatives

## Sales Enablement
- Sales playbook highlights
- Objection handling
- Competitive positioning

## Launch Timeline & Milestones
Phased approach with key dates

## Success Metrics & KPIs
How to measure success

## Budget Recommendations
Resource allocation suggestions

## Risks & Mitigation
Potential challenges and solutions

Make this practical and actionable. Use bullet points and clear formatting.`;

      // Use OpenAI gpt-5.2 for enhanced GTM plan generation
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const content = completion.choices[0]?.message?.content || "";

      // Check if recommendation already exists
      const existing = await storage.getLongFormRecommendationByType("gtm_plan", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: req.session.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "gtm_plan",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          savedPrompts,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("GTM plan generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate messaging framework for a project
  app.post("/api/projects/:projectId/recommendations/messaging_framework/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Extract prompts from request body
      const { targetAudience, toneOfVoice, keyMessages, customGuidance } = req.body;
      const savedPrompts = { targetAudience, toneOfVoice, keyMessages, customGuidance };

      // Get project products for context
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      let productContext = "";
      if (baselineProduct) {
        productContext += `\n\nOur Product: ${baselineProduct.product.name}\nDescription: ${baselineProduct.product.description || "N/A"}\nCompany: ${baselineProduct.product.companyName || "N/A"}`;
      }
      if (competitorProducts.length > 0) {
        productContext += "\n\nCompetitors:";
        for (const cp of competitorProducts) {
          productContext += `\n- ${cp.product.name} (${cp.product.companyName || "Unknown"})`;
        }
      }

      const prompt = `You are an expert brand strategist and messaging architect. Create a comprehensive Messaging & Positioning Framework in markdown format.

Project: ${project.name}
Client: ${project.clientName}
${productContext}

User Guidance:
- Target Audience: ${targetAudience || "Not specified - identify appropriate audiences"}
- Tone of Voice: ${toneOfVoice || "Not specified - recommend appropriate tone"}
- Key Messages to Emphasize: ${keyMessages || "Not specified"}
- Custom Guidance: ${customGuidance || "None"}

Create a detailed messaging framework with the following sections:

# Messaging & Positioning Framework: ${project.clientName}

## Brand Positioning Statement
A clear, concise positioning statement following the format:
"For [target audience] who [need], [product/brand] is the [category] that [key benefit] because [reason to believe]."

## Core Value Proposition
The primary value we deliver to customers

## Messaging Pillars
3-5 key themes that support the positioning

## Audience Segments & Tailored Messages
For each key audience:
- Who they are
- Their pain points
- Key messages that resonate
- Proof points

## Competitive Differentiation
How we stand apart from competitors

## Tone of Voice Guidelines
- Personality traits
- Do's and Don'ts
- Example phrases

## Key Talking Points
Elevator pitches of varying lengths:
- 10-second version
- 30-second version
- 2-minute version

## Tagline Options
3-5 potential taglines

## Proof Points & Evidence
Statistics, case studies, testimonials to support claims

## Messaging Do's and Don'ts
Clear guidelines on messaging boundaries

Make this practical and ready for use by sales, marketing, and leadership teams.`;

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      // Log AI usage
      await logAiUsage(ctx, "generate_messaging_framework", "anthropic", "claude-sonnet-4-5", message.usage);

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      // Check if recommendation already exists
      const existing = await storage.getLongFormRecommendationByType("messaging_framework", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "messaging_framework",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          savedPrompts,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Messaging framework generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate product one sheet (marketing copy draft)
  app.post("/api/projects/:projectId/recommendations/product_one_sheet/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { targetAudience, keyBenefits, toneOfVoice, customGuidance } = req.body;
      const savedPrompts = { targetAudience, keyBenefits, toneOfVoice, customGuidance };

      // Get product context
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set. Please add a baseline product first." });
      }

      // Get product features for context
      const features = await storage.getProductFeaturesByProduct(baselineProduct.productId);
      const releasedFeatures = features.filter((f: { status: string }) => f.status === "released");

      // Get battlecards for competitive differentiation
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      let productContext = `
Product: ${baselineProduct.product.name}
Company: ${baselineProduct.product.companyName || project.clientName}
Description: ${baselineProduct.product.description || "N/A"}
URL: ${baselineProduct.product.url || "N/A"}`;

      if (releasedFeatures.length > 0) {
        productContext += `\n\nKey Features:\n${releasedFeatures.slice(0, 10).map((f: { name: string; description: string | null }) => `- ${f.name}: ${f.description || ""}`).join("\n")}`;
      }

      let competitiveContext = "";
      if (competitorProducts.length > 0) {
        competitiveContext = "\n\nCompetitors:";
        for (const cp of competitorProducts) {
          competitiveContext += `\n- ${cp.product.name} (${cp.product.companyName || "Unknown"})`;
        }
      }

      if (battlecards.length > 0) {
        const bc = battlecards[0];
        const advantages = bc.ourAdvantages as string[] | null;
        const differentiators = bc.keyDifferentiators as { feature: string; ours: string; theirs: string }[] | null;
        if (advantages?.length) {
          competitiveContext += `\n\nOur Key Advantages:\n${advantages.slice(0, 5).map((a: string) => `- ${a}`).join("\n")}`;
        }
        if (differentiators?.length) {
          competitiveContext += `\n\nKey Differentiators:\n${differentiators.slice(0, 5).map((d: { feature: string; ours: string }) => `- ${d.feature}: ${d.ours}`).join("\n")}`;
        }
      }

      const prompt = `You are an expert product marketing copywriter. Create a compelling Product One Sheet (single-page marketing document) in markdown format.

${productContext}
${competitiveContext}

User Guidance:
- Target Audience: ${targetAudience || "Not specified - suggest appropriate audience"}
- Key Benefits to Highlight: ${keyBenefits || "Not specified - identify top benefits"}
- Tone of Voice: ${toneOfVoice || "Professional and compelling"}
- Custom Guidance: ${customGuidance || "None"}

Create a complete Product One Sheet with the following structure:

# ${baselineProduct.product.name}

## Headline
A compelling tagline (8-12 words max)

## The Challenge
2-3 sentences describing the problem your audience faces

## The Solution
2-3 sentences describing how this product solves that problem

## Key Benefits
- Benefit 1 with specific value proposition
- Benefit 2 with specific value proposition  
- Benefit 3 with specific value proposition
(3-5 bullet points, each with a clear business outcome)

## Key Features
- Feature 1: Brief description
- Feature 2: Brief description
- Feature 3: Brief description
(Top 3-5 features with concise descriptions)

## Why Choose ${baselineProduct.product.companyName || "Us"}
3-4 sentences on competitive differentiation and credibility

## Call to Action
Clear next step for the reader

---

Make this compelling, concise, and suitable for a one-page PDF. Use active voice and focus on customer outcomes over features.`;

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      await logAiUsage(ctx, "generate_product_one_sheet", "anthropic", "claude-sonnet-4-5", message.usage);

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("product_one_sheet", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "product_one_sheet",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          savedPrompts,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Product one sheet generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate project-level gap analysis
  app.post("/api/projects/:projectId/recommendations/gap_analysis/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set" });
      }

      const baseline = await storage.getProduct(baselineProduct.productId);
      const competitors = await Promise.all(
        competitorProducts.map(pp => storage.getProduct(pp.productId))
      );

      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const prompt = `You are a competitive intelligence analyst. Analyze the positioning gaps for "${baseline?.name}" compared to its competitors.

## Our Product
Name: ${baseline?.name}
Company: ${baseline?.companyName || "Unknown"}
Description: ${baseline?.description || "No description"}

## Competitors
${competitors.filter(Boolean).map(c => `- ${c?.name} (${c?.companyName || "Unknown"}): ${c?.description || "No description"}`).join("\n")}

## Battlecard Insights
${battlecards.map(bc => `
Competitor: ${competitors.find(c => c?.id === bc.competitorProductId)?.name || "Unknown"}
- Their Strengths: ${(Array.isArray(bc.strengths) ? bc.strengths : []).join(", ")}
- Their Weaknesses: ${(Array.isArray(bc.weaknesses) ? bc.weaknesses : []).join(", ")}
- Our Advantages: ${(Array.isArray(bc.ourAdvantages) ? bc.ourAdvantages : []).join(", ")}
`).join("\n")}

Generate a comprehensive gap analysis in markdown format with these sections:

# Gap Analysis: ${baseline?.name}

## Executive Summary
Brief overview of key positioning gaps identified

## Messaging Gaps
Areas where our messaging falls short compared to competitors

## Feature/Capability Gaps
Product features or capabilities where competitors have an edge

## Market Positioning Gaps
Areas where competitors have stronger market positioning

## Pricing/Value Gaps
Competitive pricing and value perception differences

## Target Audience Gaps
Segments where competitors are better positioned

## Critical Gaps (High Priority)
The most urgent gaps that need immediate attention

## Opportunities
Gaps in competitor offerings we can exploit

Make this actionable and specific to the competitive landscape.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      // Log AI usage
      await logAiUsage(ctx, "generate_gap_analysis", "anthropic", "claude-sonnet-4-5", message.usage);

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("gap_analysis", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "gap_analysis",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Gap analysis generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate project-level recommendations
  app.post("/api/projects/:projectId/recommendations/strategic_recommendations/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set" });
      }

      const baseline = await storage.getProduct(baselineProduct.productId);
      const competitors = await Promise.all(
        competitorProducts.map(pp => storage.getProduct(pp.productId))
      );

      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);
      const gapAnalysis = await storage.getLongFormRecommendationByType("gap_analysis", req.params.projectId);

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const prompt = `You are a strategic business consultant. Generate actionable recommendations for "${baseline?.name}" based on its competitive landscape.

## Our Product
Name: ${baseline?.name}
Company: ${baseline?.companyName || "Unknown"}
Description: ${baseline?.description || "No description"}

## Competitors
${competitors.filter(Boolean).map(c => `- ${c?.name} (${c?.companyName || "Unknown"}): ${c?.description || "No description"}`).join("\n")}

## Competitive Intelligence
${battlecards.map(bc => `
vs ${competitors.find(c => c?.id === bc.competitorProductId)?.name || "Unknown"}:
- Their Strengths: ${(Array.isArray(bc.strengths) ? bc.strengths : []).slice(0, 3).join(", ")}
- Our Advantages: ${(Array.isArray(bc.ourAdvantages) ? bc.ourAdvantages : []).slice(0, 3).join(", ")}
`).join("\n")}

${gapAnalysis?.content ? `## Gap Analysis Summary\n${gapAnalysis.content.slice(0, 2000)}` : ""}

Generate strategic recommendations in markdown format:

# Strategic Recommendations: ${baseline?.name}

## Executive Summary
Overview of recommended strategic actions

## Immediate Actions (30 Days)
Quick wins and urgent items to address

## Short-Term Initiatives (90 Days)
Projects to kick off in the next quarter

## Long-Term Strategy (6-12 Months)
Bigger strategic moves to consider

## Messaging Recommendations
How to improve competitive messaging

## Product Recommendations
Feature and capability priorities

## Go-to-Market Recommendations
Sales and marketing strategy adjustments

## Competitive Defense Strategy
How to protect against competitor moves

## Success Metrics
How to measure progress on these recommendations

Make each recommendation specific, actionable, and tied to competitive insights.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("strategic_recommendations", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "strategic_recommendations",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Strategic recommendations generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate project-level competitive summary
  app.post("/api/projects/:projectId/recommendations/competitive_summary/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set" });
      }

      const baseline = await storage.getProduct(baselineProduct.productId);
      const competitors = await Promise.all(
        competitorProducts.map(pp => storage.getProduct(pp.productId))
      );

      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const prompt = `You are a competitive intelligence analyst. Create a comprehensive competitive summary report for "${baseline?.name}".

## Our Product
Name: ${baseline?.name}
Company: ${baseline?.companyName || "Unknown"}
Description: ${baseline?.description || "No description"}

## Competitors Analyzed
${competitors.filter(Boolean).map(c => `- ${c?.name} (${c?.companyName || "Unknown"}): ${c?.description || "No description"}`).join("\n")}

## Battlecard Data
${battlecards.map(bc => {
  const comp = competitors.find(c => c?.id === bc.competitorProductId);
  return `
### ${comp?.name || "Unknown Competitor"}
**Strengths:** ${(Array.isArray(bc.strengths) ? bc.strengths : []).join("; ")}
**Weaknesses:** ${(Array.isArray(bc.weaknesses) ? bc.weaknesses : []).join("; ")}
**Our Advantages:** ${(Array.isArray(bc.ourAdvantages) ? bc.ourAdvantages : []).join("; ")}
**Key Differentiators:** ${(Array.isArray(bc.keyDifferentiators) ? bc.keyDifferentiators : []).map((d: any) => d.feature).join(", ")}
`;
}).join("\n")}

Generate a consolidated competitive summary in markdown format:

# Competitive Landscape Summary: ${baseline?.name}

## Executive Overview
High-level summary of competitive position

## Market Positioning Map
Where each player sits in the market

## Competitor Profiles
For each competitor:
### [Competitor Name]
- **Overview**: Brief description
- **Target Market**: Who they serve
- **Key Strengths**: Top 3 strengths
- **Key Weaknesses**: Top 3 weaknesses  
- **Threat Level**: Low/Medium/High and why
- **Our Win Strategy**: How to beat them

## Competitive Advantages Summary
Our strongest differentiators across all competitors

## Common Competitive Themes
Patterns seen across multiple competitors

## Risk Assessment
Competitive threats to monitor

## Win/Loss Insights
Key factors in competitive deals

## Recommended Actions
Top priorities based on competitive landscape

Make this a comprehensive reference document for sales and strategy teams.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("competitive_summary", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "competitive_summary",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Competitive summary generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===============================
  // EXECUTIVE SUMMARY DASHBOARD
  // ===============================

  // Get project executive summary - unified view of all competitive intelligence
  app.get("/api/projects/:projectId/executive-summary", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Gather all project data
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      // Get competitor scores - first try project-level, then fall back to competitor-level
      let competitorScoresData = await storage.getCompetitorScoresByProject(req.params.projectId);
      
      // If no project-specific scores, fetch by competitorId or productId for each competitor product
      if (competitorScoresData.length === 0) {
        for (const pp of competitorProducts) {
          // Try competitorId first, then fall back to productId (for standalone products)
          const scoreId = pp.product?.competitorId || pp.product?.id;
          if (scoreId) {
            const score = await storage.getCompetitorScore(scoreId);
            if (score) {
              competitorScoresData.push(score);
            }
          }
        }
      }

      // Get all long-form recommendations
      const recommendations = await storage.getLongFormRecommendationsByProject(req.params.projectId);
      const gapAnalysis = recommendations.find(r => r.type === "gap_analysis");
      const strategicRecs = recommendations.find(r => r.type === "strategic_recommendations");
      const competitiveSummary = recommendations.find(r => r.type === "competitive_summary");
      const gtmPlan = recommendations.find(r => r.type === "gtm_plan");
      const messagingFramework = recommendations.find(r => r.type === "messaging_framework");

      // Get battlecards
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      // Calculate overall analytics
      const totalCompetitors = competitorProducts.length;
      const analyzedCompetitors = competitorProducts.filter(pp => pp.product?.analysisData).length;
      const battlecardsGenerated = battlecards.filter(bc => bc.status === "published" || (Array.isArray(bc.strengths) && bc.strengths.length > 0)).length;

      // Compute rankings from scores
      const rankedCompetitors = competitorScoresData.map(score => {
        // Match by competitorId first, then by productId (for standalone products)
        const productInfo = competitorProducts.find(cp => 
          (cp.product?.competitorId && cp.product.competitorId === score.competitorId) ||
          (cp.product?.id === score.competitorId) // Score uses productId for standalone products
        );
        return {
          competitorId: score.competitorId,
          productId: productInfo?.productId || null,
          name: productInfo?.product?.name || "Unknown",
          companyName: productInfo?.product?.companyName || "Unknown",
          overallScore: score.overallScore,
          trendDirection: score.trendDirection,
          trendDelta: score.trendDelta || 0,
          breakdown: {
            marketPresence: score.marketPresenceScore,
            innovation: score.innovationScore,
            pricing: score.pricingScore,
            featureBreadth: score.featureBreadthScore,
            contentActivity: score.contentActivityScore,
            socialEngagement: score.socialEngagementScore,
          }
        };
      }).sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));

      // Identify rising/falling competitors
      const risingCompetitors = rankedCompetitors.filter(c => c.trendDirection === "rising");
      const fallingCompetitors = rankedCompetitors.filter(c => c.trendDirection === "falling");

      // Build executive summary response
      const executiveSummary = {
        project: {
          id: project.id,
          name: project.name,
          clientName: project.clientName,
          analysisType: project.analysisType,
          status: project.status,
        },
        baseline: baselineProduct ? {
          id: baselineProduct.productId,
          name: baselineProduct.product?.name,
          companyName: baselineProduct.product?.companyName,
          description: baselineProduct.product?.description,
        } : null,
        analytics: {
          totalCompetitors,
          analyzedCompetitors,
          battlecardsGenerated,
          completionPercentage: totalCompetitors > 0 
            ? Math.round((analyzedCompetitors / totalCompetitors) * 100) 
            : 0,
        },
        rankings: {
          topCompetitors: rankedCompetitors.slice(0, 5),
          risingThreats: risingCompetitors.slice(0, 3),
          decliningCompetitors: fallingCompetitors.slice(0, 3),
        },
        insights: {
          gapAnalysis: gapAnalysis ? {
            status: gapAnalysis.status,
            lastGenerated: gapAnalysis.lastGeneratedAt,
            content: gapAnalysis.content,
          } : null,
          strategicRecommendations: strategicRecs ? {
            status: strategicRecs.status,
            lastGenerated: strategicRecs.lastGeneratedAt,
            content: strategicRecs.content,
          } : null,
          competitiveSummary: competitiveSummary ? {
            status: competitiveSummary.status,
            lastGenerated: competitiveSummary.lastGeneratedAt,
            content: competitiveSummary.content,
          } : null,
          gtmPlan: gtmPlan ? {
            status: gtmPlan.status,
            lastGenerated: gtmPlan.lastGeneratedAt,
          } : null,
          messagingFramework: messagingFramework ? {
            status: messagingFramework.status,
            lastGenerated: messagingFramework.lastGeneratedAt,
          } : null,
        },
        competitors: competitorProducts.map(cp => {
          const competitorId = cp.product?.competitorId;
          const productId = cp.product?.id;
          // Match by competitorId first, then by productId (for standalone products)
          const matchedScore = rankedCompetitors.find(r => 
            (competitorId && r.competitorId === competitorId) ||
            (productId && r.competitorId === productId)
          );
          return {
            id: cp.productId,
            competitorId: competitorId,
            name: cp.product?.name,
            companyName: cp.product?.companyName,
            score: matchedScore?.overallScore || null,
            trend: matchedScore?.trendDirection || "stable",
            hasAnalysis: !!cp.product?.analysisData,
            hasBattlecard: battlecards.some(bc => bc.competitorProductId === cp.productId),
          };
        }),
        lastUpdated: new Date().toISOString(),
      };

      res.json(executiveSummary);
    } catch (error: any) {
      console.error("Executive summary error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export project as Markdown report
  app.get("/api/projects/:projectId/export", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Gather all project data
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");
      const recommendations = await storage.getLongFormRecommendationsByProject(req.params.projectId);
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const gapAnalysis = recommendations.find(r => r.type === "gap_analysis");
      const strategicRecs = recommendations.find(r => r.type === "strategic_recommendations");
      const competitiveSummary = recommendations.find(r => r.type === "competitive_summary");
      const gtmPlan = recommendations.find(r => r.type === "gtm_plan");
      const messagingFramework = recommendations.find(r => r.type === "messaging_framework");

      // Build Markdown report
      let markdown = `# ${project.name} - Competitive Intelligence Report\n\n`;
      markdown += `**Client:** ${project.clientName}\n`;
      markdown += `**Analysis Type:** ${project.analysisType === "product" ? "Product Analysis" : "Company Analysis"}\n`;
      markdown += `**Generated:** ${new Date().toLocaleDateString()}\n\n`;
      markdown += `---\n\n`;

      // Products Overview
      markdown += `## Products Overview\n\n`;
      if (baselineProduct) {
        markdown += `### Baseline Product\n`;
        markdown += `- **${baselineProduct.product?.name || "Unnamed"}** (${baselineProduct.product?.companyName || "Unknown Company"})\n`;
        if (baselineProduct.product?.url) {
          markdown += `  - URL: ${baselineProduct.product.url}\n`;
        }
        markdown += `\n`;
      }

      if (competitorProducts.length > 0) {
        markdown += `### Competitors (${competitorProducts.length})\n`;
        for (const cp of competitorProducts) {
          markdown += `- **${cp.product?.name || "Unnamed"}** (${cp.product?.companyName || "Unknown Company"})\n`;
        }
        markdown += `\n`;
      }

      markdown += `---\n\n`;

      // Gap Analysis
      if (gapAnalysis?.status === "generated" && gapAnalysis.content) {
        markdown += `## Gap Analysis\n\n`;
        markdown += `*Last updated: ${gapAnalysis.lastGeneratedAt ? new Date(gapAnalysis.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += gapAnalysis.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // Strategic Recommendations
      if (strategicRecs?.status === "generated" && strategicRecs.content) {
        markdown += `## Strategic Recommendations\n\n`;
        markdown += `*Last updated: ${strategicRecs.lastGeneratedAt ? new Date(strategicRecs.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += strategicRecs.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // Competitive Summary
      if (competitiveSummary?.status === "generated" && competitiveSummary.content) {
        markdown += `## Competitive Summary\n\n`;
        markdown += `*Last updated: ${competitiveSummary.lastGeneratedAt ? new Date(competitiveSummary.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += competitiveSummary.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // GTM Plan
      if (gtmPlan?.status === "generated" && gtmPlan.content) {
        markdown += `## Go-to-Market Plan\n\n`;
        markdown += `*Last updated: ${gtmPlan.lastGeneratedAt ? new Date(gtmPlan.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += gtmPlan.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // Messaging Framework
      if (messagingFramework?.status === "generated" && messagingFramework.content) {
        markdown += `## Messaging Framework\n\n`;
        markdown += `*Last updated: ${messagingFramework.lastGeneratedAt ? new Date(messagingFramework.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += messagingFramework.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // Battlecards
      const publishedBattlecards = battlecards.filter(bc => bc.status === "published" || (Array.isArray(bc.strengths) && (bc.strengths as string[]).length > 0));
      if (publishedBattlecards.length > 0) {
        markdown += `## Battlecards\n\n`;
        for (const bc of publishedBattlecards) {
          const competitor = competitorProducts.find(cp => cp.productId === bc.competitorProductId);
          markdown += `### ${competitor?.product?.name || "Competitor"} Battlecard\n\n`;

          const strengths = bc.strengths as string[] | null;
          const weaknesses = bc.weaknesses as string[] | null;
          const ourAdvantages = bc.ourAdvantages as string[] | null;
          const keyDifferentiators = bc.keyDifferentiators as { feature: string; ours: string; theirs: string }[] | null;
          const objections = bc.objections as { objection: string; response: string }[] | null;
          const talkTracks = bc.talkTracks as { scenario: string; script: string }[] | null;

          if (strengths && strengths.length > 0) {
            markdown += `**Their Strengths:**\n`;
            strengths.forEach((s) => markdown += `- ${s}\n`);
            markdown += `\n`;
          }

          if (weaknesses && weaknesses.length > 0) {
            markdown += `**Their Weaknesses:**\n`;
            weaknesses.forEach((w) => markdown += `- ${w}\n`);
            markdown += `\n`;
          }

          if (ourAdvantages && ourAdvantages.length > 0) {
            markdown += `**Our Advantages:**\n`;
            ourAdvantages.forEach((a) => markdown += `- ${a}\n`);
            markdown += `\n`;
          }

          if (keyDifferentiators && keyDifferentiators.length > 0) {
            markdown += `**Key Differentiators:**\n`;
            keyDifferentiators.forEach((d) => {
              markdown += `- **${d.feature}**: Ours: ${d.ours} | Theirs: ${d.theirs}\n`;
            });
            markdown += `\n`;
          }

          if (objections && objections.length > 0) {
            markdown += `**Objection Handling:**\n`;
            objections.forEach((o) => {
              markdown += `- *"${o.objection}"* → ${o.response}\n`;
            });
            markdown += `\n`;
          }

          if (talkTracks && talkTracks.length > 0) {
            markdown += `**Talk Tracks:**\n`;
            talkTracks.forEach((t) => {
              markdown += `- **${t.scenario}**: "${t.script}"\n`;
            });
            markdown += `\n`;
          }

          markdown += `---\n\n`;
        }
      }

      markdown += `\n---\n\n`;
      markdown += `*Report generated by [Orbit](https://orbit.synozur.com) - Go-to-Market Intelligence Platform*\n\n`;
      markdown += `© 2026 The Synozur Alliance LLC. All Rights Reserved.\n`;

      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${project.name.replace(/[^a-z0-9]/gi, "_")}_report.md"`);
      res.send(markdown);
    } catch (error: any) {
      console.error("Project export error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate Full Report - orchestrate all AI generations with one click
  app.post("/api/projects/:projectId/generate-full-report", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set. Add a baseline product first." });
      }

      const baseline = await storage.getProduct(baselineProduct.productId);
      const competitors = await Promise.all(
        competitorProducts.map(pp => storage.getProduct(pp.productId))
      );
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const results: { section: string; status: "success" | "error"; error?: string }[] = [];

      // Helper function to generate and save a section
      const generateSection = async (
        type: string,
        prompt: string,
        sectionName: string
      ): Promise<void> => {
        try {
          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-5",
            max_tokens: 4000,
            messages: [{ role: "user", content: prompt }],
          });

          // Log AI usage
          await logAiUsage(ctx, `generate_${type}`, "anthropic", "claude-sonnet-4-5", response.usage);

          const content = response.content[0].type === "text" ? response.content[0].text : "";

          const existing = await storage.getLongFormRecommendationByType(
            type,
            req.params.projectId,
            undefined
          );

          if (existing) {
            await storage.updateLongFormRecommendation(existing.id, {
              content,
              status: "generated",
              lastGeneratedAt: new Date(),
            });
          } else {
            await storage.createLongFormRecommendation({
              type,
              projectId: req.params.projectId,
              tenantDomain: ctx.tenantDomain,
              marketId: project.marketId || null,
              content,
              status: "generated",
              lastGeneratedAt: new Date(),
              generatedBy: ctx.userId,
            });
          }
          results.push({ section: sectionName, status: "success" });
        } catch (error: any) {
          console.error(`Failed to generate ${sectionName}:`, error);
          results.push({ section: sectionName, status: "error", error: error.message });
        }
      };

      // Build context for prompts
      const contextInfo = `
## Our Product
Name: ${baseline?.name}
Company: ${baseline?.companyName || "Unknown"}
Description: ${baseline?.description || "No description"}

## Competitors
${competitors.filter(Boolean).map(c => `- ${c?.name} (${c?.companyName || "Unknown"}): ${c?.description || "No description"}`).join("\n")}

## Battlecard Insights
${battlecards.map(bc => {
  const comp = competitors.find(c => c?.id === bc.competitorProductId);
  return `
Competitor: ${comp?.name || "Unknown"}
- Their Strengths: ${(Array.isArray(bc.strengths) ? (bc.strengths as string[]).join(", ") : "N/A")}
- Their Weaknesses: ${(Array.isArray(bc.weaknesses) ? (bc.weaknesses as string[]).join(", ") : "N/A")}
- Our Advantages: ${(Array.isArray(bc.ourAdvantages) ? (bc.ourAdvantages as string[]).join(", ") : "N/A")}`;
}).join("\n")}`;

      // Run all generations in parallel
      await Promise.allSettled([
        generateSection(
          "gap_analysis",
          `You are a competitive intelligence analyst. Analyze the positioning gaps for "${baseline?.name}" compared to its competitors.
${contextInfo}

Generate a comprehensive gap analysis in markdown format with sections:
# Gap Analysis
## Executive Summary
## Messaging Gaps  
## Feature Gaps
## Market Position Gaps
## Recommendations`,
          "Gap Analysis"
        ),
        generateSection(
          "strategic_recommendations",
          `You are a strategic advisor. Provide actionable recommendations for "${baseline?.name}" based on competitive analysis.
${contextInfo}

Generate strategic recommendations in markdown format with sections:
# Strategic Recommendations
## Priority Actions
## Competitive Differentiation Opportunities
## Market Expansion Strategies
## Risk Mitigation`,
          "Strategic Recommendations"
        ),
        generateSection(
          "competitive_summary",
          `You are a competitive intelligence analyst. Create a comprehensive competitive summary for "${baseline?.name}".
${contextInfo}

Generate a competitive landscape summary in markdown format with sections:
# Competitive Summary
## Market Overview
## Competitor Profiles
## Competitive Dynamics
## Key Takeaways`,
          "Competitive Summary"
        ),
        generateSection(
          "gtm_plan",
          `You are a go-to-market strategist. Create a GTM plan for "${baseline?.name}" considering the competitive landscape.
${contextInfo}

Generate a go-to-market plan in markdown format with sections:
# Go-to-Market Plan
## Target Market
## Value Proposition
## Channel Strategy
## Launch Tactics
## Success Metrics`,
          "GTM Plan"
        ),
        generateSection(
          "messaging_framework",
          `You are a marketing strategist. Create a messaging framework for "${baseline?.name}" that differentiates from competitors.
${contextInfo}

Generate a messaging framework in markdown format with sections:
# Messaging Framework
## Core Value Proposition
## Key Messages by Audience
## Competitive Positioning Statements
## Proof Points
## Call to Action Templates`,
          "Messaging Framework"
        ),
      ]);

      // Calculate competitor scores
      try {
        for (const pp of competitorProducts) {
          const product = pp.product;
          if (!product?.competitorId) continue;

          const competitor = await storage.getCompetitor(product.competitorId);
          const battlecard = battlecards.find(bc => bc.competitorProductId === pp.productId);

          let marketPresenceScore = 50;
          let innovationScore = 50;
          let pricingScore = 50;
          let featureBreadthScore = 50;
          let contentActivityScore = 50;
          let socialEngagementScore = 50;

          if (battlecard) {
            const strengthsArr = Array.isArray(battlecard.strengths) ? battlecard.strengths as string[] : [];
            const weaknessesArr = Array.isArray(battlecard.weaknesses) ? battlecard.weaknesses as string[] : [];
            featureBreadthScore = Math.min(100, 50 + (strengthsArr.length - weaknessesArr.length) * 5);
          }

          if (competitor?.linkedInEngagement) {
            const engagement = competitor.linkedInEngagement as any;
            if (engagement.followers > 10000) socialEngagementScore = 80;
            else if (engagement.followers > 5000) socialEngagementScore = 65;
          }

          const overallScore = Math.round(
            (marketPresenceScore * 0.25) +
            (innovationScore * 0.20) +
            (featureBreadthScore * 0.20) +
            (contentActivityScore * 0.15) +
            (socialEngagementScore * 0.10) +
            (pricingScore * 0.10)
          );

          const existingScore = await storage.getCompetitorScore(product.competitorId, req.params.projectId);
          const previousScore = existingScore?.overallScore || null;
          const trendDelta = previousScore !== null ? overallScore - previousScore : 0;
          const trendDirection = trendDelta > 5 ? "rising" : trendDelta < -5 ? "falling" : "stable";

          await storage.upsertCompetitorScore({
            competitorId: product.competitorId,
            projectId: req.params.projectId,
            tenantDomain: ctx.tenantDomain,
            marketId: project.marketId || null,
            overallScore,
            marketPresenceScore,
            innovationScore,
            pricingScore,
            featureBreadthScore,
            contentActivityScore,
            socialEngagementScore,
            trendDirection,
            trendDelta,
          });
        }
        results.push({ section: "Competitor Scores", status: "success" });
      } catch (error: any) {
        console.error("Failed to calculate scores:", error);
        results.push({ section: "Competitor Scores", status: "error", error: error.message });
      }

      const successful = results.filter(r => r.status === "success").length;
      const failed = results.filter(r => r.status === "error").length;

      res.json({
        message: `Report generation complete. ${successful} sections generated successfully${failed > 0 ? `, ${failed} failed` : ""}.`,
        results,
        allSuccess: failed === 0,
      });
    } catch (error: any) {
      console.error("Generate full report error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get side-by-side messaging comparison
  app.get("/api/projects/:projectId/messaging-comparison", async (req, res) => {
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
      if (project.tenantDomain !== tenantDomain && !hasCrossTenantReadAccess(user.role)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      // Extract messaging data from baseline
      const baselineAnalysis = baselineProduct?.product?.analysisData as any;
      const baseline = baselineProduct ? {
        id: baselineProduct.productId,
        name: baselineProduct.product?.name || "Your Product",
        companyName: baselineProduct.product?.companyName || "Your Company",
        messaging: {
          summary: baselineAnalysis?.summary || null,
          valueProposition: baselineAnalysis?.valueProposition || null,
          targetAudience: baselineAnalysis?.targetAudience || null,
          keyMessages: baselineAnalysis?.keyMessages || [],
          differentiators: baselineAnalysis?.differentiators || [],
          toneAndStyle: baselineAnalysis?.toneAndStyle || null,
        }
      } : null;

      // Extract messaging data from competitors
      const competitors = competitorProducts.map(cp => {
        const analysis = cp.product?.analysisData as any;
        return {
          id: cp.productId,
          name: cp.product?.name || "Unknown",
          companyName: cp.product?.companyName || "Unknown",
          messaging: {
            summary: analysis?.summary || null,
            valueProposition: analysis?.valueProposition || null,
            targetAudience: analysis?.targetAudience || null,
            keyMessages: analysis?.keyMessages || [],
            differentiators: analysis?.differentiators || [],
            toneAndStyle: analysis?.toneAndStyle || null,
          },
          hasAnalysis: !!analysis,
        };
      });

      res.json({
        baseline,
        competitors,
        totalCompetitors: competitorProducts.length,
        analyzedCompetitors: competitors.filter(c => c.hasAnalysis).length,
      });
    } catch (error: any) {
      console.error("Messaging comparison error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Calculate and update competitor scores
  app.post("/api/projects/:projectId/calculate-scores", async (req, res) => {
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

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const scores = [];

      for (const cp of competitorProducts) {
        const product = cp.product;
        if (!product) continue;

        const battlecard = battlecards.find(bc => bc.competitorProductId === cp.productId);

        // Calculate component scores based on available data
        let marketPresenceScore = 50; // Default baseline
        let innovationScore = 50;
        let pricingScore = 50;
        let featureBreadthScore = 50;
        let contentActivityScore = 50;
        let socialEngagementScore = 50;

        // Get linked competitor data if available
        let competitor = null;
        if (product.competitorId) {
          competitor = await storage.getCompetitor(product.competitorId);
        }

        // Adjust based on competitor analysis data (if linked)
        if (competitor?.analysisData) {
          const analysis = competitor.analysisData as any;
          if (analysis.marketPosition) {
            marketPresenceScore = analysis.marketPosition === "leader" ? 90 : 
                                  analysis.marketPosition === "challenger" ? 70 : 50;
          }
          if (analysis.innovationLevel) {
            innovationScore = analysis.innovationLevel === "high" ? 85 : 
                             analysis.innovationLevel === "medium" ? 60 : 40;
          }
        }
        
        // Also adjust based on product's own analysis data
        if (product.analysisData) {
          const productAnalysis = product.analysisData as any;
          if (productAnalysis.competitiveScore) {
            // Use product's competitive score to influence overall
            marketPresenceScore = Math.round((marketPresenceScore + productAnalysis.competitiveScore) / 2);
          }
          if (productAnalysis.features?.length) {
            featureBreadthScore = Math.min(100, 40 + productAnalysis.features.length * 6);
          }
          // For standalone products, use additional product analysis fields
          if (productAnalysis.marketPosition) {
            marketPresenceScore = productAnalysis.marketPosition === "leader" ? 90 : 
                                  productAnalysis.marketPosition === "challenger" ? 70 : 50;
          }
          if (productAnalysis.innovationLevel) {
            innovationScore = productAnalysis.innovationLevel === "high" ? 85 : 
                             productAnalysis.innovationLevel === "medium" ? 60 : 40;
          }
        }

        // Adjust based on battlecard data
        if (battlecard) {
          const strengths = Array.isArray(battlecard.strengths) ? battlecard.strengths.length : 0;
          const weaknesses = Array.isArray(battlecard.weaknesses) ? battlecard.weaknesses.length : 0;
          featureBreadthScore = Math.min(100, 50 + (strengths - weaknesses) * 5);
          
          // Also boost innovation if battlecard shows strong differentiators
          if (battlecard.keyDifferentiators && Array.isArray(battlecard.keyDifferentiators)) {
            innovationScore = Math.min(100, 50 + battlecard.keyDifferentiators.length * 8);
          }
        }

        // Adjust based on social engagement from linked competitor
        if (competitor?.linkedInEngagement) {
          const engagement = competitor.linkedInEngagement as any;
          if (engagement.followers > 10000) socialEngagementScore = 80;
          else if (engagement.followers > 5000) socialEngagementScore = 65;
        }

        // Calculate overall score (weighted average)
        const overallScore = Math.round(
          (marketPresenceScore * 0.25) +
          (innovationScore * 0.20) +
          (featureBreadthScore * 0.20) +
          (contentActivityScore * 0.15) +
          (socialEngagementScore * 0.10) +
          (pricingScore * 0.10)
        );

        // Get previous score for trend calculation
        // Use product score lookup for standalone products, competitor score for linked products
        const existingScore = product.competitorId 
          ? await storage.getCompetitorScore(product.competitorId, req.params.projectId)
          : await storage.getProductScore(product.id, req.params.projectId);
        const previousScore = existingScore?.overallScore || null;
        const trendDelta = previousScore !== null ? overallScore - previousScore : 0;
        const trendDirection = trendDelta > 5 ? "rising" : trendDelta < -5 ? "falling" : "stable";

        // Build score data - use productId for standalone products, competitorId for linked
        const scorePayload = {
          competitorId: product.competitorId || null,
          productId: product.competitorId ? null : product.id, // Only set productId for standalone products
          projectId: req.params.projectId,
          tenantDomain,
          marketId: project.marketId || null,
          entityName: product.name,
          overallScore,
          marketPresenceScore,
          innovationScore,
          pricingScore,
          featureBreadthScore,
          contentActivityScore,
          socialEngagementScore,
          trendDirection,
          trendDelta,
          previousOverallScore: previousScore,
          scoreBreakdown: {
            marketPresence: { score: marketPresenceScore, weight: 0.25 },
            innovation: { score: innovationScore, weight: 0.20 },
            featureBreadth: { score: featureBreadthScore, weight: 0.20 },
            contentActivity: { score: contentActivityScore, weight: 0.15 },
            socialEngagement: { score: socialEngagementScore, weight: 0.10 },
            pricing: { score: pricingScore, weight: 0.10 },
          },
        };

        // Use appropriate upsert method based on product type
        const scoreData = product.competitorId 
          ? await storage.upsertCompetitorScore(scorePayload)
          : await storage.upsertProductScore(scorePayload);

        scores.push({
          ...scoreData,
          name: product.name,
        });
      }

      res.json({ success: true, scores });
    } catch (error: any) {
      console.error("Score calculation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===============================
  // BASELINE-LEVEL RECOMMENDATIONS
  // ===============================

  // Get baseline GTM plan
  app.get("/api/baseline/recommendations/gtm_plan", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      if (!companyProfile) {
        return res.json({
          type: "gtm_plan",
          status: "not_generated",
          content: null,
          savedPrompts: null,
          lastGeneratedAt: null
        });
      }

      const recommendation = await storage.getLongFormRecommendationByType(
        "gtm_plan",
        undefined,
        companyProfile.id
      );
      
      if (!recommendation) {
        return res.json({
          type: "gtm_plan",
          companyProfileId: companyProfile.id,
          status: "not_generated",
          content: null,
          savedPrompts: null,
          lastGeneratedAt: null
        });
      }
      
      res.json(recommendation);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get baseline messaging framework
  app.get("/api/baseline/recommendations/messaging_framework", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      if (!companyProfile) {
        return res.json({
          type: "messaging_framework",
          status: "not_generated",
          content: null,
          savedPrompts: null,
          lastGeneratedAt: null
        });
      }

      const recommendation = await storage.getLongFormRecommendationByType(
        "messaging_framework",
        undefined,
        companyProfile.id
      );
      
      if (!recommendation) {
        return res.json({
          type: "messaging_framework",
          companyProfileId: companyProfile.id,
          status: "not_generated",
          content: null,
          savedPrompts: null,
          lastGeneratedAt: null
        });
      }
      
      res.json(recommendation);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Generate baseline GTM plan
  app.post("/api/baseline/recommendations/gtm_plan/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      if (!companyProfile) {
        return res.status(400).json({ error: "Company profile not found. Please set up your company profile first." });
      }

      const { customGuidance } = req.body;
      const savedPrompts = { customGuidance };

      // Get competitors for context
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      
      let competitorContext = "";
      if (competitors.length > 0) {
        competitorContext = "\n\nCompetitors:";
        for (const c of competitors) {
          competitorContext += `\n- ${c.name} (${c.url})`;
        }
      }

      // Get analysis data if available
      const analysis = await storage.getLatestAnalysisByContext(toContextFilter(ctx));
      let analysisContext = "";
      if (analysis) {
        if (analysis.gaps && Array.isArray(analysis.gaps)) {
          analysisContext += "\n\nIdentified Gaps:";
          for (const gap of analysis.gaps.slice(0, 5)) {
            analysisContext += `\n- ${gap.area}: ${gap.observation} (Impact: ${gap.impact})`;
          }
        }
      }

      const prompt = `You are an expert go-to-market strategist. Create a comprehensive GTM plan in markdown format.

Company: ${companyProfile.companyName}
Website: ${companyProfile.websiteUrl}
Description: ${companyProfile.description || "N/A"}
${competitorContext}
${analysisContext}

${customGuidance ? `Custom Guidance: ${customGuidance}` : ""}

Create a detailed, actionable Go-To-Market plan with the following sections:

# Go-To-Market Plan: ${companyProfile.companyName}

## Executive Summary
Brief overview of the GTM strategy

## Target Market Analysis
- Primary target segments
- Market size and opportunity
- Key buyer personas

## Value Proposition
- Core differentiation
- Key benefits by persona
- Competitive advantages

## Positioning Strategy
- Market positioning statement
- Category definition
- Competitive differentiation

## Channel Strategy
- Primary distribution channels
- Partner ecosystem opportunities
- Digital presence optimization

## Marketing Strategy
- Content marketing approach
- Demand generation tactics
- Brand awareness initiatives

## Sales Strategy
- Sales motion (product-led, sales-led, hybrid)
- Sales process and stages
- Key objection handling

## Launch Plan
- Phase 1: Foundation (30 days)
- Phase 2: Growth (60 days)
- Phase 3: Scale (90 days)

## Success Metrics
- Key performance indicators
- Revenue targets
- Customer acquisition goals

## Resource Requirements
- Team structure
- Budget considerations
- Technology stack

Make this practical and actionable for the team.`;

      // Use OpenAI gpt-5.2 for enhanced GTM plan generation
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const content = completion.choices[0]?.message?.content || "";

      const existing = await storage.getLongFormRecommendationByType("gtm_plan", undefined, companyProfile.id);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "gtm_plan",
          companyProfileId: companyProfile.id,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          savedPrompts,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Baseline GTM plan generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate baseline messaging framework
  app.post("/api/baseline/recommendations/messaging_framework/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      if (!companyProfile) {
        return res.status(400).json({ error: "Company profile not found. Please set up your company profile first." });
      }

      const { customGuidance } = req.body;
      const savedPrompts = { customGuidance };

      // Get competitors for context
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      
      let competitorContext = "";
      if (competitors.length > 0) {
        competitorContext = "\n\nCompetitors:";
        for (const c of competitors) {
          competitorContext += `\n- ${c.name} (${c.url})`;
        }
      }

      // Get analysis data if available
      const analysis = await storage.getLatestAnalysisByContext(toContextFilter(ctx));
      let analysisContext = "";
      if (analysis) {
        if (analysis.messaging && Array.isArray(analysis.messaging)) {
          analysisContext += "\n\nCurrent Messaging Comparison:";
          for (const m of analysis.messaging.slice(0, 5)) {
            analysisContext += `\n- ${m.category}: "${m.us}" vs competitors`;
          }
        }
        if (analysis.gaps && Array.isArray(analysis.gaps)) {
          analysisContext += "\n\nIdentified Gaps:";
          for (const gap of analysis.gaps.slice(0, 5)) {
            analysisContext += `\n- ${gap.area}: ${gap.observation}`;
          }
        }
      }

      const prompt = `You are an expert brand strategist and messaging architect. Create a comprehensive Messaging & Positioning Framework in markdown format.

Company: ${companyProfile.companyName}
Website: ${companyProfile.websiteUrl}
Description: ${companyProfile.description || "N/A"}
${competitorContext}
${analysisContext}

${customGuidance ? `Custom Guidance: ${customGuidance}` : ""}

Create a detailed messaging framework with the following sections:

# Messaging & Positioning Framework: ${companyProfile.companyName}

## Brand Positioning Statement
A clear, concise positioning statement following the format:
"For [target audience] who [need], [company] is the [category] that [key benefit] because [reason to believe]."

## Core Value Proposition
The primary value delivered to customers

## Messaging Pillars
3-5 key themes that support the positioning

## Audience Segments & Tailored Messages
For each key audience:
- Who they are
- Their pain points
- Key messages that resonate
- Proof points

## Competitive Differentiation
How the company stands apart from competitors

## Tone of Voice Guidelines
- Personality traits
- Do's and Don'ts
- Example phrases

## Key Talking Points
Elevator pitches of varying lengths:
- 10-second version
- 30-second version
- 2-minute version

## Tagline Options
3-5 potential taglines

## Proof Points & Evidence
Statistics, case studies, testimonials to support claims

## Messaging Do's and Don'ts
Clear guidelines on messaging boundaries

Make this practical and ready for use by sales, marketing, and leadership teams.`;

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      // Log AI usage
      await logAiUsage(ctx, "generate_baseline_messaging_framework", "anthropic", "claude-sonnet-4-5", message.usage);

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("messaging_framework", undefined, companyProfile.id);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "messaging_framework",
          companyProfileId: companyProfile.id,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          savedPrompts,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Baseline messaging framework generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== FULL REGENERATION ENDPOINTS ====================

  // Start full regeneration of all analysis (runs in background, emails when complete)
  app.post("/api/baseline/full-regenerate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const user = await storage.getUser(ctx.userId);
      
      // Check prerequisites
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      if (!companyProfile) {
        return res.status(400).json({ error: "Please set up your company profile first" });
      }

      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      if (competitors.length === 0) {
        return res.status(400).json({ error: "Please add at least one competitor first" });
      }

      // Start the background regeneration job
      const jobId = await startFullRegeneration(
        ctx.userId,
        ctx.tenantDomain,
        user?.email || "",
        user?.name || "",
        ctx.marketId
      );

      res.json({
        success: true,
        jobId,
        message: "Full analysis regeneration started. You'll receive an email when it's complete.",
        estimatedMinutes: Math.ceil((competitors.length * 2) + 5),
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Full regeneration start error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get regeneration job status
  app.get("/api/baseline/regeneration-status/:jobId", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const status = getRegenerationStatus(req.params.jobId);
      if (!status) {
        return res.status(404).json({ error: "Job not found or expired" });
      }

      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Download recommendation as markdown
  app.get("/api/recommendations/:id/download/markdown", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const recommendation = await storage.getLongFormRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (recommendation.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const filename = `${recommendation.type}_${new Date().toISOString().split('T')[0]}.md`;
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(recommendation.content || "");
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Download recommendation as Word document (DOCX)
  app.get("/api/recommendations/:id/download/docx", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const recommendation = await storage.getLongFormRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (recommendation.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      // Convert markdown to simple HTML then to docx-compatible format
      const content = recommendation.content || "";
      
      // Simple markdown to HTML conversion for basic formatting
      let html = content
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        .replace(/^- (.*$)/gim, '<li>$1</li>')
        .replace(/\n/gim, '<br/>');

      // Create a simple Word-compatible HTML document
      const docContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; }
            h1 { color: #333; border-bottom: 2px solid #810FFB; padding-bottom: 10px; }
            h2 { color: #555; margin-top: 30px; }
            h3 { color: #666; }
            li { margin: 5px 0; }
          </style>
        </head>
        <body>
          ${html}
        </body>
        </html>
      `;

      const filename = `${recommendation.type}_${new Date().toISOString().split('T')[0]}.doc`;
      res.setHeader("Content-Type", "application/msword");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(docContent);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update saved prompts for a recommendation
  app.patch("/api/recommendations/:id/prompts", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const recommendation = await storage.getLongFormRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (recommendation.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateLongFormRecommendation(req.params.id, {
        savedPrompts: req.body.savedPrompts,
      });
      res.json(updated);
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

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
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

  // AI-suggest competitor companies for a baseline company
  app.post("/api/company-profile/suggest-competitors", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      if (!companyProfile) {
        return res.status(400).json({ error: "Please set up your company profile first" });
      }

      // Get existing competitors to exclude from suggestions
      const existingCompetitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      const existingNames = existingCompetitors.map(c => c.name.toLowerCase());
      const existingUrls = existingCompetitors.map(c => {
        try {
          return new URL(c.url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      }).filter(Boolean);

      const analysisData = companyProfile.analysisData as any || {};
      
      const prompt = `Analyze this company and suggest 5-8 competing companies in the market:

Company: ${companyProfile.companyName}
Website: ${companyProfile.websiteUrl}
Industry: ${analysisData.industry || "Unknown"}
Description: ${analysisData.companyDescription || analysisData.valueProposition || "No description available"}
Key offerings: ${analysisData.keyOfferings?.join(", ") || "Not specified"}

${existingNames.length > 0 ? `Already tracking these competitors (exclude from suggestions): ${existingNames.join(", ")}` : ""}

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

      let suggestions: any[] = [];
      try {
        const responseText = message.content[0].type === "text" ? message.content[0].text : "";
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          // Filter out any that match existing competitors by URL
          suggestions = parsed.filter((s: any) => {
            try {
              const hostname = new URL(s.url).hostname.replace(/^www\./, "");
              return !existingUrls.includes(hostname);
            } catch {
              return true;
            }
          });
        }
      } catch (e) {
        console.error("Failed to parse AI competitor suggestions:", e);
      }

      res.json(suggestions);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Auto-generate product description from URL
  app.post("/api/products/auto-describe", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { url, name } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      // Validate URL format and protocol
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          return res.status(400).json({ error: "Only HTTP/HTTPS URLs are allowed" });
        }
        // Block private IP ranges and localhost
        const hostname = parsedUrl.hostname.toLowerCase();
        if (hostname === "localhost" || 
            hostname === "127.0.0.1" || 
            hostname.startsWith("192.168.") ||
            hostname.startsWith("10.") ||
            hostname.startsWith("172.16.") ||
            hostname.endsWith(".local")) {
          return res.status(400).json({ error: "Internal/private URLs are not allowed" });
        }
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }

      // Fetch website content with timeout
      let websiteContent = "";
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
        
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; OrbitBot/1.0; +https://orbit.synozur.com)",
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch URL: ${response.status}`);
        }
        const rawHtml = await response.text();
        
        // Extract text content from HTML
        websiteContent = rawHtml
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 5000); // Limit content to avoid huge prompts
      } catch (fetchError: any) {
        return res.status(400).json({ error: `Could not fetch website: ${fetchError.message}` });
      }

      // Use AI to generate description
      const prompt = `Based on the following website content for a product${name ? ` called "${name}"` : ""}, write a concise 2-3 sentence description that captures what the product does and its key value proposition. Be specific and factual.

Website content:
${websiteContent}

Return only the description text, no quotes or formatting.`;

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });

      const description = message.content[0].type === "text" ? message.content[0].text.trim() : "";
      
      res.json({ description });
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

      // Verify same domain (only Synozur Global Admins can modify cross-tenant)
      const currentDomain = currentUser.email.split("@")[1];
      const targetDomain = targetUser.email.split("@")[1];
      const isSynozurAdmin = currentUser.role === "Global Admin" && currentDomain === "synozur.com";
      if (!isSynozurAdmin && currentDomain !== targetDomain) {
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

  // Toggle email verification (Domain Admin or Global Admin)
  app.patch("/api/team/members/:userId/verification", async (req, res) => {
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

      // Verify same domain (only Synozur Global Admins can modify cross-tenant)
      const currentDomain = currentUser.email.split("@")[1];
      const targetDomain = targetUser.email.split("@")[1];
      const isSynozurAdmin = currentUser.role === "Global Admin" && currentDomain === "synozur.com";
      if (!isSynozurAdmin && currentDomain !== targetDomain) {
        return res.status(403).json({ error: "Cannot modify users from another tenant" });
      }

      // Cannot modify self
      if (targetUser.id === currentUser.id) {
        return res.status(400).json({ error: "Cannot change your own verification status" });
      }

      const { emailVerified } = req.body;
      if (typeof emailVerified !== "boolean") {
        return res.status(400).json({ error: "emailVerified must be a boolean" });
      }

      const updated = await storage.updateUser(req.params.userId, { emailVerified });
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

      // Verify same domain (only Synozur Global Admins can modify cross-tenant)
      const currentDomain = currentUser.email.split("@")[1];
      const targetDomain = targetUser.email.split("@")[1];
      const isSynozurAdmin = currentUser.role === "Global Admin" && currentDomain === "synozur.com";
      if (!isSynozurAdmin && currentDomain !== targetDomain) {
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

  // ==================== TENANT ADMIN - ENTRA ID USER PROVISIONING ====================

  // Search Entra ID users from Microsoft Graph API
  app.get("/api/team/entra/search", async (req, res) => {
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

      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.status(400).json({ error: "Search query must be at least 2 characters" });
      }

      const { searchEntraUsers, isGraphApiConfigured } = await import("./services/entra-graph-service");
      
      if (!isGraphApiConfigured()) {
        return res.status(503).json({ error: "Microsoft Graph API is not configured. Please contact Synozur support." });
      }

      // Use active tenant context for Global Admins, otherwise use user's email domain
      let tenant;
      if (currentUser.role === "Global Admin" && req.session.activeTenantId) {
        tenant = await storage.getTenant(req.session.activeTenantId);
        console.log(`[Entra Search] Global Admin using active tenant context: ${tenant?.domain}, Azure Tenant ID: ${tenant?.entraTenantId}`);
      } else {
        const userDomain = currentUser.email.split("@")[1];
        tenant = await storage.getTenantByDomain(userDomain);
        console.log(`[Entra Search] Using user domain tenant: ${tenant?.domain}, Azure Tenant ID: ${tenant?.entraTenantId}`);
      }
      
      if (!tenant?.entraTenantId) {
        console.log(`[Entra Search] No Azure Tenant ID configured for tenant: ${tenant?.domain}`);
        return res.status(400).json({ 
          error: "Azure Tenant ID is not configured for this organization. Please contact your administrator to set up Entra ID integration." 
        });
      }

      console.log(`[Entra Search] Searching for "${query}" in Azure tenant: ${tenant.entraTenantId}`);
      const result = await searchEntraUsers(query, tenant.entraTenantId);
      
      if (result.error) {
        return res.status(500).json({ error: result.error });
      }

      res.json(result.users);
    } catch (error: any) {
      console.error("Entra search error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Check if Entra ID is configured (admin only)
  app.get("/api/team/entra/status", async (req, res) => {
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

      const { isGraphApiConfigured } = await import("./services/entra-graph-service");
      
      // Check if base credentials are configured
      if (!isGraphApiConfigured()) {
        return res.json({ configured: false, reason: "platform" });
      }
      
      // Use active tenant context for Global Admins, otherwise use user's email domain
      let tenant;
      if (currentUser.role === "Global Admin" && req.session.activeTenantId) {
        tenant = await storage.getTenant(req.session.activeTenantId);
      } else {
        const userDomain = currentUser.email.split("@")[1];
        tenant = await storage.getTenantByDomain(userDomain);
      }
      
      if (!tenant?.entraTenantId) {
        return res.json({ configured: false, reason: "tenant" });
      }
      
      res.json({ configured: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get admin consent URL for a tenant (to grant Graph API permissions)
  app.get("/api/team/entra/admin-consent-url", async (req, res) => {
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

      const clientId = process.env.ENTRA_CLIENT_ID;
      if (!clientId) {
        return res.status(503).json({ error: "Entra ID not configured" });
      }

      // Use active tenant context for Global Admins, otherwise use user's email domain
      let tenant;
      if (currentUser.role === "Global Admin" && req.session.activeTenantId) {
        tenant = await storage.getTenant(req.session.activeTenantId);
      } else {
        const userDomain = currentUser.email.split("@")[1];
        tenant = await storage.getTenantByDomain(userDomain);
      }
      
      if (!tenant?.entraTenantId) {
        return res.status(400).json({ error: "Azure Tenant ID is not configured for this organization" });
      }

      // Construct the admin consent URL
      const redirectUri = `${req.protocol}://${req.get("host")}/team`;
      const adminConsentUrl = `https://login.microsoftonline.com/${tenant.entraTenantId}/adminconsent?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;

      res.json({ 
        url: adminConsentUrl,
        tenantId: tenant.entraTenantId,
        tenantDomain: tenant.domain
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Provision user directly from Entra ID
  app.post("/api/team/entra/provision", async (req, res) => {
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

      const { entraUserId, email, displayName, jobTitle, role, sendWelcomeEmail } = req.body;

      if (!email || !displayName) {
        return res.status(400).json({ error: "Email and display name are required" });
      }

      const validRoles = ["Standard User", "Domain Admin"];
      if (role && !validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role. Must be 'Standard User' or 'Domain Admin'" });
      }

      // Validate domain access
      const currentDomain = currentUser.email.split("@")[1];
      const newUserDomain = email.split("@")[1];
      if (currentDomain !== newUserDomain && currentUser.role !== "Global Admin") {
        return res.status(400).json({ error: `User must have an @${currentDomain} email address` });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
      }

      // Get tenant info based on new user's domain (not current user's domain for cross-tenant provisioning)
      const tenant = await storage.getTenantByDomain(newUserDomain);
      if (!tenant) {
        return res.status(400).json({ error: `No tenant found for domain @${newUserDomain}. The tenant must be created first.` });
      }

      // Create user with SSO marker (no password needed for Entra users)
      const avatar = displayName.charAt(0).toUpperCase();
      const newUser = await storage.createUser({
        email,
        password: "__SSO_USER__", // Marker for SSO-only users (never used for login)
        name: displayName,
        role: role || "Standard User",
        company: tenant.name,
        companySize: "",
        jobTitle: jobTitle || "",
        industry: "",
        country: "",
        avatar,
        emailVerified: true, // SSO users are pre-verified
        status: "active",
        entraId: entraUserId || null,
        authProvider: "entra", // Mark as SSO user
      });

      // Update tenant user count
      await storage.updateTenant(tenant.id, { 
        userCount: (tenant.userCount || 0) + 1 
      });

      // Send welcome email if requested
      if (sendWelcomeEmail) {
        const { sendUserProvisionedWelcomeEmail } = await import("./services/email-service");
        const baseUrl = process.env.REPLIT_DEV_DOMAIN 
          ? `https://${process.env.REPLIT_DEV_DOMAIN}`
          : "https://orbit.synozur.com";
        
        await sendUserProvisionedWelcomeEmail(
          email,
          displayName,
          tenant.name,
          role || "Standard User",
          currentUser.name,
          baseUrl
        );
      }

      const { password: _, ...userWithoutPassword } = newUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Entra provision error:", error);
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

  // Get dashboard scores with calculated values for baseline and competitors
  app.get("/api/dashboard/scores", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      // Get baseline company profile
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      // Get competitors
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      
      // Calculate baseline scores using dedicated baseline function
      let baselineScores: ScoreBreakdown | null = null;
      let baselineTrend: { previousScore: number; delta: number; direction: string } | null = null;
      
      if (companyProfile) {
        baselineScores = calculateBaselineScore({
          description: companyProfile.description,
          crawlData: companyProfile.crawlData as any,
          blogSnapshot: companyProfile.blogSnapshot as any,
          linkedInEngagement: companyProfile.linkedInEngagement as any,
          instagramEngagement: companyProfile.instagramEngagement as any,
          lastCrawl: companyProfile.lastCrawl,
        });
        
        // Get trend data from score history
        const previousScore = await storage.getLatestScoreForEntity("baseline", companyProfile.id);
        if (previousScore) {
          const delta = Math.round((baselineScores.overallScore - previousScore.overallScore) * 100) / 100;
          baselineTrend = {
            previousScore: previousScore.overallScore,
            delta,
            direction: delta > 0 ? "up" : delta < 0 ? "down" : "stable"
          };
        }
      }
      
      // Calculate competitor scores
      const competitorScores = competitors.map(c => {
        const analysisData = c.analysisData as any;
        const scores = calculateScores(
          analysisData,
          c.linkedInEngagement as any,
          c.instagramEngagement as any,
          c.crawlData as any,
          c.blogSnapshot as any,
          c.lastCrawl ? new Date(c.lastCrawl) : null
        );
        return {
          id: c.id,
          name: c.name,
          ...scores,
        };
      });
      
      // Calculate market average
      const avgInnovation = competitorScores.length > 0
        ? competitorScores.reduce((sum, c) => sum + c.innovationScore, 0) / competitorScores.length
        : 50;
      const avgMarketPresence = competitorScores.length > 0
        ? competitorScores.reduce((sum, c) => sum + c.marketPresenceScore, 0) / competitorScores.length
        : 50;
      const avgOverall = competitorScores.length > 0
        ? competitorScores.reduce((sum, c) => sum + c.overallScore, 0) / competitorScores.length
        : 50;
      
      // Calculate delta vs market average
      const baselineOverall = baselineScores?.overallScore || 0;
      const deltaVsMarket = baselineOverall - avgOverall;
      const deltaPercent = avgOverall > 0 ? Math.round((deltaVsMarket / avgOverall) * 100) : 0;
      
      res.json({
        baseline: baselineScores ? {
          name: companyProfile?.companyName || 'Your Company',
          id: companyProfile?.id,
          ...baselineScores,
          trend: baselineTrend,
        } : null,
        competitors: competitorScores,
        marketAverages: {
          innovationScore: Math.round(avgInnovation * 100) / 100,
          marketPresenceScore: Math.round(avgMarketPresence * 100) / 100,
          overallScore: Math.round(avgOverall * 100) / 100,
        },
        deltaVsMarket: {
          absolute: Math.round(deltaVsMarket * 100) / 100,
          percent: deltaPercent,
        },
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Dashboard scores error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get basic tenant info (plan, premium status) for any authenticated user
  app.get("/api/tenant/info", async (req, res) => {
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
        return res.json({ plan: "trial", isPremium: false });
      }

      const isPremium = tenant.plan === "pro" || tenant.plan === "professional" || tenant.plan === "enterprise";
      
      res.json({
        plan: tenant.plan,
        isPremium,
        name: tenant.name,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

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
      
      const { name, logoUrl, faviconUrl, primaryColor, secondaryColor, monitoringFrequency, entraClientId, entraTenantId, entraClientSecret, entraEnabled } = req.body;
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
      // Tenant-level Entra ID configuration (Domain Admin editable)
      if (entraClientId !== undefined) {
        updateData.entraClientId = entraClientId?.trim() || null;
      }
      if (entraTenantId !== undefined) {
        updateData.entraTenantId = entraTenantId?.trim() || null;
      }
      if (entraClientSecret !== undefined) {
        updateData.entraClientSecret = entraClientSecret?.trim() || null;
      }
      if (typeof entraEnabled === "boolean") {
        updateData.entraEnabled = entraEnabled;
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

  // Admin endpoint to backfill marketId for existing activities
  app.post("/api/admin/backfill-activity-markets", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Global Admin only" });
      }

      // Run SQL to backfill marketId based on competitor records
      const result = await db.execute(sql`
        UPDATE activity a
        SET market_id = c.market_id
        FROM competitors c
        WHERE a.market_id IS NULL 
          AND a.competitor_id IS NOT NULL
          AND c.id = a.competitor_id
      `);

      // Also backfill from company profiles for baseline-related activities
      const result2 = await db.execute(sql`
        UPDATE activity a
        SET market_id = cp.market_id
        FROM company_profiles cp
        WHERE a.market_id IS NULL 
          AND a.company_profile_id IS NOT NULL
          AND cp.id = a.company_profile_id
      `);

      res.json({ 
        success: true, 
        message: "Activity market IDs backfilled successfully",
        competitorLinked: result.rowCount || 0,
        baselineLinked: result2.rowCount || 0
      });
    } catch (error: any) {
      console.error("Backfill activity markets error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== COMMAND CENTER ROUTES ====================

  // Get Command Center data - aggregated view across all projects
  app.get("/api/command-center", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const ctxFilter = toContextFilter(ctx);

      // Get all projects for this tenant/market context
      const projects = await storage.getClientProjectsByContext(ctxFilter);
      
      // Get all competitors for this tenant/market context (including baseline)
      const allCompetitors = await storage.getCompetitorsByContext(ctxFilter);
      
      // Get all products for this tenant/market context
      const allProducts = await storage.getProductsByContext(ctxFilter);
      
      // Get all recommendations (action items)
      // Handle both new statuses (pending/accepted/dismissed) and legacy statuses (Open/In Progress)
      const allRecommendations = await storage.getRecommendationsByContext(ctxFilter);
      const pendingActions = allRecommendations.filter(r => 
        r.status === "pending" || r.status === "Open" || r.status === "In Progress" || !r.status
      );
      
      // Get recent activity
      const recentActivity = await storage.getActivityByContext(ctxFilter);
      
      // Get tenant users for assignment dropdown
      const tenantUsers = await storage.getUsersByDomain(ctx.tenantDomain);
      
      // Calculate aggregate health score (average of competitor scores where available)
      let totalScore = 0;
      let scoredCompetitors = 0;
      const competitorScores: Array<{id: string; name: string; score: number; lastAnalysis: string | null}> = [];
      
      for (const competitor of allCompetitors) {
        const analysisData = competitor.analysisData as any;
        if (analysisData?.competitiveScore) {
          totalScore += analysisData.competitiveScore;
          scoredCompetitors++;
          competitorScores.push({
            id: competitor.id,
            name: competitor.name,
            score: analysisData.competitiveScore,
            lastAnalysis: competitor.lastFullCrawl?.toISOString() || null
          });
        }
      }
      
      const averageHealthScore = scoredCompetitors > 0 ? Math.round(totalScore / scoredCompetitors) : null;
      
      // Count items needing attention
      const competitorsNeedingCrawl = allCompetitors.filter((c: Competitor) => {
        if (!c.lastFullCrawl) return true;
        const daysSinceCrawl = (Date.now() - new Date(c.lastFullCrawl).getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceCrawl > 7;
      });
      
      const productsNeedingAnalysis = allProducts.filter(p => !p.analysisData);

      res.json({
        summary: {
          totalProjects: projects.length,
          activeProjects: projects.filter(p => p.status === "active").length,
          totalCompetitors: allCompetitors.length,
          totalProducts: allProducts.length,
          pendingActions: pendingActions.length,
          averageHealthScore,
          competitorsNeedingCrawl: competitorsNeedingCrawl.length,
          productsNeedingAnalysis: productsNeedingAnalysis.length,
        },
        actionItems: pendingActions.slice(0, 20).map(r => ({
          id: r.id,
          title: r.title,
          description: r.description,
          area: r.area,
          impact: r.impact,
          status: r.status,
          assignedTo: r.assignedTo,
          projectId: r.projectId,
          competitorId: r.competitorId,
          productId: r.productId,
          createdAt: r.createdAt,
        })),
        recentActivity: recentActivity.slice(0, 10),
        competitorScores: competitorScores.sort((a, b) => b.score - a.score).slice(0, 10),
        projects: projects.map(p => ({
          id: p.id,
          name: p.name,
          clientName: p.clientName,
          status: p.status,
          analysisType: p.analysisType,
        })),
        tenantUsers: tenantUsers.map((u: User) => ({
          id: u.id,
          name: u.name,
          email: u.email,
        })),
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Command center error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Rebuild All - refresh all competitive intelligence (Admin only)
  app.post("/api/rebuild-all", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const user = await storage.getUser(ctx.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Only admins can trigger rebuild (expensive operation)
      if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      // Use market context filter to get only competitors in active market
      const contextFilter = toContextFilter(ctx);

      // Get all competitors and products that need processing (filtered by market context)
      const allCompetitors = await storage.getCompetitorsByContext(contextFilter);
      const allProducts = await storage.getProductsByContext(contextFilter);
      const projects = await storage.getClientProjectsByContext(contextFilter);

      // Return immediately with job info - actual processing happens async
      const jobId = `rebuild-${Date.now()}`;
      
      // Get total battlecards count for projects
      let projectBattlecardCount = 0;
      for (const project of projects) {
        const battlecards = await storage.getProductBattlecardsByProject(project.id);
        projectBattlecardCount += battlecards.length;
      }

      // Track progress
      let processed = 0;
      const total = allCompetitors.length + allProducts.length + projectBattlecardCount;

      // Start async processing
      (async () => {
        const anthropic = new Anthropic({
          apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
        });

        // Process competitors - crawl and analyze
        for (const competitor of allCompetitors) {
          try {
            // Always process if never crawled (no analysisData)
            const hasBeenAnalyzed = competitor.analysisData && Object.keys(competitor.analysisData).length > 0;
            
            // Skip if recently crawled (within 24 hours) AND already has analysis data
            if (hasBeenAnalyzed && competitor.lastFullCrawl) {
              const hoursSinceCrawl = (Date.now() - new Date(competitor.lastFullCrawl).getTime()) / (1000 * 60 * 60);
              if (hoursSinceCrawl < 24) {
                processed++;
                continue;
              }
            }

            // Perform multi-page crawl
            const crawlResult = await crawlCompetitorWebsite(competitor.url);
            
            // Prepare content for analysis
            const combinedContent = crawlResult.pages
              .map((p: any) => `## ${p.pageType}\n${p.content}`)
              .join("\n\n");

            // AI Analysis
            const analysisPrompt = `Analyze this company's website content and provide competitive intelligence:

Company: ${competitor.name}
Website: ${competitor.url}

Content:
${combinedContent.substring(0, 15000)}

Provide analysis in this JSON format:
{
  "competitiveScore": <number 1-100>,
  "strengths": ["strength1", "strength2", ...],
  "weaknesses": ["weakness1", "weakness2", ...],
  "valueProposition": "main value proposition",
  "targetAudience": "target audience description",
  "keyMessages": ["message1", "message2", ...],
  "marketPosition": "market position description"
}`;

            const analysisResponse = await anthropic.messages.create({
              model: "claude-sonnet-4-5",
              max_tokens: 2000,
              messages: [{ role: "user", content: analysisPrompt }],
            });

            const analysisText = analysisResponse.content[0].type === "text" 
              ? analysisResponse.content[0].text : "";
            
            let analysisData = {};
            try {
              const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                analysisData = JSON.parse(jsonMatch[0]);
              }
            } catch (e) {
              console.error("Failed to parse analysis:", e);
            }

            await storage.updateCompetitor(competitor.id, {
              crawlData: crawlResult,
              analysisData,
              lastFullCrawl: new Date(),
            });

          } catch (error) {
            console.error(`Error processing competitor ${competitor.name}:`, error);
          }
          processed++;
        }

        // Process products - analyze if needed
        for (const product of allProducts) {
          try {
            if (product.analysisData) {
              processed++;
              continue; // Already analyzed
            }

            if (!product.url) {
              processed++;
              continue; // No URL to crawl
            }

            // Crawl product page
            const crawlResult = await crawlCompetitorWebsite(product.url);
            
            const combinedContent = crawlResult.pages
              .map((p: any) => `## ${p.pageType}\n${p.content}`)
              .join("\n\n");

            // AI Analysis for product
            const analysisPrompt = `Analyze this product page and provide competitive intelligence:

Product: ${product.name}
Company: ${product.companyName || "Unknown"}
URL: ${product.url}

Content:
${combinedContent.substring(0, 15000)}

Provide analysis in this JSON format:
{
  "competitiveScore": <number 1-100>,
  "strengths": ["strength1", "strength2", ...],
  "weaknesses": ["weakness1", "weakness2", ...],
  "valueProposition": "main value proposition",
  "targetAudience": "target audience description",
  "keyMessages": ["message1", "message2", ...],
  "features": ["feature1", "feature2", ...],
  "pricing": "pricing info if found"
}`;

            const analysisResponse = await anthropic.messages.create({
              model: "claude-sonnet-4-5",
              max_tokens: 2000,
              messages: [{ role: "user", content: analysisPrompt }],
            });

            const analysisText = analysisResponse.content[0].type === "text" 
              ? analysisResponse.content[0].text : "";
            
            let analysisData = {};
            try {
              const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                analysisData = JSON.parse(jsonMatch[0]);
              }
            } catch (e) {
              console.error("Failed to parse product analysis:", e);
            }

            await storage.updateProduct(product.id, {
              crawlData: crawlResult,
              analysisData,
            });

          } catch (error) {
            console.error(`Error processing product ${product.name}:`, error);
          }
          processed++;
        }

        // Process projects - regenerate product battlecards
        for (const project of projects) {
          try {
            // Get existing product battlecards for this project
            const existingBattlecards = await storage.getProductBattlecardsByProject(project.id);
            
            for (const battlecard of existingBattlecards) {
              try {
                // Get the products
                const baselineProduct = await storage.getProduct(battlecard.baselineProductId);
                const competitorProduct = await storage.getProduct(battlecard.competitorProductId);
                
                if (!baselineProduct || !competitorProduct) continue;

                // Regenerate battlecard using updated product analysis data
                const battlecardPrompt = `Generate a competitive sales battlecard comparing these two products:

BASELINE PRODUCT (Our Product):
Name: ${baselineProduct.name}
Company: ${baselineProduct.companyName || "Unknown"}
Analysis: ${JSON.stringify(baselineProduct.analysisData || {}, null, 2)}

COMPETITOR PRODUCT:
Name: ${competitorProduct.name}
Company: ${competitorProduct.companyName || "Unknown"}  
Analysis: ${JSON.stringify(competitorProduct.analysisData || {}, null, 2)}

Generate a comprehensive battlecard in this JSON format:
{
  "strengths": ["competitor strength 1", "competitor strength 2"],
  "weaknesses": ["competitor weakness 1", "competitor weakness 2"],
  "ourAdvantages": ["our advantage 1", "our advantage 2"],
  "keyDifferentiators": [{"feature": "feature name", "ours": "our capability", "theirs": "their capability"}],
  "objections": [{"objection": "common objection", "response": "how to respond"}],
  "talkTracks": [{"scenario": "scenario name", "script": "what to say"}]
}`;

                const battlecardResponse = await anthropic.messages.create({
                  model: "claude-sonnet-4-5",
                  max_tokens: 3000,
                  messages: [{ role: "user", content: battlecardPrompt }],
                });

                const battlecardText = battlecardResponse.content[0].type === "text" 
                  ? battlecardResponse.content[0].text : "";
                
                let battlecardData: any = {};
                try {
                  const jsonMatch = battlecardText.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    battlecardData = JSON.parse(jsonMatch[0]);
                  }
                } catch (e) {
                  console.error("Failed to parse battlecard:", e);
                }

                await storage.updateProductBattlecard(battlecard.id, {
                  strengths: battlecardData.strengths || battlecard.strengths,
                  weaknesses: battlecardData.weaknesses || battlecard.weaknesses,
                  ourAdvantages: battlecardData.ourAdvantages || battlecard.ourAdvantages,
                  keyDifferentiators: battlecardData.keyDifferentiators || battlecard.keyDifferentiators,
                  objections: battlecardData.objections || battlecard.objections,
                  talkTracks: battlecardData.talkTracks || battlecard.talkTracks,
                  lastGeneratedAt: new Date(),
                });

              } catch (error) {
                console.error(`Error regenerating battlecard ${battlecard.id}:`, error);
              }
              processed++;
            }

          } catch (error) {
            console.error(`Error processing project ${project.name}:`, error);
          }
        }

        console.log(`Rebuild all completed: ${processed}/${total} items processed, ${projects.length} projects refreshed`);
      })();

      res.json({
        success: true,
        jobId,
        message: "Rebuild started",
        totalItems: total,
        competitors: allCompetitors.length,
        products: allProducts.length,
        projects: projects.length,
      });
    } catch (error: any) {
      console.error("Rebuild all error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update recommendation status (accept/dismiss/assign)
  app.patch("/api/recommendations/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { status, assignedTo } = req.body;
      const tenantDomain = user.email.split("@")[1];

      // Validate status value
      const allowedStatuses = ["pending", "accepted", "dismissed"];
      if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(", ")}` });
      }

      const recommendation = await storage.getRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      if (recommendation.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      // Validate assignedTo belongs to same tenant
      if (assignedTo) {
        const assignee = await storage.getUser(assignedTo);
        if (!assignee) {
          return res.status(400).json({ error: "Assigned user not found" });
        }
        const assigneeDomain = assignee.email.split("@")[1];
        if (assigneeDomain !== tenantDomain && user.role !== "Global Admin") {
          return res.status(400).json({ error: "Cannot assign to user outside your organization" });
        }
      }

      const updates: any = {};
      if (status) {
        updates.status = status;
        if (status === "accepted") updates.acceptedAt = new Date();
        if (status === "dismissed") updates.dismissedAt = new Date();
      }
      if (assignedTo !== undefined) {
        updates.assignedTo = assignedTo;
      }

      const updated = await storage.updateRecommendation(req.params.id, updates);
      res.json(updated);
    } catch (error: any) {
      console.error("Update recommendation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vote on a recommendation (thumbs up/down)
  app.post("/api/recommendations/:id/vote", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { vote } = req.body; // "up" or "down"
      if (!vote || !["up", "down"].includes(vote)) {
        return res.status(400).json({ error: "Vote must be 'up' or 'down'" });
      }

      const tenantDomain = user.email.split("@")[1];
      const recommendation = await storage.getRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      if (recommendation.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const updates = vote === "up"
        ? { thumbsUp: (recommendation.thumbsUp || 0) + 1 }
        : { thumbsDown: (recommendation.thumbsDown || 0) + 1 };

      const updated = await storage.updateRecommendation(req.params.id, updates);
      res.json(updated);
    } catch (error: any) {
      console.error("Vote on recommendation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Toggle priority on a recommendation
  app.post("/api/recommendations/:id/priority", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const recommendation = await storage.getRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      if (recommendation.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateRecommendation(req.params.id, {
        isPriority: !recommendation.isPriority,
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Toggle priority error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Soft hide (dismiss) a recommendation with reason
  app.post("/api/recommendations/:id/hide", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { reason } = req.body; // already_done, not_relevant, duplicate, other
      const allowedReasons = ["already_done", "not_relevant", "duplicate", "other"];
      if (reason && !allowedReasons.includes(reason)) {
        return res.status(400).json({ error: `Reason must be one of: ${allowedReasons.join(", ")}` });
      }

      const tenantDomain = user.email.split("@")[1];
      const recommendation = await storage.getRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      if (recommendation.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      // Generate dedupe key from title + area (normalized)
      const dedupeKey = `${recommendation.title.toLowerCase().replace(/[^a-z0-9]/g, "")}_${recommendation.area.toLowerCase()}`;

      const updated = await storage.updateRecommendation(req.params.id, {
        status: "dismissed",
        dismissedAt: new Date(),
        dismissedReason: reason || "not_relevant",
        dismissedBy: user.id,
        dedupeKey,
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Hide recommendation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Restore a hidden recommendation
  app.post("/api/recommendations/:id/restore", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      const recommendation = await storage.getRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      if (recommendation.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateRecommendation(req.params.id, {
        status: "pending",
        dismissedAt: null,
        dismissedReason: null,
        dismissedBy: null,
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Restore recommendation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== DATA SOURCES / NEWS ROUTES ====================

  app.get("/api/data-sources/news", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const allCompetitors = await storage.getCompetitorsByUserId(req.session.userId!);
      const competitors = allCompetitors.filter(c => validateResourceContext(c, ctx));
      
      const cachedResults: NewsMonitoringResult[] = [];
      for (const competitor of competitors.slice(0, 5)) {
        cachedResults.push({
          competitorId: competitor.id,
          competitorName: competitor.name,
          mentions: [],
          totalMentions: 0,
          status: "success",
          message: "Use refresh to fetch latest news",
          fetchedAt: new Date().toISOString(),
        });
      }
      
      res.json({ results: cachedResults });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("News fetch error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/data-sources/news/refresh", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (tenant?.plan === "free") {
        return res.status(403).json({ error: "News monitoring is a premium feature. Please upgrade your plan." });
      }
      
      const allCompetitors = await storage.getCompetitorsByUserId(req.session.userId!);
      const competitors = allCompetitors.filter(c => validateResourceContext(c, ctx));
      
      const competitorData = competitors.slice(0, 5).map((c: Competitor) => ({
        id: c.id,
        name: c.name,
        websiteUrl: c.url || undefined,
      }));
      
      const results = await monitorMultipleCompetitorsNews(competitorData);
      
      res.json({ results, fetchedAt: new Date().toISOString() });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("News refresh error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/data-sources/news/:competitorId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }
      
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const result = await monitorCompetitorNews(
        competitor.id,
        competitor.name,
        competitor.url || undefined
      );
      
      res.json(result);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Competitor news fetch error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ANALYTICS ROUTES ====================

  // Simple in-memory cache for IP to country lookups
  const ipCountryCache = new Map<string, { country: string; expires: number }>();
  const IP_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  async function getCountryFromIP(ip: string): Promise<string | null> {
    try {
      // Check cache first
      const cached = ipCountryCache.get(ip);
      if (cached && cached.expires > Date.now()) {
        return cached.country;
      }

      // Skip private/local IPs (RFC 1918 and RFC 4193)
      if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || 
          ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') ||
          ip.startsWith('172.19.') || ip.startsWith('172.20.') || ip.startsWith('172.21.') ||
          ip.startsWith('172.22.') || ip.startsWith('172.23.') || ip.startsWith('172.24.') ||
          ip.startsWith('172.25.') || ip.startsWith('172.26.') || ip.startsWith('172.27.') ||
          ip.startsWith('172.28.') || ip.startsWith('172.29.') || ip.startsWith('172.30.') ||
          ip.startsWith('172.31.') || ip === '::1' || ip === 'localhost' ||
          ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
        return null;
      }

      // Validate IP format (basic check)
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      const ipv6Regex = /^[0-9a-fA-F:]+$/;
      if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
        return null;
      }

      // Use ipapi.co (HTTPS, free tier: 1000 req/day)
      const response = await fetch(`https://ipapi.co/${ip}/json/`, {
        headers: { 'User-Agent': 'Orbit/1.0' },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      if (!response.ok) return null;
      
      const data = await response.json();
      if (data.country_code && !data.error) {
        // Cache the result
        ipCountryCache.set(ip, { country: data.country_code, expires: Date.now() + IP_CACHE_TTL });
        return data.country_code;
      }
      return null;
    } catch (error) {
      // Silently fail - geolocation is best-effort
      return null;
    }
  }

  app.post("/api/analytics/page-view", async (req, res) => {
    try {
      const { path, sessionId, referrer, utmSource, utmMedium, utmCampaign } = req.body;
      
      if (!path || !sessionId) {
        return res.status(400).json({ error: "path and sessionId are required" });
      }

      const xForwardedFor = req.headers['x-forwarded-for'];
      const ip = Array.isArray(xForwardedFor) ? xForwardedFor[0] : (xForwardedFor?.split(',')[0]?.trim() || req.socket.remoteAddress || '');
      const ipHash = createHash('sha256').update(String(ip)).digest('hex').substring(0, 16);
      const userAgent = req.headers['user-agent'] || '';

      // Get country from IP (async, cached)
      const country = await getCountryFromIP(ip);

      await storage.createPageView({
        path,
        sessionId,
        ipHash,
        userAgent,
        referrer: referrer || null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        country: country || null,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Page view tracking error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/analytics/usage", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || !hasAdminAccess(user.role)) {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const days = parseInt(req.query.days as string) || 7;
      const stats = await storage.getPageViewStats(days);
      
      const conversionRate = stats.totalViews > 0 
        ? (stats.signupPageViews / stats.totalViews) * 100 
        : 0;

      res.json({
        ...stats,
        conversionRate,
      });
    } catch (error: any) {
      console.error("Usage stats error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Marketing Plans API - Enterprise feature
  app.get("/api/marketing-plans", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      // Check if tenant is enterprise
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const plans = await storage.getMarketingPlans(toContextFilter(ctx));
      res.json(plans);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/marketing-plans/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const plan = await storage.getMarketingPlan(req.params.id, toContextFilter(ctx));
      if (!plan) {
        return res.status(404).json({ error: "Marketing plan not found" });
      }
      
      // Get tasks for this plan
      const tasks = await storage.getMarketingTasks(plan.id, toContextFilter(ctx));
      
      res.json({ ...plan, tasks });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/marketing-plans", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const { name, fiscalYear, description, configMatrix } = req.body;
      
      if (!name || !fiscalYear) {
        return res.status(400).json({ error: "Name and fiscal year are required" });
      }
      
      const plan = await storage.createMarketingPlan({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        name,
        fiscalYear,
        description: description || null,
        configMatrix: configMatrix || null,
        status: "draft",
        createdBy: ctx.userId,
      });
      
      res.json(plan);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/marketing-plans/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const { name, description, configMatrix, status } = req.body;
      
      const updated = await storage.updateMarketingPlan(
        req.params.id,
        { name, description, configMatrix, status },
        toContextFilter(ctx)
      );
      
      if (!updated) {
        return res.status(404).json({ error: "Marketing plan not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/marketing-plans/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const deleted = await storage.deleteMarketingPlan(req.params.id, toContextFilter(ctx));
      if (!deleted) {
        return res.status(404).json({ error: "Marketing plan not found" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Marketing Tasks API
  app.get("/api/marketing-plans/:planId/tasks", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const plan = await storage.getMarketingPlan(req.params.planId, toContextFilter(ctx));
      if (!plan) {
        return res.status(404).json({ error: "Marketing plan not found" });
      }
      
      const tasks = await storage.getMarketingTasks(plan.id, toContextFilter(ctx));
      res.json(tasks);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/marketing-plans/:planId/tasks", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const plan = await storage.getMarketingPlan(req.params.planId, toContextFilter(ctx));
      if (!plan) {
        return res.status(404).json({ error: "Marketing plan not found" });
      }
      
      const { title, description, activityGroup, timeframe, priority, aiGenerated, sourceRecommendationId } = req.body;
      
      if (!title || !activityGroup || !timeframe) {
        return res.status(400).json({ error: "Title, activity group, and timeframe are required" });
      }
      
      const task = await storage.createMarketingTask({
        planId: plan.id,
        title,
        description: description || null,
        activityGroup,
        timeframe,
        priority: priority || "Medium",
        status: "suggested",
        aiGenerated: aiGenerated ?? false,
        sourceRecommendationId: sourceRecommendationId || null,
      }, toContextFilter(ctx));
      
      if (!task) {
        return res.status(404).json({ error: "Marketing plan not found or access denied" });
      }
      
      res.json(task);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/marketing-plans/:planId/tasks/:taskId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const plan = await storage.getMarketingPlan(req.params.planId, toContextFilter(ctx));
      if (!plan) {
        return res.status(404).json({ error: "Marketing plan not found" });
      }
      
      const { title, description, activityGroup, timeframe, priority, status, assignedTo, dueDate } = req.body;
      
      const updated = await storage.updateMarketingTask(
        req.params.taskId,
        plan.id,
        { title, description, activityGroup, timeframe, priority, status, assignedTo, dueDate },
        toContextFilter(ctx)
      );
      
      if (!updated) {
        return res.status(404).json({ error: "Task not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/marketing-plans/:planId/tasks/:taskId", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const plan = await storage.getMarketingPlan(req.params.planId, toContextFilter(ctx));
      if (!plan) {
        return res.status(404).json({ error: "Marketing plan not found" });
      }
      
      const deleted = await storage.deleteMarketingTask(req.params.taskId, plan.id, toContextFilter(ctx));
      if (!deleted) {
        return res.status(404).json({ error: "Task not found" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Generate AI-suggested marketing tasks
  app.post("/api/marketing-plans/:planId/generate-tasks", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      if (!tenant || tenant.plan !== "enterprise") {
        return res.status(403).json({ error: "Marketing Planner is an Enterprise feature" });
      }
      
      const plan = await storage.getMarketingPlan(req.params.planId, toContextFilter(ctx));
      if (!plan) {
        return res.status(404).json({ error: "Marketing plan not found" });
      }

      const { categories = [], periods = [] } = req.body;
      
      if (!categories.length || !periods.length) {
        return res.status(400).json({ error: "Please select at least one category and one time period" });
      }

      // Get existing tasks to avoid duplicates
      const existingTasks = await storage.getMarketingTasks(plan.id, toContextFilter(ctx));
      
      // Get competitive intelligence context
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      const recommendations = await storage.getRecommendationsByContext(toContextFilter(ctx));
      
      // Get GTM plan (long-form recommendation) if available
      let gtmPlan: any = null;
      if (companyProfile) {
        gtmPlan = await storage.getLongFormRecommendationByType("gtm_plan", undefined, companyProfile.id);
      }
      
      // Category labels for the prompt
      const categoryLabels: Record<string, string> = {
        events: "Events & Trade Shows",
        digital_marketing: "Digital Marketing",
        outbound_campaigns: "Outbound Campaigns",
        content_marketing: "Content Marketing",
        social_media: "Social Media",
        email_marketing: "Email Marketing",
        seo_sem: "SEO/SEM",
        pr_comms: "PR & Communications",
        analyst_relations: "Analyst Relations",
        partner_marketing: "Partner Marketing",
        customer_marketing: "Customer Marketing",
        product_marketing: "Product Marketing",
        brand: "Brand",
        website: "Website",
        webinars: "Webinars",
        podcasts: "Podcasts",
        video: "Video",
        research: "Research & Insights",
        other: "Other",
      };

      const periodLabels: Record<string, string> = {
        steady_state: "Steady State (Ongoing)",
        Q1: "Q1",
        Q2: "Q2",
        Q3: "Q3",
        Q4: "Q4",
        future: "Future",
        q1: "Q1",
        q2: "Q2",
        q3: "Q3",
        q4: "Q4",
        h1: "H1 (First Half)",
        h2: "H2 (Second Half)",
        annual: "Full Year",
      };

      const selectedCategoryNames = categories.map((c: string) => categoryLabels[c] || c);
      const selectedPeriodNames = periods.map((p: string) => periodLabels[p] || p);

      // Build context for AI
      const companyName = companyProfile?.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') || "Unknown";
      let contextInfo = `Company: ${companyName}\n`;
      if (companyProfile?.description) {
        contextInfo += `Description: ${companyProfile.description}\n`;
      }
      if (competitors.length > 0) {
        contextInfo += `Key Competitors: ${competitors.slice(0, 5).map((c: any) => c.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') || c.id).join(", ")}\n`;
      }
      
      // Add GTM Plan context (most important input)
      let gtmPlanContext = "";
      if (gtmPlan?.content && gtmPlan.status === "generated") {
        // Truncate to ~3000 chars to leave room for other context
        const truncatedGtm = gtmPlan.content.length > 3000 
          ? gtmPlan.content.substring(0, 3000) + "..." 
          : gtmPlan.content;
        gtmPlanContext = `\n## Draft GTM Plan (Key Strategic Input)\n${truncatedGtm}\n`;
      }
      
      // Add AI Recommendations context
      let recommendationsContext = "";
      const activeRecs = recommendations.filter((r: any) => r.status !== "dismissed").slice(0, 10);
      if (activeRecs.length > 0) {
        recommendationsContext = `\n## Strategic Recommendations\n`;
        activeRecs.forEach((r: any) => {
          recommendationsContext += `- [${r.area}] ${r.title}: ${r.description?.substring(0, 150) || ""}...\n`;
        });
      }
      
      // Add competitor insights if available
      let competitorInsights = "";
      const competitorsWithData = competitors.filter((c: any) => c.strengthsWeaknesses || c.lastAnalysisDate).slice(0, 3);
      if (competitorsWithData.length > 0) {
        competitorInsights = `\n## Competitor Insights\n`;
        competitorsWithData.forEach((c: any) => {
          const name = c.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') || "Competitor";
          if (c.strengthsWeaknesses) {
            const sw = typeof c.strengthsWeaknesses === 'string' ? c.strengthsWeaknesses : JSON.stringify(c.strengthsWeaknesses);
            competitorInsights += `${name}: ${sw.substring(0, 200)}...\n`;
          }
        });
      }

      // Build existing tasks context to avoid duplicates
      let existingTasksContext = "";
      if (existingTasks.length > 0) {
        existingTasksContext = `\n## EXISTING TASKS (DO NOT DUPLICATE)\nThe following tasks already exist in this plan. DO NOT generate similar or duplicate tasks:\n`;
        existingTasks.forEach((t: any) => {
          existingTasksContext += `- [${categoryLabels[t.activityGroup] || t.activityGroup}] "${t.title}"\n`;
        });
        existingTasksContext += `\nGenerate only NEW, unique tasks that are different from the above.\n`;
      }

      const prompt = `Generate marketing tasks for a ${plan.fiscalYear} marketing plan.

## Company Context
${contextInfo}
${gtmPlanContext}
${recommendationsContext}
${competitorInsights}
${existingTasksContext}

## Task Generation Request
Selected Activity Categories: ${selectedCategoryNames.join(", ")}
Time Periods: ${selectedPeriodNames.join(", ")}

Generate 2-3 specific, actionable marketing tasks for EACH selected category. Each task should:
1. Be specific and measurable
2. DIRECTLY ALIGN with the Draft GTM Plan strategies and recommendations above
3. Address competitive gaps or opportunities identified in the strategic recommendations
4. Include a suggested priority (High, Medium, or Low)
5. Be assigned to one of the selected time periods (use "steady_state" for ongoing activities)
6. BE UNIQUE - DO NOT duplicate any existing tasks listed above

Respond in JSON format:
{
  "tasks": [
    {
      "title": "Task title",
      "description": "Brief description of the task and how it supports the GTM strategy",
      "activityGroup": "category_value",
      "priority": "High|Medium|Low",
      "timeframe": "period_value"
    }
  ]
}

Only use these activityGroup values: ${categories.join(", ")}
Only use these timeframe values: ${periods.join(", ")}`;

      // Call AI to generate tasks
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8000,
        messages: [
          { 
            role: "user", 
            content: prompt 
          }
        ],
        system: "You are a marketing strategy expert. Generate practical, actionable marketing tasks based on the company's competitive landscape. Always respond with valid JSON only, no additional text.",
      });

      const aiResponse = message.content[0].type === "text" ? message.content[0].text : "";

      // Parse AI response with more robust handling
      let generatedTasks: any[] = [];
      console.log("AI Response length:", aiResponse.length);
      console.log("AI Response (first 500 chars):", aiResponse.substring(0, 500));
      
      // Strip markdown code fences if present
      let cleanedResponse = aiResponse.trim();
      if (cleanedResponse.startsWith("```json")) {
        cleanedResponse = cleanedResponse.slice(7);
      } else if (cleanedResponse.startsWith("```")) {
        cleanedResponse = cleanedResponse.slice(3);
      }
      if (cleanedResponse.endsWith("```")) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      cleanedResponse = cleanedResponse.trim();
      
      try {
        // First, try to parse the entire response as JSON
        if (cleanedResponse.startsWith("{")) {
          const parsed = JSON.parse(cleanedResponse);
          generatedTasks = parsed.tasks || [];
        } else if (cleanedResponse.startsWith("[")) {
          generatedTasks = JSON.parse(cleanedResponse);
        }
      } catch (firstParseError) {
        console.log("Direct parse failed, trying regex extraction...");
        try {
          // Try to find JSON object with tasks array (greedy match for the array)
          const jsonMatch = aiResponse.match(/\{[\s\S]*"tasks"\s*:\s*\[([\s\S]*)\]\s*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            generatedTasks = parsed.tasks || [];
          }
        } catch (parseError) {
          console.error("Failed to parse AI response:", parseError);
          console.error("AI Response (first 1000 chars):", aiResponse.substring(0, 1000));
          // Try a more lenient extraction - look for individual task objects
          try {
            const taskPattern = /\{\s*"title"\s*:\s*"[^"]+"\s*,\s*"description"\s*:\s*"[^"]*"\s*,\s*"activityGroup"\s*:\s*"[^"]+"\s*,\s*"priority"\s*:\s*"[^"]+"\s*,\s*"timeframe"\s*:\s*"[^"]+"\s*\}/g;
            const taskMatches = Array.from(aiResponse.matchAll(taskPattern));
            for (const match of taskMatches) {
              try {
                const task = JSON.parse(match[0]);
                if (task.title) {
                  generatedTasks.push(task);
                }
              } catch {}
            }
          } catch {}
        }
      }
      
      if (generatedTasks.length === 0) {
        console.error("No tasks extracted from AI response");
        return res.status(500).json({ error: "Failed to parse AI suggestions. Please try again." });
      }

      // Create the tasks in the database
      let tasksCreated = 0;
      for (const task of generatedTasks) {
        if (task.title && categories.includes(task.activityGroup) && periods.includes(task.timeframe)) {
          await storage.createMarketingTask({
            planId: plan.id,
            title: task.title,
            description: task.description || null,
            activityGroup: task.activityGroup,
            priority: task.priority || "Medium",
            status: "suggested",
            timeframe: task.timeframe,
            aiGenerated: true,
          }, toContextFilter(ctx));
          tasksCreated++;
        }
      }

      // Log AI usage
      await logAiUsage(ctx, "generate_marketing_tasks", "anthropic", "claude-sonnet-4-5", message.usage);

      res.json({ success: true, tasksCreated });
    } catch (error: any) {
      console.error("Generate tasks error:", error);
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
