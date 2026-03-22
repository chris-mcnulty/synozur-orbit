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
import { eq, and, desc } from "drizzle-orm";
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
    res.status(500).json({ error: err.message });
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
    const rows = await db.select().from(contentAssets)
      .where(and(
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
        eq(contentAssets.marketId, ctx.marketId),
        eq(contentAssets.status, "active"),
      ))
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
    const { title, description, url, content, categoryId, productTagIds } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "title is required" });
    const [row] = await db.insert(contentAssets).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      title: title.trim(),
      description,
      url,
      content,
      categoryId,
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
    const { title, description, url, content, categoryId, status, productTagIds } = req.body;
    const [row] = await db.update(contentAssets)
      .set({ title, description, url, content, categoryId, status, updatedAt: new Date() })
      .where(and(
        eq(contentAssets.id, req.params.id),
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
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
      ));
    res.status(204).send();
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
    const rows = await db.select().from(brandAssets)
      .where(and(
        eq(brandAssets.tenantDomain, ctx.tenantDomain),
        eq(brandAssets.marketId, ctx.marketId),
        eq(brandAssets.status, "active"),
      ))
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
      ));
    if (!row) return res.status(404).json({ error: "Not found" });
    const tagLinks = await db.select().from(brandAssetProductTags)
      .where(eq(brandAssetProductTags.assetId, row.id));
    res.json({ ...row, productTagIds: tagLinks.map(t => t.tagId) });
  });

  app.post("/api/brand-assets", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    const { name, description, url, categoryId, productTagIds } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const [row] = await db.insert(brandAssets).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name: name.trim(),
      description,
      url,
      categoryId,
      createdBy: ctx.userId,
    } as InsertBrandAsset).returning();
    if (productTagIds?.length) {
      await db.insert(brandAssetProductTags).values(
        productTagIds.map((tagId: string) => ({ assetId: row.id, tagId }))
      );
    }
    res.status(201).json(row);
  });

  app.patch("/api/brand-assets/:id", async (req, res) => {
    if (!await guardFeature(req, res, "brandLibrary")) return;
    const ctx = await getRequestContext(req);
    const { name, description, url, categoryId, status, productTagIds } = req.body;
    const [row] = await db.update(brandAssets)
      .set({ name, description, url, categoryId, status, updatedAt: new Date() })
      .where(and(
        eq(brandAssets.id, req.params.id),
        eq(brandAssets.tenantDomain, ctx.tenantDomain),
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
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(campaigns)
      .where(and(
        eq(campaigns.tenantDomain, ctx.tenantDomain),
        eq(campaigns.marketId, ctx.marketId),
      ))
      .orderBy(desc(campaigns.createdAt));
    res.json(rows);
  });

  app.get("/api/campaigns/:id", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
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
  });

  app.post("/api/campaigns", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const { name, description, startDate, endDate } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const [row] = await db.insert(campaigns).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name: name.trim(),
      description,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      createdBy: ctx.userId,
    } as InsertCampaign).returning();
    res.status(201).json(row);
  });

  app.patch("/api/campaigns/:id", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const { name, description, status, startDate, endDate } = req.body;
    const [row] = await db.update(campaigns)
      .set({
        name, description, status,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        updatedAt: new Date(),
      })
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

  // Campaign Assets

  app.post("/api/campaigns/:id/assets", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const { assetId, overrideTitle, overrideContent, sortOrder } = req.body;
    if (!assetId) return res.status(400).json({ error: "assetId is required" });
    const [row] = await db.insert(campaignAssets).values({
      id: randomUUID(),
      campaignId: campaign.id,
      assetId,
      overrideTitle,
      overrideContent,
      sortOrder: sortOrder ?? 0,
    } as InsertCampaignAsset).returning();
    res.status(201).json(row);
  });

  app.patch("/api/campaigns/:campaignId/assets/:assetId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    const { overrideTitle, overrideContent, sortOrder } = req.body;
    const [row] = await db.update(campaignAssets)
      .set({ overrideTitle, overrideContent, sortOrder })
      .where(and(
        eq(campaignAssets.campaignId, req.params.campaignId),
        eq(campaignAssets.assetId, req.params.assetId),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/campaigns/:campaignId/assets/:assetId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    await db.delete(campaignAssets)
      .where(and(
        eq(campaignAssets.campaignId, req.params.campaignId),
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
    const [row] = await db.insert(campaignSocialAccounts).values({
      id: randomUUID(),
      campaignId: campaign.id,
      socialAccountId,
    } as InsertCampaignSocialAccount).returning();
    res.status(201).json(row);
  });

  app.delete("/api/campaigns/:campaignId/social-accounts/:accountId", async (req, res) => {
    if (!await guardFeature(req, res, "campaigns")) return;
    await db.delete(campaignSocialAccounts)
      .where(and(
        eq(campaignSocialAccounts.campaignId, req.params.campaignId),
        eq(campaignSocialAccounts.socialAccountId, req.params.accountId),
      ));
    res.status(204).send();
  });

  // ══════════════════════════════════════════════════════════
  // GENERATED POSTS — list, update, delete
  // ══════════════════════════════════════════════════════════

  app.get("/api/campaigns/:id/generated-posts", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    const ctx = await getRequestContext(req);
    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const posts = await db.select().from(generatedPosts)
      .where(eq(generatedPosts.campaignId, campaign.id))
      .orderBy(generatedPosts.platform, desc(generatedPosts.createdAt));
    res.json(posts);
  });

  app.put("/api/campaigns/:campaignId/generated-posts/:postId", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    const { editedContent, status } = req.body;
    const [row] = await db.update(generatedPosts)
      .set({ editedContent, status, updatedAt: new Date() })
      .where(eq(generatedPosts.id, req.params.postId))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.delete("/api/campaigns/:campaignId/generated-posts/:postId", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    await db.update(generatedPosts)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(eq(generatedPosts.id, req.params.postId));
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

  // SocialPilot CSV export
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

    const lines = ["message,scheduled_time,account"];
    for (const post of posts) {
      const content = (post.editedContent ?? post.content).replace(/"/g, '""');
      lines.push(`"${content}",,${post.platform}`);
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="campaign-${campaign.id}-posts.csv"`);
    res.send(lines.join("\n"));
  });

  // ══════════════════════════════════════════════════════════
  // EMAIL GENERATION
  // ══════════════════════════════════════════════════════════

  app.post("/api/email/generate", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    const ctx = await getRequestContext(req);
    const { campaignId, assetIds, instructions } = req.body;

    // Load selected assets
    const assetRows = assetIds?.length
      ? await db.select().from(contentAssets).where(
          and(eq(contentAssets.tenantDomain, ctx.tenantDomain))
        )
      : [];
    const selectedAssets = assetRows.filter((a: any) => (assetIds ?? []).includes(a.id));

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
      .map((a: any) => `## ${a.title}\n${a.content ?? a.description ?? ""}`)
      .join("\n\n");

    const prompt = `You are an expert B2B email marketing copywriter. Generate a professional promotional email based on the following content assets and brand guidelines.

${groundingContext ? `## Brand & Marketing Guidelines\n${groundingContext}\n\n` : ""}## Content Assets\n${assetContext || "(no assets provided)"}

${instructions ? `## Additional Instructions\n${instructions}\n\n` : ""}Return a JSON object with:
- subject: string (email subject line)
- previewText: string (40-90 char preview text)
- htmlBody: string (complete HTML email body, inline styles, responsive)
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
      .where(eq(generatedEmails.tenantDomain, ctx.tenantDomain))
      .orderBy(desc(generatedEmails.createdAt));
    res.json(rows);
  });

  app.post("/api/email/saved", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    const ctx = await getRequestContext(req);
    const { campaignId, subject, previewText, htmlBody, textBody } = req.body;
    if (!subject?.trim() || !htmlBody?.trim()) {
      return res.status(400).json({ error: "subject and htmlBody are required" });
    }
    const [row] = await db.insert(generatedEmails).values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      campaignId,
      subject,
      previewText,
      htmlBody,
      textBody,
      createdBy: ctx.userId,
    } as InsertGeneratedEmail).returning();
    res.status(201).json(row);
  });

  app.delete("/api/email/saved/:id", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    const ctx = await getRequestContext(req);
    await db.update(generatedEmails)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(generatedEmails.id, req.params.id),
        eq(generatedEmails.tenantDomain, ctx.tenantDomain),
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
    const assetRows = assetIds.length
      ? await db.select().from(contentAssets).where(eq(contentAssets.tenantDomain, tenantDomain))
      : [];
    const selectedAssets = assetRows.filter((a: any) => assetIds.includes(a.id));

    // Load linked social accounts
    const camSocial = await db.select().from(campaignSocialAccounts)
      .where(eq(campaignSocialAccounts.campaignId, campaignId));
    const socialIds = camSocial.map(cs => cs.socialAccountId);
    const socialRows = socialIds.length
      ? await db.select().from(socialAccounts).where(eq(socialAccounts.tenantDomain, tenantDomain))
      : [];
    const linkedAccounts = socialRows.filter((s: any) => socialIds.includes(s.id));

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
      .map((a: any) => `## ${a.title}\n${a.content ?? a.description ?? ""}`)
      .join("\n\n");

    const platformTargets = linkedAccounts.length
      ? linkedAccounts
      : [{ id: "placeholder", platform: "linkedin", accountName: "Your Company" }];

    const generatedRows: InsertGeneratedPost[] = [];

    for (const account of platformTargets) {
      const platformGuide = getPlatformGuide(account.platform);
      const prompt = `You are an expert B2B social media copywriter. Generate a single ${account.platform} post for the account "${account.accountName}" based on the following content.

${groundingContext ? `## Brand & Marketing Guidelines\n${groundingContext}\n\n` : ""}## Content Assets\n${assetContext || "(no specific assets provided — draw from your knowledge of best practices)"}

## Platform Guidelines\n${platformGuide}

Return a JSON object with:
- content: string (the post body)
- hashtags: string[] (3-5 relevant hashtags without the # symbol)
- imagePrompt: string (a suggested image description for this post)`;

      const result = await completeForFeature("marketing_tasks", [
        { role: "user", content: prompt }
      ]);

      let parsed: any = {};
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch {
        parsed = { content: result.content, hashtags: [], imagePrompt: "" };
      }

      generatedRows.push({
        id: randomUUID(),
        campaignId,
        socialAccountId: account.id === "placeholder" ? account.id : account.id,
        tenantDomain,
        platform: account.platform,
        content: parsed.content ?? result.content,
        hashtags: parsed.hashtags ?? [],
        imagePrompt: parsed.imagePrompt ?? "",
        generationJobId: jobId,
      } as InsertGeneratedPost);
    }

    if (generatedRows.length) {
      await db.insert(generatedPosts).values(generatedRows);
    }

    await db.update(scheduledJobRuns)
      .set({ status: "completed", completedAt: new Date(), result: { postsGenerated: generatedRows.length } })
      .where(eq(scheduledJobRuns.id, jobId));
  } catch (err: any) {
    await db.update(scheduledJobRuns)
      .set({ status: "failed", completedAt: new Date(), errorMessage: err.message })
      .where(eq(scheduledJobRuns.id, jobId));
    throw err;
  }
}

function getPlatformGuide(platform: string): string {
  const guides: Record<string, string> = {
    linkedin: "Professional tone. 150-300 words. Include a clear value proposition and a call to action. Use line breaks for readability.",
    twitter: "Concise and punchy. Max 280 characters. Conversational. One key message only.",
    instagram: "Engaging and visual. 150-200 words. Use emojis sparingly. Strong opening line.",
    facebook: "Friendly and informative. 100-250 words. Encourage engagement with a question or CTA.",
  };
  return guides[platform] ?? "Professional and engaging. Clear call to action.";
}
