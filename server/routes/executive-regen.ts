import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, logAiUsage, computeLatestSourceDataTimestamp, guardFeature } from "./helpers";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { calculateScores, calculateBaselineScore, getCurrentWeeklyPeriod, type ScoreBreakdown } from "../services/scoring-service";
import { startFullRegeneration, getRegenerationStatus } from "../services/full-regeneration-service";

export function registerExecutiveRegenRoutes(app: Express) {
  // ===============================
  // BASELINE-LEVEL RECOMMENDATIONS
  // ===============================

  // Get baseline GTM plan
  app.get("/api/baseline/recommendations/gtm_plan", async (req, res) => {
    if (!await guardFeature(req, res, "gtmPlan")) return;
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
    if (!await guardFeature(req, res, "messagingFramework")) return;
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
    if (!await guardFeature(req, res, "gtmPlan")) return;
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
      const sourceDataAsOf = await computeLatestSourceDataTimestamp(ctx);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedFromDataAsOf: sourceDataAsOf,
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
          generatedFromDataAsOf: sourceDataAsOf,
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
    if (!await guardFeature(req, res, "messagingFramework")) return;
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
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      // Log AI usage
      await logAiUsage(ctx, "generate_baseline_messaging_framework", "anthropic", "claude-sonnet-4-5", message.usage);

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("messaging_framework", undefined, companyProfile.id);
      const sourceDataAsOf = await computeLatestSourceDataTimestamp(ctx);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedFromDataAsOf: sourceDataAsOf,
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
          generatedFromDataAsOf: sourceDataAsOf,
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

  // ==================== BASELINE EXECUTIVE SUMMARY ====================

  // Get baseline executive summary
  app.get("/api/baseline/executive-summary", async (req, res) => {
    if (!await guardFeature(req, res, "recommendations")) return;
    try {
      const ctx = await getRequestContext(req);
      const { getExecutiveSummary } = await import("../services/executive-summary-service");
      
      const summary = await getExecutiveSummary(ctx.tenantDomain, ctx.marketId);
      
      if (!summary) {
        return res.json({ 
          exists: false,
          data: null,
          lockedSections: [],
          lastGeneratedAt: null
        });
      }

      res.json({
        exists: true,
        data: summary.data,
        lockedSections: summary.lockedSections,
        lastGeneratedAt: summary.lastGeneratedAt
      });
    } catch (error: any) {
      console.error("Get executive summary error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate/regenerate executive summary (respects locked sections)
  app.post("/api/baseline/executive-summary/generate", async (req, res) => {
    if (!await guardFeature(req, res, "recommendations")) return;
    try {
      const ctx = await getRequestContext(req);
      const { generateExecutiveSummary } = await import("../services/executive-summary-service");
      
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      const existingSummary = await storage.getExecutiveSummaryByContext(toContextFilter(ctx));
      const lockedSections = (existingSummary?.lockedSections as string[]) || [];

      const data = await generateExecutiveSummary(
        ctx.tenantDomain, 
        ctx.marketId, 
        companyProfile?.id,
        lockedSections
      );

      res.json({ 
        success: true, 
        data,
        lockedSections
      });
    } catch (error: any) {
      console.error("Generate executive summary error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update a specific section of the executive summary
  app.patch("/api/baseline/executive-summary", async (req, res) => {
    if (!await guardFeature(req, res, "recommendations")) return;
    try {
      const ctx = await getRequestContext(req);
      const { section, content, lock } = req.body;
      
      if (!section || !["companySnapshot", "marketPosition", "competitiveLandscape", "opportunities"].includes(section)) {
        return res.status(400).json({ error: "Invalid section" });
      }

      if (typeof content !== "string") {
        return res.status(400).json({ error: "Content must be a string" });
      }

      const { updateExecutiveSummarySection } = await import("../services/executive-summary-service");
      
      await updateExecutiveSummarySection(
        ctx.tenantDomain,
        ctx.marketId,
        section,
        content,
        lock === true
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error("Update executive summary error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== FULL REGENERATION ENDPOINTS ====================

  // Start full regeneration of all analysis (runs in background, emails when complete)
  app.post("/api/baseline/full-regenerate", async (req, res) => {
    if (!await guardFeature(req, res, "recommendations")) return;
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
    if (!await guardFeature(req, res, "recommendations")) return;
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
    if (!await guardFeature(req, res, "recommendations")) return;
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
    if (!await guardFeature(req, res, "recommendations")) return;
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

  app.patch("/api/baseline/recommendations/:id/content", async (req, res) => {
    if (!await guardFeature(req, res, "recommendations")) return;
    try {
      const ctx = await getRequestContext(req);
      const { content } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Content is required" });
      }

      const recommendation = await storage.getLongFormRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      if (recommendation.tenantDomain !== ctx.tenantDomain) {
        const user = await storage.getUser(ctx.userId);
        if (user?.role !== "Global Admin") {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const previousVersions = ((recommendation.savedPrompts as any)?.versionHistory || []) as any[];
      if (recommendation.content && recommendation.content !== content) {
        previousVersions.push({
          content: recommendation.content,
          savedAt: recommendation.updatedAt || recommendation.lastGeneratedAt || new Date(),
          savedBy: recommendation.generatedBy || ctx.userId,
        });
        if (previousVersions.length > 10) {
          previousVersions.splice(0, previousVersions.length - 10);
        }
      }

      const updated = await storage.updateLongFormRecommendation(req.params.id, {
        content,
        updatedAt: new Date(),
        savedPrompts: {
          ...((recommendation.savedPrompts as any) || {}),
          versionHistory: previousVersions,
          lastManualEdit: new Date().toISOString(),
          lastEditedBy: ctx.userId,
        },
      });
      res.json(updated);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/baseline/recommendations/:id/versions", async (req, res) => {
    if (!await guardFeature(req, res, "recommendations")) return;
    try {
      const ctx = await getRequestContext(req);

      const recommendation = await storage.getLongFormRecommendation(req.params.id);
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }

      if (recommendation.tenantDomain !== ctx.tenantDomain) {
        const user = await storage.getUser(ctx.userId);
        if (user?.role !== "Global Admin") {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const versions = ((recommendation.savedPrompts as any)?.versionHistory || []) as any[];
      res.json(versions);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
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


}
