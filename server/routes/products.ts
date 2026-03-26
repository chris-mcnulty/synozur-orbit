import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, logAiUsage } from "./helpers";
import Anthropic from "@anthropic-ai/sdk";
import { crawlCompetitorWebsite } from "../services/web-crawler";
import { z } from "zod";
import { contentAssets, projectProducts as projectProductsTable } from "@shared/schema";
import { generateRoadmapRecommendations } from "../ai-service";

export function registerProductRoutes(app: Express) {
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

  app.post("/api/products/from-content-asset", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const bodySchema = z.object({
        contentAssetId: z.string().min(1, "Content asset ID is required"),
        projectId: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request body" });
      }
      const { contentAssetId, projectId } = parsed.data;

      const assetConditions = [
        eq(contentAssets.id, contentAssetId),
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
      ];
      if (ctx.marketId) {
        assetConditions.push(eq(contentAssets.marketId, ctx.marketId));
      }
      const [asset] = await db.select().from(contentAssets)
        .where(and(...assetConditions));

      if (!asset) {
        return res.status(404).json({ error: "Content asset not found" });
      }

      const profile = await storage.getCompanyProfileByContext(toContextFilter(ctx));

      const product = await storage.createProduct({
        name: asset.title,
        description: asset.description || (asset.aiSummary ? asset.aiSummary.substring(0, 500) : null),
        url: asset.url || null,
        companyName: profile?.companyName || null,
        isBaseline: true,
        companyProfileId: profile?.id || null,
        sourceContentAssetId: contentAssetId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        createdBy: ctx.userId,
      });

      if (projectId) {
        const project = await storage.getClientProject(projectId);
        if (project && validateResourceContext(project, ctx)) {
          await storage.addProductToProject({
            projectId,
            productId: product.id,
            role: "baseline",
          });
        }
      }

      res.status(201).json(product);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Create product from content asset error:", error);
      res.status(500).json({ error: error.message || "Failed to create product from content asset" });
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

  // Generate competitive position summary for a product
  app.post("/api/products/:id/generate-summary", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      if (!validateResourceContext(product, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      const allProducts = await storage.getProductsByContext(toContextFilter(ctx));
      const competitorProducts = allProducts.filter(p => p.id !== product.id && !p.isBaseline);

      let competitorContext = "";
      for (const cp of competitorProducts.slice(0, 5)) {
        const analysis = cp.analysisData as any;
        competitorContext += `\n- ${cp.name} (${cp.companyName || "Unknown"}): ${cp.description || analysis?.summary || "No details"}`;
      }
      for (const c of competitors.slice(0, 5)) {
        const analysis = c.analysisData as any;
        competitorContext += `\n- ${c.name}: ${analysis?.summary || "No details"}`;
      }

      const productAnalysis = product.analysisData as any;
      const features = await storage.getProductFeaturesByProduct(product.id);
      const featureList = features.slice(0, 10).map(f => f.name).join(", ");

      const prompt = `Write a concise 2-3 sentence competitive position summary for this product.

Product: ${product.name}
Company: ${product.companyName || companyProfile?.companyName || "Unknown"}
Description: ${product.description || "N/A"}
${productAnalysis?.summary ? `Analysis: ${productAnalysis.summary}` : ""}
${featureList ? `Key Features: ${featureList}` : ""}
${product.isBaseline ? "This is the user's own product." : `This is a competitor product from ${product.companyName || "an unknown company"}.`}

Competitive Landscape:${competitorContext || " No competitor data available."}

Write 2-3 sentences that capture:
1. What this product does and who it serves
2. Its key differentiators or competitive position
3. How it compares to alternatives in the market

Be specific and analytical. Do not use generic marketing language. Return ONLY the summary text, no quotes or labels.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        return res.status(500).json({ error: "Failed to generate summary" });
      }

      const summary = content.text.trim();
      await storage.updateProduct(product.id, {
        competitivePositionSummary: summary,
        summaryGeneratedAt: new Date(),
      });

      res.json({ summary, generatedAt: new Date().toISOString() });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Product summary generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update product competitive position summary (manual edit)
  app.patch("/api/products/:id/summary", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      if (!validateResourceContext(product, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { summary } = req.body;
      if (typeof summary !== "string") {
        return res.status(400).json({ error: "Summary must be a string" });
      }

      await storage.updateProduct(product.id, {
        competitivePositionSummary: summary,
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Generate competitive position summaries for all products in context
  app.post("/api/products/generate-all-summaries", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const products = await storage.getProductsByContext(toContextFilter(ctx));

      if (products.length === 0) {
        return res.json({ generated: 0, message: "No products found" });
      }

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));

      let competitorContext = "";
      for (const c of competitors.slice(0, 5)) {
        const analysis = c.analysisData as any;
        competitorContext += `\n- ${c.name}: ${analysis?.summary || "No details"}`;
      }

      let generated = 0;
      for (const product of products) {
        try {
          const productAnalysis = product.analysisData as any;
          const features = await storage.getProductFeaturesByProduct(product.id);
          const featureList = features.slice(0, 10).map(f => f.name).join(", ");

          const prompt = `Write a concise 2-3 sentence competitive position summary for this product.

Product: ${product.name}
Company: ${product.companyName || companyProfile?.companyName || "Unknown"}
Description: ${product.description || "N/A"}
${productAnalysis?.summary ? `Analysis: ${productAnalysis.summary}` : ""}
${featureList ? `Key Features: ${featureList}` : ""}
${product.isBaseline ? "This is the user's own product." : `This is a competitor product from ${product.companyName || "an unknown company"}.`}

Competitive Landscape:${competitorContext || " No competitor data available."}

Write 2-3 sentences that capture what this product does, its key differentiators, and how it compares to alternatives. Be specific and analytical. Return ONLY the summary text.`;

          const message = await anthropic.messages.create({
            model: "claude-sonnet-4-5",
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }],
          });

          const content = message.content[0];
          if (content.type === "text") {
            await storage.updateProduct(product.id, {
              competitivePositionSummary: content.text.trim(),
              summaryGeneratedAt: new Date(),
            });
            generated++;
          }
        } catch (e) {
          console.error(`Failed to generate summary for product ${product.name}:`, e);
        }
      }

      res.json({ generated, total: products.length });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Batch product summary generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Scan/Analyze a product (crawl website and generate analysis)
  app.post("/api/products/:id/scan", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (!validateResourceContext(product, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!product.url) {
        return res.status(400).json({ error: "Product has no URL to scan" });
      }

      // Crawl the product page
      let crawlResult;
      try {
        crawlResult = await crawlCompetitorWebsite(product.url);
      } catch (crawlError) {
        console.error("Product crawl failed:", crawlError);
        return res.status(502).json({ error: "Failed to crawl product website" });
      }
      
      const pages = crawlResult?.pages || [];
      if (pages.length === 0) {
        return res.status(502).json({ error: "No content found on product website" });
      }
      
      const combinedContent = pages
        .map((p: any) => `## ${p.pageType}\n${p.content}`)
        .join("\n\n");

      // AI Analysis for product
      let analysisData: any = {};
      try {
        const anthropic = new Anthropic({
          apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
        });
        
        const analysisPrompt = `Analyze this product page and provide competitive intelligence:

Product: ${product.name}
Company: ${product.companyName || "Unknown"}
URL: ${product.url}

Content:
${combinedContent.substring(0, 15000)}

Provide analysis in this JSON format:
{
  "competitiveScore": <number 1-100>,
  "marketPosition": "<leader|challenger|follower|niche>",
  "innovationLevel": "<high|medium|low>",
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
        
        try {
          const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            analysisData = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          console.error("Failed to parse product analysis JSON:", e);
        }
      } catch (aiError) {
        console.error("AI analysis failed:", aiError);
        // Continue with just crawl data, no analysis
      }

      const updated = await storage.updateProduct(product.id, {
        crawlData: crawlResult,
        analysisData: Object.keys(analysisData).length > 0 ? analysisData : undefined,
        updatedAt: new Date(),
      });

      res.json({ 
        success: true, 
        product: updated,
        analysis: analysisData,
        pagesScanned: pages.length,
        hasAnalysis: Object.keys(analysisData).length > 0
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Product scan error:", error);
      res.status(500).json({ error: error.message || "Failed to scan product" });
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
      const { validateUrlSoft } = await import("../utils/url-validator");
      const urlValidation = await validateUrlSoft(url);
      if (!urlValidation.isValid) {
        return res.status(400).json({ error: urlValidation.error || "Invalid URL" });
      }
      
      // Fetch and extract content from URL
      const { extractFeaturesFromContent } = await import("../ai-service");
      
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
      
      const { extractFeaturesFromContent } = await import("../ai-service");
      const extractedFeatures = await extractFeaturesFromContent(text, "text", product.name);
      
      if (extractedFeatures.length === 0) {
        return res.status(400).json({ error: "No features could be extracted from the provided text. Try reformatting the content or breaking it into smaller sections." });
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
      const { validateUrlSoft } = await import("../utils/url-validator");
      const urlValidation = await validateUrlSoft(url);
      if (!urlValidation.isValid) {
        return res.status(400).json({ error: urlValidation.error || "Invalid URL" });
      }
      
      const { extractRoadmapFromContent } = await import("../ai-service");
      
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
      
      const { extractRoadmapFromContent } = await import("../ai-service");
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
      
      // Check if this product belongs to a project — if so, scope competitors to that project's products
      const { projectId: requestProjectId } = req.body || {};
      const productProjectLinks = await db.select().from(projectProductsTable)
        .where(eq(projectProductsTable.productId, req.params.productId));
      
      const competitorData: { name: string; analysis: string }[] = [];
      
      // Use explicit projectId if provided, otherwise use first link
      const resolvedProjectLink = requestProjectId
        ? productProjectLinks.find(pp => pp.projectId === requestProjectId)
        : productProjectLinks[0];
      
      if (resolvedProjectLink) {
        const projectId = resolvedProjectLink.projectId;
        const allProjectProducts = await storage.getProjectProducts(projectId);
        const competitorProductEntries = allProjectProducts.filter(pp => pp.role === "competitor");
        
        for (const pp of competitorProductEntries.slice(0, 5)) {
          const compProduct = pp.product;
          if (compProduct?.analysisData) {
            const analysisText = typeof compProduct.analysisData === 'string'
              ? compProduct.analysisData
              : JSON.stringify(compProduct.analysisData);
            competitorData.push({
              name: compProduct.name,
              analysis: analysisText,
            });
          }
        }
        console.log(`[Roadmap Recs] Product "${product.name}" is in project ${projectId}, using ${competitorData.length} project-scoped competitor products`);
      } else {
        const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
        
        for (const comp of competitors.slice(0, 5)) {
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
      }
      
      // Fetch existing feature recommendations for dedup context
      const existingFeatureRecs = await storage.getFeatureRecommendationsByProduct(req.params.productId);
      const existingForRoadmapAI = existingFeatureRecs.map(r => ({
        title: r.title,
        status: r.status,
      }));

      // Generate recommendations using AI
      const recommendations = await generateRoadmapRecommendations(
        product.name,
        product.description || "",
        featuresContext,
        competitorData,
        existingForRoadmapAI.length > 0 ? existingForRoadmapAI : undefined
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


}
