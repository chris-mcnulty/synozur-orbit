import type { Express } from "express";
import { db } from "../db";
import { contentAssets, contentOptimizations, generatedPosts } from "@shared/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import type { RequestContext } from "../context";
import { guardFeature } from "./helpers";
import { optimizeContent } from "../services/seo-aeo-service";
import { repurposeAsset, repurposeToLongForm, repurposeMultiFormat } from "../services/repurpose-service";
import type { RepurposeSelection } from "../services/repurpose-service";
import { rewriteLongFormContent } from "../services/copywriter-service";
import {
  isLongformRepurposeFormat,
  longformFormatToAssetType,
  isRepurposeBatchFormat,
  REPURPOSE_FORMAT_DEFS,
  extractCarouselSlides,
  type LongformRepurposeFormat,
} from "../services/repurpose-core";
import type { CarouselSlide } from "@shared/schema";
import {
  generateBrandedPostGraphic,
  generateBrandedCarouselSet,
  generateBrandedCarouselSlides,
} from "../services/conference-promotion-service";

// Canonical market scope for shared content_assets rows: default-market data
// may be stored with the default market id OR NULL (cross-feature convention),
// so match both for the default market.
function assetMarketScope(ctx: RequestContext) {
  return ctx.isDefaultMarket
    ? or(eq(contentAssets.marketId, ctx.marketId), isNull(contentAssets.marketId))
    : eq(contentAssets.marketId, ctx.marketId);
}

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
          .where(and(eq(contentAssets.id, contentAssetId), eq(contentAssets.tenantDomain, ctx.tenantDomain), assetMarketScope(ctx)));
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

      // WS3: also persist the headline SEO fields onto the asset itself so they
      // are usable inline (and the deeper AEO data stays linked via the row above).
      if (contentAssetId) {
        await db
          .update(contentAssets)
          .set({
            seoTitle: opt.seoTitle,
            metaDescription: opt.metaDescription,
            seoSlug: opt.slug,
            seoKeywords: opt.keywords.length ? opt.keywords : null,
            seoOptimizedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(contentAssets.id, contentAssetId), eq(contentAssets.tenantDomain, ctx.tenantDomain), assetMarketScope(ctx)));
      }

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
        .where(and(eq(contentAssets.id, req.params.id), eq(contentAssets.tenantDomain, ctx.tenantDomain), assetMarketScope(ctx)));
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
        .where(and(eq(contentAssets.id, asset.id), eq(contentAssets.tenantDomain, ctx.tenantDomain), assetMarketScope(ctx)));

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
        .where(and(eq(contentAssets.id, req.params.id), eq(contentAssets.tenantDomain, ctx.tenantDomain), assetMarketScope(ctx)));
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
            imagePrompt: v.imagePrompt,
            sourceAssetId: asset.id,
            variantGroup,
            status: "draft",
          })),
        )
        .returning();

      // Auto-generate a matched branded graphic for each variant so every post
      // ships with a visual. Best-effort: a failed render leaves that post
      // image-less rather than failing the whole repurpose.
      const withImages = await Promise.allSettled(
        posts.map(async (post) => {
          const headline = (post.imagePrompt || post.content || "").trim().slice(0, 200);
          if (!headline) return post;
          const saved = await generateBrandedPostGraphic({
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            headline,
          });
          const [row] = await db
            .update(generatedPosts)
            .set({ overrideImageUrl: saved.fileUrl, updatedAt: new Date() })
            .where(and(eq(generatedPosts.id, post.id), eq(generatedPosts.tenantDomain, ctx.tenantDomain)))
            .returning();
          return row ?? post;
        }),
      );
      const finalPosts = withImages.map((r, i) => (r.status === "fulfilled" ? r.value : posts[i]));
      const imagesGenerated = finalPosts.filter((p) => p.overrideImageUrl).length;

      res.status(201).json({
        variantGroup,
        posts: finalPosts,
        count: finalPosts.length,
        imagesGenerated,
        usage,
        model,
      });
    } catch (err: any) {
      console.error("[content repurpose]", err);
      res.status(500).json({ error: err.message || "Failed to repurpose content" });
    }
  });

  // Repurpose a content asset into a NEW long-form/derivative asset (blog,
  // newsletter, video script, podcast outline, whitepaper, carousel). Reviving
  // the breadth of the original repurposing engine beyond social fan-out.
  app.post("/api/content-assets/:id/repurpose-longform", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "contentRepurposing"))) return;
      const ctx = await getRequestContext(req);

      const format = req.body?.format;
      if (!isLongformRepurposeFormat(format)) {
        return res.status(400).json({ error: "Provide a valid long-form format to repurpose into." });
      }

      const [asset] = await db
        .select()
        .from(contentAssets)
        .where(and(eq(contentAssets.id, req.params.id), eq(contentAssets.tenantDomain, ctx.tenantDomain), assetMarketScope(ctx)));
      if (!asset) return res.status(404).json({ error: "Content asset not found" });
      if (!(asset.content || asset.aiSummary || asset.description)?.trim()) {
        return res.status(409).json({ error: "This asset has no content to repurpose." });
      }

      const fmt = format as LongformRepurposeFormat;
      const { title, body, meta, usage, model } = await repurposeToLongForm({
        asset,
        format: fmt,
        isDefaultMarket: ctx.isDefaultMarket,
      });
      if (!body.trim()) {
        return res.status(502).json({ error: "The AI did not return usable content. Please try again." });
      }

      // For carousels, render one branded image per slide and surface them.
      // Best-effort: if rendering fails we still save the text body. The slide
      // images are embedded into the body markdown and the first becomes the
      // asset's lead image, so they persist without any new schema.
      let finalBody = body;
      let leadImageUrl: string | null = null;
      let slideImages: { index: number; headline: string; fileUrl: string }[] = [];
      if (fmt === "carousel") {
        try {
          const slides = extractCarouselSlides(body);
          const rendered = await generateBrandedCarouselSlides({
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            slides,
          });
          if (rendered.length > 0) {
            leadImageUrl = rendered[0].fileUrl;
            slideImages = rendered.map((s) => ({ index: s.index, headline: s.headline, fileUrl: s.fileUrl }));
            const imageMarkdown = rendered
              .map((s) => `![Slide ${s.index}: ${s.headline}](${s.fileUrl})`)
              .join("\n\n");
            finalBody = `${body.trim()}\n\n---\n\n## Slide images\n\n${imageMarkdown}\n`;
          }
        } catch (imgErr) {
          console.error("[content repurpose-longform carousel images]", imgErr);
        }
      }

      const [created] = await db
        .insert(contentAssets)
        .values({
          id: randomUUID(),
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId || null,
          title,
          description: meta,
          content: finalBody,
          aiSummary: meta,
          assetType: longformFormatToAssetType(fmt),
          leadImageUrl,
          productIds: asset.productIds ?? null,
          repurposedFromAssetId: asset.id,
          status: "active",
          createdBy: ctx.userId,
        })
        .returning();

      res.status(201).json({ asset: created, slideImages, usage, model });
    } catch (err: any) {
      console.error("[content repurpose-longform]", err);
      res.status(500).json({ error: err.message || "Failed to repurpose content" });
    }
  });

  // Multi-format repurposer: from one source asset, generate every selected
  // output type in a single batch. Posts/carousels land in the generated_posts
  // pipeline as drafts; snippets land in the Content Library as draft assets.
  // Branded images are auto-generated and degrade gracefully on failure.
  app.post("/api/content-assets/:id/repurpose-batch", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "contentRepurposing"))) return;
      const ctx = await getRequestContext(req);

      const rawSelections = Array.isArray(req.body?.selections) ? req.body.selections : [];
      const selections: RepurposeSelection[] = [];
      for (const s of rawSelections) {
        if (!isRepurposeBatchFormat(s?.format)) continue;
        const count = Number(s?.count);
        if (!Number.isFinite(count) || count < 1) continue;
        selections.push({ format: s.format, count: Math.floor(count) });
      }
      if (selections.length === 0) {
        return res.status(400).json({ error: "Select at least one content type to generate." });
      }

      const [asset] = await db
        .select()
        .from(contentAssets)
        .where(and(eq(contentAssets.id, req.params.id), eq(contentAssets.tenantDomain, ctx.tenantDomain), assetMarketScope(ctx)));
      if (!asset) return res.status(404).json({ error: "Content asset not found" });
      if (!(asset.content || asset.aiSummary || asset.description)?.trim()) {
        return res.status(409).json({ error: "This asset has no content to repurpose." });
      }

      const { items, errors, usage, model } = await repurposeMultiFormat({
        asset,
        selections,
        isDefaultMarket: ctx.isDefaultMarket,
      });

      if (items.length === 0) {
        return res.status(502).json({
          error: "The AI did not return any usable content. Please try again.",
          errors,
        });
      }

      const variantGroup = randomUUID();
      const createdPosts: any[] = [];
      const createdAssets: any[] = [];
      const imageWarnings: { format: string; message: string }[] = [];

      for (const item of items) {
        if (item.kind === "post") {
          const isCarousel = item.postFormat === "carousel";

          // Build the branded image(s) first, degrading gracefully on failure so
          // the draft is always created even if compositing fails.
          let overrideImageUrl: string | null = null;
          let carouselSlides: CarouselSlide[] | null = item.slides ?? null;

          if (isCarousel && item.slides && item.slides.length > 0) {
            try {
              const rendered = await generateBrandedCarouselSet({
                tenantDomain: ctx.tenantDomain,
                marketId: ctx.marketId || null,
                slides: item.slides.map((s) => ({
                  index: s.index,
                  total: item.slides!.length,
                  role: s.role,
                  kicker: s.kicker,
                  headline: s.headline,
                  supportingLines: s.supportingLines,
                })),
              });
              carouselSlides = item.slides.map((s, i) => ({
                ...s,
                imageUrl: rendered[i]?.fileUrl ?? s.imageUrl ?? null,
              }));
              overrideImageUrl = rendered[0]?.fileUrl ?? null;
            } catch (imgErr: any) {
              imageWarnings.push({ format: item.format, message: imgErr?.message || "carousel image generation failed" });
            }
          } else {
            try {
              const headline = (item.meta.coreIdea || item.content || asset.title).slice(0, 200);
              const saved = await generateBrandedPostGraphic({
                tenantDomain: ctx.tenantDomain,
                marketId: ctx.marketId || null,
                headline,
              });
              overrideImageUrl = saved.fileUrl;
            } catch (imgErr: any) {
              imageWarnings.push({ format: item.format, message: imgErr?.message || "image generation failed" });
            }
          }

          const [row] = await db
            .insert(generatedPosts)
            .values({
              id: randomUUID(),
              campaignId: null,
              tenantDomain: ctx.tenantDomain,
              platform: item.platform,
              content: item.content,
              imagePrompt: item.imagePrompt,
              overrideImageUrl,
              postFormat: item.postFormat,
              carouselSlides,
              repurposeMeta: item.meta,
              sourceAssetId: asset.id,
              variantGroup,
              status: "draft",
            })
            .returning();
          createdPosts.push(row);
        } else {
          const [row] = await db
            .insert(contentAssets)
            .values({
              id: randomUUID(),
              tenantDomain: ctx.tenantDomain,
              marketId: ctx.marketId || null,
              title: item.title,
              description: item.meta.coreIdea ?? null,
              content: item.body,
              aiSummary: item.meta.coreIdea ?? null,
              assetType: item.assetType,
              productIds: asset.productIds ?? null,
              repurposedFromAssetId: asset.id,
              repurposeMeta: item.meta,
              status: "draft",
              createdBy: ctx.userId,
            })
            .returning();
          createdAssets.push(row);
        }
      }

      // Group results by format label for the results view.
      const groups = Object.values(REPURPOSE_FORMAT_DEFS).map((def) => {
        const posts = createdPosts.filter((p) => p.repurposeMeta?.format === def.label);
        const assets = createdAssets.filter((a) => a.repurposeMeta?.format === def.label);
        return {
          format: def.key,
          label: def.label,
          destination: def.destination,
          posts,
          assets,
          count: posts.length + assets.length,
        };
      }).filter((g) => g.count > 0);

      res.status(201).json({
        variantGroup,
        groups,
        posts: createdPosts,
        assets: createdAssets,
        totalCount: createdPosts.length + createdAssets.length,
        errors,
        imageWarnings,
        usage,
        model,
      });
    } catch (err: any) {
      console.error("[content repurpose-batch]", err);
      res.status(500).json({ error: err.message || "Failed to repurpose content" });
    }
  });

  // Generate a brand-aligned graphic for a social post and attach it, keeping
  // the post and its visual coupled. Uses the post's content/imagePrompt as the
  // headline source.
  app.post("/api/generated-posts/:id/generate-image", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "contentRepurposing"))) return;
      const ctx = await getRequestContext(req);

      const [post] = await db
        .select()
        .from(generatedPosts)
        .where(and(eq(generatedPosts.id, req.params.id), eq(generatedPosts.tenantDomain, ctx.tenantDomain)));
      if (!post) return res.status(404).json({ error: "Post not found" });

      const headlineSource =
        (typeof req.body?.headline === "string" && req.body.headline.trim()) ||
        post.imagePrompt ||
        post.editedContent ||
        post.content ||
        "";
      const headline = headlineSource.trim().slice(0, 200);
      if (!headline) return res.status(422).json({ error: "No text available to build a graphic from." });

      const saved = await generateBrandedPostGraphic({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId || null,
        headline,
      });

      const [row] = await db
        .update(generatedPosts)
        .set({ overrideImageUrl: saved.fileUrl, updatedAt: new Date() })
        .where(and(eq(generatedPosts.id, post.id), eq(generatedPosts.tenantDomain, ctx.tenantDomain)))
        .returning();

      res.json({ post: row, imageUrl: saved.fileUrl });
    } catch (err: any) {
      console.error("[generated-post generate-image]", err);
      res.status(500).json({ error: err.message || "Failed to generate image" });
    }
  });
}
