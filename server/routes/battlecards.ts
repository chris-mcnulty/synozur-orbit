import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, logAiUsage, computeLatestSourceDataTimestamp, guardFeature } from "./helpers";
import Anthropic from "@anthropic-ai/sdk";

export function registerBattlecardRoutes(app: Express) {
  // ==================== BATTLECARD ROUTES ====================

  app.get("/api/competitors/:competitorId/battlecard", async (req, res) => {
    if (!await guardFeature(req, res, "battlecards")) return;
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

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
    if (!await guardFeature(req, res, "battlecards")) return;
    try {
      const ctx = await getRequestContext(req);

      const competitor = await storage.getCompetitor(req.params.competitorId);
      if (!competitor) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

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
    if (!await guardFeature(req, res, "battlecards")) return;
    try {
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battlecard not found" });
      }

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
    if (!await guardFeature(req, res, "battlecards")) return;
    try {
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battlecard not found" });
      }

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


  // ==================== BATTLECARD ROUTES ====================

  app.get("/api/battlecards", async (req, res) => {
    if (!await guardFeature(req, res, "battlecards")) return;
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
    if (!await guardFeature(req, res, "battlecards")) return;
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
    if (!await guardFeature(req, res, "battlecards")) return;
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
      
      const sourceDataAsOf = await computeLatestSourceDataTimestamp(ctx);
      let battlecard;
      if (existing) {
        battlecard = await storage.updateBattlecard(existing.id, {
          ...battlecardContent,
          lastGeneratedAt: new Date(),
          generatedFromDataAsOf: sourceDataAsOf,
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
          generatedFromDataAsOf: sourceDataAsOf,
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
    if (!await guardFeature(req, res, "battlecards")) return;
    try {
      const ctx = await getRequestContext(req);

      const battlecard = await storage.getBattlecard(req.params.id);
      if (!battlecard) {
        return res.status(404).json({ error: "Battle card not found" });
      }

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
    if (!await guardFeature(req, res, "battlecards")) return;
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
      
      const { generateBattlecardPdf } = await import("../services/battlecard-export");
      const { enqueuePdf } = await import("../services/job-queue");
      const pdfBuffer = await enqueuePdf(`battlecard-pdf:${req.params.id}`, () => generateBattlecardPdf(
        battlecard,
        competitor?.name || "Competitor",
        companyProfile?.companyName || "Your Company",
        tenant,
        battlecard.lastGeneratedAt || battlecard.createdAt,
        competitor?.faviconUrl || null,
        competitor ? {
          headquarters: competitor.headquarters,
          founded: competitor.founded,
          revenue: competitor.revenue,
          fundingRaised: competitor.fundingRaised,
        } : null
      ));
      
      const filename = `Battlecard_${competitor?.name || "Competitor"}_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
      res.send(pdfBuffer);

      // Store to SPE (fire-and-forget)
      if (tenant?.speStorageEnabled) {
        import("../services/sharepoint-file-storage.js").then(({ sharepointFileStorage }) =>
          sharepointFileStorage.storeFile(pdfBuffer, filename, "application/pdf", {
            documentType: "report",
            scope: "competitor",
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || undefined,
            competitorId: battlecard.competitorId,
            createdByUserId: ctx.userId,
            fileType: "pdf",
            originalFileName: filename,
            reportType: "battlecard",
          }, ctx.userId, battlecard.id, tenant.id)
        ).catch((err) => console.error("[SPE] Failed to store battlecard PDF:", err));
      }
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
      
      const { generateBattlecardText } = await import("../services/battlecard-export");
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
      
      const { generateProductBattlecardPdf } = await import("../services/battlecard-export");
      const { enqueuePdf } = await import("../services/job-queue");
      const pdfBuffer = await enqueuePdf(`product-battlecard-pdf:${req.params.id}`, () => generateProductBattlecardPdf(
        battlecard,
        competitorProduct?.name || "Competitor Product",
        baselineProduct?.name || "Your Product",
        tenant
      ));
      
      const filename = `Battlecard_${competitorProduct?.name || "Product"}_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
      res.send(pdfBuffer);

      // Store to SPE (fire-and-forget)
      if (tenant?.speStorageEnabled) {
        import("../services/sharepoint-file-storage.js").then(({ sharepointFileStorage }) =>
          sharepointFileStorage.storeFile(pdfBuffer, filename, "application/pdf", {
            documentType: "report",
            scope: "competitor",
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || undefined,
            createdByUserId: ctx.userId,
            fileType: "pdf",
            originalFileName: filename,
            reportType: "product_battlecard",
          }, ctx.userId, battlecard.id, tenant.id)
        ).catch((err) => console.error("[SPE] Failed to store product battlecard PDF:", err));
      }
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
      
      const { generateProductBattlecardText } = await import("../services/battlecard-export");
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


}
