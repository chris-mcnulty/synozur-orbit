/**
 * Unified Marketing Calendar (Task #149)
 *
 * One calendar that aggregates the three marketing content types — social
 * posts, emails, and content briefs/drafts — scoped to the active
 * tenant/market. Opening it never triggers AI generation; it only shows what
 * is planned. Items can be added manually, assigned to a campaign / theme
 * (solution area) / event (conference), filtered/grouped, exported, and moved
 * through a lightweight Draft → Approved → Delivered lifecycle.
 *
 * Gated on the existing `editorialCalendar` feature (Enterprise), the planning
 * surface these content types already live under.
 */

import type { Express } from "express";
import { db } from "../db";
import {
  generatedPosts,
  generatedEmails,
  contentBriefs,
  contentAssets,
  editorialCalendars,
  campaigns,
  solutionAreas,
  conferences,
  socialAccounts,
} from "@shared/schema";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { buildPostsCsv } from "../services/posts-csv-export";
import { getScheduledDayCounts } from "../services/schedule-load";

// A day with at least this many activities is considered "crowded".
const BUSY_THRESHOLD = 3;

// Friendly labels for the type filter's channel (social platform) and content
// format sub-dimensions, surfaced by the /filters endpoint.
const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  x: "X / Twitter",
  facebook: "Facebook",
  instagram: "Instagram",
  blog: "Blog",
};
const FORMAT_LABELS: Record<string, string> = {
  blog_post: "Blog post",
  whitepaper: "Whitepaper",
  case_study: "Case study",
  landing_page: "Landing page",
  video_script: "Video script",
  newsletter: "Newsletter",
  linkedin_post: "LinkedIn post",
  x_post: "X post",
};
function titleize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type Lifecycle = "draft" | "approved" | "delivered";

function socialLifecycle(status: string): Lifecycle {
  if (status === "exported" || status === "published") return "delivered";
  if (status === "approved") return "approved";
  return "draft";
}
function emailLifecycle(status: string, sentAt: Date | null): Lifecycle {
  if (status === "sent" || sentAt) return "delivered";
  if (status === "approved") return "approved";
  return "draft";
}
function contentLifecycle(status: string): Lifecycle {
  if (status === "published") return "delivered";
  if (status === "approved") return "approved";
  return "draft";
}

