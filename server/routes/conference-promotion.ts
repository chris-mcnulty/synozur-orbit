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
import { and, desc, eq, inArray, ne, notInArray, count } from "drizzle-orm";
import { db } from "../db";
import {
  conferences,
  conferenceSessions,
  conferenceImages,
  conferenceBackgrounds,
  generatedPosts,
  campaigns,
  scheduledJobRuns,
  CONFERENCE_IMAGE_SOURCES,
  CONFERENCE_IMAGE_ROLES,
  CONFERENCE_SESSION_TYPES,
  type ConferenceImageSource,
  type ConferenceImageRole,
  type ConferenceSpeaker,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { guardFeature, guardManualAction } from "./helpers";
import { enqueue } from "../services/job-queue";
import {
  generateConferencePostsAsync,
  renderConferenceImage,
} from "../services/conference-promotion-service";
import { buildPostsCsv } from "../services/posts-csv-export";
import { storeArtifact } from "../services/artifact-storage-helper";

const FEATURE = "conferencePromotion";

function toDateOrNull(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  // Event/session times are floating wall-clock values (no timezone). Normalize
  // a timezone-less datetime ("2026-09-18T16:00" or "2026-09-18 16:00") to UTC so
  // the typed wall-clock is stored and displayed identically regardless of the
  // server or viewer timezone.
  let s = v.trim();
  const tzless = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;
  if (tzless.test(s)) {
    s = s.replace(" ", "T");
    if (!/:\d{2}$/.test(s.slice(11))) s += ":00";
    s += "Z";
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function cleanStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
}

// Resolve an optional parent-campaign id, verifying it belongs to this tenant.
// Returns the id when valid, or null (so a bad/foreign id is simply ignored).
async function resolveParentCampaignId(
  ctx: { tenantDomain: string },
  raw: unknown,
): Promise<string | null> {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const [row] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, raw), eq(campaigns.tenantDomain, ctx.tenantDomain)));
  return row?.id ?? null;
}

// Normalise a speakers payload (array of strings or { name, isStaff }) into
// structured ConferenceSpeaker[]. Empty names are dropped.
function cleanSpeakers(v: unknown): ConferenceSpeaker[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s): ConferenceSpeaker => {
      if (typeof s === "string") return { name: s.trim(), isStaff: false };
      if (s && typeof s === "object" && typeof (s as any).name === "string") {
        return { name: (s as any).name.trim(), isStaff: !!(s as any).isStaff };
      }
      return { name: "", isStaff: false };
    })
    .filter((s) => s.name);
}

// Derive the legacy single-speaker display string from the structured list,
// falling back to a provided legacy value when no structured speakers exist.
function speakerDisplay(speakers: ConferenceSpeaker[], fallback?: string | null): string | null {
  if (speakers.length) return speakers.map((s) => s.name).join(", ");
  return fallback ?? null;
}

function cleanSessionType(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  return (CONFERENCE_SESSION_TYPES as readonly string[]).includes(up) ? up : null;
}

