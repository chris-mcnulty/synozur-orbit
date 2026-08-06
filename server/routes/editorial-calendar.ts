import type { Express } from "express";
import { db } from "../db";
import { editorialCalendars, contentBriefs, contentAssets, campaigns, solutionAreas, personas, marketingTasks, marketingPlans, marketingLinks, generatedPosts, socialAccounts } from "@shared/schema";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { storeArtifact } from "../services/artifact-storage-helper";
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

// Canonical market scope for shared content_assets rows: default-market data
// may be stored with the default market id OR NULL (cross-feature convention,
// mirrors assetMarketScope in content-production.ts), so match both for the
// default market.
function assetMarketScope(ctx: { isDefaultMarket: boolean; marketId: string }) {
  return ctx.isDefaultMarket
    ? or(eq(contentAssets.marketId, ctx.marketId), isNull(contentAssets.marketId))
    : eq(contentAssets.marketId, ctx.marketId);
}

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
          if (extracted.content) {
            sourceArticleText = extracted.content;
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

      // Enrich each brief with its produced draft's website publish fields. The
      // asset owns the link (contentAssets.sourceBriefId), so we read from there.
      const briefIds = briefs.map((b) => b.id);
      const assetWebsiteRows = briefIds.length
        ? await db
            .select({
              sourceBriefId: contentAssets.sourceBriefId,
              title: contentAssets.title,
              websitePostSlug: contentAssets.websitePostSlug,
              websitePostStatus: contentAssets.websitePostStatus,
              websiteScheduledFor: contentAssets.websiteScheduledFor,
            })
            .from(contentAssets)
            .where(
              and(
                inArray(contentAssets.sourceBriefId, briefIds),
                eq(contentAssets.tenantDomain, ctx.tenantDomain),
                assetMarketScope(ctx),
              ),
            )
        : [];
      const assetInfoByBriefId = new Map(
        assetWebsiteRows
          .filter((a): a is typeof a & { sourceBriefId: string } => !!a.sourceBriefId)
          .map((a) => [a.sourceBriefId, a]),
      );
      const enrichedBriefs = briefs.map((b) => {
        const ai = assetInfoByBriefId.get(b.id);
        // draftTitle: title from asset linked via sourceBriefId (reverse FK).
        // contentAssetId on the brief is the forward FK (set when drafting).
        // Use whichever is available; they should agree.
        const draftTitle = ai?.title ?? null;
        return {
          ...b,
          draftTitle,
          websitePostSlug: ai?.websitePostSlug ?? null,
          websitePostStatus: ai?.websitePostStatus ?? null,
          websiteScheduledFor: ai?.websiteScheduledFor ?? null,
        };
      });

      res.json({ calendar, briefs: enrichedBriefs });
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

      // Enrich: draft title/category from the produced asset, keyed off the
      // asset's sourceBriefId (the asset owns the brief↔draft link).
      const briefIds = rows.map((b) => b.id);
      let assetMap = new Map<string, { title: string; categoryId: string | null }>();
      if (briefIds.length) {
        const assets = await db
          .select({ sourceBriefId: contentAssets.sourceBriefId, title: contentAssets.title, categoryId: contentAssets.categoryId })
          .from(contentAssets)
          .where(
            and(
              inArray(contentAssets.sourceBriefId, briefIds),
              eq(contentAssets.tenantDomain, ctx.tenantDomain),
              assetMarketScope(ctx),
            ),
          );
        for (const a of assets) {
          if (a.sourceBriefId && !assetMap.has(a.sourceBriefId)) {
            assetMap.set(a.sourceBriefId, { title: a.title, categoryId: a.categoryId });
          }
        }
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

      // Enrich: campaign status so the client can hide briefs on closed campaigns.
      const uniqueCampaignIds = [...new Set(rows.map((b) => b.campaignId).filter((id): id is string => !!id))];
      const campaignStatusMap = new Map<string, string>();
      if (uniqueCampaignIds.length) {
        const campaignRows = await db
          .select({ id: campaigns.id, status: campaigns.status })
          .from(campaigns)
          .where(inArray(campaigns.id, uniqueCampaignIds));
        for (const c of campaignRows) campaignStatusMap.set(c.id, c.status);
      }

      const enriched = rows.map((b) => {
        const asset = assetMap.get(b.id);
        return {
          ...b,
          draftTitle: asset?.title ?? null,
          draftCategoryId: asset?.categoryId ?? null,
          pushedToPlanner: pushedBriefIds.has(b.id),
          campaignStatus: b.campaignId ? (campaignStatusMap.get(b.campaignId) ?? null) : null,
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
      const briefIds = briefs.map((b) => b.id);
      let assetMap = new Map<string, { title: string; categoryId: string | null }>();
      if (briefIds.length) {
        const assets = await db
          .select({
            sourceBriefId: contentAssets.sourceBriefId,
            title: contentAssets.title,
            categoryId: contentAssets.categoryId,
          })
          .from(contentAssets)
          .where(
            and(
              inArray(contentAssets.sourceBriefId, briefIds),
              eq(contentAssets.tenantDomain, ctx.tenantDomain),
              assetMarketScope(ctx),
            ),
          );
        for (const a of assets) {
          if (a.sourceBriefId && !assetMap.has(a.sourceBriefId)) {
            assetMap.set(a.sourceBriefId, { title: a.title, categoryId: a.categoryId });
          }
        }
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
        const asset = assetMap.get(b.id);
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

      // blank: true — skip AI generation entirely and create an empty draft
      // linked to the brief, ready for the user to write themselves.
      const blank = req.body?.blank === true;

      const instructions = typeof req.body?.instructions === "string" ? req.body.instructions : undefined;
      const guest = typeof req.body?.guest === "string" ? req.body.guest : undefined;
      const draft = blank
        ? {
            title: brief.title,
            subtitle: null as string | null,
            overview: null as string | null,
            body: "",
            meta: null as string | null,
            tags: null as string[] | null,
            format: brief.format,
            usage: undefined,
            model: undefined,
          }
        : await (async () => {
            const voiceProfile = await getPersonalVoiceProfile(ctx.userId);
            return draftFromBrief(brief, {
              isDefaultMarket: ctx.isDefaultMarket,
              instructions,
              guest,
              soundLikeMeInstructions: voiceProfile?.soundLikeMeInstructions ?? null,
            });
          })();

      if (!blank && !draft.body?.trim()) {
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
            // postTags is a text column; draft.tags may be a string[]. Preserve
            // the existing runtime value and cast so the insert typechecks.
            postTags: (draft.tags as any) || null,
            assetType: briefFormatToAssetType(draft.format as any),
            status: "active",
            // Output points back at the brief that motivated it; the brief-side
            // contentAssetId write below stays in sync for back-compat.
            sourceBriefId: brief.id,
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
      // Retain in SPE (silent fallback to object storage).
      try {
        await storeArtifact({
          tenantDomain: ctx.tenantDomain,
          buffer: docBuffer,
          filename,
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          kind: "docx",
          marketId: ctx.marketId,
          createdByUserId: ctx.userId,
        });
      } catch (e: any) {
        console.error("[content-briefs download-docx] store failed:", e?.message);
      }
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

  // ── Campaign-scoped LinkedIn Digest ─────────────────────────────────────────
  // One call from a campaign generates three linked outputs:
  //   1. linkedin_digest content brief + draft (the full article)
  //   2. newsletter content brief + draft
  //   3. LinkedIn social teaser post (generatedPost, status=draft)
  // Source is pasted content — no LinkedIn API scraping required.
  app.post("/api/campaigns/:id/generate-digest", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "editorialCalendar"))) return;
      const ctx = await getRequestContext(req);

      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain), eq(campaigns.marketId, ctx.marketId)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const sourceContent = typeof req.body?.sourceContent === "string" ? req.body.sourceContent.trim() : "";
      if (!sourceContent) return res.status(400).json({ error: "sourceContent is required — paste your LinkedIn posts or notes." });

      const customTitle = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const socialAccountId = typeof req.body?.socialAccountId === "string" ? req.body.socialAccountId.trim() : "";

      const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const digestTitle = customTitle || `LinkedIn Digest — ${monthLabel}`;

      // Find or create the campaign's editorial calendar.
      let [calendar] = await db
        .select()
        .from(editorialCalendars)
        .where(and(eq(editorialCalendars.campaignId, campaign.id), eq(editorialCalendars.tenantDomain, ctx.tenantDomain)))
        .limit(1);
      if (!calendar) {
        [calendar] = await db
          .insert(editorialCalendars)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            campaignId: campaign.id,
            name: campaign.name,
            description: campaign.description || null,
            funnelTargets: DEFAULT_FUNNEL_TARGETS,
            status: "active",
            createdBy: ctx.userId,
          })
          .returning();
      }
      const calendarId = calendar.id;

      const voiceProfile = await getPersonalVoiceProfile(ctx.userId);

      // Insert the two briefs.
      const digestBriefId = randomUUID();
      const newsletterBriefId = randomUUID();

      const [digestBrief, newsletterBrief] = await db.transaction(async (tx) => {
        const [db1] = await tx
          .insert(contentBriefs)
          .values({
            id: digestBriefId,
            calendarId,
            campaignId: campaign.id,
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            title: digestTitle,
            format: "linkedin_digest",
            demandSignal: "Synthesized from curated LinkedIn posts and industry news",
            funnelStage: "awareness",
            differentiationAngle: "First-person perspective, own voice and experience",
            targetReader: "LinkedIn connections, newsletter subscribers, and blog readers",
            cta: "Follow for more or connect to continue the conversation",
            status: "accepted",
            aiGenerated: false,
            sortOrder: 0,
          })
          .returning();

        const [nb] = await tx
          .insert(contentBriefs)
          .values({
            id: newsletterBriefId,
            calendarId,
            campaignId: campaign.id,
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            title: `Newsletter: ${digestTitle}`,
            format: "newsletter",
            demandSignal: "Subscriber-ready version of the LinkedIn digest",
            funnelStage: "awareness",
            differentiationAngle: "Curated insights formatted for email delivery",
            targetReader: "Email subscribers",
            cta: "Share with a colleague or subscribe for more",
            status: "accepted",
            aiGenerated: false,
            sortOrder: 1,
          })
          .returning();

        return [db1, nb];
      });

      // Draft both in parallel — each gets the source content injected.
      const [digestDraft, newsletterDraft] = await Promise.all([
        draftFromBrief(digestBrief, {
          isDefaultMarket: ctx.isDefaultMarket,
          sourceContext: sourceContent,
          soundLikeMeInstructions: voiceProfile?.soundLikeMeInstructions ?? null,
        }),
        draftFromBrief(newsletterBrief, {
          isDefaultMarket: ctx.isDefaultMarket,
          sourceContext: sourceContent,
          soundLikeMeInstructions: voiceProfile?.soundLikeMeInstructions ?? null,
        }),
      ]);

      if (!digestDraft.body?.trim()) {
        return res.status(502).json({ error: "The AI did not return a usable digest draft. Please try again." });
      }

      // Persist assets and flip brief status.
      const [digestAsset, newsletterAsset] = await db.transaction(async (tx) => {
        const [da] = await tx
          .insert(contentAssets)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            title: digestDraft.title || digestTitle,
            description: digestDraft.meta || null,
            content: digestDraft.body,
            subtitle: digestDraft.subtitle || null,
            overview: digestDraft.overview || null,
            assetType: briefFormatToAssetType("linkedin_digest"),
            status: "active",
            sourceBriefId: digestBriefId,
            createdBy: ctx.userId,
          })
          .returning();
        await tx
          .update(contentBriefs)
          .set({ contentAssetId: da.id, status: "drafted", updatedAt: new Date() })
          .where(eq(contentBriefs.id, digestBriefId));

        const [na] = await tx
          .insert(contentAssets)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            title: newsletterDraft.title || `Newsletter: ${digestTitle}`,
            description: newsletterDraft.meta || null,
            content: newsletterDraft.body || "",
            assetType: briefFormatToAssetType("newsletter"),
            status: "active",
            sourceBriefId: newsletterBriefId,
            createdBy: ctx.userId,
          })
          .returning();
        await tx
          .update(contentBriefs)
          .set({ contentAssetId: na.id, status: "drafted", updatedAt: new Date() })
          .where(eq(contentBriefs.id, newsletterBriefId));

        return [da, na];
      });

      // Generate LinkedIn teaser post if an account was selected — non-fatal if it fails.
      let postId: string | null = null;
      if (socialAccountId) {
        try {
          const [account] = await db
            .select()
            .from(socialAccounts)
            .where(and(eq(socialAccounts.id, socialAccountId), eq(socialAccounts.tenantDomain, ctx.tenantDomain)));

          if (account) {
            // Create a linkedin_post brief, draft it using the digest body as source.
            const teaserBriefId = randomUUID();
            const [teaserBrief] = await db
              .insert(contentBriefs)
              .values({
                id: teaserBriefId,
                calendarId,
                campaignId: campaign.id,
                tenantDomain: ctx.tenantDomain,
                marketId: ctx.marketId || null,
                title: `LinkedIn post: ${digestTitle}`,
                format: "linkedin_post",
                funnelStage: "awareness",
                cta: "Read the full digest — link in comments",
                status: "accepted",
                aiGenerated: false,
                sortOrder: 2,
              })
              .returning();

            const teaserDraft = await draftFromBrief(teaserBrief, {
              isDefaultMarket: ctx.isDefaultMarket,
              // Feed the digest body as source so the teaser previews it faithfully.
              sourceContext: `Here is the full digest article — write a compelling LinkedIn teaser that makes connections want to read it:\n\n${digestDraft.body.slice(0, 5000)}`,
              soundLikeMeInstructions: voiceProfile?.soundLikeMeInstructions ?? null,
            });

            if (teaserDraft.body?.trim()) {
              const newPostId = randomUUID();
              await db.insert(generatedPosts).values({
                id: newPostId,
                tenantDomain: ctx.tenantDomain,
                campaignId: campaign.id,
                sourceBriefId: teaserBriefId,
                socialAccountId: account.id,
                platform: account.platform,
                content: teaserDraft.body.trim(),
                status: "draft",
              });
              await db
                .update(contentBriefs)
                .set({ status: "drafted", updatedAt: new Date() })
                .where(eq(contentBriefs.id, teaserBriefId));
              postId = newPostId;
            }
          }
        } catch (teaserErr: any) {
          console.warn("[generate-digest] Teaser post generation failed (non-fatal):", teaserErr?.message);
        }
      }

      res.status(201).json({
        title: digestDraft.title || digestTitle,
        digestBriefId,
        digestAssetId: digestAsset.id,
        newsletterBriefId,
        newsletterAssetId: newsletterAsset.id,
        postId,
        calendarId,
      });
    } catch (err: any) {
      console.error("[generate-digest]", err);
      res.status(500).json({ error: err.message || "Failed to generate digest" });
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
            // Output points back at the brief that motivated it; the brief-side
            // contentAssetId write below stays in sync for back-compat.
            sourceBriefId: brief.id,
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
