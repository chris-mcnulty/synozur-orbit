import type { Express } from "express";
import { db } from "../db";
import { editorialCalendars, contentBriefs, contentAssets, campaigns, solutionAreas, personas, marketingTasks, marketingPlans, marketingLinks } from "@shared/schema";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { generateContentBriefs } from "../services/editorial-calendar-service";
import { draftFromBrief } from "../services/copywriter-service";
import { getPersonalVoiceProfile } from "../services/outbound-voice-service";
import { getPersonalProfilePosts } from "../services/linkedin-api";
import {
  DEFAULT_FUNNEL_TARGETS,
  briefFormatToAssetType,
  recommendedBriefCount,
  type CampaignBriefContext,
} from "../services/editorial-calendar-core";
import type { CampaignType } from "@shared/schema";
import { CONTENT_BRIEF_FORMATS } from "@shared/schema";

const FORMAT_LABELS: Record<string, string> = {
  blog_post: "Blog post",
  landing_page: "Landing page",
  linkedin_post: "LinkedIn post",
  x_post: "X / Twitter post",
  newsletter: "Newsletter",
  video_script: "Video script",
  case_study: "Case study",
  whitepaper: "Whitepaper",
  ebook: "Ebook",
  podcast_outline: "Podcast outline",
  webinar: "Webinar",
  press_release: "Press release",
  linkedin_digest: "LinkedIn Digest",
  other: "Other",
};

const FUNNEL_LABELS: Record<string, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  decision: "Decision",
};

const EDITABLE_BRIEF_FIELDS = [
  "title",
  "format",
  "summary",
  "targetKeyword",
  "demandSignal",
  "funnelStage",
  "differentiationAngle",
  "targetReader",
  "cta",
  "channels",
  "estimatedHours",
  "status",
  "sortOrder",
] as const;

