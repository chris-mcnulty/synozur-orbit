import type { Express } from "express";
import { db } from "../db";
import { editorialCalendars, contentBriefs, contentAssets } from "@shared/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { generateContentBriefs } from "../services/editorial-calendar-service";
import { draftFromBrief } from "../services/copywriter-service";
import { DEFAULT_FUNNEL_TARGETS, briefFormatToAssetType } from "../services/editorial-calendar-core";

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
      const ctx = await getRequestContext(req);
      const [calendar] = await db
        .select()
        .from(editorialCalendars)
        .where(
          and(
            eq(editorialCalendars.id, req.params.id),
            eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
          ),
        );
      if (!calendar) return res.status(404).json({ error: "Not found" });

      const briefs = await db
        .select()
        .from(contentBriefs)
        .where(eq(contentBriefs.calendarId, calendar.id))
        .orderBy(asc(contentBriefs.sortOrder), asc(contentBriefs.createdAt));

      res.json({ calendar, briefs });
    } catch (err: any) {
      console.error("[editorial-calendars get]", err);
      res.status(500).json({ error: err.message || "Failed to fetch editorial calendar" });
    }
  });

  // Update a single content brief (status changes, edits).
  app.patch("/api/content-briefs/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const updates: Record<string, any> = {};
      for (const field of EDITABLE_BRIEF_FIELDS) {
        if (req.body?.[field] !== undefined) updates[field] = req.body[field];
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
          .where(eq(contentBriefs.id, brief.id))
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

  // Delete a calendar (briefs cascade).
  app.delete("/api/editorial-calendars/:id", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const [deleted] = await db
        .delete(editorialCalendars)
        .where(
          and(
            eq(editorialCalendars.id, req.params.id),
            eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
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
