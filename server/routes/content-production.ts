import type { Express } from "express";
import { db } from "../db";
import { contentAssets, contentOptimizations, generatedPosts } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { optimizeContent } from "../services/seo-aeo-service";
import { repurposeAsset } from "../services/repurpose-service";
import { rewriteLongFormContent } from "../services/copywriter-service";

export function registerContentProductionRoutes(app: Express) {
  // SEO/AEO optimize — accepts a contentAssetId or a raw { title, content }.
  app.post("/api/content/optimize", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "seoAeoOptimizer"))) return;
      const ctx = await getRequestContext(req);

      let title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      let content = typeof req.body?.content === "string" ? req.body.content : "";
      const contentAssetId =
        typeof req.body?.contentAssetId === "string" ? req.body.contentAssetId : undefined;

      if (contentAssetId) {
        const [asset] = await db
          .select()
          .from(contentAssets)
          .where(and(eq(contentAssets.id, contentAssetId), eq(contentAssets.tenantDomain, ctx.tenantDomain)));
        if (!asset) return res.status(404).json({ error: "Content asset not found" });
        title = title || asset.title;
        content = content || asset.content || asset.aiSummary || asset.description || "";
      }

      if (!title || !content.trim()) {
        return res.status(400).json({ error: "Provide a contentAssetId, or a title and content to optimize." });
      }

      const opt = await optimizeContent({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        isDefaultMarket: ctx.isDefaultMarket,
        title,
        content,
        contentAssetId,
      });

      const [row] = await db
        .insert(contentOptimizations)
        .values({
          id: randomUUID(),
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId || null,
          contentAssetId: contentAssetId || null,
          sourceTitle: title,
          seoTitle: opt.seoTitle,
          metaDescription: opt.metaDescription,
          slug: opt.slug,
          targetKeyword: opt.targetKeyword,
          keywords: opt.keywords.length ? opt.keywords : null,
          answerBlocks: opt.answerBlocks,
          faq: opt.faq,
          internalLinks: opt.internalLinks,
          contentGaps: opt.contentGaps,
          createdBy: ctx.userId,
        })
        .returning();

      res.status(201).json({ optimization: row, usage: opt.usage, model: opt.model });
    } catch (err: any) {
      console.error("[content optimize]", err);
      res.status(500).json({ error: err.message || "Failed to optimize content" });
    }
  });

  // Long-form AI rewrite: revise a content asset's body per instructions
  // (brand-voice grounded) and persist the result back to the asset.
  app.post("/api/content-assets/:id/rewrite", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);

      const instructions = typeof req.body?.instructions === "string" ? req.body.instructions.trim() : "";
      if (!instructions) return res.status(400).json({ error: "Provide rewrite instructions." });

      const [asset] = await db
        .select()
        .from(contentAssets)
        .where(and(eq(contentAssets.id, req.params.id), eq(contentAssets.tenantDomain, ctx.tenantDomain)));
      if (!asset) return res.status(404).json({ error: "Content asset not found" });
      if (!asset.content?.trim()) return res.status(409).json({ error: "This asset has no content to rewrite." });

      const rw = await rewriteLongFormContent({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        isDefaultMarket: ctx.isDefaultMarket,
        title: asset.title,
        body: asset.content,
        format: asset.assetType,
        instructions,
      });

      if (!rw.body.trim()) {
        return res.status(502).json({ error: "The AI did not return a usable rewrite. Please try again." });
      }

      await db
        .update(contentAssets)
        .set({ content: rw.body, updatedAt: new Date() })
        .where(eq(contentAssets.id, asset.id));

      res.json({ body: rw.body, usage: rw.usage, model: rw.model });
    } catch (err: any) {
      console.error("[content rewrite]", err);
      res.status(500).json({ error: err.message || "Failed to rewrite content" });
    }
  });

  // Repurpose a content asset into brand-aligned social variants written into
  // the generated_posts pipeline (standalone drafts, linked via sourceAssetId).
  app.post("/api/content-assets/:id/repurpose", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "contentRepurposing"))) return;
      const ctx = await getRequestContext(req);

      const [asset] = await db
        .select()
        .from(contentAssets)
        .where(and(eq(contentAssets.id, req.params.id), eq(contentAssets.tenantDomain, ctx.tenantDomain)));
      if (!asset) return res.status(404).json({ error: "Content asset not found" });

      const platforms = Array.isArray(req.body?.platforms) ? req.body.platforms : undefined;
      const count = req.body?.count ? Number(req.body.count) : undefined;

      const { variants, usage, model } = await repurposeAsset({
        asset,
        isDefaultMarket: ctx.isDefaultMarket,
        platforms,
        count,
      });

      if (variants.length === 0) {
        return res.status(502).json({ error: "The AI did not return any usable variants. Please try again." });
      }

      const variantGroup = randomUUID();
      const posts = await db
        .insert(generatedPosts)
        .values(
          variants.map((v) => ({
            id: randomUUID(),
            campaignId: null,
            tenantDomain: ctx.tenantDomain,
            platform: v.platform,
            content: v.content,
            hashtags: v.hashtags,
            sourceAssetId: asset.id,
            variantGroup,
            status: "draft",
          })),
        )
        .returning();

      res.status(201).json({ variantGroup, posts, count: posts.length, usage, model });
    } catch (err: any) {
      console.error("[content repurpose]", err);
      res.status(500).json({ error: err.message || "Failed to repurpose content" });
    }
  });
}
