/**
 * Conference Social Promotion routes.
 *
 * Manages conferences, their delivered sessions, a dedicated (archivable) image
 * space, and AI generation of anchor + per-session posts with 2-3 copy
 * variations each. Generation is async via the job queue; posts land in the
 * shared `generatedPosts` table so they reuse the calendar/publishing flows.
 *
 * Feature-gated via "conferencePromotion"; scoped to tenantDomain + marketId.
 */

import type { Express } from "express";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  conferences,
  conferenceSessions,
  conferenceImages,
  generatedPosts,
  scheduledJobRuns,
  CONFERENCE_IMAGE_SOURCES,
  CONFERENCE_IMAGE_ROLES,
  type ConferenceImageSource,
  type ConferenceImageRole,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { guardFeature, guardManualAction } from "./helpers";
import { enqueue } from "../services/job-queue";
import {
  generateConferencePostsAsync,
  renderConferenceImage,
} from "../services/conference-promotion-service";

const FEATURE = "conferencePromotion";

function toDateOrNull(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function cleanStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
}

export function registerConferencePromotionRoutes(app: Express) {
  // ── Conferences ────────────────────────────────────────────────────────────

  app.get("/api/conferences", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const where = status
      ? and(eq(conferences.tenantDomain, ctx.tenantDomain), eq(conferences.status, status))
      : and(eq(conferences.tenantDomain, ctx.tenantDomain), inArray(conferences.status, ["active", "archived"]));
    const rows = await db.select().from(conferences).where(where).orderBy(desc(conferences.createdAt));
    res.json(rows);
  });

  app.get("/api/conferences/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [conf] = await db
      .select()
      .from(conferences)
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain)));
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const sessions = await db
      .select()
      .from(conferenceSessions)
      .where(and(eq(conferenceSessions.conferenceId, conf.id), eq(conferenceSessions.status, "active")))
      .orderBy(conferenceSessions.sortOrder);
    const images = await db
      .select()
      .from(conferenceImages)
      .where(eq(conferenceImages.conferenceId, conf.id));
    res.json({ ...conf, sessions, images });
  });

  app.post("/api/conferences", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const b = req.body ?? {};
    if (!b.name || typeof b.name !== "string" || !b.name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const [row] = await db
      .insert(conferences)
      .values({
        id: randomUUID(),
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        name: b.name.trim(),
        description: typeof b.description === "string" ? b.description : null,
        location: typeof b.location === "string" ? b.location : null,
        website: typeof b.website === "string" ? b.website : null,
        eventHashtag: typeof b.eventHashtag === "string" ? b.eventHashtag : null,
        startDate: toDateOrNull(b.startDate),
        endDate: toDateOrNull(b.endDate),
        promoStartDate: toDateOrNull(b.promoStartDate),
        promoEndDate: toDateOrNull(b.promoEndDate),
        postsPerDay: Number.isFinite(b.postsPerDay) ? Math.max(1, Math.trunc(b.postsPerDay)) : 2,
        includeSaturday: !!b.includeSaturday,
        includeSunday: !!b.includeSunday,
        anchorPostCount: Number.isFinite(b.anchorPostCount) ? Math.min(2, Math.max(1, Math.trunc(b.anchorPostCount))) : 2,
        variantsPerPost: Number.isFinite(b.variantsPerPost) ? Math.min(3, Math.max(2, Math.trunc(b.variantsPerPost))) : 3,
        thematicBrief: typeof b.thematicBrief === "string" ? b.thematicBrief : null,
        alwaysHashtags: cleanStringArray(b.alwaysHashtags),
        productIds: cleanStringArray(b.productIds),
        createdBy: ctx.userId,
      })
      .returning();
    res.status(201).json(row);
  });

  app.patch("/api/conferences/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [existing] = await db
      .select()
      .from(conferences)
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain)));
    if (!existing) return res.status(404).json({ error: "Conference not found" });

    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
    if ("description" in b) patch.description = b.description ?? null;
    if ("location" in b) patch.location = b.location ?? null;
    if ("website" in b) patch.website = b.website ?? null;
    if ("eventHashtag" in b) patch.eventHashtag = b.eventHashtag ?? null;
    if ("startDate" in b) patch.startDate = toDateOrNull(b.startDate);
    if ("endDate" in b) patch.endDate = toDateOrNull(b.endDate);
    if ("promoStartDate" in b) patch.promoStartDate = toDateOrNull(b.promoStartDate);
    if ("promoEndDate" in b) patch.promoEndDate = toDateOrNull(b.promoEndDate);
    if (Number.isFinite(b.postsPerDay)) patch.postsPerDay = Math.max(1, Math.trunc(b.postsPerDay));
    if ("includeSaturday" in b) patch.includeSaturday = !!b.includeSaturday;
    if ("includeSunday" in b) patch.includeSunday = !!b.includeSunday;
    if (Number.isFinite(b.anchorPostCount)) patch.anchorPostCount = Math.min(2, Math.max(1, Math.trunc(b.anchorPostCount)));
    if (Number.isFinite(b.variantsPerPost)) patch.variantsPerPost = Math.min(3, Math.max(2, Math.trunc(b.variantsPerPost)));
    if ("thematicBrief" in b) patch.thematicBrief = b.thematicBrief ?? null;
    if ("alwaysHashtags" in b) patch.alwaysHashtags = cleanStringArray(b.alwaysHashtags);
    if ("productIds" in b) patch.productIds = cleanStringArray(b.productIds);

    const [row] = await db.update(conferences).set(patch).where(eq(conferences.id, existing.id)).returning();
    res.json(row);
  });

  app.delete("/api/conferences/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [existing] = await db
      .select()
      .from(conferences)
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain)));
    if (!existing) return res.status(404).json({ error: "Conference not found" });
    await db.update(conferences).set({ status: "deleted", updatedAt: new Date() }).where(eq(conferences.id, existing.id));
    res.json({ ok: true });
  });

  // One-click archive: hide the conference and all its images after the event.
  app.post("/api/conferences/:id/archive", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [existing] = await db
      .select()
      .from(conferences)
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain)));
    if (!existing) return res.status(404).json({ error: "Conference not found" });
    const now = new Date();
    await db.update(conferences).set({ status: "archived", archivedAt: now, updatedAt: now }).where(eq(conferences.id, existing.id));
    await db
      .update(conferenceImages)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(eq(conferenceImages.conferenceId, existing.id));
    res.json({ ok: true, archivedAt: now });
  });

  app.post("/api/conferences/:id/unarchive", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [existing] = await db
      .select()
      .from(conferences)
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain)));
    if (!existing) return res.status(404).json({ error: "Conference not found" });
    const now = new Date();
    await db.update(conferences).set({ status: "active", archivedAt: null, updatedAt: now }).where(eq(conferences.id, existing.id));
    await db
      .update(conferenceImages)
      .set({ status: "active", archivedAt: null, updatedAt: now })
      .where(eq(conferenceImages.conferenceId, existing.id));
    res.json({ ok: true });
  });

  // ── Sessions ─────────────────────────────────────────────────────────────────

  async function loadConference(reqId: string, tenantDomain: string) {
    const [conf] = await db
      .select()
      .from(conferences)
      .where(and(eq(conferences.id, reqId), eq(conferences.tenantDomain, tenantDomain)));
    return conf;
  }

  app.get("/api/conferences/:id/sessions", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const rows = await db
      .select()
      .from(conferenceSessions)
      .where(and(eq(conferenceSessions.conferenceId, conf.id), eq(conferenceSessions.status, "active")))
      .orderBy(conferenceSessions.sortOrder);
    res.json(rows);
  });

  function buildSessionValues(conferenceId: string, tenantDomain: string, s: any, sortOrder: number) {
    return {
      id: randomUUID(),
      conferenceId,
      tenantDomain,
      title: String(s.title).trim(),
      speaker: typeof s.speaker === "string" ? s.speaker.trim() : null,
      track: typeof s.track === "string" ? s.track.trim() : null,
      room: typeof s.room === "string" ? s.room.trim() : null,
      sessionStart: toDateOrNull(s.sessionStart),
      sessionEnd: toDateOrNull(s.sessionEnd),
      abstract: typeof s.abstract === "string" ? s.abstract.trim() : null,
      url: typeof s.url === "string" ? s.url.trim() : null,
      sortOrder,
    };
  }

  app.post("/api/conferences/:id/sessions", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const b = req.body ?? {};
    if (!b.title || typeof b.title !== "string" || !b.title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    const existing = await db
      .select({ id: conferenceSessions.id })
      .from(conferenceSessions)
      .where(eq(conferenceSessions.conferenceId, conf.id));
    const [row] = await db.insert(conferenceSessions).values(buildSessionValues(conf.id, ctx.tenantDomain, b, existing.length)).returning();
    res.status(201).json(row);
  });

  // Bulk import (CSV/paste). Body: { sessions: [{ title, speaker, track, room, sessionStart, abstract, url }, ...] }
  app.post("/api/conferences/:id/sessions/bulk", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const incoming = Array.isArray(req.body?.sessions) ? req.body.sessions : [];
    const valid = incoming.filter((s: any) => s && typeof s.title === "string" && s.title.trim());
    if (valid.length === 0) return res.status(400).json({ error: "No valid sessions (each needs a title)" });

    const existing = await db
      .select({ id: conferenceSessions.id })
      .from(conferenceSessions)
      .where(eq(conferenceSessions.conferenceId, conf.id));
    let order = existing.length;
    const values = valid.map((s: any) => buildSessionValues(conf.id, ctx.tenantDomain, s, order++));
    const rows = await db.insert(conferenceSessions).values(values).returning();
    res.status(201).json({ created: rows.length, sessions: rows });
  });

  app.patch("/api/conference-sessions/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [existing] = await db
      .select()
      .from(conferenceSessions)
      .where(and(eq(conferenceSessions.id, req.params.id), eq(conferenceSessions.tenantDomain, ctx.tenantDomain)));
    if (!existing) return res.status(404).json({ error: "Session not found" });
    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof b.title === "string" && b.title.trim()) patch.title = b.title.trim();
    if ("speaker" in b) patch.speaker = b.speaker ?? null;
    if ("track" in b) patch.track = b.track ?? null;
    if ("room" in b) patch.room = b.room ?? null;
    if ("sessionStart" in b) patch.sessionStart = toDateOrNull(b.sessionStart);
    if ("sessionEnd" in b) patch.sessionEnd = toDateOrNull(b.sessionEnd);
    if ("abstract" in b) patch.abstract = b.abstract ?? null;
    if ("url" in b) patch.url = b.url ?? null;
    if (Number.isFinite(b.sortOrder)) patch.sortOrder = Math.trunc(b.sortOrder);
    const [row] = await db.update(conferenceSessions).set(patch).where(eq(conferenceSessions.id, existing.id)).returning();
    res.json(row);
  });

  app.delete("/api/conference-sessions/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [existing] = await db
      .select()
      .from(conferenceSessions)
      .where(and(eq(conferenceSessions.id, req.params.id), eq(conferenceSessions.tenantDomain, ctx.tenantDomain)));
    if (!existing) return res.status(404).json({ error: "Session not found" });
    await db
      .update(conferenceSessions)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(eq(conferenceSessions.id, existing.id));
    res.json({ ok: true });
  });

  // ── Images (dedicated conference space) ──────────────────────────────────────

  app.get("/api/conferences/:id/images", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const includeArchived = req.query.includeArchived === "true";
    const where = includeArchived
      ? eq(conferenceImages.conferenceId, conf.id)
      : and(eq(conferenceImages.conferenceId, conf.id), eq(conferenceImages.status, "active"));
    const rows = await db.select().from(conferenceImages).where(where).orderBy(desc(conferenceImages.createdAt));
    res.json(rows);
  });

  app.post("/api/conferences/:id/images", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const b = req.body ?? {};
    const source: ConferenceImageSource = CONFERENCE_IMAGE_SOURCES.includes(b.source) ? b.source : "ai_generated";
    const role: ConferenceImageRole = CONFERENCE_IMAGE_ROLES.includes(b.role) ? b.role : (b.sessionId ? "session" : "anchor");
    const sessionId = typeof b.sessionId === "string" && b.sessionId ? b.sessionId : null;

    // Validate session belongs to this conference and enforce 1:1.
    if (sessionId) {
      const [sess] = await db
        .select()
        .from(conferenceSessions)
        .where(and(eq(conferenceSessions.id, sessionId), eq(conferenceSessions.conferenceId, conf.id)));
      if (!sess) return res.status(400).json({ error: "sessionId does not belong to this conference" });
      const [dupe] = await db.select().from(conferenceImages).where(eq(conferenceImages.sessionId, sessionId));
      if (dupe) return res.status(409).json({ error: "This session already has an image (1:1)" });
    }
    if (source === "uploaded" && (!b.fileUrl || typeof b.fileUrl !== "string")) {
      return res.status(400).json({ error: "uploaded images require a fileUrl" });
    }

    const [row] = await db
      .insert(conferenceImages)
      .values({
        id: randomUUID(),
        conferenceId: conf.id,
        sessionId,
        tenantDomain: ctx.tenantDomain,
        role,
        source,
        name: typeof b.name === "string" ? b.name : null,
        imagePrompt: typeof b.imagePrompt === "string" ? b.imagePrompt : null,
        templateAssetId: typeof b.templateAssetId === "string" && b.templateAssetId ? b.templateAssetId : null,
        fileUrl: source === "uploaded" ? b.fileUrl : null,
        fileType: source === "uploaded" && typeof b.fileType === "string" ? b.fileType : null,
        createdBy: ctx.userId,
      })
      .returning();
    res.status(201).json(row);
  });

  // Render bytes for an ai_generated / template_composite image on demand.
  app.post("/api/conference-images/:id/render", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    if (!(await guardManualAction(req, res, "aiPostGen"))) return;
    const ctx = await getRequestContext(req);
    const [img] = await db
      .select()
      .from(conferenceImages)
      .where(and(eq(conferenceImages.id, req.params.id), eq(conferenceImages.tenantDomain, ctx.tenantDomain)));
    if (!img) return res.status(404).json({ error: "Image not found" });
    const [conf] = await db.select().from(conferences).where(eq(conferences.id, img.conferenceId));
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    let session = null;
    if (img.sessionId) {
      [session] = await db.select().from(conferenceSessions).where(eq(conferenceSessions.id, img.sessionId));
    }
    try {
      const fileUrl = await renderConferenceImage(img, conf, session ?? null);
      res.json({ ok: true, fileUrl });
    } catch (err: any) {
      console.error("[Conference] render error:", err?.message);
      res.status(500).json({ error: "Failed to render image" });
    }
  });

  app.patch("/api/conference-images/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [img] = await db
      .select()
      .from(conferenceImages)
      .where(and(eq(conferenceImages.id, req.params.id), eq(conferenceImages.tenantDomain, ctx.tenantDomain)));
    if (!img) return res.status(404).json({ error: "Image not found" });
    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if ("name" in b) patch.name = b.name ?? null;
    if ("imagePrompt" in b) patch.imagePrompt = b.imagePrompt ?? null;
    if ("templateAssetId" in b) patch.templateAssetId = b.templateAssetId ?? null;
    if (typeof b.source === "string" && CONFERENCE_IMAGE_SOURCES.includes(b.source)) patch.source = b.source;
    if (b.source === "uploaded" && typeof b.fileUrl === "string") patch.fileUrl = b.fileUrl;
    const [row] = await db.update(conferenceImages).set(patch).where(eq(conferenceImages.id, img.id)).returning();
    res.json(row);
  });

  app.post("/api/conference-images/:id/archive", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [img] = await db
      .select()
      .from(conferenceImages)
      .where(and(eq(conferenceImages.id, req.params.id), eq(conferenceImages.tenantDomain, ctx.tenantDomain)));
    if (!img) return res.status(404).json({ error: "Image not found" });
    const now = new Date();
    const archive = req.body?.archived !== false;
    await db
      .update(conferenceImages)
      .set({ status: archive ? "archived" : "active", archivedAt: archive ? now : null, updatedAt: now })
      .where(eq(conferenceImages.id, img.id));
    res.json({ ok: true });
  });

  app.delete("/api/conference-images/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [img] = await db
      .select()
      .from(conferenceImages)
      .where(and(eq(conferenceImages.id, req.params.id), eq(conferenceImages.tenantDomain, ctx.tenantDomain)));
    if (!img) return res.status(404).json({ error: "Image not found" });
    await db.delete(conferenceImages).where(eq(conferenceImages.id, img.id));
    res.json({ ok: true });
  });

  // ── Post generation (async) ──────────────────────────────────────────────────

  app.post("/api/conferences/:id/generate-posts", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    if (!(await guardManualAction(req, res, "aiPostGen"))) return;
    try {
      const ctx = await getRequestContext(req);
      const conf = await loadConference(req.params.id, ctx.tenantDomain);
      if (!conf) return res.status(404).json({ error: "Conference not found" });

      const socialAccountIds = cleanStringArray(req.body?.socialAccountIds);
      if (socialAccountIds.length === 0) {
        return res.status(400).json({ error: "Select at least one social account" });
      }
      const generateImages = req.body?.generateImages !== false;

      const [job] = await db
        .insert(scheduledJobRuns)
        .values({
          id: randomUUID(),
          jobType: "generateConferencePosts",
          tenantDomain: ctx.tenantDomain,
          targetId: conf.id,
          targetName: conf.name,
          status: "pending",
        })
        .returning();

      await db.update(conferences).set({ postGenerationJobId: job.id, updatedAt: new Date() }).where(eq(conferences.id, conf.id));

      enqueue(
        "analysis",
        `conference-posts:${conf.id}`,
        (_signal, reportProgress) =>
          generateConferencePostsAsync(
            conf.id,
            ctx.tenantDomain,
            job.id,
            { socialAccountIds, ownerUserId: ctx.userId, generateImages },
            reportProgress,
          ),
        { ctx: { tenantDomain: ctx.tenantDomain, targetId: conf.id, targetName: conf.name } },
      ).catch((err) => console.error("[Conference] Post generation error:", err?.message));

      res.status(202).json({ jobId: job.id, status: "pending" });
    } catch (err: any) {
      console.error("[Conference Generate Posts Error]", err?.message);
      res.status(500).json({ error: "Failed to start post generation" });
    }
  });

  app.get("/api/conferences/:id/generate-posts-status", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    if (!conf.postGenerationJobId) return res.json({ status: "idle" });
    const [job] = await db.select().from(scheduledJobRuns).where(eq(scheduledJobRuns.id, conf.postGenerationJobId));
    res.json({ status: job?.status ?? "unknown", jobId: conf.postGenerationJobId, errorMessage: job?.errorMessage ?? null });
  });

  // Review generated posts for a conference (grouped client-side by variantGroup).
  app.get("/api/conferences/:id/posts", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const rows = await db
      .select()
      .from(generatedPosts)
      .where(and(eq(generatedPosts.conferenceId, conf.id), eq(generatedPosts.tenantDomain, ctx.tenantDomain)))
      .orderBy(generatedPosts.scheduledDate);
    res.json(rows);
  });
}
