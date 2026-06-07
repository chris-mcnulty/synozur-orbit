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
import { eq, and, desc, inArray, notInArray, sql, ne, ilike, or, isNull, count } from "drizzle-orm";
import { parsePaginationParams, buildPaginatedEnvelope, toContainsPattern } from "../utils/pagination";
import { randomUUID } from "crypto";
import {
  contentAssets,
  contentAssetCategories,
  contentAssetProductTags,
  contentAssetSolutionAreas,
  brandAssets,
  brandAssetCategories,
  brandAssetProductTags,
  brandAssetSolutionAreas,
  marketingProductTags,
  solutionAreas,
  socialAccounts,
  campaigns,
  campaignAssets,
  campaignSocialAccounts,
  campaignSolutionAreas,
  generatedPosts,
  generatedEmails,
  scheduledJobRuns,
  products,
  companyProfiles,
  DEFAULT_CONTENT_CATEGORIES,
  DEFAULT_BRAND_ASSET_CATEGORIES,
  CONTENT_ASSET_TYPES,
  type ContentAssetType,
  type InsertContentAsset,
  type InsertContentAssetCategory,
  type InsertBrandAsset,
  type InsertBrandAssetCategory,
  type InsertMarketingProductTag,
  type InsertSolutionArea,
  type InsertSocialAccount,
  type InsertCampaign,
  type InsertCampaignAsset,
  type InsertCampaignSocialAccount,
  type InsertGeneratedPost,
  type InsertGeneratedEmail,
  personas,
  markets,
  suggestedContentAssets,
  socialAccountVoiceProfiles,
  longFormRecommendations,
  groundingDocuments,
  globalGroundingDocuments,
  MESSAGING_FRAMEWORK_GLOBAL_CATEGORIES,
  VOICE_PERSON_OPTIONS,
  VOICE_AUTHOR_PERSPECTIVES,
  VOICE_EMOJI_POLICIES,
  VOICE_HASHTAG_POLICIES,
  type InsertPersona,
  type InsertSocialAccountVoiceProfile,
  type VoiceFrameworkRef,
  type VoiceSampleSnippet,
  type VoiceToneAttributes,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { storage, type ContextFilter } from "../storage";
import { completeForFeature } from "../services/ai-provider";
import { extractContentFromUrl, generateContentSummary, loadGroundingContext } from "../services/content-extraction";
import { loadStrategicContext, formatStrategicContextForPrompt, formatPersonaContextForPrompt } from "../services/strategic-context";
import { wrapOutboundLinksInText, slugifyForUtm } from "../services/marketing-links-helpers";
import { guardManualAction } from "./helpers";
import { enqueue } from "../services/job-queue";
import { buildPostsCsv } from "../services/posts-csv-export";

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
  // SOLUTION AREAS
  // ══════════════════════════════════════════════════════════

  const slugifySolutionArea = (name: string): string =>
    name.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 64) || "area";

  app.get("/api/solution-areas", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(solutionAreas)
      .where(and(
        eq(solutionAreas.tenantDomain, ctx.tenantDomain),
        eq(solutionAreas.marketId, ctx.marketId),
      ))
      .orderBy(solutionAreas.sortOrder, solutionAreas.name);
    res.json(rows);
  });

  app.post("/api/solution-areas", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const { name, description, color, icon, parentId, sortOrder } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const baseSlug = slugifySolutionArea(name);
    // Append a short suffix on slug collision rather than failing — tenants
    // can rename later via PATCH.
    let slug = baseSlug;
    const existing = await db.select({ slug: solutionAreas.slug }).from(solutionAreas)
      .where(and(
        eq(solutionAreas.tenantDomain, ctx.tenantDomain),
        eq(solutionAreas.marketId, ctx.marketId),
      ));
    const taken = new Set(existing.map(e => e.slug));
    if (taken.has(slug)) {
      let i = 2;
      while (taken.has(`${baseSlug}-${i}`)) i++;
      slug = `${baseSlug}-${i}`;
    }
    try {
      const [row] = await db.insert(solutionAreas).values({
        id: randomUUID(),
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        color: color || null,
        icon: icon || null,
        parentId: parentId || null,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        createdBy: ctx.userId,
      } as InsertSolutionArea).returning();
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[solution-areas POST]", err.message);
      res.status(500).json({ error: "Failed to create solution area" });
    }
  });

  app.patch("/api/solution-areas/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const { name, description, color, icon, parentId, sortOrder } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (color !== undefined) updates.color = color;
    if (icon !== undefined) updates.icon = icon;
    if (parentId !== undefined) updates.parentId = parentId || null;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    const [row] = await db.update(solutionAreas)
      .set(updates)
      .where(and(
        eq(solutionAreas.id, req.params.id),
        eq(solutionAreas.tenantDomain, ctx.tenantDomain),
        eq(solutionAreas.marketId, ctx.marketId),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/solution-areas/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    await db.delete(solutionAreas)
      .where(and(
        eq(solutionAreas.id, req.params.id),
        eq(solutionAreas.tenantDomain, ctx.tenantDomain),
        eq(solutionAreas.marketId, ctx.marketId),
      ));
    res.status(204).send();
  });

  // Resolve the subset of incoming solutionAreaIds that actually belong to
  // the caller's tenant+market. Used by all join-table writers so the link
  // table can't accumulate cross-tenant or cross-market references.
  async function validSolutionAreaIds(
    ctx: { tenantDomain: string; marketId: string },
    ids: unknown,
  ): Promise<string[]> {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const candidates = ids.filter((s): s is string => typeof s === "string" && s.length > 0);
    if (candidates.length === 0) return [];
    const found = await db.select({ id: solutionAreas.id }).from(solutionAreas)
      .where(and(
        inArray(solutionAreas.id, candidates),
        eq(solutionAreas.tenantDomain, ctx.tenantDomain),
        eq(solutionAreas.marketId, ctx.marketId),
      ));
    return found.map(f => f.id);
  }

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
    if (status === "archived") {
      conditions.push(eq(contentAssets.status, "archived"));
    } else {
      conditions.push(ne(contentAssets.status, "archived"));
    }
    const pagination = parsePaginationParams(req);
    if (pagination.q) {
      const pattern = toContainsPattern(pagination.q);
      conditions.push(or(
        ilike(contentAssets.title, pattern),
        ilike(contentAssets.description, pattern),
      )!);
    }
    const categoryId = req.query.categoryId as string | undefined;
    if (categoryId) {
      if (categoryId === "__uncategorized") {
        conditions.push(isNull(contentAssets.categoryId));
      } else {
        conditions.push(eq(contentAssets.categoryId, categoryId));
      }
    }
    const source = req.query.source as string | undefined;
    if (source === "captured") {
      conditions.push(eq(contentAssets.capturedViaExtension, true));
    } else if (source === "manual") {
      conditions.push(eq(contentAssets.capturedViaExtension, false));
    }
    const assetType = req.query.assetType as string | undefined;
    if (assetType) {
      const types = assetType.split(",").filter(t => (CONTENT_ASSET_TYPES as readonly string[]).includes(t));
      if (types.length) conditions.push(inArray(contentAssets.assetType, types));
    }
    const solutionAreaId = req.query.solutionAreaId as string | undefined;
    if (solutionAreaId) {
      const ids = solutionAreaId.split(",").filter(Boolean);
      if (ids.length) {
        const links = await db.select({ assetId: contentAssetSolutionAreas.assetId })
          .from(contentAssetSolutionAreas)
          .where(inArray(contentAssetSolutionAreas.solutionAreaId, ids));
        const matchedIds = Array.from(new Set(links.map(l => l.assetId)));
        if (matchedIds.length === 0) {
          // No assets in any of the requested areas — short-circuit with an
          // impossible condition so the same paginated envelope is returned.
          conditions.push(sql`false`);
        } else {
          conditions.push(inArray(contentAssets.id, matchedIds));
        }
      }
    }
    const where = and(...conditions);

    if (!pagination.isPaginated) {
      const rows = await db.select().from(contentAssets)
        .where(where)
        .orderBy(desc(contentAssets.createdAt));
      return res.json(rows);
    }

    const [{ value: total }] = await db.select({ value: count() }).from(contentAssets).where(where);
    const items = await db.select().from(contentAssets)
      .where(where)
      .orderBy(desc(contentAssets.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset);
    res.json(buildPaginatedEnvelope(items, Number(total), pagination));
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
    const [tagLinks, areaLinks] = await Promise.all([
      db.select().from(contentAssetProductTags)
        .where(eq(contentAssetProductTags.assetId, row.id)),
      db.select().from(contentAssetSolutionAreas)
        .where(eq(contentAssetSolutionAreas.assetId, row.id)),
    ]);
    res.json({
      ...row,
      productTagIds: tagLinks.map(t => t.tagId),
      solutionAreaIds: areaLinks.map(a => a.solutionAreaId),
    });
  });

  app.post("/api/content-assets", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const { title, description, url, content, categoryId, productTagIds, productIds, aiSummary, leadImageUrl, extractionStatus, tags, status, assetType, solutionAreaIds } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "title is required" });
    const safeAssetType = typeof assetType === "string" && (CONTENT_ASSET_TYPES as readonly string[]).includes(assetType)
      ? (assetType as ContentAssetType)
      : "other";
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
      assetType: safeAssetType,
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
    const validAreas = await validSolutionAreaIds(ctx, solutionAreaIds);
    if (validAreas.length) {
      await db.insert(contentAssetSolutionAreas).values(
        validAreas.map(solutionAreaId => ({ assetId: row.id, solutionAreaId }))
      );
    }
    res.status(201).json(row);
  });

  app.patch("/api/content-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const { title, description, url, content, categoryId, status, productTagIds, productIds, aiSummary, leadImageUrl, tags, assetType, solutionAreaIds } = req.body;
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
    if (assetType !== undefined && (CONTENT_ASSET_TYPES as readonly string[]).includes(assetType)) {
      updates.assetType = assetType;
    }

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
    if (solutionAreaIds !== undefined) {
      await db.delete(contentAssetSolutionAreas).where(eq(contentAssetSolutionAreas.assetId, row.id));
      const validAreas = await validSolutionAreaIds(ctx, solutionAreaIds);
      if (validAreas.length) {
        await db.insert(contentAssetSolutionAreas).values(
          validAreas.map(solutionAreaId => ({ assetId: row.id, solutionAreaId }))
        );
      }
    }
    res.json(row);
  });

  app.delete("/api/content-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    const conditions = and(
      eq(contentAssets.id, req.params.id),
      eq(contentAssets.tenantDomain, ctx.tenantDomain),
      eq(contentAssets.marketId, ctx.marketId),
    );
    if (req.query.permanent === "true") {
      const [existing] = await db.select({ status: contentAssets.status }).from(contentAssets).where(conditions);
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (existing.status !== "archived") return res.status(400).json({ error: "Only archived assets can be permanently deleted" });
      await db.delete(contentAssets).where(conditions);
    } else {
      await db.update(contentAssets)
        .set({ status: "archived", updatedAt: new Date() })
        .where(conditions);
    }
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // URL EXTRACTION — fetch, parse, summarize via AI
  // ══════════════════════════════════════════════════════════

  app.post("/api/content-assets/extract", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    if (!await guardManualAction(req, res, "manualCrawl")) return;
    const ctx = await getRequestContext(req);
    const { url } = req.body;
    if (!url?.trim()) return res.status(400).json({ error: "url is required" });

    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    try {
      const groundingContext = await loadGroundingContext(ctx.tenantDomain, ctx.marketId);
      const result = await extractContentFromUrl(url.trim(), groundingContext);
      res.json(result);
    } catch (err: any) {
      console.error("[Saturn] Content extraction error:", err.message);
      res.status(422).json({ error: `Could not extract content: ${err.message}` });
    }
  });

  app.post("/api/content-assets/generate-summaries", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    if (!await guardManualAction(req, res, "aiResearch")) return;
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
      const groundingContext = await loadGroundingContext(ctx.tenantDomain, ctx.marketId);
      for (const asset of assetsToProcess) {
        try {
          const summary = await generateContentSummary(
            asset.title,
            asset.description || "",
            asset.content || asset.description || "",
            asset.url || "",
            groundingContext,
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
      const groundingContext = await loadGroundingContext(ctx.tenantDomain, ctx.marketId);
      const summary = await generateContentSummary(
        asset.title,
        asset.description || "",
        asset.content || asset.description || "",
        asset.url || "",
        groundingContext,
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
    if (!ctx.marketId) {
      return res.json([]);
    }
    const conditions = [
      eq(products.tenantDomain, ctx.tenantDomain),
      eq(products.marketId, ctx.marketId),
    ];
    const rows = await db.select({
      id: products.id,
      name: products.name,
      isBaseline: products.isBaseline,
      productType: products.productType,
    }).from(products)
      .where(and(...conditions))
      .orderBy(products.name);
    res.json(rows);
  });

  // ══════════════════════════════════════════════════════════
  // SUGGESTED CONTENT ASSETS (from baseline crawl)
  // ══════════════════════════════════════════════════════════

  app.get("/api/suggested-content-assets", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);

    const existingAssetUrls = await db.select({ url: contentAssets.url })
      .from(contentAssets)
      .where(and(
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
        eq(contentAssets.marketId, ctx.marketId),
        eq(contentAssets.status, "active"),
      ));

    const existingUrlSet = new Set(
      existingAssetUrls
        .map(a => a.url?.trim().toLowerCase().replace(/\/+$/, ""))
        .filter(Boolean)
    );

    const rows = await db.select().from(suggestedContentAssets)
      .where(and(
        eq(suggestedContentAssets.tenantDomain, ctx.tenantDomain),
        eq(suggestedContentAssets.marketId, ctx.marketId),
        eq(suggestedContentAssets.status, "pending"),
      ))
      .orderBy(suggestedContentAssets.createdAt);

    const filtered = rows.filter(r => {
      const norm = r.url.trim().toLowerCase().replace(/\/+$/, "");
      return !existingUrlSet.has(norm);
    });

    res.json(filtered);
  });

  app.post("/api/suggested-content-assets/:id/dismiss", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const { id } = req.params;
    await db.update(suggestedContentAssets)
      .set({ status: "dismissed" })
      .where(eq(suggestedContentAssets.id, id));
    res.json({ success: true });
  });

  app.post("/api/suggested-content-assets/dismiss-all", async (req, res) => {
    if (!await guardFeature(req, res, "contentLibrary")) return;
    const ctx = await getRequestContext(req);
    await db.update(suggestedContentAssets)
      .set({ status: "dismissed" })
      .where(and(
        eq(suggestedContentAssets.tenantDomain, ctx.tenantDomain),
        eq(suggestedContentAssets.marketId, ctx.marketId),
        eq(suggestedContentAssets.status, "pending"),
      ));
    res.json({ success: true });
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
    if (status === "archived") {
      conditions.push(eq(brandAssets.status, "archived"));
    } else {
      conditions.push(ne(brandAssets.status, "archived"));
    }
    const pagination = parsePaginationParams(req);
    if (pagination.q) {
      const pattern = toContainsPattern(pagination.q);
      conditions.push(or(
        ilike(brandAssets.name, pattern),
        ilike(brandAssets.description, pattern),
      )!);
    }
    const categoryId = req.query.categoryId as string | undefined;
    if (categoryId) {
      if (categoryId === "__uncategorized") {
        conditions.push(isNull(brandAssets.categoryId));
      } else {
        conditions.push(eq(brandAssets.categoryId, categoryId));
      }
    }
    const fileType = req.query.fileType as string | undefined;
    if (fileType) {
      conditions.push(eq(brandAssets.fileType, fileType));
    }
    const assetType = req.query.assetType as string | undefined;
    if (assetType) {
      const types = assetType.split(",").filter(t => (CONTENT_ASSET_TYPES as readonly string[]).includes(t));
      if (types.length) conditions.push(inArray(brandAssets.assetType, types));
    }
    const solutionAreaId = req.query.solutionAreaId as string | undefined;
    if (solutionAreaId) {
      const ids = solutionAreaId.split(",").filter(Boolean);
      if (ids.length) {
        const links = await db.select({ assetId: brandAssetSolutionAreas.assetId })
          .from(brandAssetSolutionAreas)
          .where(inArray(brandAssetSolutionAreas.solutionAreaId, ids));
        const matchedIds = Array.from(new Set(links.map(l => l.assetId)));
        if (matchedIds.length === 0) {
          conditions.push(sql`false`);
        } else {
          conditions.push(inArray(brandAssets.id, matchedIds));
        }
      }
    }
    const where = and(...conditions);
    const baseQuery = db.select({
        asset: brandAssets,
        categoryName: brandAssetCategories.name,
      }).from(brandAssets)
      .leftJoin(brandAssetCategories, eq(brandAssets.categoryId, brandAssetCategories.id))
      .where(where)
      .orderBy(desc(brandAssets.createdAt));

    if (!pagination.isPaginated) {
      const rows = await baseQuery;
      return res.json(rows.map(r => ({ ...r.asset, categoryName: r.categoryName })));
    }

    const [{ value: total }] = await db.select({ value: count() }).from(brandAssets).where(where);
    const rows = await baseQuery.limit(pagination.limit).offset(pagination.offset);
    const items = rows.map(r => ({ ...r.asset, categoryName: r.categoryName }));
    res.json(buildPaginatedEnvelope(items, Number(total), pagination));
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
    const [tagLinks, areaLinks] = await Promise.all([
      db.select().from(brandAssetProductTags)
        .where(eq(brandAssetProductTags.assetId, row.id)),
      db.select().from(brandAssetSolutionAreas)
        .where(eq(brandAssetSolutionAreas.assetId, row.id)),
    ]);
    res.json({
      ...row,
      productTagIds: tagLinks.map(t => t.tagId),
      solutionAreaIds: areaLinks.map(a => a.solutionAreaId),
    });
  });

  app.post("/api/brand-assets", async (req, res) => {
    try {
      if (!await guardFeature(req, res, "brandLibrary")) return;
      const ctx = await getRequestContext(req);
      const { name, description, url, categoryId, productTagIds, productIds, tags, fileType, fileUrl, fileSize, assetType, solutionAreaIds, logoVariant, fontFamily, fontWeight, fontStyle, fontUsage } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name is required" });
      const safeAssetType = typeof assetType === "string" && (CONTENT_ASSET_TYPES as readonly string[]).includes(assetType)
        ? (assetType as ContentAssetType)
        : "other";
      const [row] = await db.insert(brandAssets).values({
        id: randomUUID(),
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        name: name.trim(),
        description: description || null,
        url: url || null,
        fileUrl: fileUrl || null,
        fileSize: fileSize ? Number(fileSize) : null,
        categoryId: categoryId || null,
        assetType: safeAssetType,
        fileType: fileType || null,
        productIds: productIds?.length ? productIds : null,
        tags: tags || null,
        logoVariant: logoVariant || null,
        fontFamily: fontFamily || null,
        fontWeight: fontWeight || null,
        fontStyle: fontStyle || null,
        fontUsage: fontUsage || null,
        createdBy: ctx.userId,
      } as InsertBrandAsset).returning();
      if (productTagIds?.length) {
        await db.insert(brandAssetProductTags).values(
          productTagIds.map((tagId: string) => ({ assetId: row.id, tagId }))
        );
      }
      const validAreas = await validSolutionAreaIds(ctx, solutionAreaIds);
      if (validAreas.length) {
        await db.insert(brandAssetSolutionAreas).values(
          validAreas.map(solutionAreaId => ({ assetId: row.id, solutionAreaId }))
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
    const { name, description, url, fileUrl, fileType, fileSize, categoryId, status, productTagIds, productIds, tags, assetType, solutionAreaIds, logoVariant, fontFamily, fontWeight, fontStyle, fontUsage } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (url !== undefined) updates.url = url;
    if (fileUrl !== undefined) updates.fileUrl = fileUrl;
    if (fileType !== undefined) updates.fileType = fileType;
    if (fileSize !== undefined) updates.fileSize = fileSize ? Number(fileSize) : null;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (status !== undefined) updates.status = status;
    if (productIds !== undefined) updates.productIds = productIds?.length ? productIds : null;
    if (tags !== undefined) updates.tags = tags;
    if (assetType !== undefined && (CONTENT_ASSET_TYPES as readonly string[]).includes(assetType)) {
      updates.assetType = assetType;
    }
    if (logoVariant !== undefined) updates.logoVariant = logoVariant || null;
    if (fontFamily !== undefined) updates.fontFamily = fontFamily || null;
    if (fontWeight !== undefined) updates.fontWeight = fontWeight || null;
    if (fontStyle !== undefined) updates.fontStyle = fontStyle || null;
    if (fontUsage !== undefined) updates.fontUsage = fontUsage || null;

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
    if (solutionAreaIds !== undefined) {
      await db.delete(brandAssetSolutionAreas).where(eq(brandAssetSolutionAreas.assetId, row.id));
      const validAreas = await validSolutionAreaIds(ctx, solutionAreaIds);
      if (validAreas.length) {
        await db.insert(brandAssetSolutionAreas).values(
          validAreas.map(solutionAreaId => ({ assetId: row.id, solutionAreaId }))
        );
      }
    }
    res.json(row);
  });

  app.delete("/api/brand-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    const conditions = and(
      eq(brandAssets.id, req.params.id),
      eq(brandAssets.tenantDomain, ctx.tenantDomain),
      eq(brandAssets.marketId, ctx.marketId),
    );
    if (req.query.permanent === "true") {
      const [existing] = await db.select({ status: brandAssets.status }).from(brandAssets).where(conditions);
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (existing.status !== "archived") return res.status(400).json({ error: "Only archived assets can be permanently deleted" });
      await db.delete(brandAssets).where(conditions);
    } else {
      await db.update(brandAssets)
        .set({ status: "archived", updatedAt: new Date() })
        .where(conditions);
    }
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // SOCIAL ACCOUNTS
  // ══════════════════════════════════════════════════════════

  app.get("/api/social-accounts", async (req, res) => {
    if (!await guardFeature(req, res, "socialAccounts")) return;
    const ctx = await getRequestContext(req);
    // Project only the fields the UI needs — never return encrypted token
    // material. Connection state is exposed as a derived `isConnected`
    // boolean. Token expiry / scope strings are also stripped.
    const rows = await db.select({
      id: socialAccounts.id,
      platform: socialAccounts.platform,
      accountName: socialAccounts.accountName,
      accountId: socialAccounts.accountId,
      profileUrl: socialAccounts.profileUrl,
      notes: socialAccounts.notes,
      status: socialAccounts.status,
      authorMode: socialAccounts.authorMode,
      authorUrn: socialAccounts.authorUrn,
      availableAuthors: socialAccounts.availableAuthors,
      connectedAt: socialAccounts.connectedAt,
      tokenExpiresAt: socialAccounts.tokenExpiresAt,
      lastPublishError: socialAccounts.lastPublishError,
      hasAccessToken: sql<boolean>`(${socialAccounts.encryptedAccessToken} IS NOT NULL)`,
    }).from(socialAccounts)
      .where(and(
        eq(socialAccounts.tenantDomain, ctx.tenantDomain),
        eq(socialAccounts.marketId, ctx.marketId),
        eq(socialAccounts.status, "active"),
      ))
      .orderBy(socialAccounts.platform, socialAccounts.accountName);
    // Map hasAccessToken → encryptedAccessToken-shaped boolean field for
    // backward-compatibility with the existing UI which just checks truthiness.
    res.json(rows.map(r => ({
      ...r,
      isConnected: r.hasAccessToken === true,
      // Legacy field name kept as boolean indicator (NEVER ciphertext).
      encryptedAccessToken: r.hasAccessToken ? true : null,
    })));
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
  // ACCOUNT VOICE PROFILES
  // Per-account voice settings used by AI rewrites and the composer.
  // ══════════════════════════════════════════════════════════

  // Helper: validate framework refs against the three allowed source tables
  // and the current tenant. Returns the cleansed list (drops invalid refs
  // silently — the UI will show what it has, but we never persist garbage).
  async function validateFrameworkRefs(
    refs: VoiceFrameworkRef[] | null | undefined,
    ctx: { tenantDomain: string; marketId: string },
  ): Promise<VoiceFrameworkRef[]> {
    if (!Array.isArray(refs) || refs.length === 0) return [];
    const longFormIds = refs.filter(r => r.kind === "long_form").map(r => r.id);
    const groundingIds = refs.filter(r => r.kind === "grounding").map(r => r.id);
    const globalIds = refs.filter(r => r.kind === "global").map(r => r.id);
    const valid = new Set<string>();
    if (longFormIds.length) {
      const rows = await db.select({ id: longFormRecommendations.id })
        .from(longFormRecommendations)
        .where(and(
          inArray(longFormRecommendations.id, longFormIds),
          eq(longFormRecommendations.tenantDomain, ctx.tenantDomain),
          eq(longFormRecommendations.type, "messaging_framework"),
        ));
      rows.forEach(r => valid.add(`long_form:${r.id}`));
    }
    if (groundingIds.length) {
      const rows = await db.select({ id: groundingDocuments.id, contexts: groundingDocuments.contexts })
        .from(groundingDocuments)
        .where(and(
          inArray(groundingDocuments.id, groundingIds),
          eq(groundingDocuments.tenantDomain, ctx.tenantDomain),
        ));
      rows.forEach(r => {
        if (Array.isArray(r.contexts) && r.contexts.includes("marketing_content")) {
          valid.add(`grounding:${r.id}`);
        }
      });
    }
    if (globalIds.length) {
      const rows = await db.select({ id: globalGroundingDocuments.id, category: globalGroundingDocuments.category })
        .from(globalGroundingDocuments)
        .where(and(
          inArray(globalGroundingDocuments.id, globalIds),
          eq(globalGroundingDocuments.isActive, true),
        ));
      rows.forEach(r => {
        if ((MESSAGING_FRAMEWORK_GLOBAL_CATEGORIES as readonly string[]).includes(r.category)) {
          valid.add(`global:${r.id}`);
        }
      });
    }
    // Preserve original ordering, drop invalids.
    return refs.filter(r => valid.has(`${r.kind}:${r.id}`));
  }

  // Helper: load the social account row (tenant-scoped) and its voice profile,
  // if any. Caller handles the missing-account case.
  async function loadAccount(socialAccountId: string, tenantDomain: string) {
    const [account] = await db.select().from(socialAccounts).where(and(
      eq(socialAccounts.id, socialAccountId),
      eq(socialAccounts.tenantDomain, tenantDomain),
    ));
    return account ?? null;
  }
  async function loadVoiceProfile(socialAccountId: string) {
    const [profile] = await db.select().from(socialAccountVoiceProfiles).where(
      eq(socialAccountVoiceProfiles.socialAccountId, socialAccountId),
    );
    return profile ?? null;
  }

  // GET — return the profile, or a synthetic default if none exists yet
  // (avoids forcing the UI to handle 404 vs empty-state separately).
  app.get("/api/social-accounts/:id/voice-profile", async (req, res) => {
    if (!await guardFeature(req, res, "socialAccounts")) return;
    const ctx = await getRequestContext(req);
    const account = await loadAccount(req.params.id, ctx.tenantDomain);
    if (!account) return res.status(404).json({ error: "Social account not found" });
    const profile = await loadVoiceProfile(account.id);
    if (profile) return res.json(profile);
    // Synthetic default — does NOT create a row. UI saves to materialize.
    res.json({
      socialAccountId: account.id,
      tenantDomain: account.tenantDomain,
      person: account.authorMode === "organization" ? "third" : "first",
      authorPerspective: account.authorMode === "organization" ? "brand" : "individual",
      toneAttributes: null,
      styleGuidance: null,
      forbiddenPhrases: null,
      preferredPhrases: null,
      emojiPolicy: "sparing",
      hashtagPolicy: "standard",
      maxLength: null,
      sampleSnippets: [],
      defaultPersonaId: null,
      defaultFrameworkRefs: [],
      isUnsaved: true,
    });
  });

  // PUT — upsert. We accept the full profile shape; partial fields default
  // to current row values (or sensible defaults on first save).
  app.put("/api/social-accounts/:id/voice-profile", async (req, res) => {
    if (!await guardFeature(req, res, "socialAccounts")) return;
    const ctx = await getRequestContext(req);
    const account = await loadAccount(req.params.id, ctx.tenantDomain);
    if (!account) return res.status(404).json({ error: "Social account not found" });
    const profile = await loadVoiceProfile(account.id);

    const body = req.body ?? {};
    const person = (VOICE_PERSON_OPTIONS as readonly string[]).includes(body.person)
      ? body.person : (profile?.person ?? (account.authorMode === "organization" ? "third" : "first"));
    const authorPerspective = (VOICE_AUTHOR_PERSPECTIVES as readonly string[]).includes(body.authorPerspective)
      ? body.authorPerspective : (profile?.authorPerspective ?? (account.authorMode === "organization" ? "brand" : "individual"));
    const emojiPolicy = (VOICE_EMOJI_POLICIES as readonly string[]).includes(body.emojiPolicy)
      ? body.emojiPolicy : (profile?.emojiPolicy ?? "sparing");
    const hashtagPolicy = (VOICE_HASHTAG_POLICIES as readonly string[]).includes(body.hashtagPolicy)
      ? body.hashtagPolicy : (profile?.hashtagPolicy ?? "standard");

    // Sanitize string arrays: trim, drop empties, dedupe, cap length. The
    // caller passes the prior value so each field falls back to its OWN
    // previous value when the incoming payload is malformed (i.e., not an
    // array) — without this, a malformed preferredPhrases would
    // incorrectly inherit forbiddenPhrases.
    const cleanStrArray = (
      v: unknown,
      prior: string[] | null | undefined,
      max = 50,
    ): string[] | null => {
      if (v === null) return null;
      if (!Array.isArray(v)) return prior ?? null;
      const out: string[] = [];
      const seen = new Set<string>();
      for (const item of v) {
        if (typeof item !== "string") continue;
        const t = item.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
        if (out.length >= max) break;
      }
      return out;
    };

    const sampleSnippets: VoiceSampleSnippet[] = Array.isArray(body.sampleSnippets)
      ? body.sampleSnippets
          .filter((s: any) => s && typeof s.content === "string" && s.content.trim().length > 0)
          .slice(0, 10)
          .map((s: any) => ({ label: typeof s.label === "string" ? s.label.slice(0, 80) : undefined, content: s.content.slice(0, 1000) }))
      : (profile?.sampleSnippets ?? []);

    // Validate persona belongs to this tenant (if supplied).
    let defaultPersonaId: string | null = null;
    if (typeof body.defaultPersonaId === "string" && body.defaultPersonaId) {
      const [persona] = await db.select({ id: personas.id }).from(personas).where(and(
        eq(personas.id, body.defaultPersonaId),
        eq(personas.tenantDomain, ctx.tenantDomain),
      ));
      if (persona) defaultPersonaId = persona.id;
    } else if (body.defaultPersonaId === null) {
      defaultPersonaId = null;
    } else {
      defaultPersonaId = profile?.defaultPersonaId ?? null;
    }

    const defaultFrameworkRefs = body.defaultFrameworkRefs !== undefined
      ? await validateFrameworkRefs(body.defaultFrameworkRefs, ctx)
      : (profile?.defaultFrameworkRefs ?? []);

    const toneAttributes: VoiceToneAttributes | null =
      body.toneAttributes && typeof body.toneAttributes === "object"
        ? Object.fromEntries(
            Object.entries(body.toneAttributes)
              .filter(([, v]) => typeof v === "number" && !Number.isNaN(v))
              .map(([k, v]) => [k, Math.max(0, Math.min(1, v as number))])
          )
        : (body.toneAttributes === null ? null : (profile?.toneAttributes ?? null));

    const maxLength: number | null = typeof body.maxLength === "number" && body.maxLength > 0
      ? Math.floor(body.maxLength)
      : (body.maxLength === null ? null : (profile?.maxLength ?? null));

    const values = {
      socialAccountId: account.id,
      tenantDomain: ctx.tenantDomain,
      person,
      authorPerspective,
      toneAttributes,
      styleGuidance: typeof body.styleGuidance === "string"
        ? body.styleGuidance.slice(0, 4000)
        : (body.styleGuidance === null ? null : (profile?.styleGuidance ?? null)),
      forbiddenPhrases: body.forbiddenPhrases !== undefined ? cleanStrArray(body.forbiddenPhrases, profile?.forbiddenPhrases) : (profile?.forbiddenPhrases ?? null),
      preferredPhrases: body.preferredPhrases !== undefined ? cleanStrArray(body.preferredPhrases, profile?.preferredPhrases) : (profile?.preferredPhrases ?? null),
      emojiPolicy,
      hashtagPolicy,
      maxLength,
      sampleSnippets,
      defaultPersonaId,
      defaultFrameworkRefs,
      createdBy: profile?.createdBy ?? ctx.userId,
      updatedAt: new Date(),
    };

    if (profile) {
      const [row] = await db.update(socialAccountVoiceProfiles)
        .set(values)
        .where(eq(socialAccountVoiceProfiles.id, profile.id))
        .returning();
      return res.json(row);
    }
    const [row] = await db.insert(socialAccountVoiceProfiles)
      .values({ id: randomUUID(), ...values } as InsertSocialAccountVoiceProfile)
      .returning();
    res.status(201).json(row);
  });

  // DELETE — reset to defaults by removing the row. Next GET returns the
  // synthetic default again. Safe because no FK from generatedPosts (we
  // snapshot voice into the post row at schedule time).
  app.delete("/api/social-accounts/:id/voice-profile", async (req, res) => {
    if (!await guardFeature(req, res, "socialAccounts")) return;
    const ctx = await getRequestContext(req);
    const account = await loadAccount(req.params.id, ctx.tenantDomain);
    if (!account) return res.status(404).json({ error: "Social account not found" });
    await db.delete(socialAccountVoiceProfiles)
      .where(eq(socialAccountVoiceProfiles.socialAccountId, account.id));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // MESSAGING FRAMEWORK PICKER (unified across three sources)
  // Returns long-form messaging frameworks, marketing-tagged grounding
  // documents, and global brand-voice/marketing-guideline docs in one list,
  // tenant-scoped where applicable. Used by the voice profile defaults and
  // (later) the composer's per-rewrite framework picker.
  // ══════════════════════════════════════════════════════════
  app.get("/api/messaging-frameworks/available", async (req, res) => {
    if (!await guardFeature(req, res, "socialAccounts")) return;
    const ctx = await getRequestContext(req);

    const [longForm, grounding, global] = await Promise.all([
      db.select({
        id: longFormRecommendations.id,
        label: sql<string>`COALESCE(NULLIF(${longFormRecommendations.type}, ''), 'Messaging Framework')`,
        marketId: longFormRecommendations.marketId,
        updatedAt: longFormRecommendations.updatedAt,
      }).from(longFormRecommendations)
        .where(and(
          eq(longFormRecommendations.tenantDomain, ctx.tenantDomain),
          eq(longFormRecommendations.type, "messaging_framework"),
          eq(longFormRecommendations.status, "generated"),
        )),
      db.select({
        id: groundingDocuments.id,
        name: groundingDocuments.name,
        scope: groundingDocuments.scope,
        marketId: groundingDocuments.marketId,
        contexts: groundingDocuments.contexts,
        updatedAt: groundingDocuments.updatedAt,
      }).from(groundingDocuments)
        .where(eq(groundingDocuments.tenantDomain, ctx.tenantDomain)),
      db.select({
        id: globalGroundingDocuments.id,
        name: globalGroundingDocuments.name,
        category: globalGroundingDocuments.category,
        updatedAt: globalGroundingDocuments.updatedAt,
      }).from(globalGroundingDocuments)
        .where(and(
          eq(globalGroundingDocuments.isActive, true),
          inArray(globalGroundingDocuments.category, MESSAGING_FRAMEWORK_GLOBAL_CATEGORIES as unknown as string[]),
        )),
    ]);

    const items = [
      ...longForm.map(r => ({
        kind: "long_form" as const,
        id: r.id,
        label: "Messaging Framework",
        scope: r.marketId === ctx.marketId ? "market" : "tenant",
        marketScoped: r.marketId === ctx.marketId,
        updatedAt: r.updatedAt,
      })),
      ...grounding
        .filter(r => Array.isArray(r.contexts) && r.contexts.includes("marketing_content"))
        .map(r => ({
          kind: "grounding" as const,
          id: r.id,
          label: r.name,
          scope: r.marketId ? (r.marketId === ctx.marketId ? "market" : "tenant") : "tenant",
          marketScoped: r.marketId === ctx.marketId,
          updatedAt: r.updatedAt,
        })),
      ...global.map(r => ({
        kind: "global" as const,
        id: r.id,
        label: r.name,
        category: r.category,
        scope: "global",
        marketScoped: false,
        updatedAt: r.updatedAt,
      })),
    ];

    // Market-scoped first, then tenant, then global. Secondary sort by recency.
    const scopeRank = { market: 0, tenant: 1, global: 2 } as const;
    items.sort((a, b) => {
      const sa = scopeRank[(a.scope as keyof typeof scopeRank)] ?? 3;
      const sb = scopeRank[(b.scope as keyof typeof scopeRank)] ?? 3;
      if (sa !== sb) return sa - sb;
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    });

    res.json({ items });
  });

  // ══════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ══════════════════════════════════════════════════════════

  app.get("/api/campaigns", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
      const ctx = await getRequestContext(req);
      const conditions = [
        eq(campaigns.tenantDomain, ctx.tenantDomain),
        eq(campaigns.marketId, ctx.marketId),
        ne(campaigns.status, "deleted"),
      ];
      const pagination = parsePaginationParams(req);
      if (pagination.q) {
        const pattern = toContainsPattern(pagination.q);
        conditions.push(or(
          ilike(campaigns.name, pattern),
          ilike(campaigns.description, pattern),
        )!);
      }
      const solutionAreaId = req.query.solutionAreaId as string | undefined;
      if (solutionAreaId) {
        const ids = solutionAreaId.split(",").filter(Boolean);
        if (ids.length) {
          const links = await db.select({ campaignId: campaignSolutionAreas.campaignId })
            .from(campaignSolutionAreas)
            .where(inArray(campaignSolutionAreas.solutionAreaId, ids));
          const matchedIds = Array.from(new Set(links.map(l => l.campaignId)));
          if (matchedIds.length === 0) {
            conditions.push(sql`false`);
          } else {
            conditions.push(inArray(campaigns.id, matchedIds));
          }
        }
      }
      const where = and(...conditions);

      if (!pagination.isPaginated) {
        const rows = await db.select().from(campaigns)
          .where(where)
          .orderBy(desc(campaigns.createdAt));
        return res.json(rows);
      }

      const [{ value: total }] = await db.select({ value: count() }).from(campaigns).where(where);
      const items = await db.select().from(campaigns)
        .where(where)
        .orderBy(desc(campaigns.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset);
      res.json(buildPaginatedEnvelope(items, Number(total), pagination));
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
          eq(campaigns.marketId, ctx.marketId),
          ne(campaigns.status, "deleted"),
        ));
      if (!campaign) return res.status(404).json({ error: "Not found" });

      const [assets, socialAccts, areaLinks] = await Promise.all([
        db.select().from(campaignAssets)
          .where(eq(campaignAssets.campaignId, campaign.id))
          .orderBy(campaignAssets.sortOrder),
        db.select().from(campaignSocialAccounts)
          .where(eq(campaignSocialAccounts.campaignId, campaign.id)),
        db.select().from(campaignSolutionAreas)
          .where(eq(campaignSolutionAreas.campaignId, campaign.id)),
      ]);

      res.json({
        ...campaign,
        assets,
        socialAccounts: socialAccts,
        solutionAreaIds: areaLinks.map(a => a.solutionAreaId),
      });
    } catch (err: any) {
      console.error("[Campaign Detail Error]", err.message);
      res.status(500).json({ error: "Failed to load campaign" });
    }
  });

  app.post("/api/campaigns", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
      const ctx = await getRequestContext(req);
      const { name, description, startDate, endDate, numberOfDays, includeSaturday, includeSunday, assetIds, socialAccountIds, productIds, solutionAreaIds } = req.body;
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

        if (Array.isArray(solutionAreaIds) && solutionAreaIds.length > 0) {
          const validAreas = await tx.select({ id: solutionAreas.id }).from(solutionAreas)
            .where(and(
              inArray(solutionAreas.id, solutionAreaIds),
              eq(solutionAreas.tenantDomain, ctx.tenantDomain),
              eq(solutionAreas.marketId, ctx.marketId),
            ));
          if (validAreas.length > 0) {
            await tx.insert(campaignSolutionAreas).values(
              validAreas.map(a => ({ campaignId, solutionAreaId: a.id }))
            );
          }
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
    try {
      if (!await guardFeature(req, res, "campaigns")) return;
      const ctx = await getRequestContext(req);
      const { name, description, status, startDate, endDate, numberOfDays, includeSaturday, includeSunday, productIds, alwaysHashtags, solutionAreaIds } = req.body;
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
      if (alwaysHashtags !== undefined) updateData.alwaysHashtags = Array.isArray(alwaysHashtags) ? alwaysHashtags : [];
      const [row] = await db.update(campaigns)
        .set(updateData)
        .where(and(
          eq(campaigns.id, req.params.id),
          eq(campaigns.tenantDomain, ctx.tenantDomain),
          eq(campaigns.marketId, ctx.marketId),
        ))
        .returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      if (solutionAreaIds !== undefined) {
        await db.delete(campaignSolutionAreas).where(eq(campaignSolutionAreas.campaignId, row.id));
        const validAreas = await validSolutionAreaIds(ctx, solutionAreaIds);
        if (validAreas.length > 0) {
          await db.insert(campaignSolutionAreas).values(
            validAreas.map(solutionAreaId => ({ campaignId: row.id, solutionAreaId }))
          );
        }
      }
      res.json(row);
    } catch (err: any) {
      console.error("[PATCH /api/campaigns/:id]", err);
      res.status(500).json({ error: "Failed to update campaign", detail: err?.message });
    }
  });

  app.delete("/api/campaigns/:id", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
      const ctx = await getRequestContext(req);
      await db.update(campaigns)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(and(
          eq(campaigns.id, req.params.id),
          eq(campaigns.tenantDomain, ctx.tenantDomain),
        ));
      res.status(204).send();
    } catch (err: any) {
      console.error("[Campaign Delete Error]", err.message);
      res.status(500).json({ error: "Failed to delete campaign" });
    }
  });

  // Campaign Duplication
  app.post("/api/campaigns/:id/duplicate", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
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

        const sourceAreas = await tx.select().from(campaignSolutionAreas)
          .where(eq(campaignSolutionAreas.campaignId, source.id));
        if (sourceAreas.length > 0) {
          await tx.insert(campaignSolutionAreas).values(
            sourceAreas.map(a => ({ campaignId: newId, solutionAreaId: a.solutionAreaId }))
          );
        }
      });

      const [row] = await db.select().from(campaigns).where(eq(campaigns.id, newId));
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[Campaign Duplicate Error]", err.message);
      res.status(500).json({ error: "Failed to duplicate campaign" });
    }
  });

  // Campaign Assets

  app.post("/api/campaigns/:id/assets", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
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
    } catch (err: any) {
      console.error("[Campaign Assets Add Error]", err.message);
      res.status(500).json({ error: "Failed to add campaign assets" });
    }
  });

  app.patch("/api/campaigns/:campaignId/assets/:assetId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
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
    } catch (err: any) {
      console.error("[Campaign Asset Update Error]", err.message);
      res.status(500).json({ error: "Failed to update campaign asset" });
    }
  });

  app.delete("/api/campaigns/:campaignId/assets/:assetId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
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
    } catch (err: any) {
      console.error("[Campaign Asset Delete Error]", err.message);
      res.status(500).json({ error: "Failed to remove campaign asset" });
    }
  });

  // Campaign Social Accounts

  app.post("/api/campaigns/:id/social-accounts", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
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
    } catch (err: any) {
      console.error("[Campaign Social Account Add Error]", err.message);
      res.status(500).json({ error: "Failed to add social account to campaign" });
    }
  });

  app.patch("/api/campaigns/:campaignId/social-accounts/:accountId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
      const ctx = await getRequestContext(req);
      const [campaign] = await db.select().from(campaigns)
        .where(and(eq(campaigns.id, req.params.campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const updates: any = {};
      if (typeof req.body?.autoPublish === "boolean") updates.autoPublish = req.body.autoPublish;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No supported fields to update" });
      await db.update(campaignSocialAccounts).set(updates)
        .where(and(
          eq(campaignSocialAccounts.campaignId, campaign.id),
          eq(campaignSocialAccounts.socialAccountId, req.params.accountId),
        ));
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Campaign Social Account Patch Error]", err.message);
      res.status(500).json({ error: "Failed to update campaign social account" });
    }
  });

  app.delete("/api/campaigns/:campaignId/social-accounts/:accountId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
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
    } catch (err: any) {
      console.error("[Campaign Social Account Delete Error]", err.message);
      res.status(500).json({ error: "Failed to remove social account from campaign" });
    }
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

  app.put("/api/campaigns/:campaignId/generated-posts/bulk-status", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [campaign] = await db.select().from(campaigns)
        .where(and(eq(campaigns.id, req.params.campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const { status } = req.body;
      if (!status || !["approved", "rejected"].includes(status)) {
        return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
      }
      if (status === "rejected") {
        const rows = await db.delete(generatedPosts)
          .where(and(
            eq(generatedPosts.campaignId, campaign.id),
            ne(generatedPosts.status, "approved"),
          ))
          .returning();
        res.json({ updated: rows.length });
      } else {
        const rows = await db.update(generatedPosts)
          .set({ status, updatedAt: new Date() })
          .where(and(
            eq(generatedPosts.campaignId, campaign.id),
            ne(generatedPosts.status, "deleted"),
            ne(generatedPosts.status, status),
          ))
          .returning();
        res.json({ updated: rows.length });
      }
    } catch (err: any) {
      console.error("[Generated Posts Bulk Status Error]", err.message);
      res.status(500).json({ error: "Failed to update posts status" });
    }
  });

  app.put("/api/campaigns/:campaignId/generated-posts/:postId", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [campaign] = await db.select().from(campaigns)
        .where(and(eq(campaigns.id, req.params.campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const { editedContent, status, overrideImageUrl, overrideBrandAssetId, scheduledDate, hashtags } = req.body;
      if (status === "rejected" || status === "deleted") {
        await db.delete(generatedPosts)
          .where(and(eq(generatedPosts.id, req.params.postId), eq(generatedPosts.campaignId, campaign.id)));
        return res.json({ id: req.params.postId, status });
      }
      const updateFields: any = { updatedAt: new Date() };
      if (editedContent !== undefined) updateFields.editedContent = editedContent;
      if (status !== undefined) updateFields.status = status;
      if (overrideImageUrl !== undefined) updateFields.overrideImageUrl = overrideImageUrl || null;
      if (overrideBrandAssetId !== undefined) updateFields.overrideBrandAssetId = overrideBrandAssetId || null;
      if (scheduledDate !== undefined) updateFields.scheduledDate = scheduledDate ? new Date(scheduledDate) : null;
      if (hashtags !== undefined) updateFields.hashtags = Array.isArray(hashtags) ? hashtags : [];
      const [row] = await db.update(generatedPosts)
        .set(updateFields)
        .where(and(eq(generatedPosts.id, req.params.postId), eq(generatedPosts.campaignId, campaign.id)))
        .returning();
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[Generated Post Update Error]", err.message);
      res.status(500).json({ error: "Failed to update generated post" });
    }
  });

  app.delete("/api/campaigns/:campaignId/generated-posts/:postId", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [campaign] = await db.select().from(campaigns)
        .where(and(eq(campaigns.id, req.params.campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      await db.delete(generatedPosts)
        .where(and(eq(generatedPosts.id, req.params.postId), eq(generatedPosts.campaignId, campaign.id)));
      res.status(204).send();
    } catch (err: any) {
      console.error("[Generated Post Delete Error]", err.message);
      res.status(500).json({ error: "Failed to delete generated post" });
    }
  });

  // ══════════════════════════════════════════════════════════
  // MANUAL POST CREATION
  // ══════════════════════════════════════════════════════════

  app.post("/api/campaigns/:id/create-posts", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [campaign] = await db.select().from(campaigns)
        .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const { content, socialAccountIds, scheduledDate, overrideBrandAssetId, aiPolish } = req.body;
      if (!content || typeof content !== "string" || content.trim().length === 0) {
        return res.status(400).json({ error: "Post content is required" });
      }
      if (!Array.isArray(socialAccountIds) || socialAccountIds.length === 0) {
        return res.status(400).json({ error: "At least one social account must be selected" });
      }

      let parsedScheduledDate: Date | undefined;
      if (scheduledDate) {
        parsedScheduledDate = new Date(scheduledDate);
        if (isNaN(parsedScheduledDate.getTime())) {
          return res.status(400).json({ error: "Invalid scheduled date" });
        }
      }

      let validBrandAssetId: string | undefined;
      if (overrideBrandAssetId) {
        const [asset] = await db.select({ id: brandAssets.id }).from(brandAssets)
          .where(and(
            eq(brandAssets.id, overrideBrandAssetId),
            eq(brandAssets.tenantDomain, ctx.tenantDomain),
          ));
        if (!asset) {
          return res.status(400).json({ error: "Invalid brand asset" });
        }
        validBrandAssetId = asset.id;
      }

      const linkedSocialIds = (await db.select().from(campaignSocialAccounts)
        .where(eq(campaignSocialAccounts.campaignId, campaign.id)))
        .map(cs => cs.socialAccountId);

      const validAccountIds = socialAccountIds.filter((sid: string) => linkedSocialIds.includes(sid));
      if (validAccountIds.length === 0) {
        return res.status(400).json({ error: "No valid linked social accounts found" });
      }

      const selectedAccounts = await db.select().from(socialAccounts)
        .where(and(
          eq(socialAccounts.tenantDomain, ctx.tenantDomain),
          eq(socialAccounts.marketId, ctx.marketId),
          inArray(socialAccounts.id, validAccountIds),
        ));

      if (selectedAccounts.length === 0) {
        return res.status(400).json({ error: "No valid linked social accounts found" });
      }

      const baseText = content.trim();
      const variantGroupId = randomUUID();
      const rows: InsertGeneratedPost[] = [];

      const campaignAlwaysHashtags = (campaign.alwaysHashtags as string[] || [])
        .map((h: string) => h.replace(/^#/, "").replace(/\s+/g, "").trim())
        .filter((h: string) => h.length > 0);

      let groundingContext: string | null = null;
      if (aiPolish) {
        groundingContext = await loadGroundingContext(ctx.tenantDomain, ctx.marketId);
      }

      for (const account of selectedAccounts) {
        let postContent = baseText;

        if (aiPolish) {
          try {
            const platformGuide = getPlatformGuide(account.platform);
            const polishPrompt = `You are an expert social media copywriter. Adapt the following post text for ${account.platform} (account: "${account.accountName}").

RULES:
1. Keep the core message and intent intact — do NOT rewrite from scratch.
2. Adjust tone, length, and style to fit the platform.
3. Suggest relevant hashtags.
4. ${account.platform === "twitter" ? "Twitter/X has a HARD 280 CHARACTER LIMIT for content + hashtags combined. Keep post body under 180 characters to leave room for hashtags and URL. One punchy sentence + URL is ideal." : "Follow platform guidelines."}
5. Do NOT add placeholder text or instructions.
6. Include any URL ONCE only — never duplicate it in the post.

${groundingContext ? `## Brand Guidelines\n${groundingContext}\n\n` : ""}## Platform Guidelines
${platformGuide}

## Original Post Text
${baseText}

Return ONLY a valid JSON object (no markdown fences) with:
- "content": string (the adapted post body, no inline hashtags)
- "hashtags": string[] (3-5 relevant hashtags, each a single camelCase word, no # prefix)`;

            const result = await completeForFeature("marketing_tasks", polishPrompt);
            try {
              const parsed = JSON.parse(result.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
              if (parsed.content) postContent = parsed.content;
              let hashtags = (parsed.hashtags ?? [])
                .map((h: string) => h.replace(/^#/, "").replace(/\s+/g, "").trim())
                .filter((h: string) => h.length > 0 && h.length < 50);
              if (campaignAlwaysHashtags.length > 0) {
                const existing = new Set(hashtags.map((h: string) => h.toLowerCase()));
                for (const ah of campaignAlwaysHashtags) {
                  if (!existing.has(ah.toLowerCase())) hashtags.push(ah);
                }
              }
              const adapted = applyPlatformRules(postContent, account.platform, hashtags);

              rows.push({
                id: randomUUID(),
                campaignId: campaign.id,
                socialAccountId: account.id,
                tenantDomain: ctx.tenantDomain,
                platform: account.platform,
                content: adapted.content,
                hashtags: adapted.hashtags,
                variantGroup: variantGroupId,
                scheduledDate: parsedScheduledDate,
                overrideBrandAssetId: validBrandAssetId,
                status: "draft",
              } as InsertGeneratedPost);
              continue;
            } catch (parseErr: any) {
              console.warn(`[Manual Post] AI polish JSON parse failed for ${account.platform}, falling back to plain text:`, parseErr.message);
            }
          } catch (aiErr: any) {
            console.warn(`[Manual Post] AI polish call failed for ${account.platform}, falling back to plain text:`, aiErr.message);
          }
        }

        // Non-AI path: apply basic platform rules
        const adapted = applyPlatformRules(baseText, account.platform, [...campaignAlwaysHashtags]);

        rows.push({
          id: randomUUID(),
          campaignId: campaign.id,
          socialAccountId: account.id,
          tenantDomain: ctx.tenantDomain,
          platform: account.platform,
          content: adapted.content,
          hashtags: adapted.hashtags,
          variantGroup: variantGroupId,
          scheduledDate: parsedScheduledDate,
          overrideBrandAssetId: validBrandAssetId,
          status: "draft",
        } as InsertGeneratedPost);
      }

      if (rows.length > 0) {
        await db.insert(generatedPosts).values(rows);
      }

      res.status(201).json({ created: rows.length, posts: rows });
    } catch (err: any) {
      console.error("[Manual Post Creation Error]", err.message);
      res.status(500).json({ error: "Failed to create posts" });
    }
  });

  // ══════════════════════════════════════════════════════════
  // CAMPAIGN ASSET SUGGESTIONS — discover content + brand assets
  // tagged to the given solution areas (and optionally products),
  // grouped by assetType so the campaign wizard can offer one-click
  // "Assemble from solution area" assembly across types.
  // ══════════════════════════════════════════════════════════

  app.get("/api/campaigns/asset-suggestions", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
      const ctx = await getRequestContext(req);
      // Param names mirror the other list endpoints: singular query string,
      // comma-separated values.
      const solutionAreaIds = ((req.query.solutionAreaId as string | undefined) || "")
        .split(",").map(s => s.trim()).filter(Boolean);
      const productIds = ((req.query.productId as string | undefined) || "")
        .split(",").map(s => s.trim()).filter(Boolean);
      const assetTypesParam = ((req.query.assetType as string | undefined) || "")
        .split(",").map(s => s.trim())
        .filter(t => (CONTENT_ASSET_TYPES as readonly string[]).includes(t));
      const limitPerType = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || "50", 10) || 50));

      // Solution-area filter: assets must be linked to AT LEAST ONE of the areas.
      // No areas given → don't constrain on solution-area membership.
      let contentAreaMatch: Set<string> | null = null;
      let brandAreaMatch: Set<string> | null = null;
      if (solutionAreaIds.length > 0) {
        const [cLinks, bLinks] = await Promise.all([
          db.select({ assetId: contentAssetSolutionAreas.assetId })
            .from(contentAssetSolutionAreas)
            .where(inArray(contentAssetSolutionAreas.solutionAreaId, solutionAreaIds)),
          db.select({ assetId: brandAssetSolutionAreas.assetId })
            .from(brandAssetSolutionAreas)
            .where(inArray(brandAssetSolutionAreas.solutionAreaId, solutionAreaIds)),
        ]);
        contentAreaMatch = new Set(cLinks.map(l => l.assetId));
        brandAreaMatch = new Set(bLinks.map(l => l.assetId));
      }

      const contentConditions: any[] = [
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
        eq(contentAssets.marketId, ctx.marketId),
        eq(contentAssets.status, "active"),
      ];
      if (contentAreaMatch) {
        if (contentAreaMatch.size === 0) contentConditions.push(sql`false`);
        else contentConditions.push(inArray(contentAssets.id, Array.from(contentAreaMatch)));
      }
      if (assetTypesParam.length > 0) {
        contentConditions.push(inArray(contentAssets.assetType, assetTypesParam));
      }
      if (productIds.length > 0) {
        const productLiterals = sql.join(productIds.map(p => sql`${p}`), sql`, `);
        contentConditions.push(sql`${contentAssets.productIds} && ARRAY[${productLiterals}]::text[]`);
      }

      const brandConditions: any[] = [
        eq(brandAssets.tenantDomain, ctx.tenantDomain),
        eq(brandAssets.marketId, ctx.marketId),
        ne(brandAssets.status, "archived"),
      ];
      if (brandAreaMatch) {
        if (brandAreaMatch.size === 0) brandConditions.push(sql`false`);
        else brandConditions.push(inArray(brandAssets.id, Array.from(brandAreaMatch)));
      }
      if (assetTypesParam.length > 0) {
        brandConditions.push(inArray(brandAssets.assetType, assetTypesParam));
      }
      if (productIds.length > 0) {
        const productLiterals = sql.join(productIds.map(p => sql`${p}`), sql`, `);
        brandConditions.push(sql`${brandAssets.productIds} && ARRAY[${productLiterals}]::text[]`);
      }

      // Pull a generous slice from each table; we'll bucket and cap per-type below.
      const maxPerTable = limitPerType * (CONTENT_ASSET_TYPES.length);
      const [contentRows, brandRows] = await Promise.all([
        db.select().from(contentAssets)
          .where(and(...contentConditions))
          .orderBy(desc(contentAssets.createdAt))
          .limit(maxPerTable),
        db.select().from(brandAssets)
          .where(and(...brandConditions))
          .orderBy(desc(brandAssets.createdAt))
          .limit(maxPerTable),
      ]);

      const byType: Record<string, { content: any[]; brand: any[] }> = {};
      for (const t of CONTENT_ASSET_TYPES) byType[t] = { content: [], brand: [] };
      for (const row of contentRows) {
        const t = (row.assetType || "other") as ContentAssetType;
        const bucket = byType[t] || byType.other;
        if (bucket.content.length < limitPerType) bucket.content.push(row);
      }
      for (const row of brandRows) {
        const t = (row.assetType || "other") as ContentAssetType;
        const bucket = byType[t] || byType.other;
        if (bucket.brand.length < limitPerType) bucket.brand.push(row);
      }

      res.json({
        byType,
        totals: {
          content: contentRows.length,
          brand: brandRows.length,
        },
        appliedFilters: {
          solutionAreaIds,
          productIds,
          assetTypes: assetTypesParam,
          limitPerType,
        },
      });
    } catch (err: any) {
      console.error("[asset-suggestions]", err.message);
      res.status(500).json({ error: "Failed to load asset suggestions" });
    }
  });

  // ══════════════════════════════════════════════════════════
  // POST GENERATION — async via job queue
  // ══════════════════════════════════════════════════════════

  app.post("/api/campaigns/:id/generate-posts", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    if (!await guardManualAction(req, res, "aiPostGen")) return;
    try {
      const ctx = await getRequestContext(req);

      const [campaign] = await db.select().from(campaigns)
        .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const brandImageIds: string[] = Array.isArray(req.body?.brandImageIds) ? req.body.brandImageIds : [];
      const personaIds: string[] = Array.isArray(req.body?.personaIds) ? req.body.personaIds : [];
      const thematicBrief: string = typeof req.body?.thematicBrief === "string" ? req.body.thematicBrief.trim() : "";
      const thematicUrl: string = typeof req.body?.thematicUrl === "string" ? req.body.thematicUrl.trim() : "";
      const useThematicMode: boolean = !!(thematicBrief);
      // Default on: each source content asset's lead image becomes one of
      // the image variants for posts drafted from that asset. Callers can
      // opt out by sending { includeAssetLeadImages: false }.
      const includeAssetLeadImages: boolean = req.body?.includeAssetLeadImages !== false;

      await db.delete(generatedPosts)
        .where(and(
          eq(generatedPosts.campaignId, campaign.id),
          inArray(generatedPosts.status, ["deleted", "rejected"]),
        ));

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

      const wrapLinks: boolean = !!req.body?.wrapLinks;
      const reqHost = req.get("host") || undefined;
      const reqProtocol = req.protocol;
      const ownerUserId = ctx.userId;

      // Kick off async generation via job queue (fire-and-forget at the HTTP
      // layer; the queue runs the work and exposes live progress).
      enqueue(
        "analysis",
        `campaign-posts:${campaign.id}`,
        (_signal, reportProgress) => generatePostsAsync(
          campaign.id,
          ctx.tenantDomain,
          ctx.marketId,
          job.id,
          brandImageIds,
          personaIds,
          useThematicMode ? thematicBrief : "",
          useThematicMode ? thematicUrl : "",
          { wrapLinks, ownerUserId, redirectProtocol: reqProtocol, redirectHost: reqHost, includeAssetLeadImages },
          reportProgress,
        ),
        { ctx: { tenantDomain: ctx.tenantDomain, targetId: campaign.id, targetName: campaign.name } },
      ).catch(err => {
        console.error("[Saturn] Post generation error:", err.message);
      });

      res.status(202).json({ jobId: job.id, status: "pending" });
    } catch (err: any) {
      console.error("[Generate Posts Error]", err.message);
      res.status(500).json({ error: "Failed to start post generation" });
    }
  });

  app.get("/api/campaigns/:id/generate-posts-status", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [campaign] = await db.select().from(campaigns)
        .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      if (!campaign.postGenerationJobId) return res.json({ status: "idle" });
      const [job] = await db.select().from(scheduledJobRuns)
        .where(eq(scheduledJobRuns.id, campaign.postGenerationJobId));
      res.json({ status: job?.status ?? "unknown", jobId: campaign.postGenerationJobId });
    } catch (err: any) {
      console.error("[Generate Posts Status Error]", err.message);
      res.status(500).json({ error: "Failed to get post generation status" });
    }
  });

  app.get("/api/campaigns/:id/export-preview", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [campaign] = await db.select().from(campaigns)
        .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const allPosts = await db.select().from(generatedPosts)
        .where(and(
          eq(generatedPosts.campaignId, campaign.id),
          notInArray(generatedPosts.status, ["deleted", "rejected"]),
        ));

      const now = new Date();
      const dated = allPosts.filter(p => p.scheduledDate && new Date(p.scheduledDate) >= now);
      const undated = allPosts.filter(p => !p.scheduledDate || new Date(p.scheduledDate) < now);

      const campaignAccountLinks = await db.select().from(campaignSocialAccounts)
        .where(eq(campaignSocialAccounts.campaignId, campaign.id));
      const campaignAccountIds = campaignAccountLinks.map(l => l.socialAccountId);
      const allAccountIds = Array.from(new Set([
        ...allPosts.map(p => p.socialAccountId).filter(Boolean),
        ...campaignAccountIds,
      ])) as string[];
      const accountMap = new Map<string, any>();
      if (allAccountIds.length) {
        const accts = await db.select().from(socialAccounts).where(inArray(socialAccounts.id, allAccountIds));
        for (const a of accts) accountMap.set(a.id, a);
      }
      const platformAccountFallback = new Map<string, string>();
      for (const link of campaignAccountLinks) {
        const acct = accountMap.get(link.socialAccountId);
        if (acct?.accountId && acct.platform && !platformAccountFallback.has(acct.platform)) {
          platformAccountFallback.set(acct.platform, acct.accountId);
        }
      }

      const getAcctId = (post: any) => {
        if (post.socialAccountId) {
          const acct = accountMap.get(post.socialAccountId);
          if (acct?.accountId) return acct.accountId;
        }
        return platformAccountFallback.get(post.platform) || post.platform;
      };

      let collisions = 0;
      const slotMap = new Map<string, number>();
      for (const p of dated) {
        const key = `${new Date(p.scheduledDate!).toISOString()}|${getAcctId(p)}`;
        const count = (slotMap.get(key) || 0) + 1;
        slotMap.set(key, count);
        if (count > 1) collisions++;
      }

      res.json({
        totalPosts: allPosts.length,
        datedPosts: dated.length,
        undatedPosts: undated.length,
        collisions,
      });
    } catch (err: any) {
      console.error("[Export Preview Error]", err.message);
      res.status(500).json({ error: "Failed to load export preview" });
    }
  });

  app.post("/api/campaigns/:id/export-csv", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const excludeUndated = req.query.excludeUndated !== "false";

    const allPosts = await db.select().from(generatedPosts)
      .where(and(
        eq(generatedPosts.campaignId, campaign.id),
        notInArray(generatedPosts.status, ["deleted", "rejected"]),
      ));

    const now_filter = new Date();
    const posts = excludeUndated
      ? allPosts.filter(p => p.scheduledDate && new Date(p.scheduledDate) >= now_filter)
      : allPosts;

    const campaignAccountLinks = await db.select().from(campaignSocialAccounts)
      .where(eq(campaignSocialAccounts.campaignId, campaign.id));

    const csvFormat = (req.query.format as string || "socialpilot").toLowerCase();
    const clientTzOffset = parseInt(req.query.tzOffset as string || "0", 10);

    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const csv = await buildPostsCsv({
      posts,
      tenantDomain: ctx.tenantDomain,
      format: csvFormat,
      tzOffset: clientTzOffset,
      fallbackAccountIds: campaignAccountLinks.map(l => l.socialAccountId),
      imageBaseUrl: host ? `${proto}://${host}` : undefined,
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="campaign-${campaign.id}-${csvFormat}.csv"`);
    res.send(csv);
    } catch (err: any) {
      console.error("[Export CSV Error]", err.message);
      res.status(500).json({ error: "Failed to export campaign CSV" });
    }
  });

  // ══════════════════════════════════════════════════════════
  // EMAIL GENERATION
  // ══════════════════════════════════════════════════════════

  app.post("/api/email/generate", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    if (!await guardManualAction(req, res, "aiEmailGen")) return;
    const ctx = await getRequestContext(req);
    const { campaignId, assetIds, instructions, platform, tone, callToAction, recipientContext, personaIds, wrapLinks } = req.body;

    const platformKey = platform || "outlook";
    const toneKey = tone || "professional";

    const platformInstructions: Record<string, string> = {
      "outlook": `Generate a plain-text email suitable for Microsoft Outlook.
- Do NOT use any HTML tags.
- Use line breaks and simple formatting (dashes, asterisks) for structure.
- Keep the layout clean, scannable, and professional.
- The email should look natural when pasted into Outlook's compose window.`,
      "hubspot-marketing": `Generate a RICH, visually compelling HTML email suitable for HubSpot Marketing Email.
Structure the email as a complete, production-ready HTML email using nested <table> layout (NOT divs) for maximum email client compatibility.

CRITICAL WIDTH CONSTRAINT — STRICT 560px MAXIMUM:
- The outer wrapper table is width="560" with style="max-width:560px;table-layout:fixed". Every child element must fit INSIDE 560px.
- Content text <td> cells have 32px left + 32px right padding, so text content max width = 496px.
- IMPORTANT: Full-width elements like hero images and header banners must be in their OWN <tr><td> with ZERO padding (style="padding:0"). The image inside uses width="100%" style="display:block;width:100%;max-width:560px;height:auto;border:0". NEVER put a wide image inside a <td> that has padding — that makes the row wider than 560px.
- Do NOT use width values greater than 560 on ANY element (table, td, img, div, or inline style).
- Stat card tables inside a padded td must use percentage widths (width="33%"), NEVER pixel widths.

REQUIRED HTML STRUCTURE:
- Wrap everything in: <table width="560" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:560px;table-layout:fixed;background-color:#ffffff;margin:0 auto">
- CRITICAL: Use ONLY inline CSS styles (style="..." attributes) on every element. NEVER use <style> tags or blocks anywhere in the output — they are NOT supported by HubSpot or Gmail and will trigger warnings.
- Do NOT include <!DOCTYPE>, <html>, <head>, or <body> tags — output ONLY the table HTML fragment
- Do NOT include ANY <style>...</style> blocks, not even for resets or responsive media queries
- Use table-based layout ONLY (email clients don't support flexbox, grid, or div layouts)
- Text content <td> cells should have style="padding:24px 32px"
- Image/banner <td> cells should have style="padding:0" with the image at width="100%"

REQUIRED SECTIONS (adapt based on content):
1. **Branded Header Banner**: Use the Brand Primary Color as the header background-color. Include company logo as a small image and company name in small uppercase white text, a bold headline (h1 style, max font-size 26px, color:#ffffff), and a subheading in white/light text.
2. **Hero Image**: If the content asset has an image URL, include it as <img src="URL" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0" alt="...">. The image td must have NO padding (padding:0).
3. **Opening Paragraph**: Jump straight into 2-3 context-setting paragraphs. Do NOT include a greeting like "Hi there" or "Dear Reader" — the email platform handles greetings separately in its pre-HTML section.
4. **Key Stats / Data Cards**: If stats exist, use a SINGLE-ROW table with 2-3 <td> cells, each with percentage widths (e.g. width="33%"). Each cell: use Brand Secondary Color as background, border-radius:8px, centered large bold number and label in white. Do NOT use fixed pixel widths on stat cells.
5. **Key Points**: Present 3-5 highlights as styled paragraphs with bold titles (use Brand Primary Color for bold text) and descriptions.
6. **Primary CTA Button**: Render as a centered <table> with a single <td bgcolor="BRAND_PRIMARY_COLOR" style="border-radius:6px;text-align:center"><a href="URL" style="display:inline-block;padding:14px 32px;color:#ffffff;font-weight:bold;text-decoration:none;font-family:Arial,sans-serif;font-size:16px">Button Text</a></td>. Do NOT use [CTA_BUTTON] placeholders.
7. **Secondary Content**: If multiple assets, add another section.
8. **Footer**: Simple single-column footer. Do NOT use multi-column footer layouts — stack footer items vertically.

VISUAL DESIGN RULES:
- Use <hr> with style="border:none;border-top:1px solid #e8ecf0;margin:24px 0" between sections
- All buttons must be real HTML <table><tr><td bgcolor><a> buttons, NOT placeholders
- Typography: font-family:Arial,sans-serif throughout, headings 22-26px, body 15-16px, line-height:1.6
- IMPORTANT: Use the Brand Primary Color for heading text, header backgrounds, and CTA button backgrounds. Use Brand Secondary Color for accent elements (stat cards, highlights, secondary buttons). Do NOT fall back to navy (#0a2540) or generic blue when brand colors are provided.
- Body text: #333 for primary body, #555 for secondary/lighter text
- Include company logo image if a logo URL is provided`,
      "hubspot-1to1": `Generate a personal, conversational email suitable for HubSpot 1:1 Sales Email.
- Do NOT use any HTML tags.
- Write as if one person is emailing another directly.
- Keep it short (under 150 words ideally), warm, and personal.
- Reference the recipient naturally if context is provided.
- Include a soft, non-pushy call to action.`,
      "dynamics-365": `Generate a professional CRM-style email suitable for Dynamics 365 Customer Email.
- Do NOT use any HTML tags.
- Use a structured, formal format with clear sections.
- Include a professional greeting and sign-off.
- Keep the tone business-appropriate and relationship-focused.
- Suitable for customer communications, follow-ups, and account management.`,
    };

    const toneInstructions: Record<string, string> = {
      "professional": "Use a professional, polished tone. Be authoritative yet approachable.",
      "friendly": "Use a warm, friendly, conversational tone. Be personable and engaging.",
      "urgent": "Use an urgent, action-oriented tone. Create a sense of timeliness and importance.",
    };

    const platformInstruction = platformInstructions[platformKey] || platformInstructions["outlook"];
    const toneInstruction = toneInstructions[toneKey] || toneInstructions["professional"];

    const platformLabel: Record<string, string> = {
      "outlook": "Outlook",
      "hubspot-marketing": "HubSpot Marketing Email",
      "hubspot-1to1": "HubSpot 1:1 Email",
      "dynamics-365": "Dynamics 365 Customer Email",
    };

    const selectedAssets = assetIds?.length
      ? await db.select().from(contentAssets).where(
          and(
            eq(contentAssets.tenantDomain, ctx.tenantDomain),
            eq(contentAssets.marketId, ctx.marketId),
            inArray(contentAssets.id, assetIds),
          )
        )
      : [];

    const [groundingContext, strategicCtx] = await Promise.all([
      loadGroundingContext(ctx.tenantDomain, ctx.marketId),
      loadStrategicContext(ctx.tenantDomain, ctx.marketId),
    ]);
    const strategicContext = formatStrategicContextForPrompt(strategicCtx);

    let personaContext = "";
    if (personaIds?.length) {
      const selectedPersonas = await Promise.all(
        personaIds.map((pid: string) => storage.getPersona(pid))
      );
      const validPersonas = selectedPersonas.filter(Boolean);
      if (validPersonas.length) {
        personaContext = formatPersonaContextForPrompt(validPersonas as any);
      }
    }

    const [companyProfile] = await db.select().from(companyProfiles)
      .where(and(
        eq(companyProfiles.tenantDomain, ctx.tenantDomain),
        eq(companyProfiles.marketId, ctx.marketId),
      ))
      .limit(1);

    const logoAssets = await db.select().from(brandAssets)
      .where(and(
        eq(brandAssets.tenantDomain, ctx.tenantDomain),
        eq(brandAssets.status, "active"),
      ))
      .limit(5);
    const logoAsset = logoAssets.find((a: any) =>
      a.name?.toLowerCase().includes("logo") || a.fileType?.startsWith("image")
    );

    let brandContext = "";
    if (companyProfile) {
      const parts = [`Company Name: ${companyProfile.companyName}`];
      if (companyProfile.websiteUrl) parts.push(`Website: ${companyProfile.websiteUrl}`);
      if (companyProfile.logoUrl) parts.push(`Company Logo URL: ${companyProfile.logoUrl}`);
      else if (logoAsset?.fileUrl) parts.push(`Company Logo URL: ${logoAsset.fileUrl}`);
      else if (logoAsset?.url) parts.push(`Company Logo URL: ${logoAsset.url}`);
      if (companyProfile.industry) parts.push(`Industry: ${companyProfile.industry}`);
      if (companyProfile.description) parts.push(`Company Description: ${companyProfile.description}`);
      brandContext = parts.join("\n");
    }

    const tenantRow = await storage.getTenantByDomain(ctx.tenantDomain);
    const brandPrimary = tenantRow?.primaryColor || "#810FFB";
    const brandSecondary = tenantRow?.secondaryColor || "#E60CB3";
    brandContext += `\nBrand Primary Color: ${brandPrimary}`;
    brandContext += `\nBrand Secondary Color: ${brandSecondary}`;
    brandContext += `\nIMPORTANT: Wherever the instructions say "BRAND_PRIMARY_COLOR", use ${brandPrimary}. Wherever they say "BRAND_SECONDARY_COLOR" or "Brand Secondary Color", use ${brandSecondary}. Use these exact hex values in bgcolor attributes, background-color styles, and color styles.`;

    const assetContext = selectedAssets
      .map((a: any) => {
        const parts = [`## ${a.title}`];
        if (a.url) parts.push(`URL: ${a.url}`);
        if (a.leadImageUrl) parts.push(`Lead Image URL: ${a.leadImageUrl}`);
        if (a.aiSummary) parts.push(`### AI Summary\n${a.aiSummary}`);
        if (a.content) parts.push(`### Content\n${a.content}`);
        else if (a.description) parts.push(`### Description\n${a.description}`);
        return parts.join("\n");
      })
      .join("\n\n");

    const prompt = `You are an expert B2B email marketing copywriter. Generate an email for the "${platformLabel[platformKey] || "Outlook"}" platform.

## Platform Instructions
${platformInstruction}

## Tone
${toneInstruction}

${callToAction ? `## Call to Action\nThe email should drive the reader toward this action: ${callToAction}\n\n` : ""}${recipientContext ? `## Recipient Context\n${recipientContext}\n\n` : ""}${brandContext ? `## Company & Brand Identity\n${brandContext}\nUse the company name and brand colors throughout the email. If a logo URL is provided, include it in the header.\n\n` : ""}${groundingContext ? `## Brand & Marketing Guidelines\n${groundingContext}\n\n` : ""}${strategicContext ? `${strategicContext}\n\n` : ""}${personaContext ? `${personaContext}\n\n` : ""}## Content Assets
${assetContext || "(no assets provided)"}

${instructions ? `## Additional Instructions\n${instructions}\n\n` : ""}## Response Format
Structure your response using these exact delimiters:

===EMAIL_BODY_START===
(your email body here)
===EMAIL_BODY_END===

===SUBJECT_LINES_START===
1. (first subject line suggestion)
2. (second subject line suggestion)
3. (third subject line suggestion)
===SUBJECT_LINES_END===`;

    const result = await completeForFeature("marketing_tasks", prompt);

    let emailBody = "";
    let subjectLineSuggestions: string[] = [];

    const bodyMatch = result.text.match(/===EMAIL_BODY_START===([\s\S]*?)===EMAIL_BODY_END===/);
    if (bodyMatch) {
      emailBody = bodyMatch[1].trim();
    } else {
      emailBody = result.text;
    }

    const subjectMatch = result.text.match(/===SUBJECT_LINES_START===([\s\S]*?)===SUBJECT_LINES_END===/);
    if (subjectMatch) {
      subjectLineSuggestions = subjectMatch[1].trim().split("\n")
        .map(line => line.replace(/^\d+\.\s*/, "").trim())
        .filter(Boolean);
    }

    if (platformKey === "hubspot-marketing") {
      emailBody = emailBody
        .replace(/```html\s*/gi, "")
        .replace(/```\s*$/gm, "")
        .trim();

      emailBody = emailBody.replace(
        /\[CTA_BUTTON:\s*"([^"]+)"\s*(?:→|->|—>)\s*([^\]\s]+)\s*\]/gi,
        (_, text, url) => `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;"><tr><td align="center" bgcolor="${brandPrimary}" style="border-radius:6px;"><a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">${text}</a></td></tr></table>`
      );

      emailBody = emailBody.replace(
        /width\s*=\s*"(56[1-9]|5[7-9]\d|[6-9]\d{2}|\d{4,})"/gi,
        'width="560"'
      );
      emailBody = emailBody.replace(
        /max-width:\s*(56[1-9]|5[7-9]\d|[6-9]\d{2}|\d{4,})px/gi,
        'max-width:560px'
      );
      emailBody = emailBody.replace(
        /width:\s*(56[1-9]|5[7-9]\d|[6-9]\d{2}|\d{4,})px/gi,
        'width:560px'
      );

      emailBody = emailBody.replace(
        /<img([^>]*)>/gi,
        (match, attrs) => {
          let result = match;
          result = result.replace(/width\s*=\s*"(\d+)"/i, (m: string, w: string) => {
            return parseInt(w, 10) > 496 ? 'width="560"' : m;
          });
          if (!/style\s*=/i.test(result)) {
            result = result.replace(/<img/i, '<img style="max-width:560px;height:auto;display:block"');
          } else {
            result = result.replace(/style\s*=\s*"/i, 'style="max-width:560px;');
          }
          return result;
        }
      );

      emailBody = emailBody.replace(
        /<table([^>]*?)>/gi,
        (match, attrs) => {
          if (/width\s*=\s*"560"/i.test(attrs)) {
            if (!/style/i.test(attrs)) {
              return `<table${attrs} style="max-width:560px;table-layout:fixed">`;
            }
            return match.replace(/style\s*=\s*"/i, 'style="max-width:560px;table-layout:fixed;');
          }
          return match;
        }
      );

      emailBody = emailBody.replace(
        /<img(?![^>]*width\s*=)([^>]*?)>/gi,
        (match, attrs) => {
          return `<img${attrs} width="560" style="display:block;max-width:100%;height:auto">`;
        }
      );

      emailBody = emailBody.replace(
        /min-width:\s*(56[1-9]|5[7-9]\d|[6-9]\d{2}|\d{4,})px/gi,
        'min-width:560px'
      );

      emailBody = emailBody.replace(
        /(<table[^>]*?)width\s*:\s*auto([^>]*?>)/gi,
        '$1width:560px$2'
      );

      emailBody = emailBody.replace(/<!DOCTYPE[^>]*>/gi, "");
      emailBody = emailBody.replace(/<\/?html[^>]*>/gi, "");
      emailBody = emailBody.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
      emailBody = emailBody.replace(/<\/?body[^>]*>/gi, "");
      emailBody = emailBody.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

      emailBody = emailBody.replace(/^\s*<p[^>]*>\s*(Hi\s+there|Hello\s+there|Dear\s+(Reader|Friend|Colleague))[^<]*<\/p>\s*/i, "");
      emailBody = emailBody.replace(/^\s*(Hi\s+there|Hello\s+there|Dear\s+(Reader|Friend|Colleague))\s*[,!.]?\s*(<br\s*\/?\s*>){1,2}\s*/i, "");

      const hasOuterWrapper = /^\s*<table[^>]*width\s*=\s*"(560|600)"/i.test(emailBody);
      if (!hasOuterWrapper) {
        emailBody = `<table width="560" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:560px;margin:0 auto;table-layout:fixed;overflow:hidden"><tr><td>${emailBody}</td></tr></table>`;
      }
    }

    const coachingTipsMap: Record<string, string[]> = {
      "outlook": [
        "Keep subject lines under 60 characters for Outlook's preview pane",
        "Avoid heavy formatting — Outlook strips most CSS",
        "Use short paragraphs and bullet points for scannability",
        "Include a clear text-based CTA since styled buttons may not render",
      ],
      "hubspot-marketing": [
        "Use a single-column layout for best mobile rendering",
        "Keep the primary CTA above the fold",
        "Personalize with HubSpot tokens like {{contact.firstname}}",
        "Test with HubSpot's email preview tool before sending",
        "HubSpot adds its own greeting section — no need to add 'Hi there' in the HTML body",
        "The generated HTML is 560px wide to fit within HubSpot's 600px editor frame",
      ],
      "hubspot-1to1": [
        "Keep it under 150 words for higher response rates",
        "Reference something specific about the recipient",
        "Ask a question to encourage a reply",
        "Avoid marketing language — write like a real person",
      ],
      "dynamics-365": [
        "Use Dynamics merge fields for personalization",
        "Include a follow-up task reminder in your CRM workflow",
        "Keep the email concise and action-oriented",
        "Reference previous interactions when possible",
      ],
    };

    const coachingTips = coachingTipsMap[platformKey] || coachingTipsMap["outlook"];
    const subject = subjectLineSuggestions[0] || "Generated Email";
    const isHtml = platformKey === "hubspot-marketing";

    // Optionally wrap outbound URLs in tracked redirects with UTM tags. We do
    // this after platform-specific HTML rewriting so the link-replacer doesn't
    // have to know about HubSpot's table structure.
    let wrapInfo: { createdSlugs: string[] } | null = null;
    if (wrapLinks) {
      let campaignContext: { id: string; name: string } | null = null;
      if (campaignId) {
        const [c] = await db.select({ id: campaigns.id, name: campaigns.name })
          .from(campaigns)
          .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantDomain, ctx.tenantDomain)))
          .limit(1);
        if (c) campaignContext = c;
      }
      const utmCampaignVal = slugifyForUtm(campaignContext?.name, "newsletter");
      const wrapped = await wrapOutboundLinksInText(emailBody, {
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        campaignId: campaignContext?.id ?? null,
        userId: ctx.userId,
        utm: {
          source: platformKey,
          medium: "email",
          campaign: utmCampaignVal,
          content: "newsletter",
        },
        source: "email-wrap",
        redirectBase: { protocol: req.protocol, host: req.get("host") || undefined },
        label: campaignContext ? `Email · ${campaignContext.name}` : "Email · newsletter",
      });
      emailBody = wrapped.text;
      wrapInfo = { createdSlugs: wrapped.createdSlugs };
    }

    res.json({
      subject,
      previewText: "",
      htmlBody: isHtml ? emailBody : "",
      textBody: isHtml ? "" : emailBody,
      subjectLineSuggestions,
      coachingTips,
      platform: platformKey,
      usage: result.usage,
      wrappedLinks: wrapInfo?.createdSlugs.length ?? 0,
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
    const { campaignId, subject, previewText, htmlBody, textBody, platform, tone, callToAction, recipientContext, subjectLineSuggestions, coachingTips } = req.body;
    if (!subject?.trim() || (!htmlBody?.trim() && !textBody?.trim())) {
      return res.status(400).json({ error: "subject and either htmlBody or textBody are required" });
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
      platform: platform || "outlook",
      tone: tone || "professional",
      callToAction: callToAction || null,
      recipientContext: recipientContext || null,
      subject,
      previewText,
      htmlBody: htmlBody || "",
      textBody,
      subjectLineSuggestions: subjectLineSuggestions || null,
      coachingTips: coachingTips || null,
      createdBy: ctx.userId,
    } as InsertGeneratedEmail).returning();
    res.status(201).json(row);
  });

  app.patch("/api/email/saved/:id", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    const ctx = await getRequestContext(req);
    const { subject, htmlBody, textBody, status, label } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (subject !== undefined) updates.subject = subject;
    if (htmlBody !== undefined) updates.htmlBody = htmlBody;
    if (textBody !== undefined) updates.textBody = textBody;
    if (status !== undefined) updates.status = status;
    if (label !== undefined) updates.label = label || null;
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
    await db.delete(generatedEmails)
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

  app.get("/api/extension/download", async (req, res) => {
    if (!await guardFeature(req, res, "saturnCapture")) return;
    const archiver = (await import("archiver")).default;
    const path = await import("path");
    const fs = await import("fs");

    const extensionDir = path.resolve(process.cwd(), "extensions", "saturn-capture");
    if (!fs.existsSync(extensionDir)) {
      return res.status(404).json({ error: "Extension files not found" });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="saturn-capture.zip"');

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", () => {
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to create zip archive" });
      } else {
        res.destroy();
      }
    });
    archive.pipe(res);
    archive.directory(extensionDir, "saturn-capture");
    await archive.finalize();
  });

  // ══════════════════════════════════════════════════════════
  // DASHBOARD MARKETING SUMMARY
  // ══════════════════════════════════════════════════════════

  app.get("/api/marketing/dashboard-summary", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const ctx = await getRequestContext(req);

      const campaignFilter = ctx.marketId
        ? and(eq(campaigns.tenantDomain, ctx.tenantDomain), eq(campaigns.marketId, ctx.marketId))
        : eq(campaigns.tenantDomain, ctx.tenantDomain);

      const allCampaigns = await db.select().from(campaigns).where(campaignFilter);

      const allSummaries = await Promise.all(
        allCampaigns.map(async (c) => {
          const posts = await db.select({ id: generatedPosts.id, platform: generatedPosts.platform, scheduledDate: generatedPosts.scheduledDate })
            .from(generatedPosts)
            .where(eq(generatedPosts.campaignId, c.id));
          const platformCounts: Record<string, number> = {};
          let scheduledCount = 0;
          for (const p of posts) {
            platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1;
            if (p.scheduledDate) scheduledCount++;
          }
          return {
            id: c.id,
            name: c.name,
            status: c.status,
            startDate: c.startDate,
            numberOfDays: c.numberOfDays,
            totalPosts: posts.length,
            scheduledPosts: scheduledCount,
            platforms: platformCounts,
          };
        })
      );

      const emailFilter = ctx.marketId
        ? and(eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId))
        : eq(generatedEmails.tenantDomain, ctx.tenantDomain);

      const savedEmails = await db.select({ id: generatedEmails.id, subject: generatedEmails.subject, platform: generatedEmails.platform, label: generatedEmails.label, createdAt: generatedEmails.createdAt })
        .from(generatedEmails)
        .where(emailFilter)
        .orderBy(desc(generatedEmails.createdAt))
        .limit(10);

      res.json({
        campaigns: allSummaries.slice(0, 6),
        savedEmails: savedEmails,
        totals: {
          campaigns: allCampaigns.length,
          totalPosts: allSummaries.reduce((s, c) => s + c.totalPosts, 0),
          scheduledPosts: allSummaries.reduce((s, c) => s + c.scheduledPosts, 0),
          savedEmails: savedEmails.length,
        },
      });
    } catch (err: any) {
      console.error("[Dashboard Marketing Summary] Error:", err);
      res.json({ campaigns: [], savedEmails: [], totals: { campaigns: 0, totalPosts: 0, scheduledPosts: 0, savedEmails: 0 } });
    }
  });

  // ══════════════════════════════════════════════════════════
  // STRATEGIC CONTEXT — surface intelligence summary for UI
  // ══════════════════════════════════════════════════════════

  app.get("/api/strategic-context/summary", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    try {
      const ctx = await getRequestContext(req);
      const sc = await loadStrategicContext(ctx.tenantDomain, ctx.marketId);
      const hasSections = !!(sc.messagingFramework || sc.competitiveIntelligence || sc.gtmPlanSummary || sc.briefingActionItems || sc.recommendations);
      res.json({
        available: hasSections,
        sections: {
          messagingFramework: !!sc.messagingFramework,
          competitiveIntelligence: !!sc.competitiveIntelligence,
          gtmPlan: !!sc.gtmPlanSummary,
          briefingActionItems: !!sc.briefingActionItems,
          recommendations: !!sc.recommendations,
        },
      });
    } catch {
      res.json({ available: false, sections: {} });
    }
  });

  // ══════════════════════════════════════════════════════════
  // PERSONAS & ICP BUILDER
  // ══════════════════════════════════════════════════════════

  app.get("/api/personas", async (req, res) => {
    if (!await guardFeature(req, res, "personaBuilder")) return;
    const ctx = await getRequestContext(req);
    const ctxFilter: ContextFilter = { tenantId: ctx.tenantId, marketId: ctx.marketId, tenantDomain: ctx.tenantDomain, isDefaultMarket: ctx.isDefaultMarket };
    const pagination = parsePaginationParams(req);

    if (!pagination.isPaginated && !pagination.q) {
      const rows = await storage.getPersonasByContext(ctxFilter);
      return res.json(rows);
    }

    const conditions = [eq(personas.tenantDomain, ctx.tenantDomain)];
    if (ctx.marketId) {
      conditions.push(eq(personas.marketId, ctx.marketId));
    } else if (ctx.isDefaultMarket) {
      conditions.push(isNull(personas.marketId));
    }
    if (pagination.q) {
      const pattern = toContainsPattern(pagination.q);
      conditions.push(or(
        ilike(personas.name, pattern),
        ilike(personas.role, pattern),
        ilike(personas.industry, pattern),
        ilike(personas.notes, pattern),
      )!);
    }
    const where = and(...conditions);

    if (!pagination.isPaginated) {
      const rows = await db.select().from(personas)
        .where(where)
        .orderBy(desc(personas.isIcp), personas.name);
      return res.json(rows);
    }

    const [{ value: total }] = await db.select({ value: count() }).from(personas).where(where);
    const items = await db.select().from(personas)
      .where(where)
      .orderBy(desc(personas.isIcp), personas.name)
      .limit(pagination.limit)
      .offset(pagination.offset);
    res.json(buildPaginatedEnvelope(items, Number(total), pagination));
  });

  app.get("/api/personas/:id", async (req, res) => {
    if (!await guardFeature(req, res, "personaBuilder")) return;
    const ctx = await getRequestContext(req);
    const persona = await storage.getPersona(req.params.id);
    if (!persona || persona.tenantDomain !== ctx.tenantDomain) return res.status(404).json({ error: "Not found" });
    res.json(persona);
  });

  app.post("/api/personas", async (req, res) => {
    if (!await guardFeature(req, res, "personaBuilder")) return;
    const ctx = await getRequestContext(req);
    const { name, role, industry, companySize, painPoints, goals, objections, preferredChannels, notes, isIcp } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const persona = await storage.createPersona({
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name: name.trim(),
      role: role || null,
      industry: industry || null,
      companySize: companySize || null,
      painPoints: painPoints || null,
      goals: goals || null,
      objections: objections || null,
      preferredChannels: preferredChannels || null,
      notes: notes || null,
      isIcp: isIcp || false,
      createdBy: ctx.userId,
    });
    res.status(201).json(persona);
  });

  app.put("/api/personas/:id", async (req, res) => {
    if (!await guardFeature(req, res, "personaBuilder")) return;
    const ctx = await getRequestContext(req);
    const existing = await storage.getPersona(req.params.id);
    if (!existing || existing.tenantDomain !== ctx.tenantDomain) return res.status(404).json({ error: "Not found" });
    const { name, role, industry, companySize, painPoints, goals, objections, preferredChannels, notes, isIcp } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (industry !== undefined) updates.industry = industry;
    if (companySize !== undefined) updates.companySize = companySize;
    if (painPoints !== undefined) updates.painPoints = painPoints;
    if (goals !== undefined) updates.goals = goals;
    if (objections !== undefined) updates.objections = objections;
    if (preferredChannels !== undefined) updates.preferredChannels = preferredChannels;
    if (notes !== undefined) updates.notes = notes;
    if (isIcp !== undefined) updates.isIcp = isIcp;
    const updated = await storage.updatePersona(req.params.id, updates);
    res.json(updated);
  });

  app.delete("/api/personas/:id", async (req, res) => {
    if (!await guardFeature(req, res, "personaBuilder")) return;
    const ctx = await getRequestContext(req);
    const existing = await storage.getPersona(req.params.id);
    if (!existing || existing.tenantDomain !== ctx.tenantDomain) return res.status(404).json({ error: "Not found" });
    await storage.deletePersona(req.params.id);
    res.status(204).send();
  });

  app.post("/api/personas/ingest", async (req, res) => {
    if (!await guardFeature(req, res, "personaBuilder")) return;
    const ctx = await getRequestContext(req);
    const { text } = req.body;
    if (!text || typeof text !== "string" || text.trim().length < 10) {
      return res.status(400).json({ error: "Please paste at least a short paragraph of text to extract a persona from." });
    }

    const prompt = `You are an expert B2B marketing strategist. Extract a structured buyer persona from the following text. The text may be from a CRM record, research report, strategy document, meeting notes, or any other source describing a customer or audience segment.

## Source Text
${text.trim().slice(0, 8000)}

## Instructions
Analyze the text and extract as much persona information as possible. Fill in reasonable inferences where the text implies but doesn't explicitly state something. If a field truly cannot be determined, use null.

Return ONLY a valid JSON object (no markdown fences, no explanation) with:
- "name": string (a descriptive persona name like "Enterprise IT Director" — synthesize from the text)
- "role": string | null (job title or role)
- "industry": string | null (target industry)
- "companySize": string | null (e.g. "50-200 employees", "Enterprise 1000+")
- "painPoints": string[] (pain points mentioned or implied, up to 5)
- "goals": string[] (business goals mentioned or implied, up to 5)
- "objections": string[] (buying objections mentioned or implied, up to 4)
- "preferredChannels": string[] (preferred channels mentioned or implied, up to 4)
- "notes": string (brief summary of this persona based on the source text)`;

    try {
      const result = await completeForFeature("marketing_tasks", prompt);
      let parsed: any;
      try {
        const cleaned = result.text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        const objMatch = result.text.match(/\{[\s\S]*\}/);
        if (objMatch) parsed = JSON.parse(objMatch[0]);
        else throw new Error("Could not parse AI response");
      }
      if (Array.isArray(parsed)) parsed = parsed[0];
      res.json(parsed);
    } catch (err: any) {
      console.error("[Personas] AI ingest error:", err.message);
      res.status(500).json({ error: `Persona extraction failed: ${err.message}` });
    }
  });

  app.post("/api/personas/generate", async (req, res) => {
    if (!await guardFeature(req, res, "personaBuilder")) return;
    if (!await guardManualAction(req, res, "aiPersonaGen")) return;
    const ctx = await getRequestContext(req);

    const [strategicCtx, companyProfile, marketRow] = await Promise.all([
      loadStrategicContext(ctx.tenantDomain, ctx.marketId),
      (async () => {
        const [row] = await db.select().from(companyProfiles)
          .where(and(
            eq(companyProfiles.tenantDomain, ctx.tenantDomain),
            eq(companyProfiles.marketId, ctx.marketId),
          ))
          .limit(1);
        return row;
      })(),
      (async () => {
        const [row] = await db.select().from(markets)
          .where(eq(markets.id, ctx.marketId))
          .limit(1);
        return row;
      })(),
    ]);
    const strategicContext = formatStrategicContextForPrompt(strategicCtx);
    const businessType = (marketRow as any)?.businessType || "b2b";
    const isB2C = businessType === "b2c";

    let companyContext = "";
    if (companyProfile) {
      const parts = [`Company: ${companyProfile.companyName}`];
      if (companyProfile.industry) parts.push(`Industry: ${companyProfile.industry}`);
      if (companyProfile.description) parts.push(`Description: ${companyProfile.description}`);
      companyContext = parts.join("\n");
    }

    const b2bPrompt = `You are an expert B2B marketing strategist. Generate 3 detailed buyer persona suggestions based on the company context and strategic intelligence provided.

${companyContext ? `## Company Context\n${companyContext}\n\n` : ""}${strategicContext ? `${strategicContext}\n\n` : ""}## Instructions
Analyze the company's positioning, target audience, competitive landscape, and messaging to create 3 distinct buyer personas that would be most relevant for this business. Each persona should represent a different segment of the ideal customer base.

Return ONLY a valid JSON array (no markdown fences, no explanation) of 3 objects, each with:
- "name": string (a descriptive name like "Enterprise IT Director" or "Growth-Stage CMO")
- "role": string (job title or role)
- "industry": string (target industry)
- "companySize": string (e.g. "50-200 employees", "Enterprise 1000+")
- "painPoints": string[] (3-5 specific pain points)
- "goals": string[] (3-5 business goals)
- "objections": string[] (2-4 common objections to buying)
- "preferredChannels": string[] (2-4 preferred channels like "LinkedIn", "Email", "Webinars")
- "notes": string (brief description of this persona and why they matter)`;

    const b2cPrompt = `You are an expert B2C marketing strategist specializing in consumer brands. Generate 3 detailed consumer persona suggestions based on the company context and strategic intelligence provided.

${companyContext ? `## Company Context\n${companyContext}\n\n` : ""}${strategicContext ? `${strategicContext}\n\n` : ""}## Instructions
This is a B2C (business-to-consumer) company. Analyze the company's brand positioning, consumer appeal, competitive landscape, and messaging to create 3 distinct consumer personas that would be the most relevant target customers for this business. Each persona should represent a different consumer segment (e.g., demographics, lifestyle, buying motivation).

Focus on consumer-facing characteristics: lifestyle, values, shopping behavior, social media habits, spending patterns, and emotional drivers rather than enterprise/corporate attributes.

Return ONLY a valid JSON array (no markdown fences, no explanation) of 3 objects, each with:
- "name": string (a descriptive consumer archetype like "Weekend Wine Enthusiast" or "Health-Conscious Millennial Mom")
- "role": string (life role or consumer identity, e.g. "Young Professional", "Retired Hobbyist", "Family Decision-Maker")
- "industry": string (relevant consumer segment or lifestyle category)
- "companySize": string (household or spending tier, e.g. "Dual-income household", "Budget-conscious", "Premium spender")
- "painPoints": string[] (3-5 consumer frustrations or unmet needs)
- "goals": string[] (3-5 personal or lifestyle goals related to the product/service)
- "objections": string[] (2-4 reasons they might hesitate to buy)
- "preferredChannels": string[] (2-4 channels like "Instagram", "TikTok", "In-store", "Google Search", "Email newsletters")
- "notes": string (brief description of this consumer persona and why they matter for this brand)`;

    const prompt = isB2C ? b2cPrompt : b2bPrompt;

    try {
      const result = await completeForFeature("marketing_tasks", prompt);
      let parsed: any[] = [];
      try {
        const cleaned = result.text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
        parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) parsed = [parsed];
      } catch {
        const arrayMatch = result.text.match(/\[[\s\S]*\]/);
        if (arrayMatch) parsed = JSON.parse(arrayMatch[0]);
      }
      res.json(parsed.slice(0, 5));
    } catch (err: any) {
      console.error("[Personas] AI generation error:", err.message);
      res.status(500).json({ error: `Persona generation failed: ${err.message}` });
    }
  });
}

// ─── async post generation ───────────────────────────────────────────────────

function isValidVariant(v: any): boolean {
  if (!v || typeof v !== "object") return false;
  if (typeof v.content !== "string" || v.content.trim().length === 0) return false;
  return true;
}

function normalizeVariant(v: any): { content: string; hashtags: string[]; imagePrompt: string } {
  return {
    content: (v.content as string).trim(),
    hashtags: Array.isArray(v.hashtags)
      ? v.hashtags.filter((h: any) => typeof h === "string")
      : [],
    imagePrompt: typeof v.imagePrompt === "string" ? v.imagePrompt : "",
  };
}

function extractJsonVariants(raw: string): any[] {
  let cleaned = raw
    .replace(/```(?:json)?\s*\n?/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const strategies: Array<() => any[]> = [
    () => {
      const arrMatch = cleaned.match(/\[[\s\S]*\]/);
      if (!arrMatch) throw new Error("no array");
      return JSON.parse(arrMatch[0]);
    },
    () => {
      const objects: any[] = [];
      const objRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
      let m;
      while ((m = objRegex.exec(cleaned)) !== null) {
        try {
          const parsed = JSON.parse(m[0]);
          if (parsed.content) objects.push(parsed);
        } catch {}
      }
      if (objects.length === 0) throw new Error("no objects");
      return objects;
    },
    () => {
      const singleObj = cleaned.match(/\{[\s\S]*\}/);
      if (!singleObj) throw new Error("no object");
      const parsed = JSON.parse(singleObj[0]);
      if (Array.isArray(parsed)) return parsed;
      return [parsed];
    },
  ];

  for (const strategy of strategies) {
    try {
      const result = strategy();
      const items = Array.isArray(result) ? result : [result];
      const validated = items.filter(isValidVariant).map(normalizeVariant);
      if (validated.length > 0) return validated;
    } catch {}
  }

  throw new Error("All extraction strategies failed");
}

function buildFallbackVariants(raw: string): any[] {
  const contentRegex = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  const blocks: any[] = [];
  let m;
  while ((m = contentRegex.exec(raw)) !== null) {
    try {
      const content = JSON.parse(`"${m[1]}"`);
      if (content.trim().length >= 10) {
        blocks.push({ content: content.trim(), hashtags: [], imagePrompt: "" });
      }
    } catch {}
  }
  if (blocks.length > 0) return blocks;

  const cleanedText = raw
    .replace(/```(?:json)?\s*\n?/gi, "")
    .replace(/```\s*/g, "")
    .replace(/[\[\]{}"]/g, " ")
    .replace(/,\s*$/gm, "")
    .replace(/^\s*"?\w+"\s*:\s*/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (cleanedText.length >= 10) {
    return [{ content: cleanedText, hashtags: [], imagePrompt: "" }];
  }

  return [{ content: "Post generation failed — please try again.", hashtags: [], imagePrompt: "" }];
}

/**
 * Distinct creative angles used to ensure each generated post takes a meaningfully
 * different approach. The generator rotates through these so consecutive scheduled
 * days never reuse the same hook, structure, or rhetorical device.
 */
const CONTENT_ANGLES: { name: string; directive: string }[] = [
  { name: "thought-provoking question",  directive: "Open with a thought-provoking question that challenges a common assumption the audience holds." },
  { name: "surprising statistic",        directive: "Lead with a specific, surprising statistic or data point that anchors the reader's attention." },
  { name: "short story / anecdote",      directive: "Tell a short, concrete story or anecdote (2-3 sentences) that illustrates the theme through a real situation." },
  { name: "contrarian hot take",         directive: "Open with a bold, contrarian claim or hot take that respectfully pushes back on conventional wisdom." },
  { name: "before-and-after",            directive: "Frame the message as a before-vs-after transformation — paint the old reality, then the new one." },
  { name: "actionable tip",              directive: "Deliver a single actionable tip or insight in the form 'Here's how to ___' or 'Did you know ___'." },
  { name: "behind-the-scenes",           directive: "Pull back the curtain — show the process, the decision, or the work behind the result." },
  { name: "trend commentary",            directive: "React to a current industry trend or shift, positioning the theme inside that broader movement." },
  { name: "aspirational vision",         directive: "Paint an aspirational vision of what becomes possible — appeal to the audience's ambition." },
  { name: "step-by-step breakdown",      directive: "Lay out 3 concrete steps or principles as a short numbered or bullet-style list inside the body." },
  { name: "comparison / contrast",       directive: "Use a clear comparison or contrast — old way vs new way, common approach vs better approach, X vs Y." },
  { name: "quote-led reflection",        directive: "Lead with a strong, original quote or paraphrased line of insight, then unpack it briefly." },
];

/**
 * Determine how many unique text variants to generate per platform so that each
 * scheduled day gets a meaningfully different post.
 *
 * Floor: 5 variants (gives even short campaigns visible variety).
 * Ceiling: 30 variants (covers a month of weekday posts; longer campaigns will
 *   cycle the variant pool monthly, which avoids day-after-day or every-other-day
 *   repetition while keeping AI generation cost bounded).
 */
function calculateTargetVariantsPerPlatform(campaignRow: { numberOfDays: number | null; includeSaturday: boolean | null; includeSunday: boolean | null }): { target: number; eligibleDays: number; capped: boolean } {
  const baseDays = campaignRow.numberOfDays ?? 7;
  const daysPerWeek = 5 + (campaignRow.includeSaturday ? 1 : 0) + (campaignRow.includeSunday ? 1 : 0);
  const eligibleDays = Math.max(1, Math.ceil(baseDays * daysPerWeek / 7));
  const MIN_VARIANTS = 5;
  const MAX_VARIANTS = 30;
  const target = Math.min(Math.max(eligibleDays, MIN_VARIANTS), MAX_VARIANTS);
  return { target, eligibleDays, capped: eligibleDays > MAX_VARIANTS };
}

async function generatePostsAsync(
  campaignId: string,
  tenantDomain: string,
  marketId: string,
  jobId: string,
  brandImageIds: string[] = [],
  personaIds: string[] = [],
  thematicBrief: string = "",
  thematicUrl: string = "",
  wrapOpts: { wrapLinks?: boolean; ownerUserId?: string; redirectProtocol?: string; redirectHost?: string; includeAssetLeadImages?: boolean } = {},
  reportProgress?: (patch: { phase?: string; percent?: number; currentItem?: number; totalItems?: number; currentItemName?: string }) => void,
): Promise<void> {
  // Default ON: lead images from source content assets are folded into the
  // image-variation grid alongside selected brand-library images.
  const includeAssetLeadImages = wrapOpts.includeAssetLeadImages !== false;
  await db.update(scheduledJobRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(scheduledJobRuns.id, jobId));

  try {
    reportProgress?.({ phase: "Loading context", percent: 5 });
    const [campaignRow] = await db.select().from(campaigns)
      .where(eq(campaigns.id, campaignId));

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

    const [groundingContext, strategicCtx] = await Promise.all([
      loadGroundingContext(tenantDomain, marketId),
      loadStrategicContext(tenantDomain, marketId),
    ]);
    const strategicContext = formatStrategicContextForPrompt(strategicCtx);

    let personaContext = "";
    if (personaIds.length > 0) {
      const selectedPersonas = await Promise.all(
        personaIds.map((pid: string) => storage.getPersona(pid))
      );
      const validPersonas = selectedPersonas.filter(Boolean);
      if (validPersonas.length) {
        personaContext = formatPersonaContextForPrompt(validPersonas as any);
      }
    }

    let brandImageAssets: { id: string; fileUrl: string | null; url: string | null; name: string }[] = [];
    if (brandImageIds.length > 0) {
      brandImageAssets = await db.select({
        id: brandAssets.id,
        fileUrl: brandAssets.fileUrl,
        url: brandAssets.url,
        name: brandAssets.name,
      }).from(brandAssets).where(
        and(
          eq(brandAssets.tenantDomain, tenantDomain),
          inArray(brandAssets.id, brandImageIds),
        ),
      );
    }

    const buildAssetContext = (asset: any): string => {
      const parts = [`## ${asset.title}`];
      if (asset.url) parts.push(`URL: ${asset.url}`);
      if (asset.aiSummary) parts.push(`### AI Summary\n${asset.aiSummary}`);
      if (asset.content) parts.push(`### Content\n${asset.content}`);
      else if (asset.description) parts.push(`### Description\n${asset.description}`);
      return parts.join("\n");
    };

    const platformTargets = linkedAccounts.length
      ? linkedAccounts
      : [{ id: "placeholder", platform: "linkedin", accountName: "Your Company" }];

    const generatedRows: InsertGeneratedPost[] = [];

    reportProgress?.({ phase: "Drafting posts", percent: 15, totalItems: platformTargets.length });

    const isThematic = !!(thematicBrief);

    // In thematic mode, fold any selected campaign assets in as supporting context
    // so the AI can ground the theme in the team's existing materials.
    const supportingAssetContext = (isThematic && selectedAssets.length > 0)
      ? `\n\n## Supporting Campaign Assets\n${selectedAssets.map(buildAssetContext).join("\n\n---\n\n")}`
      : "";

    // Per-asset base visual: prefer the extracted lead image, fall back to
    // the uploaded fileUrl when it's an image MIME type (covers assets that
    // are themselves an uploaded JPG/PNG rather than a URL).
    const assetBaseVisual = (a: any): string | null => {
      if (a.leadImageUrl) return a.leadImageUrl;
      if (a.fileUrl && typeof a.fileType === "string" && a.fileType.startsWith("image/")) {
        return a.fileUrl;
      }
      return null;
    };

    // Pools of (context, sourceUrl) the generator should pull from. In thematic mode
    // there is one pool (the brief, optionally enriched with assets). In asset mode
    // each selected asset becomes a pool entry the generator rotates across.
    // assetId + leadImageUrl flow through so each variant can be persisted with
    // a FK back to its source asset and (optionally) that asset's hero image.
    type ContextPool = {
      context: string;
      sourceUrl: string | null;
      thematic: boolean;
      label: string;
      assetId: string | null;
      leadImageUrl: string | null;
    };
    const contextPools: ContextPool[] = isThematic
      ? [{
          context: `## Campaign Theme\n${thematicBrief}${thematicUrl ? `\n\nReference URL: ${thematicUrl}` : ""}${supportingAssetContext}`,
          sourceUrl: thematicUrl || null,
          thematic: true,
          label: "campaign theme",
          assetId: null,
          leadImageUrl: null,
        }]
      : selectedAssets.length > 0
        ? selectedAssets.map(a => ({
            context: `## Content Asset\n${buildAssetContext(a)}`,
            sourceUrl: a.url || null,
            thematic: false,
            label: a.title,
            assetId: a.id,
            leadImageUrl: assetBaseVisual(a),
          }))
        : [{
            context: "(no specific assets provided — draw from your knowledge of best practices)",
            sourceUrl: null,
            thematic: false,
            label: "general",
            assetId: null,
            leadImageUrl: null,
          }];

    const { target: targetVariantsPerPlatform, eligibleDays, capped } = calculateTargetVariantsPerPlatform(campaignRow);
    const VARIANTS_PER_BATCH = 4; // angles per AI call — keeps prompts focused and JSON parseable
    if (capped) {
      console.log(`[Saturn] Campaign ${campaignId} has ${eligibleDays} eligible posting days but variant target capped at ${targetVariantsPerPlatform}; the variant pool will cycle approximately every ${targetVariantsPerPlatform} scheduled days.`);
    }

    const campaignAlwaysHashtags = (campaignRow.alwaysHashtags as string[] || [])
      .map((h: string) => h.replace(/^#/, "").replace(/\s+/g, "").trim())
      .filter((h: string) => h.length > 0);

    let platformIdx = 0;
    for (const account of platformTargets) {
      platformIdx++;
      const platformPct = 15 + Math.round((platformIdx - 1) / platformTargets.length * 75);
      reportProgress?.({
        phase: `Drafting ${account.platform} variants`,
        percent: platformPct,
        currentItem: platformIdx,
        totalItems: platformTargets.length,
        currentItemName: account.platform,
      });
      const platformGuide = getPlatformGuide(account.platform);
      const variantGroupId = randomUUID();
      const cleanedVariantsForAccount: {
        content: string;
        hashtags: string[];
        imagePrompt: string;
        sourceUrl: string | null;
        sourceAssetId: string | null;
        leadImageUrl: string | null;
      }[] = [];
      const usedOpenings: string[] = []; // first ~80 chars of each accepted variant — passed back to the AI to forbid reuse

      let angleIndex = 0;
      let poolIndex = 0;
      let safetyLoops = 0;
      const MAX_SAFETY_LOOPS = Math.ceil(targetVariantsPerPlatform / VARIANTS_PER_BATCH) * 3 + 2;

      while (cleanedVariantsForAccount.length < targetVariantsPerPlatform && safetyLoops < MAX_SAFETY_LOOPS) {
        safetyLoops++;
        const remaining = targetVariantsPerPlatform - cleanedVariantsForAccount.length;
        const batchSize = Math.min(VARIANTS_PER_BATCH, remaining);

        // Pick the next N angles (with wrap-around) and the pool to ground this batch in
        const batchAngles: { name: string; directive: string }[] = [];
        for (let i = 0; i < batchSize; i++) {
          batchAngles.push(CONTENT_ANGLES[(angleIndex + i) % CONTENT_ANGLES.length]);
        }
        angleIndex = (angleIndex + batchSize) % CONTENT_ANGLES.length;
        const pool = contextPools[poolIndex % contextPools.length];
        poolIndex++;

        const anglesBlock = batchAngles
          .map((a, i) => `Variant ${i + 1} — ANGLE: "${a.name}". ${a.directive}`)
          .join("\n");

        const avoidBlock = usedOpenings.length > 0
          ? `\n\n## Already-used openings — do NOT reuse, paraphrase, or echo these first lines:\n${usedOpenings.map((o, i) => `${i + 1}. "${o}"`).join("\n")}`
          : "";

        const prompt = `You are an expert social media copywriter. Generate ${batchSize} variant ${account.platform} post${batchSize > 1 ? "s" : ""} for the account "${account.accountName}" based on the following ${pool.thematic ? "campaign theme brief" : "content"}.

CRITICAL ANTI-REPETITION RULES — follow strictly:
- Each variant MUST commit to its assigned ANGLE below. Do NOT blend angles.
- Each variant MUST have a completely distinct opening hook (first sentence). Do not reuse the same words, questions, statistics, or phrasing across variants.
- Vary sentence structure, rhythm, and rhetorical device across variants.
- Do NOT start two variants with the same word, the same phrase, or the same sentence pattern.

ASSIGNED ANGLES (one per variant, in order):
${anglesBlock}${avoidBlock}

GENERAL RULES:
1. ${pool.thematic ? "The brief below is the creative starting point — rewrite and adapt it into compelling social copy. Do NOT copy it verbatim. Bring your own angle, voice, and structure." : "Strip and ignore all non-editorial material from the source content: copyright notices, cookie banners, navigation menus, headers/footers, newsletter signup forms, boilerplate \"About Us\", social sharing button text, comment sections. Only use the actual article substance and key messages."}
2. ${pool.sourceUrl ? `Include the reference URL ONCE in the post body with a clear CTA (e.g. "Learn more: ${pool.sourceUrl}"). NEVER include the URL more than once.` : "Do NOT fabricate or include any URLs unless they appear in the brief below."}
3. Do NOT include hashtags inline in the post content — put them only in the "hashtags" array field.
4. Hashtags must be single words or camelCase compound words only (e.g. "DigitalTransformation", not "Digital Transformation"). No spaces, no # symbol, no special characters.
5. ${account.platform === "twitter" ? "Twitter/X posts have a HARD 280 CHARACTER LIMIT. The TOTAL character count of the post content PLUS the hashtag line (e.g. '#Tag1 #Tag2') MUST NOT exceed 280. Since hashtags typically add 30-60 characters, keep the post content body to 200 characters MAX. Count EVERY character including spaces, punctuation, and URLs. One concise sentence + URL is ideal. NEVER write long-form content for Twitter." : "Follow the platform length guidelines below."}
6. Write clean, professional copy. No placeholder text, no "[insert link]" or similar instructions.

${groundingContext ? `## Brand & Marketing Guidelines\n${groundingContext}\n\n` : ""}${strategicContext ? `${strategicContext}\n\n` : ""}${personaContext ? `${personaContext}\n\n` : ""}${pool.context}

## Platform Guidelines
${platformGuide}

Return ONLY a valid JSON array (no markdown fences, no explanation) of ${batchSize} object${batchSize > 1 ? "s" : ""}, each with:
- "content": string (the post body — include the source URL naturally if one was provided, no inline hashtags)
- "hashtags": string[] (3-5 relevant hashtags, each a single camelCase word, no # prefix)
- "imagePrompt": string (a suggested image description for this post)`;

        let result;
        try {
          result = await completeForFeature("marketing_tasks", prompt);
        } catch (err: any) {
          console.error(`[Saturn] AI call failed for ${account.platform} batch (angles: ${batchAngles.map(a => a.name).join(", ")}):`, err.message);
          continue; // try next batch
        }

        let variants: any[] = [];
        try {
          variants = extractJsonVariants(result.text);
        } catch {
          console.error(`[Saturn] All JSON extraction strategies failed for campaign ${campaignId}`);
          console.error("[Saturn] Raw AI response:", result.text);
          variants = buildFallbackVariants(result.text);
        }

        for (const parsed of variants) {
          if (cleanedVariantsForAccount.length >= targetVariantsPerPlatform) break;

          let postContent = (parsed.content ?? result.text).trim();
          postContent = postContent.replace(/\[insert\s+link\]/gi, "").trim();

          if (!postContent || postContent.length < 10) {
            console.warn(`[Saturn] Skipping empty/trivial AI variant for campaign ${campaignId}`);
            continue;
          }

          // Reject near-duplicates: if the first 60 chars (case/whitespace-normalized) match
          // an already-accepted variant, skip it.
          const normalizedOpening = postContent.replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase();
          const isDuplicate = cleanedVariantsForAccount.some(v =>
            v.content.replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase() === normalizedOpening
          );
          if (isDuplicate) {
            console.warn(`[Saturn] Rejecting near-duplicate variant for ${account.platform}`);
            continue;
          }

          let hashtags: string[] = (parsed.hashtags ?? [])
            .map((h: string) => h.replace(/^#/, "").replace(/\s+/g, "").trim())
            .filter((h: string) => h.length > 0 && h.length < 50);

          if (campaignAlwaysHashtags.length > 0) {
            const existing = new Set(hashtags.map(h => h.toLowerCase()));
            for (const ah of campaignAlwaysHashtags) {
              if (!existing.has(ah.toLowerCase())) {
                hashtags.push(ah);
              }
            }
          }

          const adapted = applyPlatformRules(postContent, account.platform, hashtags);
          postContent = adapted.content;
          hashtags = adapted.hashtags;

          cleanedVariantsForAccount.push({
            content: postContent,
            hashtags,
            imagePrompt: parsed.imagePrompt ?? "",
            sourceUrl: pool.sourceUrl,
            sourceAssetId: pool.assetId,
            leadImageUrl: pool.leadImageUrl,
          });
          usedOpenings.push(postContent.replace(/\s+/g, " ").trim().slice(0, 80));
        }
      }

      console.log(`[Saturn] ${account.platform}/${account.accountName}: produced ${cleanedVariantsForAccount.length}/${targetVariantsPerPlatform} unique variants across ${safetyLoops} batches`);

      // Persist variants. Image-variation strategy:
      //   1. (if enabled) one row per variant carrying its source asset's
      //      lead image — these come first so day-1 scheduling shows the
      //      authentic asset visual.
      //   2. The existing brand-image × variant grid (image outer, variant
      //      inner — preserves the "same image, different copy on
      //      consecutive days" scheduling intent). Brand images that match
      //      a variant's own lead image URL are deduped.
      //   3. Text-only fallback rows for any variant left with no image
      //      attached (e.g. no brand images selected AND lead images
      //      disabled, or the source asset had no usable visual). Keeps
      //      drafts from being silently dropped.
      const haveBrand = brandImageAssets.length > 0;
      let leadCount = 0;
      let comboIndex = 0;
      let textOnlyCount = 0;

      const accountSocialAccountId = account.id === "placeholder" ? null : account.id;
      const buildBaseRow = (v: typeof cleanedVariantsForAccount[number]): InsertGeneratedPost => ({
        id: randomUUID(),
        campaignId,
        socialAccountId: accountSocialAccountId,
        tenantDomain,
        platform: account.platform,
        content: v.content,
        hashtags: v.hashtags,
        imagePrompt: v.imagePrompt,
        sourceUrl: v.sourceUrl,
        sourceAssetId: v.sourceAssetId,
        variantGroup: variantGroupId,
        generationJobId: jobId,
      } as InsertGeneratedPost);

      if (includeAssetLeadImages) {
        for (const v of cleanedVariantsForAccount) {
          if (!v.leadImageUrl) continue;
          generatedRows.push({
            ...buildBaseRow(v),
            overrideImageUrl: v.leadImageUrl,
          });
          leadCount++;
        }
      }

      if (haveBrand) {
        for (let ii = 0; ii < brandImageAssets.length; ii++) {
          const img = brandImageAssets[ii];
          const brandUrl = img.fileUrl || img.url || null;
          for (let vi = 0; vi < cleanedVariantsForAccount.length; vi++) {
            const v = cleanedVariantsForAccount[vi];
            // Skip a brand image that duplicates this variant's own lead
            // image — we already pushed that combo in pass 1.
            if (includeAssetLeadImages && v.leadImageUrl && brandUrl && brandUrl === v.leadImageUrl) {
              continue;
            }
            generatedRows.push({
              ...buildBaseRow(v),
              overrideBrandAssetId: img.id,
            });
            comboIndex++;
          }
        }
      }

      if (!haveBrand) {
        // No brand grid → make sure every variant has at least one row.
        // Variants that had a lead image are already covered above.
        for (const v of cleanedVariantsForAccount) {
          if (includeAssetLeadImages && v.leadImageUrl) continue;
          generatedRows.push(buildBaseRow(v));
          textOnlyCount++;
        }
      }

      console.log(
        `[Saturn] ${account.platform}: produced ${leadCount} lead-image + ${comboIndex} brand-image + ${textOnlyCount} text-only rows ` +
        `(${cleanedVariantsForAccount.length} unique texts, ${brandImageAssets.length} brand images, ` +
        `includeAssetLeadImages=${includeAssetLeadImages})`
      );
    }

    // Optional wrap-on-generate. Done as a final pass so the AI never has to
    // think about redirect URLs — we rewrite the URLs it produced into tracked
    // /r/:slug equivalents and persist a marketing_links row per unique URL.
    if (wrapOpts.wrapLinks && wrapOpts.ownerUserId && generatedRows.length > 0) {
      const utmCampaign = slugifyForUtm(campaignRow?.name, "campaign");
      let wrappedCount = 0;
      for (const row of generatedRows) {
        if (!row.content) continue;
        const platformSource = (row.platform || "social");
        try {
          const wrapped = await wrapOutboundLinksInText(row.content, {
            tenantDomain,
            marketId,
            campaignId,
            userId: wrapOpts.ownerUserId,
            utm: {
              source: platformSource,
              medium: "social",
              campaign: utmCampaign,
            },
            source: "post-wrap",
            redirectBase: { protocol: wrapOpts.redirectProtocol, host: wrapOpts.redirectHost },
            label: `${platformSource} · ${campaignRow?.name ?? "campaign"}`,
          });
          if (wrapped.createdSlugs.length > 0) {
            row.content = wrapped.text;
            wrappedCount += wrapped.createdSlugs.length;
          }
        } catch (err: any) {
          console.warn(`[Saturn] Link wrap failed for post:`, err.message);
        }
      }
      if (wrappedCount > 0) {
        console.log(`[Saturn] Wrapped ${wrappedCount} outbound links across ${generatedRows.length} posts`);
      }
    }

    reportProgress?.({ phase: "Saving posts", percent: 95 });
    if (generatedRows.length) {
      await db.insert(generatedPosts).values(generatedRows);
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
    linkedin: "Professional tone. 150-300 words. Include a clear value proposition and a call to action. Use line breaks for readability. Include the source URL once as a call-to-action link — never repeat it.",
    twitter: "HARD LIMIT: 280 characters TOTAL for content + hashtags combined. Keep post body under 180 characters to leave room for hashtags and a URL. One punchy sentence + URL. NEVER duplicate the URL. Do NOT write long-form content. Count characters carefully.",
    instagram: "Engaging and visual. 150-200 words. Use emojis sparingly. Strong opening line. Include the source URL once — never repeat it.",
    facebook: "Friendly and informative. 100-250 words. Encourage engagement with a question or CTA. Include the source URL once — never repeat it.",
  };
  return guides[platform] ?? "Professional and engaging. Clear call to action.";
}

function deduplicateUrls(text: string): string {
  const urlPattern = /https?:\/\/\S+/g;
  const urls = text.match(urlPattern);
  if (!urls || urls.length <= 1) return text;
  const seen = new Set<string>();
  return text.replace(urlPattern, (match) => {
    const normalized = match.replace(/\/+$/, "").toLowerCase();
    if (seen.has(normalized)) return "";
    seen.add(normalized);
    return match;
  }).replace(/\s{2,}/g, " ").trim();
}

function applyPlatformRules(text: string, platform: string, hashtags?: string[]): { content: string; hashtags: string[] } {
  let tags = hashtags ?? [];
  text = deduplicateUrls(text);

  if (platform === "twitter") {
    const hashtagLine = tags.map(h => `#${h}`).join(" ");
    const totalLen = text.length + (hashtagLine ? hashtagLine.length + 1 : 0);

    if (totalLen > 280) {
      const urlMatch = text.match(/https?:\/\/\S+/);
      const url = urlMatch ? urlMatch[0] : "";
      const textWithoutUrl = url ? text.replace(url, "").trim() : text;

      const fitWithHashtags = (body: string, ht: string[], u: string): string | null => {
        const htLine = ht.map(h => `#${h}`).join(" ");
        const parts = [body, u, htLine].filter(Boolean);
        const combined = parts.join(u && htLine ? " " : u ? " " : "\n");
        const total = body.length + (u ? u.length + 1 : 0) + (htLine ? htLine.length + 1 : 0);
        return total <= 280 ? combined : null;
      };

      const maxBodyForFull = 280 - (url ? url.length + 1 : 0) - (hashtagLine ? hashtagLine.length + 1 : 0);
      if (maxBodyForFull >= 40) {
        const trimmed = textWithoutUrl.substring(0, maxBodyForFull).replace(/[,.\s]+\S*$/, "").trim();
        text = [trimmed, url].filter(Boolean).join(" ");
      } else {
        const reducedTags = tags.slice(0, 2);
        const reducedLine = reducedTags.map(h => `#${h}`).join(" ");
        const maxBodyReduced = 280 - (url ? url.length + 1 : 0) - (reducedLine ? reducedLine.length + 1 : 0);
        if (maxBodyReduced >= 40) {
          const trimmed = textWithoutUrl.substring(0, maxBodyReduced).replace(/[,.\s]+\S*$/, "").trim();
          text = [trimmed, url].filter(Boolean).join(" ");
          tags = reducedTags;
        } else {
          tags = [];
          const maxBody = 280 - (url ? url.length + 1 : 0);
          if (maxBody >= 30) {
            const trimmed = textWithoutUrl.substring(0, maxBody).replace(/[,.\s]+\S*$/, "").trim();
            text = [trimmed, url].filter(Boolean).join(" ");
          } else {
            text = text.substring(0, 280);
          }
        }
      }
    }
  } else {
    text = deduplicateUrls(text);
  }

  return { content: text, hashtags: tags };
}
