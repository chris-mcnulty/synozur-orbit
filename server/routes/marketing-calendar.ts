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
  marketingLinks,
  SOCIAL_BRIEF_FORMATS,
  isSocialBriefFormat,
} from "@shared/schema";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { buildPostsCsv } from "../services/posts-csv-export";
import { repurposeAsset } from "../services/repurpose-service";
import { coercePlatform, SUPPORTED_PLATFORMS } from "../services/repurpose-core";
import { getScheduledDayCounts } from "../services/schedule-load";
import { rollupSocialItems, batchDayKey, type RollupSocialItem } from "../services/calendar-rollup-core";
import { storeArtifact } from "../services/artifact-storage-helper";

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
  ebook: "Ebook",
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
  if (status === "exported" || status === "scheduled_external" || status === "published") return "delivered";
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
      const { from, to, campaignId, solutionAreaId, conferenceId, includeUnscheduled, unscheduledOnly, rollupSocial, batchId, batchDay } = req.query as Record<string, string>;
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;
      const wantUnscheduled = includeUnscheduled === "true" || includeUnscheduled === "1";
      // WS4: collapse dense social batches into one item per (batch, day).
      const wantRollup = rollupSocial === "true" || rollupSocial === "1";
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

      // ── Social posts — scoped to current market via campaign join ──
      // generated_posts has no direct marketId; market scope is resolved through
      // the post's campaign. Posts without a campaign are tenant-wide and always
      // included. Posts whose campaign belongs to a different market are excluded.
      const socialConds = [eq(generatedPosts.tenantDomain, ctx.tenantDomain), ne(generatedPosts.status, "rejected"), ne(generatedPosts.status, "deleted"), ne(generatedPosts.status, "archived"),
        // Market scope: posts without a campaign are tenant-wide; posts with a campaign
        // must belong to the current market AND the campaign must not be deleted.
        or(
          isNull(generatedPosts.campaignId),
          and(ne(campaigns.status, "deleted"), or(eq(campaigns.marketId, ctx.marketId), isNull(campaigns.marketId))),
        )!,
      ];
      if (campaignId) socialConds.push(eq(generatedPosts.campaignId, campaignId));
      if (solutionAreaId) socialConds.push(eq(generatedPosts.solutionAreaId, solutionAreaId));
      if (conferenceId) socialConds.push(eq(generatedPosts.conferenceId, conferenceId));
      // WS4 drill-down: restrict to the posts of a single batch (its generation
      // run, repurpose group, event, or campaign).
      if (batchId) {
        socialConds.push(
          or(
            eq(generatedPosts.generationJobId, batchId),
            eq(generatedPosts.variantGroup, batchId),
            eq(generatedPosts.conferenceId, batchId),
            eq(generatedPosts.campaignId, batchId),
          )!,
        );
      }
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
          generationJobId: generatedPosts.generationJobId,
          variantGroup: generatedPosts.variantGroup,
          overrideImageUrl: generatedPosts.overrideImageUrl,
          accountName: socialAccounts.accountName,
        })
        .from(generatedPosts)
        .leftJoin(socialAccounts, eq(socialAccounts.id, generatedPosts.socialAccountId))
        .leftJoin(campaigns, eq(campaigns.id, generatedPosts.campaignId))
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

      // Content briefs are managed in the Editorial Calendar — they are specs,
      // not dated deliverables, and do not belong in the Content Calendar backlog.

      const items: any[] = [];

      const socialItems: RollupSocialItem[] = [];
      for (const p of socialRows) {
        // For published posts, use the actual publish time so "Post now" items
        // appear on the day they were actually posted (not the original slot).
        const date = p.publishedAt ?? p.scheduledDate ?? null;
        if (!includeByDate(date)) continue;
        socialItems.push({
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
          generationJobId: p.generationJobId,
          variantGroup: p.variantGroup,
          imageUrl: p.overrideImageUrl ?? null,
        });
      }

      // Roll up dense social batches unless we're drilling into one batch.
      if (wantRollup && !batchId) {
        const { batches, loose } = rollupSocialItems(socialItems, { threshold: BUSY_THRESHOLD });
        items.push(...batches, ...loose);
      } else if (batchId && batchDay) {
        // Drill-down: the batchId (source) is matched in SQL above; restrict to
        // the batch's exact day so we return the same members that were
        // collapsed (uses the same day key as the rollup, so they agree).
        items.push(...socialItems.filter((s) => batchDayKey(s.date) === batchDay));
      } else {
        items.push(...socialItems);
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

      if (false) {
        // Briefs removed from Content Calendar — they belong in Editorial Calendar.
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
      // Scope options to the active market plus tenant-wide (null market) records.
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
            ne(generatedPosts.status, "archived"),
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
          // Briefs are specs, not dated deliverables — never store a date.
          scheduledAt: null,
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
        // Briefs are specs, not dated deliverables — ignore any date change.
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
        // Approve the brief and activate its linked draft together (one atomic
        // step) so there's no separate approve-the-draft step.
        const row = await db.transaction(async (tx) => {
          const [updatedBrief] = await tx.update(contentBriefs).set({ status: "approved", updatedAt: new Date() })
            .where(and(eq(contentBriefs.id, id), eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId))).returning({ id: contentBriefs.id, contentAssetId: contentBriefs.contentAssetId });
          if (!updatedBrief) return null;
          if (updatedBrief.contentAssetId) {
            await tx.update(contentAssets).set({ status: "active", updatedAt: new Date() })
              .where(and(eq(contentAssets.id, updatedBrief.contentAssetId), eq(contentAssets.tenantDomain, ctx.tenantDomain)));
          }
          return updatedBrief;
        });
        if (!row) return res.status(404).json({ error: "Not found" });
        return res.json({ ok: true, lifecycle: "approved" });
      }
      if (type === "email") {
        const [row] = await db.update(generatedEmails).set({ status: "approved", updatedAt: new Date() })
          .where(and(eq(generatedEmails.id, id), eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId))).returning({ id: generatedEmails.id });
        if (!row) return res.status(404).json({ error: "Not found" });
        return res.json({ ok: true, lifecycle: "approved" });
      }
      if (type === "social") {
        const [row] = await db.update(generatedPosts).set({ status: "approved", updatedAt: new Date() })
          .where(and(eq(generatedPosts.id, id), eq(generatedPosts.tenantDomain, ctx.tenantDomain))).returning({ id: generatedPosts.id });
        if (!row) return res.status(404).json({ error: "Not found" });
        return res.json({ ok: true, lifecycle: "approved" });
      }
      return res.status(400).json({ error: "Only content, email, and social items can be approved." });
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
      // WS6: retain the finished doc in SharePoint (silent fallback to object
      // storage). Best-effort — never block the download.
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
        console.error("[marketing-calendar export-docx] store failed:", e?.message);
      }
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
      const includeExported = req.query.includeExported === "true";
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;

      const conds = [
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
        isNotNull(generatedPosts.scheduledDate),
        ne(generatedPosts.status, "rejected"),
        ne(generatedPosts.status, "deleted"),
        ne(generatedPosts.status, "archived"),
      ];
      // Skip already-delivered posts by default so they don't get re-exported.
      // publish_failed posts are on the Orbit direct-posting path and must not
      // appear in SocialPilot CSV exports.
      if (!includeExported) {
        conds.push(ne(generatedPosts.status, "exported"));
        conds.push(ne(generatedPosts.status, "scheduled_external"));
        conds.push(ne(generatedPosts.status, "published"));
        conds.push(ne(generatedPosts.status, "publish_failed"));
      }
      if (fromDate) conds.push(gte(generatedPosts.scheduledDate, fromDate));
      if (toDate) conds.push(lte(generatedPosts.scheduledDate, toDate));
      if (campaignId) conds.push(eq(generatedPosts.campaignId, campaignId));
      if (solutionAreaId) conds.push(eq(generatedPosts.solutionAreaId, solutionAreaId));
      if (conferenceId) conds.push(eq(generatedPosts.conferenceId, conferenceId));

      const allMatching = await db.select().from(generatedPosts).where(and(...conds));

      // By default drop posts whose date is in the past — the CSV writer blanks
      // those dates, which is exactly what produces the "missing dates" the user
      // saw. Caller can opt them back in.
      const excludeUndated = req.query.excludeUndated !== "false";
      const nowFilter = new Date();
      const posts = excludeUndated
        ? allMatching.filter((p) => p.scheduledDate && new Date(p.scheduledDate) >= nowFilter)
        : allMatching;
      if (posts.length === 0) {
        return res.status(422).json({ error: "No scheduled social posts match this view to export." });
      }

      // Tenant + market active social accounts supply the account number when a
      // post has no account of its own — without this the CSV's account column
      // comes out blank (the other half of the user's report).
      const activeAccounts = await db
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .where(and(
          eq(socialAccounts.tenantDomain, ctx.tenantDomain),
          eq(socialAccounts.marketId, ctx.marketId),
          eq(socialAccounts.status, "active"),
        ));
      const fallbackAccountIds = activeAccounts.map((a) => a.id);

      const csvFormat = (req.query.format as string || "socialpilot").toLowerCase();
      const clientTzOffset = parseInt((req.query.tzOffset as string) || "0", 10);
      const proto = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const csv = await buildPostsCsv({
        posts,
        tenantDomain: ctx.tenantDomain,
        format: csvFormat,
        tzOffset: clientTzOffset,
        fallbackAccountIds,
        imageBaseUrl: host ? `${proto}://${host}` : undefined,
      });

      // NOTE: downloading no longer marks posts as delivered. Scheduling tools
      // (e.g. SocialPilot) often reject a CSV (bad dates, missing graphics), and
      // auto-marking would silently bury those rejected posts. Delivery is now
      // confirmed explicitly from each campaign's export flow.

      // WS6: retain the export in SharePoint (silent fallback to object storage).
      try {
        await storeArtifact({
          tenantDomain: ctx.tenantDomain,
          buffer: Buffer.from(csv, "utf8"),
          filename: `marketing-calendar-${csvFormat}-${new Date().toISOString().split("T")[0]}.csv`,
          mimeType: "text/csv",
          kind: "csv",
          marketId: ctx.marketId,
          createdByUserId: ctx.userId,
        });
      } catch (e: any) {
        console.error("[marketing-calendar export-csv] store failed:", e?.message);
      }

      // Hand back the ids that went into this CSV so the client can confirm the
      // import worked and then mark just those posts delivered.
      res.setHeader("Access-Control-Expose-Headers", "X-Exported-Post-Ids");
      res.setHeader("X-Exported-Post-Ids", posts.map((p) => p.id).join(","));
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="marketing-calendar-${csvFormat}.csv"`);
      res.send(csv);
    } catch (err: any) {
      console.error("[marketing-calendar export-csv]", err.message);
      res.status(500).json({ error: err.message || "Failed to export CSV" });
    }
  });

  // ───── Export pre-check: counts so the user knows what's about to leave ─────
  app.get("/api/marketing-calendar/export-preview", async (req, res) => {
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
        ne(generatedPosts.status, "archived"),
        ne(generatedPosts.status, "exported"),
        ne(generatedPosts.status, "scheduled_external"),
        ne(generatedPosts.status, "published"),
      ];
      if (fromDate) conds.push(gte(generatedPosts.scheduledDate, fromDate));
      if (toDate) conds.push(lte(generatedPosts.scheduledDate, toDate));
      if (campaignId) conds.push(eq(generatedPosts.campaignId, campaignId));
      if (solutionAreaId) conds.push(eq(generatedPosts.solutionAreaId, solutionAreaId));
      if (conferenceId) conds.push(eq(generatedPosts.conferenceId, conferenceId));

      const allPosts = await db.select().from(generatedPosts).where(and(...conds));
      const now = new Date();
      const dated = allPosts.filter((p) => p.scheduledDate && new Date(p.scheduledDate) >= now);
      const undated = allPosts.filter((p) => !p.scheduledDate || new Date(p.scheduledDate) < now);

      const activeAccounts = await db
        .select({ id: socialAccounts.id, accountId: socialAccounts.accountId, platform: socialAccounts.platform })
        .from(socialAccounts)
        .where(and(
          eq(socialAccounts.tenantDomain, ctx.tenantDomain),
          eq(socialAccounts.marketId, ctx.marketId),
          eq(socialAccounts.status, "active"),
        ));
      const platformAccountFallback = new Map<string, string>();
      for (const a of activeAccounts) {
        if (a.accountId && a.platform && !platformAccountFallback.has(a.platform)) {
          platformAccountFallback.set(a.platform, a.accountId);
        }
      }
      const acctFor = (p: any) => p.socialAccountId ? p.socialAccountId : (platformAccountFallback.get(p.platform) || p.platform);

      let collisions = 0;
      const slotMap = new Map<string, number>();
      for (const p of dated) {
        const key = `${new Date(p.scheduledDate!).toISOString()}|${acctFor(p)}`;
        const count = (slotMap.get(key) || 0) + 1;
        slotMap.set(key, count);
        if (count > 1) collisions++;
      }

      // Count social-format content drafts (LinkedIn / X) in the same window that
      // aren't real social posts yet — these are the "purple LinkedIn" items the
      // user expected in the file but that silently don't export.
      const briefConds = [
        eq(contentBriefs.tenantDomain, ctx.tenantDomain),
        eq(contentBriefs.marketId, ctx.marketId),
        ne(contentBriefs.status, "removed"),
        ne(contentBriefs.status, "published"),
        inArray(contentBriefs.format, SOCIAL_BRIEF_FORMATS as unknown as string[]),
        isNotNull(contentBriefs.scheduledAt),
      ];
      if (fromDate) briefConds.push(gte(contentBriefs.scheduledAt, fromDate));
      if (toDate) briefConds.push(lte(contentBriefs.scheduledAt, toDate));
      if (campaignId) briefConds.push(eq(contentBriefs.campaignId, campaignId));
      if (solutionAreaId) briefConds.push(eq(contentBriefs.solutionAreaId, solutionAreaId));
      if (conferenceId) briefConds.push(eq(contentBriefs.conferenceId, conferenceId));
      const pendingDrafts = await db
        .select({ id: contentBriefs.id })
        .from(contentBriefs)
        .where(and(...briefConds));

      res.json({
        totalPosts: allPosts.length,
        datedPosts: dated.length,
        undatedPosts: undated.length,
        collisions,
        pendingSocialDrafts: pendingDrafts.length,
        accountsConfigured: activeAccounts.length,
      });
    } catch (err: any) {
      console.error("[marketing-calendar export-preview]", err.message);
      res.status(500).json({ error: err.message || "Failed to load export preview" });
    }
  });

  // ───── Mark posts delivered after the user confirms the CSV imported OK ─────
  app.post("/api/marketing-calendar/mark-delivered", async (req, res) => {
    if (!(await guardFeature(req, res, "socialPosts"))) return;
    try {
      const ctx = await getRequestContext(req);
      const ids: string[] = Array.isArray(req.body?.postIds) ? req.body.postIds.filter((x: any) => typeof x === "string" && x) : [];
      if (!ids.length) return res.status(400).json({ error: "No post ids supplied." });
      const result = await db.update(generatedPosts)
        .set({ status: "scheduled_external", updatedAt: new Date() })
        .where(and(
          eq(generatedPosts.tenantDomain, ctx.tenantDomain),
          inArray(generatedPosts.id, ids),
        ))
        .returning({ id: generatedPosts.id });
      res.json({ updated: result.length });
    } catch (err: any) {
      console.error("[marketing-calendar mark-delivered]", err.message);
      res.status(500).json({ error: err.message || "Failed to mark delivered" });
    }
  });

  // ───── Convert a social-format content draft into a real schedulable post ─────
  app.post("/api/marketing-calendar/content-to-post", async (req, res) => {
    if (!(await guardFeature(req, res, "socialPosts"))) return;
    try {
      const ctx = await getRequestContext(req);
      const briefId = typeof req.body?.briefId === "string" ? req.body.briefId : "";
      if (!briefId) return res.status(400).json({ error: "Missing briefId." });

      // The brief's native channel — its draft text is already written for this.
      // Other requested channels get the post tailored to their native style.
      // Read the brief + asset first (scoped) so we can do any AI tailoring
      // BEFORE opening the transaction (don't hold a row lock across an AI call).
      const [brief] = await db.select().from(contentBriefs).where(and(
        eq(contentBriefs.id, briefId),
        eq(contentBriefs.tenantDomain, ctx.tenantDomain),
        eq(contentBriefs.marketId, ctx.marketId),
      ));
      if (!brief) return res.status(404).json({ error: "Content draft not found." });
      if (!isSocialBriefFormat(brief.format)) {
        return res.status(400).json({ error: "Only LinkedIn or X drafts can become social posts." });
      }
      if (brief.status === "published") {
        return res.status(409).json({ error: "This draft has already been scheduled as a social post." });
      }
      if (!brief.contentAssetId) {
        return res.status(400).json({ error: "Draft the content first — there's no written post to schedule yet." });
      }
      const [asset] = await db.select().from(contentAssets).where(and(
        eq(contentAssets.id, brief.contentAssetId),
        eq(contentAssets.tenantDomain, ctx.tenantDomain),
      ));
      if (!asset || !asset.content || !asset.content.trim()) {
        return res.status(400).json({ error: "Draft the content first — there's no written post to schedule yet." });
      }
      const draftContent: string = asset.content;

      const nativePlatform = brief.format === "x_post" ? "twitter" : "linkedin";
      // Requested channels: default to the draft's native channel when none are
      // given. When provided, validate strictly (reject unknown channels with a
      // 400 rather than silently coercing them to LinkedIn), then dedupe.
      const requestedRaw: unknown = req.body?.platforms;
      if (requestedRaw !== undefined) {
        const allowed = new Set<string>([...SUPPORTED_PLATFORMS, "x"]);
        if (!Array.isArray(requestedRaw) || requestedRaw.length === 0) {
          return res.status(400).json({ error: "Pick at least one channel." });
        }
        const bad = requestedRaw.filter((p) => typeof p !== "string" || !allowed.has(p));
        if (bad.length) {
          return res.status(400).json({ error: `Unsupported channel: ${bad.join(", ")}` });
        }
      }
      const requested = Array.isArray(requestedRaw) && requestedRaw.length
        ? Array.from(new Set(requestedRaw.map((p) => coercePlatform(p))))
        : [nativePlatform as (typeof SUPPORTED_PLATFORMS)[number]];
      const extras = requested.filter((p) => p !== nativePlatform);

      // Per-channel copy: if the native channel was requested it uses the draft
      // verbatim; every other requested channel is tailored to its native
      // style/length via the repurposer (one AI call). The native entry is seeded
      // here but only used if `requested` actually includes it.
      const contentByPlatform = new Map<string, string>();
      contentByPlatform.set(nativePlatform, draftContent);
      if (extras.length) {
        try {
          const { variants } = await repurposeAsset({
            asset,
            isDefaultMarket: ctx.isDefaultMarket,
            platforms: extras,
            count: Math.max(extras.length, 3),
          });
          for (const p of extras) {
            const match = variants.find((v) => v.platform === p && v.content?.trim());
            // If the model didn't return copy for a channel, fall back to the
            // native draft so the post is still created (user can edit later).
            contentByPlatform.set(p, match?.content?.trim() || draftContent);
          }
        } catch (e: any) {
          console.error("[content-to-post tailoring]", e?.message);
          for (const p of extras) contentByPlatform.set(p, draftContent);
        }
      }

      // Retire the brief with a "not already published" guard so a double-click /
      // concurrent request can't create duplicate posts from one draft, then
      // insert one post per requested channel.
      type ConvResult =
        | { status: number; error: string }
        | { ok: true; posts: { postId: string; platform: string }[]; scheduled: boolean };
      const outcome = await db.transaction(async (tx): Promise<ConvResult> => {
        const flipped = await tx.update(contentBriefs)
          .set({ status: "published", updatedAt: new Date() })
          .where(and(eq(contentBriefs.id, brief.id), ne(contentBriefs.status, "published")))
          .returning({ id: contentBriefs.id });
        if (!flipped.length) {
          return { status: 409, error: "This draft has already been scheduled as a social post." };
        }

        const posts: { postId: string; platform: string }[] = [];
        for (const platform of requested) {
          const [post] = await tx.insert(generatedPosts).values({
            tenantDomain: ctx.tenantDomain,
            platform,
            content: contentByPlatform.get(platform) ?? draftContent,
            scheduledDate: brief.scheduledAt ?? null,
            overrideImageUrl: asset.leadImageUrl ?? null,
            sourceAssetId: asset.id,
            campaignId: brief.campaignId ?? null,
            solutionAreaId: brief.solutionAreaId ?? null,
            conferenceId: brief.conferenceId ?? null,
            status: "approved",
          }).returning({ id: generatedPosts.id });
          posts.push({ postId: post.id, platform });
        }
        return { ok: true, posts, scheduled: !!brief.scheduledAt };
      });

      if (!("ok" in outcome)) return res.status(outcome.status).json({ error: outcome.error });
      res.json({
        ok: true,
        posts: outcome.posts,
        // Back-compat single-post fields (first/native post).
        postId: outcome.posts[0]?.postId,
        platform: outcome.posts[0]?.platform,
        scheduled: outcome.scheduled,
      });
    } catch (err: any) {
      console.error("[marketing-calendar content-to-post]", err.message);
      res.status(500).json({ error: err.message || "Failed to convert draft" });
    }
  });

  // ───── Reset exported posts back to approved (recovery from scheduler glitch) ─────
  app.post("/api/marketing-calendar/reset-exports", async (req, res) => {
    if (!(await guardFeature(req, res, "socialPosts"))) return;
    try {
      const ctx = await getRequestContext(req);
      const { from, to } = req.query as Record<string, string>;
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;
      const conds: any[] = [
        eq(generatedPosts.tenantDomain, ctx.tenantDomain),
        or(
          eq(generatedPosts.status, "exported"),
          eq(generatedPosts.status, "scheduled_external"),
          eq(generatedPosts.status, "published"),
        ),
      ];
      if (fromDate) conds.push(gte(generatedPosts.scheduledDate, fromDate));
      if (toDate) conds.push(lte(generatedPosts.scheduledDate, toDate));
      const result = await db.update(generatedPosts)
        .set({ status: "approved", updatedAt: new Date() })
        .where(and(...conds))
        .returning({ id: generatedPosts.id });
      res.json({ ok: true, affected: result.length });
    } catch (err: any) {
      console.error("[marketing-calendar reset-exports]", err.message);
      res.status(500).json({ error: err.message || "Failed to reset exports" });
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
        // Briefs are specs, not dated deliverables — they can't be scheduled.
        // Create collateral (a post or draft) from the brief, then schedule that.
        if (byType.content.length) {
          skipped.push(`${byType.content.length} content brief(s) skipped — briefs are specs, not scheduled items. Create the collateral first, then schedule that.`);
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
      } else if (action === "archive") {
        // Archive = keep the row but remove it from planning/calendar/export.
        // Social posts only (the high-volume clutter source). Content/email use
        // their own statuses; skip them here.
        if (byType.social.length) {
          const r = await db.update(generatedPosts).set({ status: "archived", updatedAt: new Date() })
            .where(and(eq(generatedPosts.tenantDomain, ctx.tenantDomain), inArray(generatedPosts.id, byType.social))).returning({ id: generatedPosts.id });
          affected += r.length;
        }
        if (byType.content.length || byType.email.length) {
          skipped.push("Archive applies to social posts; use Discard for content/email.");
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
          // Archive marketing links tied to these briefs before soft-deleting them
          await db.update(marketingLinks).set({ status: "archived", updatedAt: new Date() }).where(
            and(eq(marketingLinks.tenantDomain, ctx.tenantDomain), inArray(marketingLinks.sourceBriefId, byType.content))
          );
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
