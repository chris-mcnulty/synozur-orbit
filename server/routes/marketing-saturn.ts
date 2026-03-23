/**
 * Saturn Marketing Integration Routes
 *
 * Provides API endpoints for:
 *  - Content Library (content assets, categories, product tags)
 *  - Brand Library (brand assets, brand asset categories)
 *  - Social Accounts
 *  - Campaigns (+ campaign assets, campaign social accounts)
 *  - AI Post Generation (async, via job queue)
 *  - AI Email Generation
 *  - Extension API (Saturn Capture → content library)
 *
 * All routes are Enterprise-gated via checkFeatureAccessAsync().
 * All data is scoped to tenantDomain + marketId from the request context.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  contentAssets,
  contentAssetCategories,
  contentAssetProductTags,
  brandAssets,
  brandAssetCategories,
  brandAssetProductTags,
  marketingProductTags,
  socialAccounts,
  campaigns,
  campaignAssets,
  campaignSocialAccounts,
  generatedPosts,
  generatedEmails,
  scheduledJobRuns,
  groundingDocuments,
  products,
  DEFAULT_CONTENT_CATEGORIES,
  DEFAULT_BRAND_ASSET_CATEGORIES,
  type InsertContentAsset,
  type InsertContentAssetCategory,
  type InsertBrandAsset,
  type InsertBrandAssetCategory,
  type InsertMarketingProductTag,
  type InsertSocialAccount,
  type InsertCampaign,
  type InsertCampaignAsset,
  type InsertCampaignSocialAccount,
  type InsertGeneratedPost,
  type InsertGeneratedEmail,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { storage } from "../storage";
import { completeForFeature } from "../services/ai-provider";
import { extractContentFromUrl, generateContentSummary } from "../services/content-extraction";

// ─── helpers ────────────────────────────────────────────────────────────────

async function getTenantPlan(tenantDomain: string): Promise<string> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  return tenant?.plan ?? "free";
}

async function guardFeature(
  req: Request,
  res: Response,
  feature: string
): Promise<boolean> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  try {
    const ctx = await getRequestContext(req);
    const plan = await getTenantPlan(ctx.tenantDomain);
    const gate = await checkFeatureAccessAsync(plan, feature);
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason, upgradeRequired: gate.upgradeRequired, requiredPlan: gate.requiredPlan });
      return false;
    }
    return true;
  } catch (err: any) {
    if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as any).status === "number"
    ) {
      const status = (err as any).status as number;
      let safeMessage = "Request failed";
      if (status === 401) {
        safeMessage = "Not authenticated";
      } else if (status === 403) {
        safeMessage = "Forbidden";
      }
      res.status(status).json({ error: safeMessage });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
    return false;
  }
}

// ─── register ────────────────────────────────────────────────────────────────

export function registerSaturnMarketingRoutes(app: Express) {

  // ══════════════════════════════════════════════════════════
  // CONTENT ASSET CATEGORIES
  // ══════════════════════════════════════════════════════════

  app.get("/api/content-categories", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(contentAssetCategories)
      .where(and(
        eq(contentAssetCategories.tenantDomain, ctx.tenantDomain),
        eq(contentAssetCategories.marketId, ctx.marketId),
      ))
      .orderBy(contentAssetCategories.name);
    res.json(rows);
  });

  app.post("/api/content-categories", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const [row] = await db.insert(contentAssetCategories).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name: name.trim(),
      createdBy: ctx.userId,
    } as InsertContentAssetCategory).returning();
    res.status(201).json(row);
  });

  app.patch("/api/content-categories/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const [row] = await db.update(contentAssetCategories)
      .set({ name: req.body.name, updatedAt: new Date() })
      .where(and(
        eq(contentAssetCategories.id, req.params.id),
        eq(contentAssetCategories.tenantDomain, ctx.tenantDomain),
        eq(contentAssetCategories.marketId, ctx.marketId),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/content-categories/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    await db.delete(contentAssetCategories)
      .where(and(
        eq(contentAssetCategories.id, req.params.id),
        eq(contentAssetCategories.tenantDomain, ctx.tenantDomain),
        eq(contentAssetCategories.marketId, ctx.marketId),
      ));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // MARKETING PRODUCT TAGS
  // ══════════════════════════════════════════════════════════

  app.get("/api/marketing-product-tags", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(marketingProductTags)
      .where(and(
        eq(marketingProductTags.tenantDomain, ctx.tenantDomain),
        eq(marketingProductTags.marketId, ctx.marketId),
      ))
      .orderBy(marketingProductTags.name);
    res.json(rows);
  });

  app.post("/api/marketing-product-tags", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const [row] = await db.insert(marketingProductTags).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name: name.trim(),
      createdBy: ctx.userId,
    } as InsertMarketingProductTag).returning();
    res.status(201).json(row);
  });

  app.patch("/api/marketing-product-tags/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const [row] = await db.update(marketingProductTags)
      .set({ name: req.body.name, updatedAt: new Date() })
      .where(and(
        eq(marketingProductTags.id, req.params.id),
        eq(marketingProductTags.tenantDomain, ctx.tenantDomain),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/marketing-product-tags/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    await db.delete(marketingProductTags)
      .where(and(
        eq(marketingProductTags.id, req.params.id),
        eq(marketingProductTags.tenantDomain, ctx.tenantDomain),
      ));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // CONTENT ASSETS
  // ══════════════════════════════════════════════════════════

  app.get("/api/content-assets", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const conditions = [
      eq(contentAssets.tenantDomain, ctx.tenantDomain),
      eq(contentAssets.marketId, ctx.marketId),
    ];
    const status = req.query.status as string | undefined;
    if (status && (status === "active" || status === "archived")) {
      conditions.push(eq(contentAssets.status, status));
    }
    const rows = await db.select().from(contentAssets)
      .where(and(...conditions))
      .orderBy(desc(contentAssets.createdAt));
    res.json(rows);
  });

  app.get("/api/content-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const [row] = await db.select().from(contentAssets)
      .where(and(
        eq(contentAssets.id, req.params.id),
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
        eq(contentAssets.marketId, ctx.marketId),
      ));
    if (!row) return res.status(404).json({ error: "Not found" });
    // Fetch product tag IDs
    const tagLinks = await db.select().from(contentAssetProductTags)
      .where(eq(contentAssetProductTags.assetId, row.id));
    res.json({ ...row, productTagIds: tagLinks.map(t => t.tagId) });
  });

  app.post("/api/content-assets", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const { title, description, url, content, categoryId, productTagIds, productIds, aiSummary, leadImageUrl, extractionStatus, tags, status } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "title is required" });
    const [row] = await db.insert(contentAssets).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      title: title.trim(),
      description,
      url,
      content,
      aiSummary: aiSummary || null,
      leadImageUrl: leadImageUrl || null,
      extractionStatus: extractionStatus || "none",
      categoryId: categoryId || null,
      productIds: productIds?.length ? productIds : null,
      tags: tags || null,
      status: status === "archived" ? "archived" : "active",
      createdBy: ctx.userId,
    } as InsertContentAsset).returning();
    if (productTagIds?.length) {
      await db.insert(contentAssetProductTags).values(
        productTagIds.map((tagId: string) => ({ assetId: row.id, tagId }))
      );
    }
    res.status(201).json(row);
  });

  app.patch("/api/content-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const { title, description, url, content, categoryId, status, productTagIds, productIds, aiSummary, leadImageUrl, tags } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (url !== undefined) updates.url = url;
    if (content !== undefined) updates.content = content;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (status !== undefined) updates.status = status;
    if (aiSummary !== undefined) updates.aiSummary = aiSummary;
    if (leadImageUrl !== undefined) updates.leadImageUrl = leadImageUrl;
    if (productIds !== undefined) updates.productIds = productIds?.length ? productIds : null;
    if (tags !== undefined) updates.tags = tags;

    const [row] = await db.update(contentAssets)
      .set(updates)
      .where(and(
        eq(contentAssets.id, req.params.id),
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
        eq(contentAssets.marketId, ctx.marketId),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    if (productTagIds !== undefined) {
      await db.delete(contentAssetProductTags).where(eq(contentAssetProductTags.assetId, row.id));
      if (productTagIds.length) {
        await db.insert(contentAssetProductTags).values(
          productTagIds.map((tagId: string) => ({ assetId: row.id, tagId }))
        );
      }
    }
    res.json(row);
  });

  app.delete("/api/content-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    await db.update(contentAssets)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(contentAssets.id, req.params.id),
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
        eq(contentAssets.marketId, ctx.marketId),
      ));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // URL EXTRACTION — fetch, parse, summarize via AI
  // ══════════════════════════════════════════════════════════

  app.post("/api/content-assets/extract", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const { url } = req.body;
    if (!url?.trim()) return res.status(400).json({ error: "url is required" });

    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    try {
      const result = await extractContentFromUrl(url.trim());
      res.json(result);
    } catch (err: any) {
      console.error("[Saturn] Content extraction error:", err.message);
      res.status(422).json({ error: `Could not extract content: ${err.message}` });
    }
  });

  app.post("/api/content-assets/generate-summaries", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);

    const { assetIds } = req.body;

    let assetsToProcess;
    if (assetIds?.length) {
      assetsToProcess = await db.select().from(contentAssets)
        .where(and(
          eq(contentAssets.tenantDomain, ctx.tenantDomain),
          eq(contentAssets.marketId, ctx.marketId),
          inArray(contentAssets.id, assetIds),
        ));
    } else {
      assetsToProcess = await db.select().from(contentAssets)
        .where(and(
          eq(contentAssets.tenantDomain, ctx.tenantDomain),
          eq(contentAssets.marketId, ctx.marketId),
          eq(contentAssets.status, "active"),
          sql`(${contentAssets.aiSummary} IS NULL OR ${contentAssets.aiSummary} = '')`,
        ));
    }

    if (assetsToProcess.length === 0) {
      return res.json({ processed: 0, failed: 0, total: 0 });
    }

    res.json({ queued: assetsToProcess.length, message: "Summary generation started" });

    (async () => {
      let processed = 0;
      let failed = 0;
      for (const asset of assetsToProcess) {
        try {
          const summary = await generateContentSummary(
            asset.title,
            asset.description || "",
            asset.content || asset.description || "",
            asset.url || "",
          );
          await db.update(contentAssets)
            .set({ aiSummary: summary, updatedAt: new Date() })
            .where(eq(contentAssets.id, asset.id));
          processed++;
        } catch (err: any) {
          console.error(`[Saturn] Bulk summary failed for ${asset.id}:`, err.message);
          failed++;
        }
      }
      console.log(`[Saturn] Bulk summary generation complete: ${processed} processed, ${failed} failed out of ${assetsToProcess.length}`);
    })();
  });

  app.post("/api/content-assets/:id/generate-summary", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);

    const [asset] = await db.select().from(contentAssets)
      .where(and(
        eq(contentAssets.id, req.params.id),
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
        eq(contentAssets.marketId, ctx.marketId),
      ));
    if (!asset) return res.status(404).json({ error: "Content asset not found" });

    try {
      const summary = await generateContentSummary(
        asset.title,
        asset.description || "",
        asset.content || asset.description || "",
        asset.url || "",
      );

      const [updated] = await db.update(contentAssets)
        .set({ aiSummary: summary, updatedAt: new Date() })
        .where(eq(contentAssets.id, asset.id))
        .returning();

      res.json({ aiSummary: updated.aiSummary });
    } catch (err: any) {
      console.error("[Saturn] AI summary generation error:", err.message);
      res.status(500).json({ error: `Summary generation failed: ${err.message}` });
    }
  });

  // Save lead image as brand asset
  app.post("/api/content-assets/:id/save-lead-image", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);

    const [asset] = await db.select().from(contentAssets)
      .where(and(
        eq(contentAssets.id, req.params.id),
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
        eq(contentAssets.marketId, ctx.marketId),
      ));
    if (!asset) return res.status(404).json({ error: "Content asset not found" });
    if (!asset.leadImageUrl) return res.status(400).json({ error: "No lead image available" });

    const { name, categoryId } = req.body;
    const [brandAsset] = await db.insert(brandAssets).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name: name?.trim() || `Image from ${asset.title}`,
      description: `Lead image extracted from ${asset.url || asset.title}`,
      url: asset.leadImageUrl,
      fileType: "image",
      categoryId: categoryId || null,
      sourceContentAssetId: asset.id,
      createdBy: ctx.userId,
    } as InsertBrandAsset).returning();

    res.status(201).json(brandAsset);
  });

  // Seed default categories for a tenant/market if none exist
  app.post("/api/content-categories/seed-defaults", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);

    const existing = await db.select().from(contentAssetCategories)
      .where(and(
        eq(contentAssetCategories.tenantDomain, ctx.tenantDomain),
        eq(contentAssetCategories.marketId, ctx.marketId),
      ));
    if (existing.length > 0) return res.json({ seeded: false, count: existing.length });

    const rows = DEFAULT_CONTENT_CATEGORIES.map(name => ({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name,
      createdBy: ctx.userId,
    }));
    await db.insert(contentAssetCategories).values(rows as InsertContentAssetCategory[]);
    res.json({ seeded: true, count: rows.length });
  });

  app.post("/api/brand-asset-categories/seed-defaults", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);

    const existing = await db.select().from(brandAssetCategories)
      .where(and(
        eq(brandAssetCategories.tenantDomain, ctx.tenantDomain),
        eq(brandAssetCategories.marketId, ctx.marketId),
      ));
    if (existing.length > 0) return res.json({ seeded: false, count: existing.length });

    const rows = DEFAULT_BRAND_ASSET_CATEGORIES.map(name => ({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name,
      createdBy: ctx.userId,
    }));
    await db.insert(brandAssetCategories).values(rows as InsertBrandAssetCategory[]);
    res.json({ seeded: true, count: rows.length });
  });

  // Get products for the current market (for product tagging)
  app.get("/api/marketing/products", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const rows = await db.select({
      id: products.id,
      name: products.name,
      isBaseline: products.isBaseline,
    }).from(products)
      .where(and(
        eq(products.tenantDomain, ctx.tenantDomain),
        eq(products.marketId, ctx.marketId),
        eq(products.isBaseline, true),
      ))
      .orderBy(products.name);
    res.json(rows);
  });

  // ══════════════════════════════════════════════════════════
  // BRAND ASSET CATEGORIES
  // ══════════════════════════════════════════════════════════

  app.get("/api/brand-asset-categories", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(brandAssetCategories)
      .where(and(
        eq(brandAssetCategories.tenantDomain, ctx.tenantDomain),
        eq(brandAssetCategories.marketId, ctx.marketId),
      ))
      .orderBy(brandAssetCategories.name);
    res.json(rows);
  });

  app.post("/api/brand-asset-categories", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const [row] = await db.insert(brandAssetCategories).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name: name.trim(),
      createdBy: ctx.userId,
    } as InsertBrandAssetCategory).returning();
    res.status(201).json(row);
  });

  app.patch("/api/brand-asset-categories/:id", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    const [row] = await db.update(brandAssetCategories)
      .set({ name: req.body.name, updatedAt: new Date() })
      .where(and(
        eq(brandAssetCategories.id, req.params.id),
        eq(brandAssetCategories.tenantDomain, ctx.tenantDomain),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/brand-asset-categories/:id", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    await db.delete(brandAssetCategories)
      .where(and(
        eq(brandAssetCategories.id, req.params.id),
        eq(brandAssetCategories.tenantDomain, ctx.tenantDomain),
      ));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // BRAND ASSETS
  // ══════════════════════════════════════════════════════════

  app.get("/api/brand-assets", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    const conditions = [
      eq(brandAssets.tenantDomain, ctx.tenantDomain),
      eq(brandAssets.marketId, ctx.marketId),
    ];
    const status = req.query.status as string | undefined;
    if (status && (status === "active" || status === "archived")) {
      conditions.push(eq(brandAssets.status, status));
    }
    const rows = await db.select().from(brandAssets)
      .where(and(...conditions))
      .orderBy(desc(brandAssets.createdAt));
    res.json(rows);
  });

  app.get("/api/brand-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    const [row] = await db.select().from(brandAssets)
      .where(and(
        eq(brandAssets.id, req.params.id),
        eq(brandAssets.tenantDomain, ctx.tenantDomain),
        eq(brandAssets.marketId, ctx.marketId),
      ));
    if (!row) return res.status(404).json({ error: "Not found" });
    const tagLinks = await db.select().from(brandAssetProductTags)
      .where(eq(brandAssetProductTags.assetId, row.id));
    res.json({ ...row, productTagIds: tagLinks.map(t => t.tagId) });
  });

  app.post("/api/brand-assets", async (req, res) => {
    try {
      if (!await guardFeature(req, res, "brandLibrary")) return;
      const ctx = await getRequestContext(req);
      const { name, description, url, categoryId, productTagIds, productIds, tags, fileType } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });
      const [row] = await db.insert(brandAssets).values({
        id: randomUUID(),
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        name: name.trim(),
        description: description || null,
        url: url || null,
        categoryId: categoryId || null,
        fileType: fileType || null,
        productIds: productIds?.length ? productIds : null,
        tags: tags || null,
        createdBy: ctx.userId,
      } as InsertBrandAsset).returning();
      if (productTagIds?.length) {
        await db.insert(brandAssetProductTags).values(
          productTagIds.map((tagId: string) => ({ assetId: row.id, tagId }))
        );
      }
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[brand-assets POST]", err);
      res.status(500).json({ error: err.message || "Failed to create brand asset" });
    }
  });

  app.patch("/api/brand-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    const { name, description, url, fileUrl, fileType, categoryId, status, productTagIds, productIds, tags } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (url !== undefined) updates.url = url;
    if (fileUrl !== undefined) updates.fileUrl = fileUrl;
    if (fileType !== undefined) updates.fileType = fileType;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (status !== undefined) updates.status = status;
    if (productIds !== undefined) updates.productIds = productIds?.length ? productIds : null;
    if (tags !== undefined) updates.tags = tags;

    const [row] = await db.update(brandAssets)
      .set(updates)
      .where(and(
        eq(brandAssets.id, req.params.id),
        eq(brandAssets.tenantDomain, ctx.tenantDomain),
        eq(brandAssets.marketId, ctx.marketId),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    if (productTagIds !== undefined) {
      await db.delete(brandAssetProductTags).where(eq(brandAssetProductTags.assetId, row.id));
      if (productTagIds.length) {
        await db.insert(brandAssetProductTags).values(
          productTagIds.map((tagId: string) => ({ assetId: row.id, tagId }))
        );
      }
    }
    res.json(row);
  });

  app.delete("/api/brand-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    await db.update(brandAssets)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(brandAssets.id, req.params.id),
        eq(brandAssets.tenantDomain, ctx.tenantDomain),
        eq(brandAssets.marketId, ctx.marketId),
      ));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // SOCIAL ACCOUNTS
  // ══════════════════════════════════════════════════════════

  app.get("/api/social-accounts", async (req, res) => {
    if (!await guardFeature(req, res, "socialAccounts")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(socialAccounts)
      .where(and(
        eq(socialAccounts.tenantDomain, ctx.tenantDomain),
        eq(socialAccounts.marketId, ctx.marketId),
        eq(socialAccounts.status, "active"),
      ))
      .orderBy(socialAccounts.platform, socialAccounts.accountName);
    res.json(rows);
  });

  app.post("/api/social-accounts", async (req, res) => {
    if (!await guardFeature(req, res, "socialAccounts")) return;
    const ctx = await getRequestContext(req);
    const { platform, accountName, accountId, profileUrl, notes } = req.body;
    if (!platform?.trim() || !accountName?.trim()) {
      return res.status(400).json({ error: "platform and accountName are required" });
    }
    const [row] = await db.insert(socialAccounts).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      platform: platform.trim(),
      accountName: accountName.trim(),
      accountId,
      profileUrl,
      notes,
      createdBy: ctx.userId,
    } as InsertSocialAccount).returning();
    res.status(201).json(row);
  });

  app.patch("/api/social-accounts/:id", async (req, res) => {
    if (!await guardFeature(req, res, "socialAccounts")) return;
    const ctx = await getRequestContext(req);
    const { accountName, accountId, profileUrl, notes, status } = req.body;
    const [row] = await db.update(socialAccounts)
      .set({ accountName, accountId, profileUrl, notes, status, updatedAt: new Date() })
      .where(and(
        eq(socialAccounts.id, req.params.id),
        eq(socialAccounts.tenantDomain, ctx.tenantDomain),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/social-accounts/:id", async (req, res) => {
    if (!await guardFeature(req, res, "socialAccounts")) return;
    const ctx = await getRequestContext(req);
    await db.update(socialAccounts)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(and(
        eq(socialAccounts.id, req.params.id),
        eq(socialAccounts.tenantDomain, ctx.tenantDomain),
      ));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ══════════════════════════════════════════════════════════

  app.get("/api/campaigns", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
      const ctx = await getRequestContext(req);
      const rows = await db.select().from(campaigns)
        .where(and(
          eq(campaigns.tenantDomain, ctx.tenantDomain),
          eq(campaigns.marketId, ctx.marketId),
        ))
        .orderBy(desc(campaigns.createdAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[Campaigns List Error]", err.message);
      res.status(500).json({ error: "Failed to load campaigns" });
    }
  });

  app.get("/api/campaigns/:id", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
      const ctx = await getRequestContext(req);
      const [campaign] = await db.select().from(campaigns)
        .where(and(
          eq(campaigns.id, req.params.id),
          eq(campaigns.tenantDomain, ctx.tenantDomain),
        ));
      if (!campaign) return res.status(404).json({ error: "Not found" });

      const assets = await db.select().from(campaignAssets)
        .where(eq(campaignAssets.campaignId, campaign.id))
        .orderBy(campaignAssets.sortOrder);
      const socialAccts = await db.select().from(campaignSocialAccounts)
        .where(eq(campaignSocialAccounts.campaignId, campaign.id));

      res.json({ ...campaign, assets, socialAccounts: socialAccts });
    } catch (err: any) {
      console.error("[Campaign Detail Error]", err.message);
      res.status(500).json({ error: "Failed to load campaign" });
    }
  });

  app.post("/api/campaigns", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
      const ctx = await getRequestContext(req);
      const { name, description, startDate, endDate, numberOfDays, includeSaturday, includeSunday, assetIds, socialAccountIds, productIds } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });

      const validAssetIds: string[] = [];
      if (Array.isArray(assetIds) && assetIds.length > 0) {
        const found = await db.select({ id: contentAssets.id }).from(contentAssets)
          .where(and(
            inArray(contentAssets.id, assetIds),
            eq(contentAssets.tenantDomain, ctx.tenantDomain),
            eq(contentAssets.marketId, ctx.marketId),
          ));
        validAssetIds.push(...found.map(f => f.id));
      }

      const validSocialIds: string[] = [];
      if (Array.isArray(socialAccountIds) && socialAccountIds.length > 0) {
        const socialConditions: any[] = [
          inArray(socialAccounts.id, socialAccountIds),
          eq(socialAccounts.tenantDomain, ctx.tenantDomain),
        ];
        if (ctx.marketId) socialConditions.push(eq(socialAccounts.marketId, ctx.marketId));
        const found = await db.select({ id: socialAccounts.id }).from(socialAccounts)
          .where(and(...socialConditions));
        validSocialIds.push(...found.map(f => f.id));
      }

      const campaignId = randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(campaigns).values({
          id: campaignId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          name: name.trim(),
          description: description || null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          numberOfDays: numberOfDays ?? null,
          includeSaturday: includeSaturday ?? false,
          includeSunday: includeSunday ?? false,
          productIds: Array.isArray(productIds) ? productIds : null,
          createdBy: ctx.userId,
        } as InsertCampaign);

        if (validAssetIds.length > 0) {
          await tx.insert(campaignAssets).values(
            validAssetIds.map((assetId, idx) => ({
              id: randomUUID(),
              campaignId,
              assetId,
              sortOrder: idx,
            } as InsertCampaignAsset))
          );
        }

        if (validSocialIds.length > 0) {
          await tx.insert(campaignSocialAccounts).values(
            validSocialIds.map((socialAccountId) => ({
              id: randomUUID(),
              campaignId,
              socialAccountId,
            } as InsertCampaignSocialAccount))
          );
        }
      });

      const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[Campaign Create Error]", err.message, err.stack);
      res.status(500).json({ error: "Failed to create campaign" });
    }
  });

  app.patch("/api/campaigns/:id", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const { name, description, status, startDate, endDate, numberOfDays, includeSaturday, includeSunday, productIds } = req.body;
    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (numberOfDays !== undefined) updateData.numberOfDays = numberOfDays;
    if (includeSaturday !== undefined) updateData.includeSaturday = includeSaturday;
    if (includeSunday !== undefined) updateData.includeSunday = includeSunday;
    if (productIds !== undefined) updateData.productIds = Array.isArray(productIds) ? productIds : null;
    const [row] = await db.update(campaigns)
      .set(updateData)
      .where(and(
        eq(campaigns.id, req.params.id),
        eq(campaigns.tenantDomain, ctx.tenantDomain),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/campaigns/:id", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    await db.update(campaigns)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(campaigns.id, req.params.id),
        eq(campaigns.tenantDomain, ctx.tenantDomain),
      ));
    res.status(204).send();
  });

  // Campaign Duplication
  app.post("/api/campaigns/:id/duplicate", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const [source] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!source) return res.status(404).json({ error: "Campaign not found" });

    const newId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(campaigns).values({
        id: newId,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        name: `${source.name} (Copy)`,
        description: source.description,
        startDate: source.startDate,
        endDate: source.endDate,
        numberOfDays: source.numberOfDays,
        includeSaturday: source.includeSaturday,
        includeSunday: source.includeSunday,
        productIds: source.productIds,
        status: "draft",
        createdBy: ctx.userId,
      } as InsertCampaign);

      const sourceAssets = await tx.select().from(campaignAssets)
        .where(eq(campaignAssets.campaignId, source.id));
      if (sourceAssets.length > 0) {
        await tx.insert(campaignAssets).values(
          sourceAssets.map(a => ({
            id: randomUUID(),
            campaignId: newId,
            assetId: a.assetId,
            overrideTitle: a.overrideTitle,
            overrideContent: a.overrideContent,
            sortOrder: a.sortOrder,
          } as InsertCampaignAsset))
        );
      }

      const sourceSocial = await tx.select().from(campaignSocialAccounts)
        .where(eq(campaignSocialAccounts.campaignId, source.id));
      if (sourceSocial.length > 0) {
        await tx.insert(campaignSocialAccounts).values(
          sourceSocial.map(s => ({
            id: randomUUID(),
            campaignId: newId,
            socialAccountId: s.socialAccountId,
          } as InsertCampaignSocialAccount))
        );
      }
    });

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, newId));
    res.status(201).json(row);
  });

  // Campaign Assets

  app.post("/api/campaigns/:id/assets", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const { assetId, assetIds, overrideTitle, overrideContent, sortOrder } = req.body;

    const idsToAdd: string[] = Array.isArray(assetIds) ? assetIds : assetId ? [assetId] : [];
    if (idsToAdd.length === 0) return res.status(400).json({ error: "assetId or assetIds is required" });

    const rows: any[] = [];
    for (let i = 0; i < idsToAdd.length; i++) {
      const aid = idsToAdd[i];
      const [asset] = await db.select().from(contentAssets)
        .where(and(
          eq(contentAssets.id, aid),
          eq(contentAssets.tenantDomain, ctx.tenantDomain),
          eq(contentAssets.marketId, ctx.marketId),
        ));
      if (!asset) continue;
      const existing = await db.select().from(campaignAssets)
        .where(and(eq(campaignAssets.campaignId, campaign.id), eq(campaignAssets.assetId, aid)));
      if (existing.length > 0) continue;
      const [row] = await db.insert(campaignAssets).values({
        id: randomUUID(),
        campaignId: campaign.id,
        assetId: aid,
        overrideTitle: idsToAdd.length === 1 ? overrideTitle : undefined,
        overrideContent: idsToAdd.length === 1 ? overrideContent : undefined,
        sortOrder: sortOrder ?? i,
      } as InsertCampaignAsset).returning();
      rows.push(row);
    }
    res.status(201).json(rows.length === 1 ? rows[0] : rows);
  });

  app.patch("/api/campaigns/:campaignId/assets/:assetId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const { overrideTitle, overrideContent, sortOrder } = req.body;
    const [row] = await db.update(campaignAssets)
      .set({ overrideTitle, overrideContent, sortOrder })
      .where(and(
        eq(campaignAssets.campaignId, campaign.id),
        eq(campaignAssets.assetId, req.params.assetId),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/campaigns/:campaignId/assets/:assetId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    await db.delete(campaignAssets)
      .where(and(
        eq(campaignAssets.campaignId, campaign.id),
        eq(campaignAssets.assetId, req.params.assetId),
      ));
    res.status(204).send();
  });

  // Campaign Social Accounts

  app.post("/api/campaigns/:id/social-accounts", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const { socialAccountId } = req.body;
    if (!socialAccountId) return res.status(400).json({ error: "socialAccountId is required" });
    const socialAccountConditions = [
      eq(socialAccounts.id, socialAccountId),
      eq(socialAccounts.tenantDomain, ctx.tenantDomain),
    ];
    if (ctx.marketId) {
      socialAccountConditions.push(eq(socialAccounts.marketId, ctx.marketId));
    }
    const [socialAccount] = await db.select().from(socialAccounts).where(and(...socialAccountConditions));
    if (!socialAccount) return res.status(404).json({ error: "Social account not found" });
    const [row] = await db.insert(campaignSocialAccounts).values({
      id: randomUUID(),
      campaignId: campaign.id,
      socialAccountId,
    } as InsertCampaignSocialAccount).returning();
    res.status(201).json(row);
  });

  app.delete("/api/campaigns/:campaignId/social-accounts/:accountId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    await db.delete(campaignSocialAccounts)
      .where(and(
        eq(campaignSocialAccounts.campaignId, campaign.id),
        eq(campaignSocialAccounts.socialAccountId, req.params.accountId),
      ));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // GENERATED POSTS — list, update, delete
  // ══════════════════════════════════════════════════════════

  app.get("/api/campaigns/:id/generated-posts", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [campaign] = await db.select().from(campaigns)
        .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const posts = await db.select().from(generatedPosts)
        .where(eq(generatedPosts.campaignId, campaign.id))
        .orderBy(generatedPosts.platform, desc(generatedPosts.createdAt));
      res.json(posts);
    } catch (err: any) {
      console.error("[Generated Posts List Error]", err.message);
      res.status(500).json({ error: "Failed to load generated posts" });
    }
  });

  app.put("/api/campaigns/:campaignId/generated-posts/:postId", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const { editedContent, status, overrideImageUrl, overrideBrandAssetId, scheduledDate } = req.body;
    const updateFields: any = { updatedAt: new Date() };
    if (editedContent !== undefined) updateFields.editedContent = editedContent;
    if (status !== undefined) updateFields.status = status;
    if (overrideImageUrl !== undefined) updateFields.overrideImageUrl = overrideImageUrl || null;
    if (overrideBrandAssetId !== undefined) updateFields.overrideBrandAssetId = overrideBrandAssetId || null;
    if (scheduledDate !== undefined) updateFields.scheduledDate = scheduledDate ? new Date(scheduledDate) : null;
    const [row] = await db.update(generatedPosts)
      .set(updateFields)
      .where(and(eq(generatedPosts.id, req.params.postId), eq(generatedPosts.campaignId, campaign.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/campaigns/:campaignId/generated-posts/:postId", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    await db.update(generatedPosts)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(and(eq(generatedPosts.id, req.params.postId), eq(generatedPosts.campaignId, campaign.id)));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // POST GENERATION — async via job queue
  // ══════════════════════════════════════════════════════════

  app.post("/api/campaigns/:id/generate-posts", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    const ctx = await getRequestContext(req);

    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    // Create a job run record
    const [job] = await db.insert(scheduledJobRuns).values({
      id: randomUUID(),
      jobType: "generateCampaignPosts",
      tenantDomain: ctx.tenantDomain,
      targetId: campaign.id,
      targetName: campaign.name,
      status: "pending",
    }).returning();

    // Link job to campaign
    await db.update(campaigns)
      .set({ postGenerationJobId: job.id, updatedAt: new Date() })
      .where(eq(campaigns.id, campaign.id));

    // Kick off async generation (fire-and-forget)
    generatePostsAsync(campaign.id, ctx.tenantDomain, ctx.marketId, job.id).catch(err => {
      console.error("[Saturn] Post generation error:", err.message);
    });

    res.status(202).json({ jobId: job.id, status: "pending" });
  });

  app.get("/api/campaigns/:id/generate-posts-status", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (!campaign.postGenerationJobId) return res.json({ status: "idle" });
    const [job] = await db.select().from(scheduledJobRuns)
      .where(eq(scheduledJobRuns.id, campaign.postGenerationJobId));
    res.json({ status: job?.status ?? "unknown", jobId: campaign.postGenerationJobId });
  });

  app.post("/api/campaigns/:id/export-csv", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const posts = await db.select().from(generatedPosts)
      .where(and(
        eq(generatedPosts.campaignId, campaign.id),
        eq(generatedPosts.status, "approved"),
      ));

    const format = (req.query.format as string || "socialpilot").toLowerCase();
    let lines: string[];

    const fmtDate = (d: Date | null | undefined) => d ? d.toISOString().split("T")[0] : "";
    const fmtTime = (d: Date | null | undefined) => d ? d.toISOString().split("T")[1]?.substring(0, 5) || "09:00" : "";
    const fmtDateTime = (d: Date | null | undefined) => d ? d.toISOString().replace("T", " ").substring(0, 16) : "";

    switch (format) {
      case "hootsuite": {
        lines = ["Message,Date,Time,Social Profile"];
        for (const post of posts) {
          const content = (post.editedContent ?? post.content).replace(/"/g, '""');
          const sd = post.scheduledDate ? new Date(post.scheduledDate) : null;
          lines.push(`"${content}",${fmtDate(sd)},${fmtTime(sd)},${post.platform}`);
        }
        break;
      }
      case "buffer": {
        lines = ["Text,Scheduled At,Profile"];
        for (const post of posts) {
          const content = (post.editedContent ?? post.content).replace(/"/g, '""');
          const sd = post.scheduledDate ? new Date(post.scheduledDate) : null;
          lines.push(`"${content}",${fmtDateTime(sd)},${post.platform}`);
        }
        break;
      }
      case "later": {
        lines = ["Caption,Scheduled Date,Platform"];
        for (const post of posts) {
          const content = (post.editedContent ?? post.content).replace(/"/g, '""');
          const sd = post.scheduledDate ? new Date(post.scheduledDate) : null;
          lines.push(`"${content}",${fmtDate(sd)},${post.platform}`);
        }
        break;
      }
      default: {
        lines = ["message,scheduled_time,account"];
        for (const post of posts) {
          const content = (post.editedContent ?? post.content).replace(/"/g, '""');
          const sd = post.scheduledDate ? new Date(post.scheduledDate) : null;
          lines.push(`"${content}",${fmtDateTime(sd)},${post.platform}`);
        }
        break;
      }
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="campaign-${campaign.id}-posts-${format}.csv"`);
    res.send(lines.join("\n"));
  });

  // ══════════════════════════════════════════════════════════
  // EMAIL GENERATION
  // ══════════════════════════════════════════════════════════

  app.post("/api/email/generate", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    const ctx = await getRequestContext(req);
    const { campaignId, assetIds, instructions, format } = req.body;

    const emailFormatPrompts: Record<string, string> = {
      "promotional": "Generate a compelling promotional email that drives action. Include a clear value proposition, benefits-focused copy, and a strong call-to-action.",
      "newsletter": "Generate a newsletter-style email with a curated digest format. Include a brief intro, 2-3 content sections with summaries, and links to read more. Use a scannable layout with clear section headers.",
      "product-announcement": "Generate a product announcement email. Lead with the news, explain what's new and why it matters, highlight key features/benefits, and include a CTA to learn more or try it.",
      "event-invitation": "Generate an event or webinar invitation email. Include the event name, date/time placeholder, a compelling description of what attendees will learn, speaker highlights if relevant, and a clear registration CTA.",
      "follow-up": "Generate a follow-up / nurture email. Use a warm, conversational tone. Reference the content naturally, provide additional value or insights, and gently guide toward the next step without being pushy.",
      "case-study": "Generate a case study highlight email. Structure it as: challenge, solution, results. Include a compelling subject line, a brief narrative, quantifiable outcomes where possible, and a CTA to read the full case study.",
      "re-engagement": "Generate a re-engagement email to win back inactive contacts. Use a friendly, non-pushy tone. Highlight what's new or what they're missing, offer value, and include a simple CTA to re-engage.",
      "welcome": "Generate a welcome / onboarding email. Use a warm, helpful tone. Introduce the brand briefly, set expectations for what's coming, highlight immediate next steps or resources, and make the recipient feel valued.",
    };

    const formatInstruction = emailFormatPrompts[format || "promotional"] || emailFormatPrompts["promotional"];

    // Load selected assets - scoped by tenant, market, and explicit asset IDs
    const selectedAssets = assetIds?.length
      ? await db.select().from(contentAssets).where(
          and(
            eq(contentAssets.tenantDomain, ctx.tenantDomain),
            eq(contentAssets.marketId, ctx.marketId),
            inArray(contentAssets.id, assetIds),
          )
        )
      : [];

    // Load marketing grounding docs
    const groundingDocs = await db.select().from(groundingDocuments)
      .where(and(
        eq(groundingDocuments.tenantDomain, ctx.tenantDomain),
        eq(groundingDocuments.useCase as any, "marketing"),
      ));
    const groundingContext = groundingDocs
      .filter(d => d.extractedText)
      .map(d => `[${d.name}]\n${d.extractedText}`)
      .join("\n\n");

    const assetContext = selectedAssets
      .map((a: any) => {
        const parts = [`## ${a.title}`];
        if (a.url) parts.push(`URL: ${a.url}`);
        if (a.aiSummary) parts.push(`### AI Summary\n${a.aiSummary}`);
        if (a.content) parts.push(`### Content\n${a.content}`);
        else if (a.description) parts.push(`### Description\n${a.description}`);
        return parts.join("\n");
      })
      .join("\n\n");

    const formatLabel = {
      "promotional": "Promotional",
      "newsletter": "Newsletter",
      "product-announcement": "Product Announcement",
      "event-invitation": "Event / Webinar Invitation",
      "follow-up": "Follow-up / Nurture",
      "case-study": "Case Study Highlight",
      "re-engagement": "Re-engagement",
      "welcome": "Welcome / Onboarding",
    }[format || "promotional"] || "Promotional";

    const prompt = `You are an expert B2B email marketing copywriter. Generate a professional "${formatLabel}" email based on the following content assets and brand guidelines.

## Email Format
${formatInstruction}

${groundingContext ? `## Brand & Marketing Guidelines\n${groundingContext}\n\n` : ""}## Content Assets\n${assetContext || "(no assets provided)"}

${instructions ? `## Additional Instructions\n${instructions}\n\n` : ""}Return a JSON object with:
- subject: string (email subject line)
- previewText: string (40-90 char preview text)
- htmlBody: string (complete HTML email body, inline styles, responsive, professional design)
- textBody: string (plain text fallback)`;

    const result = await completeForFeature("marketing_tasks", prompt);

    let parsed: any = {};
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      parsed = { subject: "Generated Email", htmlBody: result.text, textBody: result.text };
    }

    res.json({
      subject: parsed.subject ?? "Generated Email",
      previewText: parsed.previewText ?? "",
      htmlBody: parsed.htmlBody ?? result.text,
      textBody: parsed.textBody ?? "",
      usage: result.usage,
    });
  });

  app.get("/api/email/saved", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(generatedEmails)
      .where(and(
        eq(generatedEmails.tenantDomain, ctx.tenantDomain),
        eq(generatedEmails.marketId, ctx.marketId),
      ))
      .orderBy(desc(generatedEmails.createdAt));
    res.json(rows);
  });

  app.post("/api/email/saved", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    const ctx = await getRequestContext(req);
    const { campaignId, subject, previewText, htmlBody, textBody, format } = req.body;
    if (!subject?.trim() || !htmlBody?.trim()) {
      return res.status(400).json({ error: "subject and htmlBody are required" });
    }
    // Validate that the supplied campaignId belongs to this tenant to prevent
    // cross-tenant references from guessed IDs.
    if (campaignId) {
      const [campaign] = await db.select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)))
        .limit(1);
      if (!campaign) {
        return res.status(400).json({ error: "Campaign not found" });
      }
    }
    const [row] = await db.insert(generatedEmails).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      campaignId,
      format: format || "promotional",
      subject,
      previewText,
      htmlBody,
      textBody,
      createdBy: ctx.userId,
    } as InsertGeneratedEmail).returning();
    res.status(201).json(row);
  });

  app.patch("/api/email/saved/:id", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    const ctx = await getRequestContext(req);
    const { subject, htmlBody, textBody, status } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (subject !== undefined) updates.subject = subject;
    if (htmlBody !== undefined) updates.htmlBody = htmlBody;
    if (textBody !== undefined) updates.textBody = textBody;
    if (status !== undefined) updates.status = status;
    const [row] = await db.update(generatedEmails)
      .set(updates)
      .where(and(
        eq(generatedEmails.id, req.params.id),
        eq(generatedEmails.tenantDomain, ctx.tenantDomain),
        eq(generatedEmails.marketId, ctx.marketId),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/email/saved/:id", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    const ctx = await getRequestContext(req);
    await db.update(generatedEmails)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(generatedEmails.id, req.params.id),
        eq(generatedEmails.tenantDomain, ctx.tenantDomain),
        eq(generatedEmails.marketId, ctx.marketId),
      ));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // SATURN CAPTURE EXTENSION API
  // ══════════════════════════════════════════════════════════

  // Receive a captured asset from the browser extension.
  // The extension must be loaded in a browser where the user is already
  // signed into Orbit (session cookie is forwarded automatically).
  app.post("/api/extension/capture", async (req, res) => {
    if (!await guardFeature(req, res, "saturnCapture")) return;
    const ctx = await getRequestContext(req);
    const { title, url, content, description } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "title is required" });
    const [row] = await db.insert(contentAssets).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      title: title.trim(),
      description,
      url,
      content,
      capturedViaExtension: true,
      createdBy: ctx.userId,
    } as InsertContentAsset).returning();
    res.status(201).json(row);
  });

  // Extension handshake — confirms session is valid and returns context
  app.get("/api/extension/whoami", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const plan = await getTenantPlan(ctx.tenantDomain);
    const gate = await checkFeatureAccessAsync(plan, "saturnCapture");
    res.json({
      userId: ctx.userId,
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      captureEnabled: gate.allowed,
    });
  });
}

// ─── async post generation ───────────────────────────────────────────────────

async function generatePostsAsync(
  campaignId: string,
  tenantDomain: string,
  marketId: string,
  jobId: string,
): Promise<void> {
  await db.update(scheduledJobRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(scheduledJobRuns.id, jobId));

  try {
    // Load campaign assets
    const camAssets = await db.select().from(campaignAssets)
      .where(eq(campaignAssets.campaignId, campaignId))
      .orderBy(campaignAssets.sortOrder);

    const assetIds = camAssets.map(ca => ca.assetId);
    const selectedAssets = assetIds.length
      ? await db.select().from(contentAssets).where(
          and(
            eq(contentAssets.tenantDomain, tenantDomain),
            eq(contentAssets.marketId, marketId),
            inArray(contentAssets.id, assetIds),
          ),
        )
      : [];

    // Load linked social accounts
    const camSocial = await db.select().from(campaignSocialAccounts)
      .where(eq(campaignSocialAccounts.campaignId, campaignId));
    const socialIds = camSocial.map(cs => cs.socialAccountId);
    const linkedAccounts = socialIds.length
      ? await db.select().from(socialAccounts).where(
          and(
            eq(socialAccounts.tenantDomain, tenantDomain),
            eq(socialAccounts.marketId, marketId),
            inArray(socialAccounts.id, socialIds),
          ),
        )
      : [];

    // Load marketing grounding docs for AI context
    const groundingDocs = await db.select().from(groundingDocuments)
      .where(and(
        eq(groundingDocuments.tenantDomain, tenantDomain),
        eq(groundingDocuments.useCase as any, "marketing"),
      ));
    const groundingContext = groundingDocs
      .filter(d => d.extractedText)
      .map(d => `[${d.name}]\n${d.extractedText}`)
      .join("\n\n");

    const assetContext = selectedAssets
      .map((a: any) => {
        const parts = [`## ${a.title}`];
        if (a.url) parts.push(`URL: ${a.url}`);
        if (a.aiSummary) parts.push(`### AI Summary\n${a.aiSummary}`);
        if (a.content) parts.push(`### Content\n${a.content}`);
        else if (a.description) parts.push(`### Description\n${a.description}`);
        return parts.join("\n");
      })
      .join("\n\n");

    const platformTargets = linkedAccounts.length
      ? linkedAccounts
      : [{ id: "placeholder", platform: "linkedin", accountName: "Your Company" }];

    const generatedRows: InsertGeneratedPost[] = [];

    const VARIANTS_PER_ACCOUNT = 3;

    for (const account of platformTargets) {
      const platformGuide = getPlatformGuide(account.platform);
      const variantGroupId = randomUUID();
      const prompt = `You are an expert B2B social media copywriter. Generate ${VARIANTS_PER_ACCOUNT} variant ${account.platform} posts for the account "${account.accountName}" based on the following content.

IMPORTANT RULES — follow these strictly:
1. Strip and ignore all non-editorial material from the source content: copyright notices, cookie banners, navigation menus, headers/footers, newsletter signup forms, boilerplate "About Us", social sharing button text, comment sections. Only use the actual article substance and key messages.
2. Do NOT include any URLs or links in the post content — the user will add their own links when publishing.
3. Do NOT include hashtags inline in the post content — put them only in the "hashtags" array field.
4. Hashtags must be single words or camelCase compound words only (e.g. "DigitalTransformation", not "Digital Transformation"). No spaces, no # symbol, no special characters.
5. ${account.platform === "twitter" ? "Twitter/X posts MUST be under 280 characters total including spaces. Count carefully. Keep it punchy and concise." : "Follow the platform length guidelines below."}
6. Write clean, professional copy. No placeholder text, no "[insert link]" or similar instructions.

${groundingContext ? `## Brand & Marketing Guidelines\n${groundingContext}\n\n` : ""}## Content Assets\n${assetContext || "(no specific assets provided — draw from your knowledge of best practices)"}

## Platform Guidelines
${platformGuide}

Each variant should take a different angle, tone, or hook while staying on-brand and on-message.

Return ONLY a valid JSON array (no markdown fences, no explanation) of ${VARIANTS_PER_ACCOUNT} objects, each with:
- "content": string (the post body — no URLs, no inline hashtags)
- "hashtags": string[] (3-5 relevant hashtags, each a single camelCase word, no # prefix)
- "imagePrompt": string (a suggested image description for this post)`;

      const result = await completeForFeature("marketing_tasks", prompt);

      let variants: any[] = [];
      try {
        let cleaned = result.text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          variants = JSON.parse(jsonMatch[0]);
        } else {
          const objMatch = cleaned.match(/\{[\s\S]*\}/);
          variants = objMatch ? [JSON.parse(objMatch[0])] : [{ content: cleaned, hashtags: [], imagePrompt: "" }];
        }
      } catch {
        variants = [{ content: result.text, hashtags: [], imagePrompt: "" }];
      }

      for (const parsed of variants) {
        let postContent = (parsed.content ?? result.text).trim();
        postContent = postContent.replace(/https?:\/\/[^\s)]+/g, "").trim();
        postContent = postContent.replace(/\[insert\s+link\]/gi, "").trim();

        let hashtags: string[] = (parsed.hashtags ?? [])
          .map((h: string) => h.replace(/^#/, "").replace(/\s+/g, "").trim())
          .filter((h: string) => h.length > 0 && h.length < 50);

        if (account.platform === "twitter" && postContent.length > 280) {
          postContent = postContent.substring(0, 277) + "...";
        }

        generatedRows.push({
          id: randomUUID(),
          campaignId,
          socialAccountId: account.id === "placeholder" ? null : account.id,
          tenantDomain,
          platform: account.platform,
          content: postContent,
          hashtags,
          imagePrompt: parsed.imagePrompt ?? "",
          variantGroup: variantGroupId,
          generationJobId: jobId,
        } as InsertGeneratedPost);
      }
    }

    // Assign scheduledDate to each post based on campaign timeline
    const [cam] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    let eligibleDates: Date[] = [];
    if (cam?.startDate && cam?.numberOfDays) {
      const start = new Date(cam.startDate);
      let current = new Date(start);
      while (eligibleDates.length < cam.numberOfDays) {
        const dow = current.getDay();
        const skip = (dow === 0 && !cam.includeSunday) || (dow === 6 && !cam.includeSaturday);
        if (!skip) eligibleDates.push(new Date(current));
        current = new Date(current.getTime() + 86400000);
      }
    }

    const rowsWithSchedule = generatedRows.map((row, i) => ({
      ...row,
      scheduledDate: eligibleDates.length > 0 ? eligibleDates[i % eligibleDates.length] : undefined,
    }));

    if (rowsWithSchedule.length) {
      await db.insert(generatedPosts).values(rowsWithSchedule);
    }

    await db.update(scheduledJobRuns)
      .set({ status: "completed", completedAt: new Date(), result: { postsGenerated: generatedRows.length } })
      .where(eq(scheduledJobRuns.id, jobId));
  } catch (err: any) {
    console.error("[Saturn] Post generation failed:", err.message, err.stack);
    await db.update(scheduledJobRuns)
      .set({ status: "failed", completedAt: new Date(), errorMessage: err.message })
      .where(eq(scheduledJobRuns.id, jobId));
  }
}

function getPlatformGuide(platform: string): string {
  const guides: Record<string, string> = {
    linkedin: "Professional tone. 150-300 words. Include a clear value proposition and a call to action. Use line breaks for readability.",
    twitter: "HARD LIMIT: 280 characters maximum including spaces. Count every character. Concise and punchy. Conversational. One key message only. Do NOT exceed 280 characters.",
    instagram: "Engaging and visual. 150-200 words. Use emojis sparingly. Strong opening line.",
    facebook: "Friendly and informative. 100-250 words. Encourage engagement with a question or CTA.",
  };
  return guides[platform] ?? "Professional and engaging. Clear call to action.";
}
