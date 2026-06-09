import type { Express } from "express";
import { db } from "../db";
import { editorialCalendars, contentBriefs, contentAssets, campaigns, solutionAreas } from "@shared/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { generateContentBriefs } from "../services/editorial-calendar-service";
import { draftFromBrief } from "../services/copywriter-service";
import { DEFAULT_FUNNEL_TARGETS, briefFormatToAssetType } from "../services/editorial-calendar-core";

const FORMAT_LABELS: Record<string, string> = {
  blog_post: "Blog post",
  landing_page: "Landing page",
  linkedin_post: "LinkedIn post",
  x_post: "X / Twitter post",
  newsletter: "Newsletter",
  video_script: "Video script",
  case_study: "Case study",
  whitepaper: "Whitepaper",
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

      const enriched = briefs.map((b) => {
        const asset = b.contentAssetId ? assetMap.get(b.contentAssetId) : undefined;
        return {
          ...b,
          draftTitle: asset?.title ?? null,
          draftCategoryId: asset?.categoryId ?? null,
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
      const draft = await draftFromBrief(brief, {
        isDefaultMarket: ctx.isDefaultMarket,
        instructions,
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
          body: draft.body,
          meta: draft.meta,
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
            eq(contentBriefs.marketId, ctx.marketId),
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