export function registerEditorialCalendarRoutes(app: Express) {
  // Generate a calendar of demand-scored briefs and persist it.
  app.post("/api/editorial-calendars/generate", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);

      const { name, focus, count, periodStart, periodEnd } = req.body ?? {};

      const { briefs, warnings, funnel } = await generateContentBriefs({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        isDefaultMarket: ctx.isDefaultMarket,
        count: count ? Number(count) : undefined,
        focus: typeof focus === "string" ? focus : undefined,
      });

      if (briefs.length === 0) {
        return res.status(502).json({ error: "The AI did not return any usable briefs. Please try again." });
      }

      const calendarId = randomUUID();
      const created = await db.transaction(async (tx) => {
        const [calendar] = await tx
          .insert(editorialCalendars)
          .values({
            id: calendarId,
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            name: (typeof name === "string" && name.trim()) || `Editorial Calendar — ${new Date().toISOString().slice(0, 10)}`,
            focus: typeof focus === "string" && focus.trim() ? focus.trim() : null,
            periodStart: periodStart ? new Date(periodStart) : null,
            periodEnd: periodEnd ? new Date(periodEnd) : null,
            funnelTargets: DEFAULT_FUNNEL_TARGETS,
            status: "active",
            createdBy: ctx.userId,
          })
          .returning();

        const briefRows = await tx
          .insert(contentBriefs)
          .values(
            briefs.map((b, i) => ({
              id: randomUUID(),
              calendarId,
              tenantDomain: ctx.tenantDomain,
              marketId: ctx.marketId || null,
              title: b.title,
              format: b.format,
              targetKeyword: b.targetKeyword,
              demandSignal: b.demandSignal,
              funnelStage: b.funnelStage,
              differentiationAngle: b.differentiationAngle,
              targetReader: b.targetReader,
              cta: b.cta,
              channels: b.channels.length ? b.channels : null,
              estimatedHours: b.estimatedHours,
              status: "suggested",
              aiGenerated: true,
              sortOrder: i,
            })),
          )
          .returning();

        return { calendar, briefs: briefRows };
      });

      res.status(201).json({ ...created, warnings, funnel });
    } catch (err: any) {
      console.error("[editorial-calendars generate]", err);
      res.status(500).json({ error: err.message || "Failed to generate editorial calendar" });
    }
  });

  // Generate a campaign's content plan: a campaign-scoped editorial calendar of
  // briefs grounded in the campaign's intent (type/objective/audience) and its
  // recommended asset mix. Each brief is stamped with campaignId so it rolls up
  // into the campaign's master view. Re-running appends to the campaign's plan.
  app.post("/api/campaigns/:id/generate-briefs", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);

      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.id, req.params.id),
            eq(campaigns.tenantDomain, ctx.tenantDomain),
            eq(campaigns.marketId, ctx.marketId),
          ),
        );
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      // Resolve the campaign's audience personas into short summaries.
      let audience: string[] = [];
      if (Array.isArray(campaign.audiencePersonaIds) && campaign.audiencePersonaIds.length) {
        const personaRows = await db
          .select({ name: personas.name, role: personas.role, industry: personas.industry })
          .from(personas)
          .where(
            and(
              inArray(personas.id, campaign.audiencePersonaIds),
              eq(personas.tenantDomain, ctx.tenantDomain),
              // Personas are tenant/market-scoped; guard against legacy/manual
              // cross-market ids leaking another market's personas into the prompt.
              eq(personas.marketId, ctx.marketId),
            ),
          );
        audience = personaRows.map((p) =>
          [p.name, p.role, p.industry].filter(Boolean).join(" — "),
        );
      }

      // Duration: explicit numberOfDays, else span between start/end dates.
      let durationDays: number | null = campaign.numberOfDays ?? null;
      if (durationDays == null && campaign.startDate && campaign.endDate) {
        const ms = new Date(campaign.endDate).getTime() - new Date(campaign.startDate).getTime();
        if (ms > 0) durationDays = Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
      }

      const campaignType = (campaign.campaignType as CampaignType) ?? "theme";
      const campaignCtx: CampaignBriefContext = {
        type: campaignType,
        name: campaign.name,
        objective: campaign.objective ?? null,
        goal: campaign.goal ?? null,
        audience,
        durationDays,
        channels: [],
        thematicUrl: campaign.thematicUrl ?? null,
        thematicBrief: campaign.thematicBrief ?? null,
      };

      const bodyCount = req.body?.count != null ? Number(req.body.count) : undefined;
      const count = bodyCount && bodyCount > 0 ? bodyCount : recommendedBriefCount(campaignType);

      // Scrape the source article so brief generation is grounded in its
      // specific findings, not generic market claims.
      let sourceArticleText: string | undefined;
      const sourceUrl = campaign.thematicUrl?.trim();
      const inlineText = campaign.thematicBrief?.trim();
      if (inlineText) {
        // User pasted the article text directly — use it as-is.
        sourceArticleText = inlineText;
      } else if (sourceUrl) {
        try {
          const { extractContentFromUrl } = await import("../services/content-extraction");
          const extracted = await extractContentFromUrl(sourceUrl);
          if (extracted.success && extracted.text) {
            sourceArticleText = extracted.text;
          }
        } catch (scrapeErr) {
          console.warn("[generate-briefs] Could not scrape thematic URL:", scrapeErr);
        }
      }

      const { briefs, warnings, funnel } = await generateContentBriefs({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        isDefaultMarket: ctx.isDefaultMarket,
        count,
        focus: typeof req.body?.focus === "string" ? req.body.focus : undefined,
        campaign: campaignCtx,
        sourceArticleText,
      });

      if (briefs.length === 0) {
        return res
          .status(502)
          .json({ error: "The AI did not return any usable briefs. Please try again." });
      }

      const created = await db.transaction(async (tx) => {
        // Find-or-create this campaign's content-plan calendar.
        let [calendar] = await tx
          .select()
          .from(editorialCalendars)
          .where(
            and(
              eq(editorialCalendars.campaignId, campaign.id),
              eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
            ),
          )
          .limit(1);

        if (!calendar) {
          [calendar] = await tx
            .insert(editorialCalendars)
            .values({
              id: randomUUID(),
              tenantDomain: ctx.tenantDomain,
              marketId: ctx.marketId || null,
              name: `${campaign.name} — Content Plan`,
              description: campaign.objective || null,
              campaignId: campaign.id,
              periodStart: campaign.startDate ?? null,
              periodEnd: campaign.endDate ?? null,
              funnelTargets: DEFAULT_FUNNEL_TARGETS,
              focus: campaign.objective || null,
              status: "active",
              createdBy: ctx.userId,
            })
            .returning();
        }

        // Continue sortOrder after any existing briefs in this calendar.
        const existing = await tx
          .select({ sortOrder: contentBriefs.sortOrder })
          .from(contentBriefs)
          .where(eq(contentBriefs.calendarId, calendar.id))
          .orderBy(desc(contentBriefs.sortOrder))
          .limit(1);
        const baseSort = existing.length ? existing[0].sortOrder + 1 : 0;

        const briefRows = await tx
          .insert(contentBriefs)
          .values(
            briefs.map((b, i) => ({
              id: randomUUID(),
              calendarId: calendar.id,
              tenantDomain: ctx.tenantDomain,
              marketId: ctx.marketId || null,
              title: b.title,
              format: b.format,
              targetKeyword: b.targetKeyword,
              demandSignal: b.demandSignal,
              funnelStage: b.funnelStage,
              differentiationAngle: b.differentiationAngle,
              targetReader: b.targetReader,
              cta: b.cta,
              channels: b.channels.length ? b.channels : null,
              estimatedHours: b.estimatedHours,
              status: "suggested",
              aiGenerated: true,
              campaignId: campaign.id,
              sortOrder: baseSort + i,
            })),
          )
          .returning();

        return { calendar, briefs: briefRows };
      });

      res.status(201).json({ ...created, warnings, funnel });
    } catch (err: any) {
      console.error("[campaigns generate-briefs]", err);
      res.status(500).json({ error: err.message || "Failed to generate campaign briefs" });
    }
  });

  // Fetch a campaign's content-plan calendar + its briefs (empty until briefs
  // are generated). Powers the campaign master view's content section.
  app.get("/api/campaigns/:id/content-plan", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);

      const [calendar] = await db
        .select()
        .from(editorialCalendars)
        .where(
          and(
            eq(editorialCalendars.campaignId, req.params.id),
            eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
          ),
        )
        .limit(1);

      if (!calendar) return res.json({ calendar: null, briefs: [] });

      const briefs = await db
        .select()
        .from(contentBriefs)
        .where(
          and(
            eq(contentBriefs.calendarId, calendar.id),
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
          ),
        )
        .orderBy(asc(contentBriefs.sortOrder));

      res.json({ calendar, briefs });
    } catch (err: any) {
      console.error("[campaigns content-plan]", err);
      res.status(500).json({ error: err.message || "Failed to load content plan" });
    }
  });

  // List calendars for the active tenant/market.
  app.get("/api/editorial-calendars", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);
      const rows = await db
        .select()
        .from(editorialCalendars)
        .where(
          and(
            eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
            eq(editorialCalendars.marketId, ctx.marketId),
          ),
        )
        .orderBy(desc(editorialCalendars.createdAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[editorial-calendars list]", err);
      res.status(500).json({ error: err.message || "Failed to list editorial calendars" });
    }
  });

  // Flat brief list across every calendar in the active tenant/market — used
  // by cross-calendar surfaces (the Content Pipeline board) so they get the
  // complete set in one request instead of a fetch per calendar.
  app.get("/api/content-briefs", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);
      const rows = await db
        .select()
        .from(contentBriefs)
        .where(
          and(
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
            // Same market rule as elsewhere: the default market also owns
            // legacy rows with no marketId.
            ctx.isDefaultMarket
              ? or(eq(contentBriefs.marketId, ctx.marketId), isNull(contentBriefs.marketId))
              : eq(contentBriefs.marketId, ctx.marketId),
          ),
        )
        .orderBy(desc(contentBriefs.createdAt));

      // Enrich: draft title/category from linked content asset.
      const assetIds = rows.map((b) => b.contentAssetId).filter((id): id is string => !!id);
      let assetMap = new Map<string, { title: string; categoryId: string | null }>();
      if (assetIds.length) {
        const assets = await db
          .select({ id: contentAssets.id, title: contentAssets.title, categoryId: contentAssets.categoryId })
          .from(contentAssets)
          .where(
            and(
              inArray(contentAssets.id, assetIds),
              eq(contentAssets.tenantDomain, ctx.tenantDomain),
              eq(contentAssets.marketId, ctx.marketId),
            ),
          );
        assetMap = new Map(assets.map((a) => [a.id, { title: a.title, categoryId: a.categoryId }]));
      }

      // Enrich: which briefs are already in a marketing plan task.
      const pushedBriefIds = new Set<string>();
      if (rows.length) {
        const pushedTasks = await db
          .select({ sourceBriefId: marketingTasks.sourceBriefId })
          .from(marketingTasks)
          .innerJoin(marketingPlans, eq(marketingTasks.planId, marketingPlans.id))
          .where(
            and(
              inArray(marketingTasks.sourceBriefId, rows.map((b) => b.id)),
              eq(marketingPlans.tenantDomain, ctx.tenantDomain),
            ),
          );
        for (const t of pushedTasks) {
          if (t.sourceBriefId) pushedBriefIds.add(t.sourceBriefId);
        }
      }

      const enriched = rows.map((b) => {
        const asset = b.contentAssetId ? assetMap.get(b.contentAssetId) : undefined;
        return {
          ...b,
          draftTitle: asset?.title ?? null,
          draftCategoryId: asset?.categoryId ?? null,
          pushedToPlanner: pushedBriefIds.has(b.id),
        };
      });

      res.json(enriched);
    } catch (err: any) {
      console.error("[content-briefs list]", err);
      res.status(500).json({ error: err.message || "Failed to list content briefs" });
    }
  });

  // Get a single calendar with its briefs.
  app.get("/api/editorial-calendars/:id", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);
      const [calendar] = await db
        .select()
        .from(editorialCalendars)
        .where(
          and(
            eq(editorialCalendars.id, req.params.id),
            eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
            eq(editorialCalendars.marketId, ctx.marketId),
          ),
        );
      if (!calendar) return res.status(404).json({ error: "Not found" });

      const briefs = await db
        .select()
        .from(contentBriefs)
        .where(
          and(
            eq(contentBriefs.calendarId, calendar.id),
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
          ),
        )
        .orderBy(asc(contentBriefs.sortOrder), asc(contentBriefs.createdAt));

      // Enrich briefs that have a generated draft with that draft's current
      // title and category so the calendar can show the brief↔draft link and
      // the draft's library category in one place.
      const assetIds = briefs
        .map((b) => b.contentAssetId)
        .filter((id): id is string => !!id);
      let assetMap = new Map<string, { title: string; categoryId: string | null }>();
      if (assetIds.length) {
        const assets = await db
          .select({
            id: contentAssets.id,
            title: contentAssets.title,
            categoryId: contentAssets.categoryId,
          })
          .from(contentAssets)
          .where(
            and(
              inArray(contentAssets.id, assetIds),
              eq(contentAssets.tenantDomain, ctx.tenantDomain),
              eq(contentAssets.marketId, ctx.marketId),
            ),
          );
        assetMap = new Map(assets.map((a) => [a.id, { title: a.title, categoryId: a.categoryId }]));
      }

      // Which briefs have already been pushed into a marketing plan (via the
      // distribution planner)? The link is marketing_tasks.source_brief_id.
      // Scope explicitly to this tenant's plans (join marketing_plans) so the
      // marker can never reflect a task outside the tenant boundary.
      const pushedBriefIds = new Set<string>();
      if (briefs.length) {
        const pushedTasks = await db
          .select({ sourceBriefId: marketingTasks.sourceBriefId })
          .from(marketingTasks)
          .innerJoin(marketingPlans, eq(marketingTasks.planId, marketingPlans.id))
          .where(
            and(
              inArray(marketingTasks.sourceBriefId, briefs.map((b) => b.id)),
              eq(marketingPlans.tenantDomain, ctx.tenantDomain),
            ),
          );
        for (const t of pushedTasks) {
          if (t.sourceBriefId) pushedBriefIds.add(t.sourceBriefId);
        }
      }

      const enriched = briefs.map((b) => {
        const asset = b.contentAssetId ? assetMap.get(b.contentAssetId) : undefined;
        return {
          ...b,
          draftTitle: asset?.title ?? null,
          draftCategoryId: asset?.categoryId ?? null,
          pushedToPlanner: pushedBriefIds.has(b.id),
        };
      });

      res.json({ calendar, briefs: enriched });
    } catch (err: any) {
      console.error("[editorial-calendars get]", err);
      res.status(500).json({ error: err.message || "Failed to fetch editorial calendar" });
    }
  });

  // Update a single content brief (status changes, edits).
  app.patch("/api/content-briefs/:id", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);
      const updates: Record<string, any> = {};
      for (const field of EDITABLE_BRIEF_FIELDS) {
        if (req.body?.[field] !== undefined) updates[field] = req.body[field];
      }

      // Validate format against the known brief formats so an unknown value
      // can't slip into a column the rest of the system reads as an enum.
      if (updates.format !== undefined && !(CONTENT_BRIEF_FORMATS as readonly string[]).includes(updates.format)) {
        return res.status(400).json({ error: "Unknown format" });
      }

      // Campaign / theme assignment — validate the referenced row belongs to
      // the caller's tenant+market before linking so the FK can't accumulate
      // cross-tenant references. An empty string / null clears the assignment.
      if (req.body?.campaignId !== undefined) {
        const id = req.body.campaignId;
        if (id) {
          const [c] = await db
            .select({ id: campaigns.id })
            .from(campaigns)
            .where(and(eq(campaigns.id, id), eq(campaigns.tenantDomain, ctx.tenantDomain), eq(campaigns.marketId, ctx.marketId)));
          if (!c) return res.status(400).json({ error: "Unknown campaign" });
          updates.campaignId = id;
        } else {
          updates.campaignId = null;
        }
      }
      if (req.body?.solutionAreaId !== undefined) {
        const id = req.body.solutionAreaId;
        if (id) {
          const [s] = await db
            .select({ id: solutionAreas.id })
            .from(solutionAreas)
            .where(and(eq(solutionAreas.id, id), eq(solutionAreas.tenantDomain, ctx.tenantDomain), eq(solutionAreas.marketId, ctx.marketId)));
          if (!s) return res.status(400).json({ error: "Unknown theme" });
          updates.solutionAreaId = id;
        } else {
          updates.solutionAreaId = null;
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No editable fields provided" });
      }
      updates.updatedAt = new Date();

      const [row] = await db
        .update(contentBriefs)
        .set(updates)
        .where(
          and(
            eq(contentBriefs.id, req.params.id),
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
            eq(contentBriefs.marketId, ctx.marketId),
          ),
        )
        .returning();

      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[content-briefs patch]", err);
      res.status(500).json({ error: err.message || "Failed to update content brief" });
    }
  });

  // One-click Finalize: approve the brief AND its linked draft together so the
  // user doesn't have to approve the brief and the draft asset separately. The
  // brief moves to "approved" and the linked content asset is set "active"
  // (live in the library). Requires a draft to exist first.
  app.post("/api/content-briefs/:id/finalize", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);

      const [brief] = await db
        .select()
        .from(contentBriefs)
        .where(
          and(
            eq(contentBriefs.id, req.params.id),
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
            eq(contentBriefs.marketId, ctx.marketId),
          ),
        );
      if (!brief) return res.status(404).json({ error: "Not found" });
      if (!brief.contentAssetId) {
        return res.status(409).json({ error: "Generate the draft first, then finalize." });
      }

      // Approve the brief and activate its linked draft as one atomic step so
      // they can never drift apart (brief approved but draft left inactive).
      const row = await db.transaction(async (tx) => {
        const [updatedBrief] = await tx
          .update(contentBriefs)
          .set({ status: "approved", updatedAt: new Date() })
          .where(
            and(
              eq(contentBriefs.id, req.params.id),
              eq(contentBriefs.tenantDomain, ctx.tenantDomain),
              eq(contentBriefs.marketId, ctx.marketId),
            ),
          )
          .returning();

        await tx
          .update(contentAssets)
          .set({ status: "active", updatedAt: new Date() })
          .where(
            and(
              eq(contentAssets.id, brief.contentAssetId!),
              eq(contentAssets.tenantDomain, ctx.tenantDomain),
            ),
          );

        return updatedBrief;
      });

      res.json(row);
    } catch (err: any) {
      console.error("[content-briefs finalize]", err);
      res.status(500).json({ error: err.message || "Failed to finalize content brief" });
    }
  });

  // Draft content from a brief: generate a first draft in the brief's format,
  // persist it as a content asset, and link it back to the brief.
  app.post("/api/content-briefs/:id/draft", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);

      const [brief] = await db
        .select()
        .from(contentBriefs)
        .where(
          and(
            eq(contentBriefs.id, req.params.id),
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
            eq(contentBriefs.marketId, ctx.marketId),
          ),
        );
      if (!brief) return res.status(404).json({ error: "Not found" });

      const instructions = typeof req.body?.instructions === "string" ? req.body.instructions : undefined;
      const guest = typeof req.body?.guest === "string" ? req.body.guest : undefined;
      const voiceProfile = await getPersonalVoiceProfile(ctx.userId);
      const draft = await draftFromBrief(brief, {
        isDefaultMarket: ctx.isDefaultMarket,
        instructions,
        guest,
        soundLikeMeInstructions: voiceProfile?.soundLikeMeInstructions ?? null,
      });

      if (!draft.body?.trim()) {
        return res.status(502).json({ error: "The AI did not return a usable draft. Please try again." });
      }

      const result = await db.transaction(async (tx) => {
        const [asset] = await tx
          .insert(contentAssets)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            title: draft.title || brief.title,
            description: draft.meta || null,
            content: draft.body,
            subtitle: draft.subtitle || null,
            overview: draft.overview || null,
            postTags: draft.tags || null,
            assetType: briefFormatToAssetType(draft.format as any),
            status: "active",
            createdBy: ctx.userId,
          })
          .returning();

        const [updatedBrief] = await tx
          .update(contentBriefs)
          .set({ contentAssetId: asset.id, status: "drafted", updatedAt: new Date() })
          .where(
            and(
              eq(contentBriefs.id, brief.id),
              eq(contentBriefs.tenantDomain, ctx.tenantDomain),
              eq(contentBriefs.marketId, ctx.marketId),
            ),
          )
          .returning();

        return { asset, brief: updatedBrief };
      });

      res.status(201).json({
        ...result,
        draft: {
          title: draft.title,
          subtitle: draft.subtitle,
          overview: draft.overview,
          body: draft.body,
          meta: draft.meta,
          tags: draft.tags,
          format: draft.format,
        },
        usage: draft.usage,
        model: draft.model,
      });
    } catch (err: any) {
      console.error("[content-briefs draft]", err);
      res.status(500).json({ error: err.message || "Failed to draft content" });
    }
  });

  // Branded Word (.docx) export of a single content brief — Synozur logo,
  // brand color, and fonts. Maps the brief's strategy fields into a readable doc.
  app.get("/api/content-briefs/:id/download/docx", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);

      const [brief] = await db
        .select()
        .from(contentBriefs)
        .where(
          and(
            eq(contentBriefs.id, req.params.id),
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
            eq(contentBriefs.marketId, ctx.marketId),
          ),
        );
      if (!brief) return res.status(404).json({ error: "Not found" });

      const formatLabel = FORMAT_LABELS[brief.format] ?? brief.format;
      const funnelLabel = FUNNEL_LABELS[brief.funnelStage] ?? brief.funnelStage;

      const lines: string[] = [`# ${brief.title}`, ""];
      const field = (label: string, value: string | null | undefined) => {
        if (value && String(value).trim()) {
          lines.push(`**${label}:** ${String(value).trim()}`, "");
        }
      };
      field("Format", formatLabel);
      field("Funnel stage", funnelLabel);
      field("Target keyword", brief.targetKeyword);
      field("Target reader", brief.targetReader);
      field("Call to action", brief.cta);
      field("Demand signal", brief.demandSignal);
      field("Differentiation angle", brief.differentiationAngle);
      if (brief.channels && brief.channels.length) {
        field("Channels", brief.channels.join(", "));
      }
      if (brief.estimatedHours != null) {
        field("Estimated hours", `${brief.estimatedHours}h`);
      }

      const { buildBrandedDocx } = await import("../services/docx-generator.js");
      const docBuffer = await buildBrandedDocx(brief.title, lines.join("\n"));
      const safeName =
        brief.title.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "content_brief";
      const filename = `${safeName}_${new Date().toISOString().split("T")[0]}.docx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(docBuffer);
    } catch (err: any) {
      console.error("[content-briefs download docx]", err);
      res.status(500).json({ error: err.message || "Failed to generate document" });
    }
  });

  // Permanently delete a single content brief (hard delete).
  app.delete("/api/content-briefs/:id", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);
      const [deleted] = await db
        .delete(contentBriefs)
        .where(
          and(
            eq(contentBriefs.id, req.params.id),
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
            or(
              eq(contentBriefs.marketId, ctx.marketId),
              isNull(contentBriefs.marketId),
            ),
          ),
        )
        .returning({ id: contentBriefs.id });
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[content-briefs delete]", err);
      res.status(500).json({ error: err.message || "Failed to delete content brief" });
    }
  });

  // Copy a content brief to an existing or new campaign.
  // Body: { campaignId } for an existing campaign, or { newCampaignName } to create one.
  // Returns: { brief, campaignId }
  app.post("/api/content-briefs/:id/copy", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);
      const { campaignId, newCampaignName } = req.body ?? {};

      const [source] = await db
        .select()
        .from(contentBriefs)
        .where(
          and(
            eq(contentBriefs.id, req.params.id),
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
          ),
        );
      if (!source) return res.status(404).json({ error: "Brief not found" });

      let targetCalendarId: string;
      let targetCampaignId: string;

      if (campaignId) {
        // Existing campaign — verify ownership then find or create its calendar.
        const [campaign] = await db
          .select({ id: campaigns.id, name: campaigns.name })
          .from(campaigns)
          .where(
            and(
              eq(campaigns.id, campaignId),
              eq(campaigns.tenantDomain, ctx.tenantDomain),
            ),
          );
        if (!campaign) return res.status(404).json({ error: "Campaign not found" });
        targetCampaignId = campaignId;

        const [existingCal] = await db
          .select({ id: editorialCalendars.id })
          .from(editorialCalendars)
          .where(
            and(
              eq(editorialCalendars.campaignId, campaignId),
              eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
            ),
          )
          .limit(1);

        if (existingCal) {
          targetCalendarId = existingCal.id;
        } else {
          const calId = randomUUID();
          await db.insert(editorialCalendars).values({
            id: calId,
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            name: `${campaign.name} — Content Plan`,
            campaignId,
            status: "active",
            createdBy: ctx.userId,
          });
          targetCalendarId = calId;
        }
      } else if (typeof newCampaignName === "string" && newCampaignName.trim()) {
        const newCampaignId = randomUUID();
        const newCalendarId = randomUUID();
        const trimmedName = newCampaignName.trim();

        await db.transaction(async (tx) => {
          await tx.insert(campaigns).values({
            id: newCampaignId,
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
            name: trimmedName,
            status: "active",
            campaignType: "theme",
            createdBy: ctx.userId,
          });
          await tx.insert(editorialCalendars).values({
            id: newCalendarId,
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            name: `${trimmedName} — Content Plan`,
            campaignId: newCampaignId,
            status: "active",
            createdBy: ctx.userId,
          });
        });

        targetCampaignId = newCampaignId;
        targetCalendarId = newCalendarId;
      } else {
        return res.status(400).json({ error: "Either campaignId or newCampaignName is required" });
      }

      const [maxSort] = await db
        .select({ sortOrder: contentBriefs.sortOrder })
        .from(contentBriefs)
        .where(eq(contentBriefs.calendarId, targetCalendarId))
        .orderBy(desc(contentBriefs.sortOrder))
        .limit(1);

      const [copied] = await db
        .insert(contentBriefs)
        .values({
          id: randomUUID(),
          calendarId: targetCalendarId,
          tenantDomain: ctx.tenantDomain,
          marketId: source.marketId,
          title: source.title,
          format: source.format,
          targetKeyword: source.targetKeyword,
          demandSignal: source.demandSignal,
          funnelStage: source.funnelStage,
          differentiationAngle: source.differentiationAngle,
          targetReader: source.targetReader,
          targetPersonaId: source.targetPersonaId,
          cta: source.cta,
          channels: source.channels,
          estimatedHours: source.estimatedHours,
          summary: source.summary,
          formCategories: source.formCategories,
          status: "suggested",
          aiGenerated: source.aiGenerated,
          campaignId: targetCampaignId,
          sortOrder: (maxSort?.sortOrder ?? -1) + 1,
        })
        .returning();

      res.status(201).json({ brief: copied, campaignId: targetCampaignId });
    } catch (err: any) {
      console.error("[content-briefs copy]", err);
      res.status(500).json({ error: err.message || "Failed to copy brief" });
    }
  });

  // LinkedIn Digest — step 1: fetch posts and return count for UI confirmation.
  // Accepts: { profileUrl, startDate, endDate }
  // Returns: { postCount, posts: [{ text, postedAt }] } or error.
  app.post("/api/linkedin-digest/preview", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const digestCtx = await getRequestContext(req);

      const { profileUrl, startDate, endDate } = req.body ?? {};
      if (!profileUrl || typeof profileUrl !== "string" || !profileUrl.includes("linkedin.com/in/")) {
        return res.status(400).json({ error: "Please provide a valid LinkedIn personal profile URL (linkedin.com/in/…)." });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required." });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: "Invalid date format." });
      }
      if (start > end) {
        return res.status(400).json({ error: "startDate must be before endDate." });
      }
      // Set end to end-of-day so the range is inclusive.
      end.setUTCHours(23, 59, 59, 999);

      const result = await getPersonalProfilePosts(profileUrl.trim(), start, end, digestCtx.tenantDomain);

      if (!result.success) {
        if (result.errorCode === "NO_LINKEDIN_ACCOUNT") {
          return res.status(403).json({
            error: result.error,
            errorCode: "NO_LINKEDIN_ACCOUNT",
          });
        }
        return res.status(502).json({ error: result.error || "Failed to fetch posts from LinkedIn." });
      }

      res.json({
        postCount: result.postCount ?? 0,
        posts: (result.posts ?? []).map((p) => ({ text: p.text, postedAt: p.postedAt })),
      });
    } catch (err: any) {
      console.error("[linkedin-digest preview]", err);
      res.status(500).json({ error: err.message || "Failed to fetch LinkedIn posts" });
    }
  });

  // LinkedIn Digest — step 2: create the brief + generate a draft from the fetched posts.
  // Accepts: { profileUrl, startDate, endDate, calendarName? }
  // Re-fetches posts server-side (ignores any client-supplied posts) to guarantee
  // source authenticity — only the caller's own filtered posts feed the digest.
  // Returns: { brief, draft: { title, body, meta, ... }, asset: { id } }
  app.post("/api/linkedin-digest/create", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);

      const { profileUrl, startDate, endDate, calendarName } = req.body ?? {};
      if (!profileUrl || typeof profileUrl !== "string" || !profileUrl.includes("linkedin.com/in/")) {
        return res.status(400).json({ error: "Please provide a valid LinkedIn personal profile URL (linkedin.com/in/…)." });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "profileUrl, startDate, endDate are required." });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: "Invalid date format." });
      }
      // Set end to end-of-day so the range is inclusive.
      end.setUTCHours(23, 59, 59, 999);

      // Re-fetch posts server-side — do NOT trust client-supplied posts.
      const fetchResult = await getPersonalProfilePosts(profileUrl.trim(), start, end, ctx.tenantDomain);
      if (!fetchResult.success) {
        if (fetchResult.errorCode === "NO_LINKEDIN_ACCOUNT") {
          return res.status(403).json({
            error: fetchResult.error,
            errorCode: "NO_LINKEDIN_ACCOUNT",
          });
        }
        return res.status(502).json({ error: fetchResult.error || "Failed to fetch posts from LinkedIn." });
      }
      const posts = fetchResult.posts ?? [];
      if (posts.length === 0) {
        return res.status(422).json({ error: "No original posts found in that date range. Check that the profile is public and the dates are correct." });
      }

      // Build source context block from the server-fetched posts.
      const sourceContext = posts
        .map((p, i) =>
          `Post ${i + 1}${p.postedAt ? ` (${p.postedAt})` : ""}:\n${p.text}`,
        )
        .join("\n\n---\n\n");

      // Derive a title: "[Profile Name] LinkedIn Digest — [Month Range]"
      const startLabel = start.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      const endLabel = end.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      const dateLabel = startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
      const briefTitle = typeof calendarName === "string" && calendarName.trim()
        ? calendarName.trim()
        : `LinkedIn Digest — ${dateLabel}`;

      // Find-or-create a "LinkedIn Digests" editorial calendar for this tenant.
      const digestCalendarName = "LinkedIn Digests";
      let calendarId: string;

      const existingCalendars = await db
        .select({ id: editorialCalendars.id })
        .from(editorialCalendars)
        .where(
          and(
            eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
            eq(editorialCalendars.marketId, ctx.marketId),
            eq(editorialCalendars.name, digestCalendarName),
          ),
        )
        .limit(1);

      if (existingCalendars.length) {
        calendarId = existingCalendars[0].id;
      } else {
        const [newCal] = await db
          .insert(editorialCalendars)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            name: digestCalendarName,
            description: "Auto-created calendar for LinkedIn Digest briefs.",
            funnelTargets: DEFAULT_FUNNEL_TARGETS,
            status: "active",
            createdBy: ctx.userId,
          })
          .returning();
        calendarId = newCal.id;
      }

      // Persist the brief.
      const briefId = randomUUID();
      const [brief] = await db
        .insert(contentBriefs)
        .values({
          id: briefId,
          calendarId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId || null,
          title: briefTitle,
          format: "linkedin_digest",
          demandSignal: `LinkedIn profile: ${profileUrl} | Date range: ${startDate} to ${endDate} | ${posts.length} original post(s)`,
          funnelStage: "awareness",
          differentiationAngle: "First-person perspective, own voice and experience",
          targetReader: "LinkedIn connections and followers",
          cta: "Follow for more or connect to continue the conversation",
          status: "accepted",
          aiGenerated: false,
          sortOrder: 0,
        })
        .returning();

      // Generate the draft using the copywriter with the posts injected.
      const voiceProfile = await getPersonalVoiceProfile(ctx.userId);
      const draft = await draftFromBrief(brief, {
        isDefaultMarket: ctx.isDefaultMarket,
        sourceContext,
        soundLikeMeInstructions: voiceProfile?.soundLikeMeInstructions ?? null,
      });

      if (!draft.body?.trim()) {
        return res.status(502).json({ error: "The AI did not return a usable draft. Please try again." });
      }

      // Persist the draft asset and link it back to the brief.
      const result = await db.transaction(async (tx) => {
        const [asset] = await tx
          .insert(contentAssets)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            title: draft.title || briefTitle,
            description: draft.meta || null,
            content: draft.body,
            subtitle: draft.subtitle || null,
            overview: draft.overview || null,
            assetType: briefFormatToAssetType("linkedin_digest"),
            status: "active",
            createdBy: ctx.userId,
          })
          .returning();

        const [updatedBrief] = await tx
          .update(contentBriefs)
          .set({ contentAssetId: asset.id, status: "drafted", updatedAt: new Date() })
          .where(eq(contentBriefs.id, brief.id))
          .returning();

        return { asset, brief: updatedBrief };
      });

      res.status(201).json({
        ...result,
        calendarId,
        draft: {
          title: draft.title,
          subtitle: draft.subtitle,
          overview: draft.overview,
          body: draft.body,
          meta: draft.meta,
          format: "linkedin_digest",
        },
      });
    } catch (err: any) {
      console.error("[linkedin-digest create]", err);
      res.status(500).json({ error: err.message || "Failed to create LinkedIn Digest" });
    }
  });

  // Delete a calendar (briefs cascade).
  app.delete("/api/editorial-calendars/:id", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);
      const [deleted] = await db
        .delete(editorialCalendars)
        .where(
          and(
            eq(editorialCalendars.id, req.params.id),
            eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
            eq(editorialCalendars.marketId, ctx.marketId),
          ),
        )
        .returning({ id: editorialCalendars.id });
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[editorial-calendars delete]", err);
      res.status(500).json({ error: err.message || "Failed to delete editorial calendar" });
    }
  });
}
