/**
 * Marketing Posts Routes — Phase 2/3/4 of social posting personalization
 *
 *   - POST   /api/posts/rewrite-preview        AI rewrite for an unsaved draft
 *   - POST   /api/generated-posts/:id/rewrite  AI rewrite for an existing post
 *   - POST   /api/generated-posts              Create a standalone post
 *   - PATCH  /api/generated-posts/:id          Update standalone or campaign post
 *   - DELETE /api/generated-posts/:id          Delete a post
 *   - GET    /api/generated-posts/calendar     Calendar view (date-range list)
 *
 * Auth: tenant-scoped via getRequestContext. Gated by socialPosts feature.
 *
 * Standalone posts:
 *  - campaignId is nullable on generated_posts (migration 0017).
 *  - The publish worker auto-publishes campaign posts only when the
 *    campaign-link has autoPublish=true. Standalone posts auto-publish
 *    purely on schedule + status='approved' — see marketing-publish-worker.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { and, eq, ne, gte, lte, isNotNull, inArray, or, isNull, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  generatedPosts,
  socialAccounts,
  socialAccountVoiceProfiles,
  campaigns,
  marketingAuditLog,
  brandAssets,
  marketingLinks,
  AI_FEATURES,
  type VoiceFrameworkRef,
  type GeneratedPost,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { generateBrandedPostGraphic } from "../services/conference-promotion-service";
import { storage } from "../storage";
import { completeForFeature } from "../services/ai-provider";
import { guardFeature } from "./helpers";
import {
  fetchVoiceProfile,
  fetchPersona,
  resolveFrameworkRefs,
  buildSystemPrompt,
  buildRewriteUserPrompt,
  parseVariants,
  snapshotVoiceProfile,
} from "../services/voice-service";

// Status values generated_posts.status can take. Mirrors the values used
// by marketing-publish-worker and the campaign post UI; PATCH validates
// against this list to avoid persisting unknown enum values.
const ALLOWED_POST_STATUSES: readonly string[] = [
  "draft",
  "approved",
  "rejected",
  "published",
  "publish_failed",
  "missed",
  "deleted",
];

function sanitizeFrameworkRefs(input: unknown): VoiceFrameworkRef[] {
  if (!Array.isArray(input)) return [];
  const out: VoiceFrameworkRef[] = [];
  for (const r of input) {
    if (!r || typeof r !== "object") continue;
    const kind = (r as any).kind;
    const id = (r as any).id;
    if (typeof id !== "string" || !id) continue;
    if (kind !== "long_form" && kind !== "grounding" && kind !== "global") continue;
    out.push({ kind, id });
  }
  return out;
}

/**
 * Trim to at most `max` characters without cutting mid-word. Backs up to the
 * last clause (comma) or word boundary and appends an ellipsis only when text
 * was actually dropped — so headlines never end on a chopped word.
 */
function clampToBoundary(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastComma = slice.lastIndexOf(", ");
  const lastSpace = slice.lastIndexOf(" ");
  const breakAt = lastComma > max * 0.6 ? lastComma : lastSpace;
  const cut = breakAt > 0 ? slice.slice(0, breakAt) : slice;
  return cut.replace(/[\s,;:.!?-]+$/, "") + "…";
}