// Find (or lazily create) the per-tenant/market editorial calendar that holds
// manually-added content items, so a manual blog/content draft has a home
// without forcing the user through AI generation.
async function getOrCreateManualCalendar(ctx: Awaited<ReturnType<typeof getRequestContext>>) {
  const [existing] = await db
    .select()
    .from(editorialCalendars)
    .where(
      and(
        eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
        eq(editorialCalendars.marketId, ctx.marketId),
        eq(editorialCalendars.name, "Marketing Calendar (manual)"),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(editorialCalendars)
    .values({
      id: randomUUID(),
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId || null,
      name: "Marketing Calendar (manual)",
      focus: null,
      status: "active",
      createdBy: ctx.userId,
    })
    .returning();
  return created;
}

export function registerMarketingCalendarRoutes(app: Express) {
  // ───── Aggregate list ─────
  app.get("/api/marketing-calendar", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      const { from, to, campaignId, solutionAreaId, conferenceId, includeUnscheduled, unscheduledOnly } = req.query as Record<string, string>;
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;
      const wantUnscheduled = includeUnscheduled === "true" || includeUnscheduled === "1";
      // Backlog mode: return ONLY items that have no scheduled date, ignoring
      // the date window entirely. Powers the dedicated backlog panel.
      const onlyUnscheduled = unscheduledOnly === "true" || unscheduledOnly === "1";

      const inWindow = (d: Date | null) => {
        if (!d) return false;
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      };
      // Shared gate: decide whether an item (by its resolved date) belongs in
      // the response, honoring backlog vs windowed-calendar mode.
      const includeByDate = (date: Date | null): boolean => {
        const scheduled = !!date;
        if (onlyUnscheduled) return !scheduled;
        return scheduled ? inWindow(date) : wantUnscheduled;
      };

      // ── Social posts (scoped by tenant only — generated_posts has no market) ──
      const socialConds = [eq(generatedPosts.tenantDomain, ctx.tenantDomain), ne(generatedPosts.status, "rejected"), ne(generatedPosts.status, "deleted")];
      if (campaignId) socialConds.push(eq(generatedPosts.campaignId, campaignId));
      if (solutionAreaId) socialConds.push(eq(generatedPosts.solutionAreaId, solutionAreaId));
      if (conferenceId) socialConds.push(eq(generatedPosts.conferenceId, conferenceId));
      const socialRows = await db
        .select({
          id: generatedPosts.id,
          platform: generatedPosts.platform,
          content: generatedPosts.content,
          editedContent: generatedPosts.editedContent,
          scheduledDate: generatedPosts.scheduledDate,
          publishedAt: generatedPosts.publishedAt,
          status: generatedPosts.status,
          campaignId: generatedPosts.campaignId,
          solutionAreaId: generatedPosts.solutionAreaId,
          conferenceId: generatedPosts.conferenceId,
          overrideImageUrl: generatedPosts.overrideImageUrl,
          accountName: socialAccounts.accountName,
        })
        .from(generatedPosts)
        .leftJoin(socialAccounts, eq(socialAccounts.id, generatedPosts.socialAccountId))
        .where(and(...socialConds))
        .orderBy(desc(generatedPosts.createdAt));

      // ── Emails (tenant + market) ──
      const emailConds = [eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId)];
      if (campaignId) emailConds.push(eq(generatedEmails.campaignId, campaignId));
      if (solutionAreaId) emailConds.push(eq(generatedEmails.solutionAreaId, solutionAreaId));
      if (conferenceId) emailConds.push(eq(generatedEmails.conferenceId, conferenceId));
      const emailRows = await db
        .select({
          id: generatedEmails.id,
          subject: generatedEmails.subject,
          previewText: generatedEmails.previewText,
          status: generatedEmails.status,
          scheduledAt: generatedEmails.scheduledAt,
          sentAt: generatedEmails.sentAt,
          campaignId: generatedEmails.campaignId,
          solutionAreaId: generatedEmails.solutionAreaId,
          conferenceId: generatedEmails.conferenceId,
        })
        .from(generatedEmails)
        .where(and(...emailConds))
        .orderBy(desc(generatedEmails.createdAt));

      // ── Content briefs / drafts (tenant + market) ──
      const briefConds = [eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId), ne(contentBriefs.status, "removed")];
      if (campaignId) briefConds.push(eq(contentBriefs.campaignId, campaignId));
      if (solutionAreaId) briefConds.push(eq(contentBriefs.solutionAreaId, solutionAreaId));
      if (conferenceId) briefConds.push(eq(contentBriefs.conferenceId, conferenceId));
      const briefRows = await db
        .select({
          id: contentBriefs.id,
          title: contentBriefs.title,
          format: contentBriefs.format,
          status: contentBriefs.status,
          scheduledAt: contentBriefs.scheduledAt,
          contentAssetId: contentBriefs.contentAssetId,
          campaignId: contentBriefs.campaignId,
          solutionAreaId: contentBriefs.solutionAreaId,
          conferenceId: contentBriefs.conferenceId,
        })
        .from(contentBriefs)
        .where(and(...briefConds))
        .orderBy(desc(contentBriefs.createdAt));

      const items: any[] = [];

      for (const p of socialRows) {
        const date = p.scheduledDate ?? p.publishedAt ?? null;
        if (!includeByDate(date)) continue;
        items.push({
          id: p.id,
          type: "social",
          title: p.accountName ? `${p.platform} · ${p.accountName}` : `${p.platform} post`,
          preview: ((p.editedContent ?? p.content) || "").slice(0, 160),
          date: date ? date.toISOString() : null,
          status: p.status,
          lifecycle: socialLifecycle(p.status),
          platform: p.platform,
          campaignId: p.campaignId,
          solutionAreaId: p.solutionAreaId,
          conferenceId: p.conferenceId,
          imageUrl: p.overrideImageUrl ?? null,
        });
      }

      for (const e of emailRows) {
        const date = e.scheduledAt ?? e.sentAt ?? null;
        if (!includeByDate(date)) continue;
        items.push({
          id: e.id,
          type: "email",
          title: e.subject || "(untitled email)",
          preview: (e.previewText || "").slice(0, 160),
          date: date ? date.toISOString() : null,
          status: e.status,
          lifecycle: emailLifecycle(e.status, e.sentAt),
          campaignId: e.campaignId,
          solutionAreaId: e.solutionAreaId,
          conferenceId: e.conferenceId,
        });
      }

      for (const b of briefRows) {
        const date = b.scheduledAt ?? null;
        if (!includeByDate(date)) continue;
        items.push({
          id: b.id,
          type: "content",
          title: b.title,
          preview: "",
          date: date ? date.toISOString() : null,
          status: b.status,
          lifecycle: contentLifecycle(b.status),
          format: b.format,
          contentAssetId: b.contentAssetId,
          campaignId: b.campaignId,
          solutionAreaId: b.solutionAreaId,
          conferenceId: b.conferenceId,
        });
      }

      // ── Resolve campaign / theme / event NAMES server-side ──
      // Scoped to the tenant only (not the active market) so an item assigned
      // to a campaign/theme/event that lives outside the current market scope
      // still shows its label instead of silently appearing blank.
      const collectIds = (key: "campaignId" | "solutionAreaId" | "conferenceId") =>
        Array.from(new Set(items.map((i) => i[key]).filter((v): v is string => !!v)));
      const campIds = collectIds("campaignId");
      const themeIds = collectIds("solutionAreaId");
      const eventIds = collectIds("conferenceId");

      const [campNameRows, themeNameRows, eventNameRows] = await Promise.all([
        campIds.length
          ? db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns)
              .where(and(eq(campaigns.tenantDomain, ctx.tenantDomain), inArray(campaigns.id, campIds)))
          : Promise.resolve([] as { id: string; name: string }[]),
        themeIds.length
          ? db.select({ id: solutionAreas.id, name: solutionAreas.name }).from(solutionAreas)
              .where(and(eq(solutionAreas.tenantDomain, ctx.tenantDomain), inArray(solutionAreas.id, themeIds)))
          : Promise.resolve([] as { id: string; name: string }[]),
        eventIds.length
          ? db.select({ id: conferences.id, name: conferences.name }).from(conferences)
              .where(and(eq(conferences.tenantDomain, ctx.tenantDomain), inArray(conferences.id, eventIds)))
          : Promise.resolve([] as { id: string; name: string }[]),
      ]);

      const campName = new Map(campNameRows.map((r) => [r.id, r.name]));
      const themeName = new Map(themeNameRows.map((r) => [r.id, r.name]));
      const eventName = new Map(eventNameRows.map((r) => [r.id, r.name]));
      for (const it of items) {
        it.campaignName = it.campaignId ? campName.get(it.campaignId) ?? null : null;
        it.solutionAreaName = it.solutionAreaId ? themeName.get(it.solutionAreaId) ?? null : null;
        it.conferenceName = it.conferenceId ? eventName.get(it.conferenceId) ?? null : null;
      }

      res.json(items);
    } catch (err: any) {
      console.error("[marketing-calendar list]", err.message);
      res.status(500).json({ error: err.message || "Failed to load marketing calendar" });
    }
  });

  // ───── Filter option lists (campaigns / themes / events for the active context) ─────
  app.get("/api/marketing-calendar/filters", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      // Scope options to the active market plus tenant-wide (null market)
      // records, mirroring how calendar items are scoped, so other markets'
      // campaigns/themes/events don't bleed into the dropdowns.
      const campMarket = or(eq(campaigns.marketId, ctx.marketId), isNull(campaigns.marketId));
      const themeMarket = or(eq(solutionAreas.marketId, ctx.marketId), isNull(solutionAreas.marketId));
      const eventMarket = or(eq(conferences.marketId, ctx.marketId), isNull(conferences.marketId));
      const [camps, themes, events, platformRows, formatRows] = await Promise.all([
        db
          .select({ id: campaigns.id, name: campaigns.name })
          .from(campaigns)
          .where(and(eq(campaigns.tenantDomain, ctx.tenantDomain), campMarket, ne(campaigns.status, "deleted")))
          .orderBy(asc(campaigns.name)),
        db
          .select({ id: solutionAreas.id, name: solutionAreas.name })
          .from(solutionAreas)
          .where(and(eq(solutionAreas.tenantDomain, ctx.tenantDomain), themeMarket))
          .orderBy(asc(solutionAreas.name)),
        db
          .select({ id: conferences.id, name: conferences.name })
          .from(conferences)
          .where(and(eq(conferences.tenantDomain, ctx.tenantDomain), eventMarket, ne(conferences.status, "deleted")))
          .orderBy(desc(conferences.startDate)),
        // Distinct social platforms (channels) and content formats actually
        // present, so the type filter only offers values that exist.
        db
          .selectDistinct({ platform: generatedPosts.platform })
          .from(generatedPosts)
          .where(and(
            eq(generatedPosts.tenantDomain, ctx.tenantDomain),
            ne(generatedPosts.status, "rejected"),
            ne(generatedPosts.status, "deleted"),
          )),
        db
          .selectDistinct({ format: contentBriefs.format })
          .from(contentBriefs)
          .where(and(
            eq(contentBriefs.tenantDomain, ctx.tenantDomain),
            or(eq(contentBriefs.marketId, ctx.marketId), isNull(contentBriefs.marketId)),
            ne(contentBriefs.status, "removed"),
          )),
      ]);

      const socialChannels = platformRows
        .map((r) => (r.platform || "").toLowerCase())
        .filter(Boolean)
        .map((p) => ({ id: p, name: PLATFORM_LABELS[p] ?? titleize(p) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const contentFormats = formatRows
        .map((r) => r.format || "")
        .filter(Boolean)
        .map((f) => ({ id: f, name: FORMAT_LABELS[f] ?? titleize(f) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json({ campaigns: camps, solutionAreas: themes, conferences: events, socialChannels, contentFormats });
    } catch (err: any) {
      console.error("[marketing-calendar filters]", err.message);
      res.status(500).json({ error: err.message || "Failed to load filters" });
    }
  });

  // ───── Day-load advice (is this day already crowded? suggest a nearby open one) ─────
  app.get("/api/marketing-calendar/date-advice", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      const date = String((req.query.date as string) || "");
      const tz = parseInt((req.query.tzOffset as string) || "0", 10) || 0;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
      }
      const [y, m, d] = date.split("-").map(Number);
      // Count activities in a generous window around the target so we can both
      // measure the day and suggest a nearby open one.
      const SEARCH_DAYS = 21;
      const centerUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
      const from = new Date(centerUtc - (SEARCH_DAYS + 1) * 86_400_000);
      const to = new Date(centerUtc + (SEARCH_DAYS + 1) * 86_400_000);
      const counts = await getScheduledDayCounts({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        from,
        to,
        tzOffsetMinutes: tz,
      });

      const keyFor = (off: number): string => {
        const cd = new Date(Date.UTC(y, m - 1, d + off));
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${cd.getUTCFullYear()}-${pad(cd.getUTCMonth() + 1)}-${pad(cd.getUTCDate())}`;
      };
      const isWeekend = (off: number) => {
        const day = new Date(Date.UTC(y, m - 1, d + off)).getUTCDay();
        return day === 0 || day === 6;
      };

      const count = counts.get(date) ?? 0;
      const busy = count >= BUSY_THRESHOLD;

      // When crowded, look outward (forward first) for the nearest weekday that
      // is under the busy threshold.
      let suggestion: string | null = null;
      if (busy) {
        for (let r = 1; r <= SEARCH_DAYS && !suggestion; r++) {
          for (const off of [r, -r]) {
            if (isWeekend(off)) continue;
            const key = keyFor(off);
            if ((counts.get(key) ?? 0) < BUSY_THRESHOLD) {
              suggestion = key;
              break;
            }
          }
        }
      }

      res.json({ date, count, busy, threshold: BUSY_THRESHOLD, suggestion });
    } catch (err: any) {
      console.error("[marketing-calendar date-advice]", err.message);
      res.status(500).json({ error: err.message || "Failed to evaluate date" });
    }
  });

  // ───── Manual item creation (no AI) ─────
  app.post("/api/marketing-calendar/items", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      const { type, title, date, platform, format, campaignId, solutionAreaId, conferenceId } = req.body ?? {};
      if (!type || !["social", "email", "content"].includes(type)) {
        return res.status(400).json({ error: "type must be social, email, or content" });
      }
      if (!title || !String(title).trim()) {
        return res.status(400).json({ error: "title is required" });
      }
      const when = date ? new Date(date) : null;
      if (date && when && isNaN(when.getTime())) {
        return res.status(400).json({ error: "Invalid date" });
      }

      if (type === "social") {
        const [row] = await db
          .insert(generatedPosts)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            platform: platform || "linkedin",
            content: String(title).trim(),
            scheduledDate: when,
            status: "draft",
            campaignId: campaignId || null,
            solutionAreaId: solutionAreaId || null,
            conferenceId: conferenceId || null,
          } as any)
          .returning();
        return res.status(201).json({ type, id: row.id });
      }

      if (type === "email") {
        const [row] = await db
          .insert(generatedEmails)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            platform: "outlook",
            tone: "professional",
            subject: String(title).trim(),
            htmlBody: "",
            status: "draft",
            scheduledAt: when,
            campaignId: campaignId || null,
            solutionAreaId: solutionAreaId || null,
            conferenceId: conferenceId || null,
            createdBy: ctx.userId,
          } as any)
          .returning();
        return res.status(201).json({ type, id: row.id });
      }

      // content
      const calendar = await getOrCreateManualCalendar(ctx);
      const [row] = await db
        .insert(contentBriefs)
        .values({
          id: randomUUID(),
          calendarId: calendar.id,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId || null,
          title: String(title).trim(),
          format: format || "blog_post",
          funnelStage: "awareness",
          status: "suggested",
          aiGenerated: false,
          scheduledAt: when,
          campaignId: campaignId || null,
          solutionAreaId: solutionAreaId || null,
          conferenceId: conferenceId || null,
        } as any)
        .returning();
      return res.status(201).json({ type, id: row.id });
    } catch (err: any) {
      console.error("[marketing-calendar create]", err.message);
      res.status(500).json({ error: err.message || "Failed to create calendar item" });
    }
  });

  // ───── Update date / assignment for any item type ─────
  app.patch("/api/marketing-calendar/items/:type/:id", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      const { type, id } = req.params;
      const body = req.body ?? {};
      const hasDate = Object.prototype.hasOwnProperty.call(body, "date");
      const when = hasDate ? (body.date ? new Date(body.date) : null) : undefined;
      if (when && isNaN(when.getTime())) return res.status(400).json({ error: "Invalid date" });

      if (type === "social") {
        const u: any = { updatedAt: new Date() };
        if (hasDate) u.scheduledDate = when;
        if ("campaignId" in body) u.campaignId = body.campaignId || null;
        if ("solutionAreaId" in body) u.solutionAreaId = body.solutionAreaId || null;
        if ("conferenceId" in body) u.conferenceId = body.conferenceId || null;
        const [row] = await db.update(generatedPosts).set(u)
          .where(and(eq(generatedPosts.id, id), eq(generatedPosts.tenantDomain, ctx.tenantDomain))).returning({ id: generatedPosts.id });
        if (!row) return res.status(404).json({ error: "Not found" });
        return res.json({ ok: true });
      }
      if (type === "email") {
        const u: any = { updatedAt: new Date() };
        if (hasDate) u.scheduledAt = when;
        if ("campaignId" in body) u.campaignId = body.campaignId || null;
        if ("solutionAreaId" in body) u.solutionAreaId = body.solutionAreaId || null;
        if ("conferenceId" in body) u.conferenceId = body.conferenceId || null;
        const [row] = await db.update(generatedEmails).set(u)
          .where(and(eq(generatedEmails.id, id), eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId))).returning({ id: generatedEmails.id });
        if (!row) return res.status(404).json({ error: "Not found" });
        return res.json({ ok: true });
      }
      if (type === "content") {
        const u: any = { updatedAt: new Date() };
        if (hasDate) u.scheduledAt = when;
        if ("campaignId" in body) u.campaignId = body.campaignId || null;
        if ("solutionAreaId" in body) u.solutionAreaId = body.solutionAreaId || null;
        if ("conferenceId" in body) u.conferenceId = body.conferenceId || null;
        const [row] = await db.update(contentBriefs).set(u)
          .where(and(eq(contentBriefs.id, id), eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId))).returning({ id: contentBriefs.id });
        if (!row) return res.status(404).json({ error: "Not found" });
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: "Unknown type" });
    } catch (err: any) {
      console.error("[marketing-calendar patch]", err.message);
      res.status(500).json({ error: err.message || "Failed to update item" });
    }
  });

  // ───── Approve a blog/content or email item ─────
  app.post("/api/marketing-calendar/items/:type/:id/approve", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      const { type, id } = req.params;
      if (type === "content") {
        const [row] = await db.update(contentBriefs).set({ status: "approved", updatedAt: new Date() })
          .where(and(eq(contentBriefs.id, id), eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId))).returning({ id: contentBriefs.id });
        if (!row) return res.status(404).json({ error: "Not found" });
        return res.json({ ok: true, lifecycle: "approved" });
      }
      if (type === "email") {
        const [row] = await db.update(generatedEmails).set({ status: "approved", updatedAt: new Date() })
          .where(and(eq(generatedEmails.id, id), eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId))).returning({ id: generatedEmails.id });
        if (!row) return res.status(404).json({ error: "Not found" });
        return res.json({ ok: true, lifecycle: "approved" });
      }
      // Social posts intentionally have no per-item Approve — they're high
      // volume and rely on the bulk CSV export (= delivered) flow instead.
      return res.status(400).json({ error: "Only blog/content and email items can be approved." });
    } catch (err: any) {
      console.error("[marketing-calendar approve]", err.message);
      res.status(500).json({ error: err.message || "Failed to approve item" });
    }
  });

  // ───── Hand an approved email off to the campaign engine (= Delivered) ─────
  // The engine handles list selection / formatting / tracking; it does not
  // auto-send. Handing off from the calendar requires an explicit prior
  // Approve and marks the item Delivered (queued) for lifecycle purposes.
  app.post("/api/marketing-calendar/items/email/:id/handoff", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      const [email] = await db.select().from(generatedEmails)
        .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId)));
      if (!email) return res.status(404).json({ error: "Not found" });
      if (email.status !== "approved" && email.status !== "sent") {
        return res.status(409).json({ error: "Approve the email before handing it off to the campaign engine." });
      }
      await db.update(generatedEmails).set({ status: "sent", sentAt: email.sentAt ?? new Date(), updatedAt: new Date() })
        .where(and(eq(generatedEmails.id, email.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
      res.json({ ok: true, lifecycle: "delivered" });
    } catch (err: any) {
      console.error("[marketing-calendar email handoff]", err.message);
      res.status(500).json({ error: err.message || "Failed to hand off email" });
    }
  });

  // ───── Export a content/blog item to branded Word (.docx) + mark Delivered ─────
  app.get("/api/marketing-calendar/items/content/:id/export-docx", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      const [brief] = await db.select().from(contentBriefs)
        .where(and(eq(contentBriefs.id, req.params.id), eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId)));
      if (!brief) return res.status(404).json({ error: "Not found" });
      // Enforce the Draft → Approved → Delivered gate: content can only be
      // exported (= delivered) once approved. "published" is allowed so a
      // re-download of an already-delivered item is idempotent.
      if (brief.status !== "approved" && brief.status !== "published") {
        return res.status(409).json({ error: "Approve this content before exporting it." });
      }
      if (!brief.contentAssetId) {
        return res.status(422).json({ error: "This item has no written draft yet. Draft it in the Editorial Calendar first." });
      }
      const [asset] = await db.select().from(contentAssets)
        .where(and(eq(contentAssets.id, brief.contentAssetId), eq(contentAssets.tenantDomain, ctx.tenantDomain)));
      if (!asset || !asset.content?.trim()) {
        return res.status(422).json({ error: "This draft has no written content to export yet." });
      }
      const { buildBrandedDocx } = await import("../services/docx-generator.js");
      const title = asset.title || brief.title || "Content Draft";
      const docBuffer = await buildBrandedDocx(title, asset.content || "");
      // Mark delivered.
      await db.update(contentBriefs).set({ status: "published", updatedAt: new Date() })
        .where(and(eq(contentBriefs.id, brief.id), eq(contentBriefs.tenantDomain, ctx.tenantDomain)));
      const safeName = title.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "content_draft";
      const filename = `${safeName}_${new Date().toISOString().split("T")[0]}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(docBuffer);
    } catch (err: any) {
      console.error("[marketing-calendar export-docx]", err.message);
      res.status(500).json({ error: err.message || "Failed to export document" });
    }
  });

  // ───── Export social posts to SocialPilot CSV + bulk-mark Exported (=delivered) ─────
  app.post("/api/marketing-calendar/export-csv", async (req, res) => {
    if (!(await guardFeature(req, res, "socialPosts"))) return;
    try {
      const ctx = await getRequestContext(req);
      const { from, to, campaignId, solutionAreaId, conferenceId } = req.query as Record<string, string>;
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;

      const conds = [
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
        isNotNull(generatedPosts.scheduledDate),
        ne(generatedPosts.status, "rejected"),
        ne(generatedPosts.status, "deleted"),
      ];
      if (fromDate) conds.push(gte(generatedPosts.scheduledDate, fromDate));
      if (toDate) conds.push(lte(generatedPosts.scheduledDate, toDate));
      if (campaignId) conds.push(eq(generatedPosts.campaignId, campaignId));
      if (solutionAreaId) conds.push(eq(generatedPosts.solutionAreaId, solutionAreaId));
      if (conferenceId) conds.push(eq(generatedPosts.conferenceId, conferenceId));

      const posts = await db.select().from(generatedPosts).where(and(...conds));
      if (posts.length === 0) {
        return res.status(422).json({ error: "No scheduled social posts match this view to export." });
      }

      const csvFormat = (req.query.format as string || "socialpilot").toLowerCase();
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

      // Bulk-mark Exported (= delivered) for the period. Only flip non-final
      // statuses so we don't downgrade already-published posts.
      const toFlip = posts.filter((p) => !["exported", "published"].includes(p.status)).map((p) => p.id);
      if (toFlip.length) {
        await db.update(generatedPosts).set({ status: "exported", updatedAt: new Date() })
          .where(and(eq(generatedPosts.tenantDomain, ctx.tenantDomain), inArray(generatedPosts.id, toFlip)));
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="marketing-calendar-${csvFormat}.csv"`);
      res.send(csv);
    } catch (err: any) {
      console.error("[marketing-calendar export-csv]", err.message);
      res.status(500).json({ error: err.message || "Failed to export CSV" });
    }
  });

  // ───── Bulk actions on backlog items (schedule / approve / assign / discard) ─────
  app.post("/api/marketing-calendar/bulk", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      const body = req.body ?? {};
      const action = String(body.action || "");
      const rawItems: Array<{ type: string; id: string }> = Array.isArray(body.items) ? body.items : [];
      if (!rawItems.length) return res.status(400).json({ error: "No items selected." });

      // Group selected item ids by type so we can batch each table.
      const byType: Record<string, string[]> = { social: [], email: [], content: [] };
      for (const it of rawItems) {
        if (it && byType[it.type] && it.id) byType[it.type].push(it.id);
      }

      let affected = 0;
      const skipped: string[] = [];

      if (action === "schedule") {
        const when = body.date ? new Date(body.date) : null;
        if (!when || isNaN(when.getTime())) return res.status(400).json({ error: "A valid date is required to schedule." });
        if (byType.social.length) {
          const r = await db.update(generatedPosts).set({ scheduledDate: when, updatedAt: new Date() })
            .where(and(eq(generatedPosts.tenantDomain, ctx.tenantDomain), inArray(generatedPosts.id, byType.social))).returning({ id: generatedPosts.id });
          affected += r.length;
        }
        if (byType.email.length) {
          const r = await db.update(generatedEmails).set({ scheduledAt: when, updatedAt: new Date() })
            .where(and(eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId), inArray(generatedEmails.id, byType.email))).returning({ id: generatedEmails.id });
          affected += r.length;
        }
        if (byType.content.length) {
          const r = await db.update(contentBriefs).set({ scheduledAt: when, updatedAt: new Date() })
            .where(and(eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId), inArray(contentBriefs.id, byType.content))).returning({ id: contentBriefs.id });
          affected += r.length;
        }
      } else if (action === "approve") {
        // Blog/content and email support an Approve gate. Social posts rely on
        // the CSV export (= delivered) flow and have no approve step — skip them.
        if (byType.content.length) {
          const r = await db.update(contentBriefs).set({ status: "approved", updatedAt: new Date() })
            .where(and(eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId), inArray(contentBriefs.id, byType.content))).returning({ id: contentBriefs.id });
          affected += r.length;
        }
        if (byType.email.length) {
          const r = await db.update(generatedEmails).set({ status: "approved", updatedAt: new Date() })
            .where(and(eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId), inArray(generatedEmails.id, byType.email))).returning({ id: generatedEmails.id });
          affected += r.length;
        }
        if (byType.social.length) skipped.push(`${byType.social.length} social post(s) — social posts are delivered via CSV export, not approval.`);
      } else if (action === "assign") {
        // Only set the assignment fields that were explicitly provided.
        const setFor = (target: "social" | "email" | "content") => {
          const u: any = { updatedAt: new Date() };
          if ("campaignId" in body) u.campaignId = body.campaignId || null;
          if ("solutionAreaId" in body) u.solutionAreaId = body.solutionAreaId || null;
          if ("conferenceId" in body) u.conferenceId = body.conferenceId || null;
          return u;
        };
        if (!("campaignId" in body) && !("solutionAreaId" in body) && !("conferenceId" in body)) {
          return res.status(400).json({ error: "Provide a campaign, theme, or event to assign." });
        }
        if (byType.social.length) {
          const r = await db.update(generatedPosts).set(setFor("social"))
            .where(and(eq(generatedPosts.tenantDomain, ctx.tenantDomain), inArray(generatedPosts.id, byType.social))).returning({ id: generatedPosts.id });
          affected += r.length;
        }
        if (byType.email.length) {
          const r = await db.update(generatedEmails).set(setFor("email"))
            .where(and(eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId), inArray(generatedEmails.id, byType.email))).returning({ id: generatedEmails.id });
          affected += r.length;
        }
        if (byType.content.length) {
          const r = await db.update(contentBriefs).set(setFor("content"))
            .where(and(eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId), inArray(contentBriefs.id, byType.content))).returning({ id: contentBriefs.id });
          affected += r.length;
        }
      } else if (action === "discard") {
        // Social → soft-delete via status; content → "removed" status; email has
        // no soft-delete status, so it is hard-deleted.
        if (byType.social.length) {
          const r = await db.update(generatedPosts).set({ status: "deleted", updatedAt: new Date() })
            .where(and(eq(generatedPosts.tenantDomain, ctx.tenantDomain), inArray(generatedPosts.id, byType.social))).returning({ id: generatedPosts.id });
          affected += r.length;
        }
        if (byType.content.length) {
          const r = await db.update(contentBriefs).set({ status: "removed", updatedAt: new Date() })
            .where(and(eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId), inArray(contentBriefs.id, byType.content))).returning({ id: contentBriefs.id });
          affected += r.length;
        }
        if (byType.email.length) {
          const r = await db.delete(generatedEmails)
            .where(and(eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId), inArray(generatedEmails.id, byType.email))).returning({ id: generatedEmails.id });
          affected += r.length;
        }
      } else {
        return res.status(400).json({ error: "Unknown bulk action." });
      }

      res.json({ ok: true, affected, skipped });
    } catch (err: any) {
      console.error("[marketing-calendar bulk]", err.message);
      res.status(500).json({ error: err.message || "Failed to apply bulk action" });
    }
  });

  // ───── Delete a calendar item ─────
  app.delete("/api/marketing-calendar/items/:type/:id", async (req, res) => {
    if (!(await guardFeature(req, res, "editorialCalendar"))) return;
    try {
      const ctx = await getRequestContext(req);
      const { type, id } = req.params;
      if (type === "social") {
        await db.delete(generatedPosts).where(and(eq(generatedPosts.id, id), eq(generatedPosts.tenantDomain, ctx.tenantDomain)));
      } else if (type === "email") {
        await db.delete(generatedEmails).where(and(eq(generatedEmails.id, id), eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId)));
      } else if (type === "content") {
        await db.delete(contentBriefs).where(and(eq(contentBriefs.id, id), eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId)));
      } else {
        return res.status(400).json({ error: "Unknown type" });
      }
      res.status(204).send();
    } catch (err: any) {
      console.error("[marketing-calendar delete]", err.message);
      res.status(500).json({ error: err.message || "Failed to delete item" });
    }
  });
}