export function registerConferencePromotionRoutes(app: Express) {
  // ── Conferences ────────────────────────────────────────────────────────────

  // Events (conferences) linked to a campaign, with a post count — powers the
  // campaign master view's Events section.
  app.get("/api/campaigns/:id/events", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const rows = await db
      .select()
      .from(conferences)
      .where(and(
        eq(conferences.campaignId, req.params.id),
        eq(conferences.tenantDomain, ctx.tenantDomain),
        inArray(conferences.status, ["active", "archived"]),
      ))
      .orderBy(desc(conferences.startDate));
    const events = await Promise.all(
      rows.map(async (c) => {
        const [{ n } = { n: 0 }] = await db
          .select({ n: count() })
          .from(generatedPosts)
          .where(and(
            eq(generatedPosts.conferenceId, c.id),
            ne(generatedPosts.status, "deleted"),
            ne(generatedPosts.status, "rejected"),
            ne(generatedPosts.status, "archived"),
          ));
        return { id: c.id, name: c.name, status: c.status, startDate: c.startDate, endDate: c.endDate, postCount: Number(n) || 0 };
      }),
    );
    res.json(events);
  });

  app.get("/api/conferences", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const where = status
      ? and(eq(conferences.tenantDomain, ctx.tenantDomain), eq(conferences.marketId, ctx.marketId), eq(conferences.status, status))
      : and(
          eq(conferences.tenantDomain, ctx.tenantDomain),
          eq(conferences.marketId, ctx.marketId),
          inArray(conferences.status, ["active", "archived"]),
        );
    const rows = await db.select().from(conferences).where(where).orderBy(desc(conferences.createdAt));
    res.json(rows);
  });

  app.get("/api/conferences/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [conf] = await db
      .select()
      .from(conferences)
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain), eq(conferences.marketId, ctx.marketId)));
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const sessions = await db
      .select()
      .from(conferenceSessions)
      .where(and(eq(conferenceSessions.conferenceId, conf.id), eq(conferenceSessions.status, "active")))
      .orderBy(conferenceSessions.sortOrder);
    const images = await db
      .select()
      .from(conferenceImages)
      .where(and(eq(conferenceImages.conferenceId, conf.id), eq(conferenceImages.status, "active")));
    res.json({ ...conf, sessions, images });
  });

  app.post("/api/conferences", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const b = req.body ?? {};
    if (!b.name || typeof b.name !== "string" || !b.name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const parentCampaignId = await resolveParentCampaignId(ctx, b.campaignId);
    const [row] = await db
      .insert(conferences)
      .values({
        id: randomUUID(),
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        campaignId: parentCampaignId,
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
        discountStatement: typeof b.discountStatement === "string" ? b.discountStatement : null,
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
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain), eq(conferences.marketId, ctx.marketId)));
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
    if ("discountStatement" in b) patch.discountStatement = b.discountStatement ?? null;
    if ("alwaysHashtags" in b) patch.alwaysHashtags = cleanStringArray(b.alwaysHashtags);
    if ("productIds" in b) patch.productIds = cleanStringArray(b.productIds);
    if ("eventLogoFileUrl" in b) patch.eventLogoFileUrl = b.eventLogoFileUrl ?? null;
    if ("eventLogoFileType" in b) patch.eventLogoFileType = b.eventLogoFileType ?? null;
    if ("campaignId" in b) patch.campaignId = await resolveParentCampaignId(ctx, b.campaignId);

    const [row] = await db.update(conferences).set(patch).where(eq(conferences.id, existing.id)).returning();
    res.json(row);
  });

  app.delete("/api/conferences/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [existing] = await db
      .select()
      .from(conferences)
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain), eq(conferences.marketId, ctx.marketId)));
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
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain), eq(conferences.marketId, ctx.marketId)));
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
      .where(and(eq(conferences.id, req.params.id), eq(conferences.tenantDomain, ctx.tenantDomain), eq(conferences.marketId, ctx.marketId)));
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

  async function loadConference(reqId: string, tenantDomain: string, marketId: string) {
    const [conf] = await db
      .select()
      .from(conferences)
      .where(and(eq(conferences.id, reqId), eq(conferences.tenantDomain, tenantDomain), eq(conferences.marketId, marketId)));
    return conf;
  }

  app.get("/api/conferences/:id/sessions", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const rows = await db
      .select()
      .from(conferenceSessions)
      .where(and(eq(conferenceSessions.conferenceId, conf.id), eq(conferenceSessions.status, "active")))
      .orderBy(conferenceSessions.sortOrder);
    res.json(rows);
  });

  function buildSessionValues(conferenceId: string, tenantDomain: string, s: any, sortOrder: number) {
    const speakers = cleanSpeakers(s.speakers);
    return {
      id: randomUUID(),
      conferenceId,
      tenantDomain,
      title: String(s.title).trim(),
      speakers,
      speaker: speakerDisplay(speakers, typeof s.speaker === "string" ? s.speaker.trim() : null),
      sessionType: cleanSessionType(s.sessionType),
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
    const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
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
    const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
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
    if ("speakers" in b) {
      const sp = cleanSpeakers(b.speakers);
      patch.speakers = sp;
      patch.speaker = speakerDisplay(sp, null);
    } else if ("speaker" in b) {
      patch.speaker = b.speaker ?? null;
    }
    if ("sessionType" in b) patch.sessionType = cleanSessionType(b.sessionType);
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
    const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
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
    const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
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
        backgroundId: typeof b.backgroundId === "string" && b.backgroundId ? b.backgroundId : null,
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
    if ("backgroundId" in b) patch.backgroundId = b.backgroundId ?? null;
    if (typeof b.source === "string" && CONFERENCE_IMAGE_SOURCES.includes(b.source)) patch.source = b.source;
    if (b.source === "uploaded" && typeof b.fileUrl === "string") patch.fileUrl = b.fileUrl;
    if (b.source === "uploaded" && typeof b.fileType === "string") patch.fileType = b.fileType;
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

  // ── Conference Backgrounds (location photos for logo_composite) ───────────────

  app.get("/api/conferences/:id/backgrounds", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const rows = await db
      .select()
      .from(conferenceBackgrounds)
      .where(eq(conferenceBackgrounds.conferenceId, conf.id))
      .orderBy(conferenceBackgrounds.sortOrder, conferenceBackgrounds.createdAt);
    res.json(rows);
  });

  app.post("/api/conferences/:id/backgrounds", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const b = req.body ?? {};
    if (!b.fileUrl || typeof b.fileUrl !== "string") {
      return res.status(400).json({ error: "fileUrl is required" });
    }
    const existing = await db
      .select()
      .from(conferenceBackgrounds)
      .where(eq(conferenceBackgrounds.conferenceId, conf.id));
    const [row] = await db
      .insert(conferenceBackgrounds)
      .values({
        id: randomUUID(),
        conferenceId: conf.id,
        tenantDomain: ctx.tenantDomain,
        name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : null,
        fileUrl: b.fileUrl,
        fileType: typeof b.fileType === "string" ? b.fileType : null,
        fileSize: Number.isFinite(b.fileSize) ? b.fileSize : null,
        sortOrder: existing.length,
      })
      .returning();
    res.status(201).json(row);
  });

  app.patch("/api/conference-backgrounds/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [bg] = await db
      .select()
      .from(conferenceBackgrounds)
      .where(and(eq(conferenceBackgrounds.id, req.params.id), eq(conferenceBackgrounds.tenantDomain, ctx.tenantDomain)));
    if (!bg) return res.status(404).json({ error: "Background not found" });
    const b = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof b.name === "string") patch.name = b.name.trim() || null;
    if (Number.isFinite(b.sortOrder)) patch.sortOrder = b.sortOrder;
    const [row] = await db.update(conferenceBackgrounds).set(patch).where(eq(conferenceBackgrounds.id, bg.id)).returning();
    res.json(row);
  });

  app.delete("/api/conference-backgrounds/:id", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const [bg] = await db
      .select()
      .from(conferenceBackgrounds)
      .where(and(eq(conferenceBackgrounds.id, req.params.id), eq(conferenceBackgrounds.tenantDomain, ctx.tenantDomain)));
    if (!bg) return res.status(404).json({ error: "Background not found" });
    await db.delete(conferenceBackgrounds).where(eq(conferenceBackgrounds.id, bg.id));
    res.json({ ok: true });
  });

  // ── Post generation (async) ──────────────────────────────────────────────────

  app.post("/api/conferences/:id/generate-posts", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    if (!(await guardManualAction(req, res, "aiPostGen"))) return;
    try {
      const ctx = await getRequestContext(req);
      const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!conf) return res.status(404).json({ error: "Conference not found" });

      const socialAccountIds = cleanStringArray(req.body?.socialAccountIds);
      if (socialAccountIds.length === 0) {
        return res.status(400).json({ error: "Select at least one social account" });
      }
      const generateImages = req.body?.generateImages !== false;
      const includePublished = req.body?.includePublished === true;
      const rawTzOffset = Number(req.body?.tzOffset);
      const tzOffsetMinutes = Number.isFinite(rawTzOffset) ? rawTzOffset : undefined;

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
            { socialAccountIds, ownerUserId: ctx.userId, generateImages, tzOffsetMinutes, includePublished },
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
    const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    if (!conf.postGenerationJobId) return res.json({ status: "idle" });
    const [job] = await db.select().from(scheduledJobRuns).where(eq(scheduledJobRuns.id, conf.postGenerationJobId));
    res.json({ status: job?.status ?? "unknown", jobId: conf.postGenerationJobId, errorMessage: job?.errorMessage ?? null });
  });

  // Review generated posts for a conference (grouped client-side by variantGroup).
  app.get("/api/conferences/:id/posts", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    const ctx = await getRequestContext(req);
    const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
    if (!conf) return res.status(404).json({ error: "Conference not found" });
    const rows = await db
      .select()
      .from(generatedPosts)
      .where(and(
        eq(generatedPosts.conferenceId, conf.id),
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
        ne(generatedPosts.status, "deleted"),
      ))
      .orderBy(generatedPosts.scheduledDate);
    res.json(rows);
  });

  // Bulk approve / mark-CSV-only for conference posts so they flow through
  // the Marketing Publish Worker (which requires status="approved") or are
  // explicitly reserved for CSV export (deliveryMode="csv").
  app.post("/api/conferences/:id/posts/approve", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    try {
      const ctx = await getRequestContext(req);
      const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!conf) return res.status(404).json({ error: "Conference not found" });

      // action: "approve" → status=approved, deliveryMode=null (eligible for auto-publish)
      //         "csv_only" → deliveryMode="csv" (excluded from worker)
      //         "unapprove" → status=draft, deliveryMode=null
      const action: string = req.body?.action ?? "approve";
      const platform: string | undefined = req.body?.platform; // filter by platform when set
      const postIds: string[] | undefined = Array.isArray(req.body?.postIds) ? req.body.postIds : undefined;

      // "unreject" and "reject" need to touch rejected rows too; other actions skip them.
      const statusGuard = (action === "unreject" || action === "reject")
        ? notInArray(generatedPosts.status, ["deleted", "posted"])
        : notInArray(generatedPosts.status, ["deleted", "rejected", "posted"]);

      const where: any[] = [
        eq(generatedPosts.conferenceId, conf.id),
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
        statusGuard,
      ];
      if (platform) where.push(eq(generatedPosts.platform, platform));
      if (postIds?.length) where.push(inArray(generatedPosts.id, postIds));

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (action === "approve") {
        updates.status = "approved";
        updates.deliveryMode = null;
      } else if (action === "csv_only") {
        updates.deliveryMode = "csv";
      } else if (action === "reject") {
        updates.status = "rejected";
        updates.deliveryMode = null;
      } else {
        // unapprove / unreject → back to draft
        updates.status = "draft";
        updates.deliveryMode = null;
      }

      await db.update(generatedPosts).set(updates).where(and(...where));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[conference-posts:approve]", err);
      res.status(500).json({ error: err.message || "Failed to update posts" });
    }
  });

  // Export generated conference posts as CSV, reusing the same scheduler
  // formats (generic / socialpilot / hootsuite / sproutsocial) as campaigns.
  app.post("/api/conferences/:id/export-csv", async (req, res) => {
    if (!(await guardFeature(req, res, FEATURE))) return;
    try {
      const ctx = await getRequestContext(req);
      const conf = await loadConference(req.params.id, ctx.tenantDomain, ctx.marketId);
      if (!conf) return res.status(404).json({ error: "Conference not found" });

      const excludeUndated = req.query.excludeUndated !== "false";

      const allPosts = await db
        .select()
        .from(generatedPosts)
        .where(and(
          eq(generatedPosts.conferenceId, conf.id),
          eq(generatedPosts.tenantDomain, ctx.tenantDomain),
          notInArray(generatedPosts.status, ["deleted", "rejected"]),
        ));

      const nowFilter = new Date();
      const posts = excludeUndated
        ? allPosts.filter((p) => p.scheduledDate && new Date(p.scheduledDate) >= nowFilter)
        : allPosts;

      const csvFormat = ((req.query.format as string) || "socialpilot").toLowerCase();
      const clientTzOffset = parseInt((req.query.tzOffset as string) || "0", 10);

      const proto = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const csv = await buildPostsCsv({
        posts,
        tenantDomain: ctx.tenantDomain,
        format: csvFormat,
        tzOffset: clientTzOffset,
        imageBaseUrl: host ? `${proto}://${host}` : undefined,
      });

      // WS6: retain the event export in SharePoint (silent fallback to object storage).
      try {
        await storeArtifact({
          tenantDomain: ctx.tenantDomain,
          buffer: Buffer.from(csv, "utf8"),
          filename: `event-${conf.name.replace(/[^a-zA-Z0-9]+/g, "_")}-${csvFormat}-${new Date().toISOString().split("T")[0]}.csv`,
          mimeType: "text/csv",
          kind: "csv",
          marketId: ctx.marketId,
          createdByUserId: ctx.userId,
        });
      } catch (e: any) {
        console.error("[event export-csv] store failed:", e?.message);
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="event-${conf.id}-${csvFormat}.csv"`);
      res.send(csv);
    } catch (err: any) {
      console.error("[Conference Export CSV Error]", err?.message);
      res.status(500).json({ error: "Failed to export event CSV" });
    }
  });
}