function derivePostHeadline(provided: unknown, post: GeneratedPost): string | null {
  // The graphic now scales the font to fit, so we can keep a fuller, more
  // provocative thought rather than hard-cutting at ~one line of text.
  const MAX = 140;
  if (typeof provided === "string" && provided.trim()) {
    return clampToBoundary(provided, MAX);
  }
  const raw = (post.editedContent || post.content || "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/https?:\/\/\S+/g, "")
    .replace(/#[^\s#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const firstSentence = cleaned.split(/(?<=[.!?])\s/)[0] || cleaned;
  return clampToBoundary(firstSentence, MAX);
}

interface RewriteRequestBody {
  draft?: string;
  brief?: string;
  socialAccountId?: string;
  personaId?: string | null;
  frameworkRefs?: VoiceFrameworkRef[];
  instructions?: string;
  variantCount?: number;
}

async function runRewrite(opts: {
  body: RewriteRequestBody;
  account: typeof socialAccounts.$inferSelect;
  tenantDomain: string;
}): Promise<{
  variants: string[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  model: string;
  /** Persona id actually used for the rewrite (after profile-default fallback). */
  resolvedPersonaId: string | null;
  /** Sanitized + default-applied framework refs that were sent to the LLM. */
  resolvedFrameworkRefs: VoiceFrameworkRef[];
}> {
  const { body, account, tenantDomain } = opts;
  const profile = await fetchVoiceProfile(account.id);

  // Optional persona — fall back to profile default if caller didn't pass one.
  // null is treated as an explicit "none" (do not use even the default).
  let persona = null;
  if (body.personaId === undefined) {
    if (profile?.defaultPersonaId) {
      persona = await fetchPersona(profile.defaultPersonaId, tenantDomain);
    }
  } else if (body.personaId) {
    persona = await fetchPersona(body.personaId, tenantDomain);
  }

  // Optional framework refs — same fallback semantics: undefined means use
  // profile defaults, [] means explicitly none.
  const refsToUse: VoiceFrameworkRef[] =
    body.frameworkRefs !== undefined
      ? sanitizeFrameworkRefs(body.frameworkRefs)
      : (profile?.defaultFrameworkRefs ?? []);
  const frameworks = await resolveFrameworkRefs(refsToUse, tenantDomain);

  const systemPrompt = buildSystemPrompt({
    account,
    profile,
    persona,
    frameworks,
    platform: account.platform,
    instructions: body.instructions ?? null,
  });
  const userPrompt = buildRewriteUserPrompt({
    draft: body.draft ?? null,
    brief: body.brief ?? null,
    variantCount: body.variantCount,
  });

  const result = await completeForFeature(AI_FEATURES.MARKETING_TASKS, userPrompt, {
    systemPrompt,
    temperature: 0.7,
    maxTokens: 1500,
    tenantDomain,
  });

  const variants = parseVariants(result.text, body.variantCount ?? 3);
  return {
    variants,
    usage: result.usage,
    model: result.model,
    resolvedPersonaId: persona?.id ?? null,
    resolvedFrameworkRefs: refsToUse,
  };
}

// ─── route registration ─────────────────────────────────────────────────────

export function registerMarketingPostsRoutes(app: Express) {
  // ───── Rewrite preview (no post id required) ─────
  app.post("/api/posts/rewrite-preview", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const body = (req.body ?? {}) as RewriteRequestBody;
      if (!body.socialAccountId) {
        return res.status(400).json({ error: "socialAccountId is required" });
      }
      const [account] = await db.select().from(socialAccounts).where(and(
        eq(socialAccounts.id, body.socialAccountId),
        eq(socialAccounts.tenantDomain, ctx.tenantDomain),
      ));
      if (!account) return res.status(404).json({ error: "Social account not found" });

      // Need at least a draft, brief, or some signal. Voice profile alone is
      // OK for rewriting an existing draft, but a preview with nothing to
      // work from is rejected to avoid burning tokens on noise.
      if (!body.draft && !body.brief && !body.instructions) {
        return res.status(400).json({ error: "Provide a draft, brief, or instructions to rewrite from." });
      }

      const out = await runRewrite({ body, account, tenantDomain: ctx.tenantDomain });
      res.json(out);
    } catch (err: any) {
      console.error("[Posts Rewrite Preview Error]", err.message);
      res.status(500).json({ error: err.message || "Rewrite failed" });
    }
  });

  // ───── Rewrite an existing generated_post ─────
  app.post("/api/generated-posts/:id/rewrite", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [post] = await db.select().from(generatedPosts).where(and(
        eq(generatedPosts.id, req.params.id),
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
      ));
      if (!post) return res.status(404).json({ error: "Post not found" });
      if (!post.socialAccountId) {
        return res.status(409).json({ error: "Post has no social account; assign one before rewriting." });
      }
      const [account] = await db.select().from(socialAccounts).where(and(
        eq(socialAccounts.id, post.socialAccountId),
        eq(socialAccounts.tenantDomain, ctx.tenantDomain),
      ));
      if (!account) return res.status(404).json({ error: "Linked social account not found" });

      const body = (req.body ?? {}) as RewriteRequestBody;
      const out = await runRewrite({
        body: {
          ...body,
          // Default the draft to the post's edited or generated content if
          // the caller didn't pass one.
          draft: body.draft ?? post.editedContent ?? post.content,
        },
        account,
        tenantDomain: ctx.tenantDomain,
      });

      // Append a lineage entry — but never overwrite editedContent here. The
      // user picks a variant and applies it via the standard PATCH route.
      // Persist the RESOLVED persona/framework refs (after sanitization +
      // profile-default fallback) so lineage matches what the LLM actually
      // saw, not the raw request body.
      const newLineageEntry = {
        at: new Date().toISOString(),
        by: req.session.userId ?? null,
        prompt: body.instructions ?? null,
        model: out.model,
        personaId: out.resolvedPersonaId,
        frameworkRefs: out.resolvedFrameworkRefs,
      };
      const existing = (post.rewriteLineage ?? []) as Array<typeof newLineageEntry>;
      await db.update(generatedPosts).set({
        rewriteLineage: [...existing, newLineageEntry].slice(-20),
        updatedAt: new Date(),
      }).where(eq(generatedPosts.id, post.id));

      res.json(out);
    } catch (err: any) {
      console.error("[Post Rewrite Error]", err.message);
      res.status(500).json({ error: err.message || "Rewrite failed" });
    }
  });

  // ───── Create a standalone post (campaignId nullable) ─────
  app.post("/api/generated-posts", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const {
        socialAccountId,
        content,
        editedContent,
        hashtags,
        scheduledDate,
        sourceUrl,
        campaignId,
      } = req.body ?? {};

      if (!socialAccountId || typeof socialAccountId !== "string") {
        return res.status(400).json({ error: "socialAccountId is required" });
      }
      if (!content || typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "content is required" });
      }
      const [account] = await db.select().from(socialAccounts).where(and(
        eq(socialAccounts.id, socialAccountId),
        eq(socialAccounts.tenantDomain, ctx.tenantDomain),
      ));
      if (!account) return res.status(404).json({ error: "Social account not found" });

      // If campaignId was supplied, verify ownership. Null is allowed (standalone).
      if (campaignId) {
        const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(and(
          eq(campaigns.id, campaignId),
          eq(campaigns.tenantDomain, ctx.tenantDomain),
        ));
        if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      }

      const [row] = await db.insert(generatedPosts).values({
        id: randomUUID(),
        campaignId: campaignId || null,
        socialAccountId: account.id,
        tenantDomain: ctx.tenantDomain,
        platform: account.platform,
        content: content.trim(),
        editedContent: editedContent ?? null,
        hashtags: Array.isArray(hashtags) ? hashtags : [],
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
        sourceUrl: sourceUrl ?? null,
        status: "draft",
      } as any).returning();

      res.status(201).json(row);
    } catch (err: any) {
      console.error("[Post Create Error]", err.message);
      res.status(500).json({ error: err.message || "Failed to create post" });
    }
  });

  // ───── Patch a post (works for both standalone and campaign-scoped) ─────
  // Note: campaign-scoped posts also have their own PUT route in
  // marketing-saturn.ts. This one is platform-agnostic and is the path the
  // composer + calendar drag-to-reschedule both call.
  app.patch("/api/generated-posts/:id", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [post] = await db.select().from(generatedPosts).where(and(
        eq(generatedPosts.id, req.params.id),
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
      ));
      if (!post) return res.status(404).json({ error: "Post not found" });

      const {
        editedContent, hashtags, status, scheduledDate, content,
        overrideImageUrl, overrideBrandAssetId, deliveryMode, carouselSlides,
        socialAccountId,
      } = req.body ?? {};

      const updateFields: Partial<GeneratedPost> & { updatedAt: Date } = { updatedAt: new Date() };
      if (overrideImageUrl !== undefined) {
        if (overrideImageUrl !== null && typeof overrideImageUrl !== "string") {
          return res.status(400).json({ error: "overrideImageUrl must be a string or null" });
        }
        updateFields.overrideImageUrl = overrideImageUrl || null;
        // A raw image URL set on its own supersedes any brand-asset selection.
        if (overrideBrandAssetId === undefined) updateFields.overrideBrandAssetId = null;
      }
      if (overrideBrandAssetId !== undefined) {
        if (overrideBrandAssetId !== null && typeof overrideBrandAssetId !== "string") {
          return res.status(400).json({ error: "overrideBrandAssetId must be a string or null" });
        }
        if (overrideBrandAssetId) {
          // Tenant boundary: a post may only reference brand assets owned by its
          // own tenant. Without this check a caller could point a post at another
          // tenant's asset, which would later surface in CSV exports/previews.
          const [owned] = await db.select({ id: brandAssets.id }).from(brandAssets).where(and(
            eq(brandAssets.id, overrideBrandAssetId),
            eq(brandAssets.tenantDomain, ctx.tenantDomain),
          ));
          if (!owned) return res.status(404).json({ error: "Brand asset not found" });
        }
        updateFields.overrideBrandAssetId = overrideBrandAssetId || null;
      }
      if (editedContent !== undefined) {
        if (editedContent !== null && typeof editedContent !== "string") {
          return res.status(400).json({ error: "editedContent must be a string or null" });
        }
        updateFields.editedContent = editedContent;
      }
      if (content !== undefined && typeof content === "string") updateFields.content = content;
      if (hashtags !== undefined) updateFields.hashtags = Array.isArray(hashtags) ? hashtags : [];
      if (status !== undefined) {
        if (!ALLOWED_POST_STATUSES.includes(status)) {
          return res.status(400).json({
            error: `Invalid status. Allowed: ${ALLOWED_POST_STATUSES.join(", ")}`,
          });
        }
        updateFields.status = status;
      }
      if (scheduledDate !== undefined) {
        if (scheduledDate === null || scheduledDate === "") {
          updateFields.scheduledDate = null;
        } else {
          const parsed = new Date(scheduledDate);
          if (Number.isNaN(parsed.getTime())) {
            return res.status(400).json({ error: "scheduledDate is not a valid date" });
          }
          updateFields.scheduledDate = parsed;
          // Rescheduling a missed post reactivates it — operator has reviewed
          // it and chosen a new send time, so it re-enters the publish queue.
          if (post.status === "missed" && status === undefined) {
            updateFields.status = "approved";
          }
        }
      }

      if (deliveryMode !== undefined) {
        (updateFields as any).deliveryMode = deliveryMode === "csv" ? "csv" : null;
      }

      if (carouselSlides !== undefined) {
        if (carouselSlides === null || Array.isArray(carouselSlides)) {
          (updateFields as any).carouselSlides = carouselSlides;
        }
      }

      if (socialAccountId !== undefined) {
        if (socialAccountId === null) {
          (updateFields as any).socialAccountId = null;
        } else if (typeof socialAccountId === "string") {
          const [acct] = await db.select({ id: socialAccounts.id })
            .from(socialAccounts)
            .where(and(
              eq(socialAccounts.id, socialAccountId),
              eq(socialAccounts.tenantDomain, ctx.tenantDomain),
            ));
          if (!acct) return res.status(404).json({ error: "Social account not found" });
          (updateFields as any).socialAccountId = socialAccountId;
        }
      }

      // When the user transitions to 'approved' (regardless of campaign vs
      // standalone), capture the voice profile in effect right now so a
      // later edit to the profile doesn't retroactively change history.
      if (status === "approved" && !post.voiceProfileSnapshot && post.socialAccountId) {
        const profile = await fetchVoiceProfile(post.socialAccountId);
        if (profile) {
          updateFields.voiceProfileSnapshot = snapshotVoiceProfile(profile);
        }
      }

      const [row] = await db.update(generatedPosts)
        .set(updateFields as any)
        .where(eq(generatedPosts.id, post.id))
        .returning();
      res.json(row);
    } catch (err: any) {
      console.error("[Post Patch Error]", err.message);
      res.status(500).json({ error: err.message || "Failed to update post" });
    }
  });

  // ───── Generate a branded social graphic for a post ─────
  // Composites a brand-color gradient + tenant logo + a headline pulled from
  // the post copy (the same look as the conference hero graphics), saves it to
  // the public bucket, and stores the URL on the post.
  app.post("/api/generated-posts/:id/generate-image", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [post] = await db.select().from(generatedPosts).where(and(
        eq(generatedPosts.id, req.params.id),
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
      ));
      if (!post) return res.status(404).json({ error: "Post not found" });

      const headline = derivePostHeadline(req.body?.headline, post);
      if (!headline) {
        return res.status(422).json({ error: "No text available to build a graphic from." });
      }

      // Caller may supply backgroundUrl in the request body to explicitly use a
      // specific photo (e.g. an article hero image) as the background for the
      // composite. If not provided, fall back to whatever the post already has stored.
      let backgroundUrl: string | null = (req.body?.backgroundUrl as string) || null;
      if (!backgroundUrl) {
        if (post.overrideImageUrl) {
          backgroundUrl = post.overrideImageUrl;
        } else if (post.overrideBrandAssetId) {
          const [ba] = await db.select({ fileUrl: brandAssets.fileUrl, url: brandAssets.url })
            .from(brandAssets)
            .where(and(eq(brandAssets.id, post.overrideBrandAssetId), eq(brandAssets.tenantDomain, ctx.tenantDomain)));
          backgroundUrl = ba?.fileUrl || ba?.url || null;
        }
      }

      const saved = await generateBrandedPostGraphic({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId || null,
        headline,
        backgroundUrl,
      });

      const [row] = await db.update(generatedPosts)
        .set({ overrideImageUrl: saved.fileUrl, overrideBrandAssetId: null, updatedAt: new Date() })
        .where(eq(generatedPosts.id, post.id))
        .returning();
      res.json(row);
    } catch (err: any) {
      console.error("[Post Image Generate Error]", err.message);
      res.status(500).json({ error: err.message || "Failed to generate image" });
    }
  });

  // ───── Delete a post (works for standalone or campaign-scoped) ─────
  app.delete("/api/generated-posts/:id", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [post] = await db.select().from(generatedPosts).where(and(
        eq(generatedPosts.id, req.params.id),
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
      ));
      if (!post) return res.status(404).json({ error: "Post not found" });
      // Archive post-wrap marketing links embedded in this post's content before deleting
      if (post.campaignId && post.content) {
        const slugs = [...post.content.matchAll(/\/r\/([a-z0-9]+)/gi)].map(m => m[1]);
        if (slugs.length > 0) {
          await db.update(marketingLinks).set({ status: "archived", updatedAt: new Date() }).where(
            and(eq(marketingLinks.campaignId, post.campaignId), eq(marketingLinks.source, "post-wrap"), inArray(marketingLinks.slug, slugs))
          );
        }
      }
      await db.delete(generatedPosts).where(eq(generatedPosts.id, post.id));
      res.status(204).send();
    } catch (err: any) {
      console.error("[Post Delete Error]", err.message);
      res.status(500).json({ error: err.message || "Failed to delete post" });
    }
  });

  // ───── Calendar list ─────
  // Returns scheduled or recently-published posts within a date range.
  // Filters: from/to (ISO), socialAccountId(s), platform(s), status(es),
  // includeUnscheduled=true to also return drafts with no scheduledDate.
  app.get("/api/generated-posts/calendar", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const { from, to, socialAccountId, platform, status, includeUnscheduled } = req.query;
      const fromDate = typeof from === "string" ? new Date(from) : null;
      const toDate = typeof to === "string" ? new Date(to) : null;
      const accountFilter = Array.isArray(socialAccountId)
        ? socialAccountId.map(String)
        : (typeof socialAccountId === "string" ? [socialAccountId] : []);
      const platformFilter = Array.isArray(platform)
        ? platform.map(String)
        : (typeof platform === "string" ? [platform] : []);
      const statusFilter = Array.isArray(status)
        ? status.map(String)
        : (typeof status === "string" ? [status] : []);

      const conds = [eq(generatedPosts.tenantDomain, ctx.tenantDomain)];
      // Date window: posts scheduled in [from, to], OR (when requested) posts
      // with no scheduledDate that are still drafts/approved.
      const dateWindow = and(
        isNotNull(generatedPosts.scheduledDate),
        fromDate ? gte(generatedPosts.scheduledDate, fromDate) : undefined,
        toDate ? lte(generatedPosts.scheduledDate, toDate) : undefined,
      );
      if (includeUnscheduled === "true" || includeUnscheduled === "1") {
        const unscheduled = and(
          isNull(generatedPosts.scheduledDate),
          inArray(generatedPosts.status, ["draft", "approved"]),
        );
        const combined = or(dateWindow, unscheduled);
        if (combined) conds.push(combined);
      } else if (dateWindow) {
        conds.push(dateWindow);
      }
      if (accountFilter.length) conds.push(inArray(generatedPosts.socialAccountId, accountFilter));
      if (platformFilter.length) conds.push(inArray(generatedPosts.platform, platformFilter));
      if (statusFilter.length) {
        conds.push(inArray(generatedPosts.status, statusFilter));
      } else {
        // By default, exclude rejected/deleted from calendar view.
        conds.push(ne(generatedPosts.status, "rejected"));
        conds.push(ne(generatedPosts.status, "deleted"));
      }

      const rows = await db.select({
        id: generatedPosts.id,
        platform: generatedPosts.platform,
        content: generatedPosts.content,
        editedContent: generatedPosts.editedContent,
        scheduledDate: generatedPosts.scheduledDate,
        publishedAt: generatedPosts.publishedAt,
        status: generatedPosts.status,
        socialAccountId: generatedPosts.socialAccountId,
        campaignId: generatedPosts.campaignId,
        overrideImageUrl: generatedPosts.overrideImageUrl,
        accountName: socialAccounts.accountName,
        // deliveryMode/publishError power the Orbit posting queue (queue.tsx):
        // who Orbit is publishing itself vs. handing off to CSV, and why a
        // send failed. campaignName lets the queue label cross-campaign rows.
        deliveryMode: generatedPosts.deliveryMode,
        publishError: generatedPosts.publishError,
        campaignName: campaigns.name,
      })
        .from(generatedPosts)
        .leftJoin(socialAccounts, eq(socialAccounts.id, generatedPosts.socialAccountId))
        .leftJoin(campaigns, eq(campaigns.id, generatedPosts.campaignId))
        .where(and(...conds))
        .orderBy(generatedPosts.scheduledDate, desc(generatedPosts.createdAt));

      res.json(rows.map(r => ({
        ...r,
        // Provide a short preview to avoid sending full bodies in the
        // calendar payload. Full content is fetched via the click-through.
        preview: ((r.editedContent ?? r.content) || "").slice(0, 240),
      })));
    } catch (err: any) {
      console.error("[Posts Calendar Error]", err.message);
      res.status(500).json({ error: err.message || "Failed to load calendar" });
    }
  });

  // ───── Single post detail ─────
  // The calendar/aggregation payloads only carry a truncated preview and omit
  // carousel slides. The click-through detail dialog fetches the full row here so
  // it can show the complete copy, the branded graphic, and every carousel slide.
  // Registered AFTER /calendar so that literal path doesn't match this :id route.
  app.get("/api/generated-posts/:id", async (req, res) => {
    if (!await guardFeature(req, res, "socialPosts")) return;
    try {
      const ctx = await getRequestContext(req);
      const [post] = await db.select().from(generatedPosts).where(and(
        eq(generatedPosts.id, req.params.id),
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
      ));
      if (!post) return res.status(404).json({ error: "Post not found" });
      res.json(post);
    } catch (err: any) {
      console.error("[Post Detail Error]", err.message);
      res.status(500).json({ error: err.message || "Failed to load post" });
    }
  });
}
