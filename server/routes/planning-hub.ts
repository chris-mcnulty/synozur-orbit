/**
 * Campaign & Theme Planning Hub (Task #159)
 *
 * One view that aggregates every marketing item attached to a single campaign
 * OR a single theme (solution area): content briefs/drafts, social posts, and
 * emails. From here a user can:
 *   - see each item's lifecycle stage + a campaign/theme-level rollup,
 *   - attach existing items (and detach them),
 *   - create new proposed actions under the campaign/theme,
 *   - (campaigns/themes themselves are created via the existing endpoints).
 *
 * No DB schema changes: it reuses the campaignId / solutionAreaId association
 * columns that already exist on generated_posts, generated_emails, and
 * content_briefs.
 *
 * Scoping mirrors the rest of marketing:
 *   - generated_posts: tenant only (no market column)
 *   - generated_emails / content_briefs: tenant + active market
 *
 * Feature gating depends on the scope:
 *   - campaign scope → `campaigns`
 *   - theme scope    → `contentLibrary`
 */

import type { Express } from "express";
import { db } from "../db";
import {
  generatedPosts,
  generatedEmails,
  contentBriefs,
  editorialCalendars,
  campaigns,
  solutionAreas,
  conferences,
} from "@shared/schema";
import { and, asc, desc, eq, inArray, ne, or, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";

type Scope = "campaign" | "theme";
type ItemType = "social" | "email" | "content";
type Stage = "draft" | "scheduled" | "approved" | "posted";

const SCOPE_FEATURE: Record<Scope, string> = {
  campaign: "campaigns",
  theme: "contentLibrary",
};

function parseScope(raw: unknown): Scope | null {
  return raw === "campaign" || raw === "theme" ? raw : null;
}

// ── Lifecycle → 4-stage display funnel (draft → scheduled → approved → posted).
// Checked highest-first so each item lands in exactly one stage.
function socialStage(status: string, scheduledDate: Date | null): Stage {
  if (status === "exported" || status === "published") return "posted";
  if (status === "approved") return "approved";
  if (scheduledDate) return "scheduled";
  return "draft";
}
function emailStage(status: string, scheduledAt: Date | null, sentAt: Date | null): Stage {
  if (status === "sent" || sentAt) return "posted";
  if (status === "approved") return "approved";
  if (scheduledAt) return "scheduled";
  return "draft";
}
function contentStage(status: string, scheduledAt: Date | null): Stage {
  if (status === "published") return "posted";
  if (status === "approved") return "approved";
  if (status === "scheduled" || scheduledAt) return "scheduled";
  return "draft";
}

// Find (or lazily create) the per-tenant/market editorial calendar that holds
// manually-added content items, so a new proposed content action has a home
// without forcing the user through AI generation. Mirrors the marketing
// calendar's manual-calendar helper.
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

export function registerPlanningHubRoutes(app: Express) {
  // Resolve the active scope + verify the campaign/theme exists in context.
  // Returns the loaded record (with name/description) or sends the response.
  async function loadScope(
    req: any,
    res: any,
  ): Promise<{ scope: Scope; id: string; name: string; description: string | null; ctx: Awaited<ReturnType<typeof getRequestContext>> } | null> {
    const scope = parseScope(req.query.scope ?? req.body?.scope);
    const id = String(req.query.id ?? req.body?.id ?? "").trim();
    if (!scope) {
      res.status(400).json({ error: "scope must be 'campaign' or 'theme'" });
      return null;
    }
    if (!(await guardFeature(req, res, SCOPE_FEATURE[scope]))) return null;
    if (!id) {
      res.status(400).json({ error: "id is required" });
      return null;
    }
    const ctx = await getRequestContext(req);
    if (scope === "campaign") {
      const [row] = await db.select().from(campaigns).where(and(
        eq(campaigns.id, id),
        eq(campaigns.tenantDomain, ctx.tenantDomain),
        eq(campaigns.marketId, ctx.marketId),
        ne(campaigns.status, "deleted"),
      ));
      if (!row) { res.status(404).json({ error: "Campaign not found" }); return null; }
      return { scope, id, name: row.name, description: row.description, ctx };
    }
    const [row] = await db.select().from(solutionAreas).where(and(
      eq(solutionAreas.id, id),
      eq(solutionAreas.tenantDomain, ctx.tenantDomain),
      eq(solutionAreas.marketId, ctx.marketId),
    ));
    if (!row) { res.status(404).json({ error: "Theme not found" }); return null; }
    return { scope, id, name: row.name, description: row.description, ctx };
  }

  // ───── Picker: campaigns + themes for the active context ─────
  app.get("/api/planning-hub/scopes", async (req, res) => {
    if (!(await guardFeature(req, res, "campaigns"))) return;
    try {
      const ctx = await getRequestContext(req);
      const [camps, themes] = await Promise.all([
        db.select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
          .from(campaigns)
          .where(and(eq(campaigns.tenantDomain, ctx.tenantDomain), eq(campaigns.marketId, ctx.marketId), ne(campaigns.status, "deleted")))
          .orderBy(desc(campaigns.createdAt)),
        db.select({ id: solutionAreas.id, name: solutionAreas.name, color: solutionAreas.color })
          .from(solutionAreas)
          .where(and(eq(solutionAreas.tenantDomain, ctx.tenantDomain), eq(solutionAreas.marketId, ctx.marketId)))
          .orderBy(asc(solutionAreas.sortOrder), asc(solutionAreas.name)),
      ]);
      res.json({ campaigns: camps, themes });
    } catch (err: any) {
      console.error("[planning-hub scopes]", err.message);
      res.status(500).json({ error: err.message || "Failed to load scopes" });
    }
  });

  // ───── Aggregated view for one campaign / theme ─────
  app.get("/api/planning-hub", async (req, res) => {
    const loaded = await loadScope(req, res);
    if (!loaded) return;
    try {
      const { scope, id, name, description, ctx } = loaded;
      const scopeCol = scope === "campaign"
        ? { social: generatedPosts.campaignId, email: generatedEmails.campaignId, content: contentBriefs.campaignId }
        : { social: generatedPosts.solutionAreaId, email: generatedEmails.solutionAreaId, content: contentBriefs.solutionAreaId };

      const [socialRows, emailRows, briefRows] = await Promise.all([
        db.select().from(generatedPosts).where(and(
          eq(generatedPosts.tenantDomain, ctx.tenantDomain),
          eq(scopeCol.social, id),
          ne(generatedPosts.status, "rejected"),
          ne(generatedPosts.status, "deleted"),
        )).orderBy(desc(generatedPosts.createdAt)),
        db.select().from(generatedEmails).where(and(
          eq(generatedEmails.tenantDomain, ctx.tenantDomain),
          eq(generatedEmails.marketId, ctx.marketId),
          eq(scopeCol.email, id),
        )).orderBy(desc(generatedEmails.createdAt)),
        db.select().from(contentBriefs).where(and(
          eq(contentBriefs.tenantDomain, ctx.tenantDomain),
          eq(contentBriefs.marketId, ctx.marketId),
          eq(scopeCol.content, id),
          ne(contentBriefs.status, "removed"),
        )).orderBy(desc(contentBriefs.createdAt)),
      ]);

      const items: any[] = [];
      for (const p of socialRows) {
        const date = p.scheduledDate ?? p.publishedAt ?? null;
        items.push({
          id: p.id, type: "social" as ItemType,
          title: `${p.platform} post`,
          preview: ((p.editedContent ?? p.content) || "").slice(0, 160),
          date: date ? date.toISOString() : null,
          status: p.status,
          stage: socialStage(p.status, p.scheduledDate),
          platform: p.platform,
          campaignId: p.campaignId, solutionAreaId: p.solutionAreaId, conferenceId: p.conferenceId,
        });
      }
      for (const e of emailRows) {
        const date = e.scheduledAt ?? e.sentAt ?? null;
        items.push({
          id: e.id, type: "email" as ItemType,
          title: e.subject || "(untitled email)",
          preview: (e.previewText || "").slice(0, 160),
          date: date ? date.toISOString() : null,
          status: e.status,
          stage: emailStage(e.status, e.scheduledAt, e.sentAt),
          campaignId: e.campaignId, solutionAreaId: e.solutionAreaId, conferenceId: e.conferenceId,
        });
      }
      for (const b of briefRows) {
        const date = b.scheduledAt ?? null;
        items.push({
          id: b.id, type: "content" as ItemType,
          title: b.title,
          preview: "",
          date: date ? date.toISOString() : null,
          status: b.status,
          stage: contentStage(b.status, b.scheduledAt),
          format: b.format,
          contentAssetId: b.contentAssetId,
          campaignId: b.campaignId, solutionAreaId: b.solutionAreaId, conferenceId: b.conferenceId,
        });
      }

      // Resolve event names for any conference-linked items (tenant-scoped).
      const eventIds = Array.from(new Set(items.map(i => i.conferenceId).filter((v): v is string => !!v)));
      if (eventIds.length) {
        const eventRows = await db.select({ id: conferences.id, name: conferences.name }).from(conferences)
          .where(and(eq(conferences.tenantDomain, ctx.tenantDomain), inArray(conferences.id, eventIds)));
        const eventName = new Map(eventRows.map(r => [r.id, r.name]));
        for (const it of items) it.conferenceName = it.conferenceId ? eventName.get(it.conferenceId) ?? null : null;
      } else {
        for (const it of items) it.conferenceName = null;
      }

      const blank = (): Record<string, number> => ({ draft: 0, scheduled: 0, approved: 0, posted: 0 });
      const byStage = blank();
      const byType: Record<ItemType, number> = { social: 0, email: 0, content: 0 };
      for (const it of items) {
        byStage[it.stage] += 1;
        byType[it.type as ItemType] += 1;
      }

      res.json({
        scope, id, name, description,
        items,
        rollup: { total: items.length, byStage, byType },
      });
    } catch (err: any) {
      console.error("[planning-hub view]", err.message);
      res.status(500).json({ error: err.message || "Failed to load planning hub" });
    }
  });

  // ───── Candidate items to attach (not currently assigned to this scope) ─────
  app.get("/api/planning-hub/available", async (req, res) => {
    const loaded = await loadScope(req, res);
    if (!loaded) return;
    try {
      const { scope, id, ctx } = loaded;
      const col = {
        social: scope === "campaign" ? generatedPosts.campaignId : generatedPosts.solutionAreaId,
        email: scope === "campaign" ? generatedEmails.campaignId : generatedEmails.solutionAreaId,
        content: scope === "campaign" ? contentBriefs.campaignId : contentBriefs.solutionAreaId,
      };
      // Available = not already attached to THIS scope (null or attached elsewhere).
      const notThisScope = (c: any) => or(isNull(c), ne(c, id));

      const [socialRows, emailRows, briefRows] = await Promise.all([
        db.select().from(generatedPosts).where(and(
          eq(generatedPosts.tenantDomain, ctx.tenantDomain),
          ne(generatedPosts.status, "rejected"),
          ne(generatedPosts.status, "deleted"),
          notThisScope(col.social),
        )).orderBy(desc(generatedPosts.createdAt)),
        db.select().from(generatedEmails).where(and(
          eq(generatedEmails.tenantDomain, ctx.tenantDomain),
          eq(generatedEmails.marketId, ctx.marketId),
          notThisScope(col.email),
        )).orderBy(desc(generatedEmails.createdAt)),
        db.select().from(contentBriefs).where(and(
          eq(contentBriefs.tenantDomain, ctx.tenantDomain),
          eq(contentBriefs.marketId, ctx.marketId),
          ne(contentBriefs.status, "removed"),
          notThisScope(col.content),
        )).orderBy(desc(contentBriefs.createdAt)),
      ]);

      const items: any[] = [];
      for (const p of socialRows) {
        items.push({
          id: p.id, type: "social" as ItemType,
          title: `${p.platform} post`,
          preview: ((p.editedContent ?? p.content) || "").slice(0, 120),
          status: p.status,
          assignedCampaignId: p.campaignId, assignedSolutionAreaId: p.solutionAreaId,
        });
      }
      for (const e of emailRows) {
        items.push({
          id: e.id, type: "email" as ItemType,
          title: e.subject || "(untitled email)",
          preview: (e.previewText || "").slice(0, 120),
          status: e.status,
          assignedCampaignId: e.campaignId, assignedSolutionAreaId: e.solutionAreaId,
        });
      }
      for (const b of briefRows) {
        items.push({
          id: b.id, type: "content" as ItemType,
          title: b.title,
          preview: "",
          status: b.status,
          format: b.format,
          assignedCampaignId: b.campaignId, assignedSolutionAreaId: b.solutionAreaId,
        });
      }
      res.json(items);
    } catch (err: any) {
      console.error("[planning-hub available]", err.message);
      res.status(500).json({ error: err.message || "Failed to load available items" });
    }
  });

  // ───── Attach / detach existing items ─────
  async function setAssignment(req: any, res: any, attach: boolean) {
    const loaded = await loadScope(req, res);
    if (!loaded) return;
    try {
      const { scope, id, ctx } = loaded;
      const rawItems: Array<{ type: string; id: string }> = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!rawItems.length) return res.status(400).json({ error: "No items provided." });
      const byType: Record<ItemType, string[]> = { social: [], email: [], content: [] };
      for (const it of rawItems) {
        if (it && (it.type === "social" || it.type === "email" || it.type === "content") && it.id) {
          byType[it.type].push(it.id);
        }
      }
      const value = attach ? id : null;
      let affected = 0;

      if (byType.social.length) {
        const set = scope === "campaign" ? { campaignId: value } : { solutionAreaId: value };
        const r = await db.update(generatedPosts).set({ ...set, updatedAt: new Date() })
          .where(and(eq(generatedPosts.tenantDomain, ctx.tenantDomain), inArray(generatedPosts.id, byType.social)))
          .returning({ id: generatedPosts.id });
        affected += r.length;
      }
      if (byType.email.length) {
        const set = scope === "campaign" ? { campaignId: value } : { solutionAreaId: value };
        const r = await db.update(generatedEmails).set({ ...set, updatedAt: new Date() })
          .where(and(eq(generatedEmails.tenantDomain, ctx.tenantDomain), eq(generatedEmails.marketId, ctx.marketId), inArray(generatedEmails.id, byType.email)))
          .returning({ id: generatedEmails.id });
        affected += r.length;
      }
      if (byType.content.length) {
        const set = scope === "campaign" ? { campaignId: value } : { solutionAreaId: value };
        const r = await db.update(contentBriefs).set({ ...set, updatedAt: new Date() })
          .where(and(eq(contentBriefs.tenantDomain, ctx.tenantDomain), eq(contentBriefs.marketId, ctx.marketId), inArray(contentBriefs.id, byType.content)))
          .returning({ id: contentBriefs.id });
        affected += r.length;
      }
      res.json({ ok: true, affected });
    } catch (err: any) {
      console.error("[planning-hub assign]", err.message);
      res.status(500).json({ error: err.message || "Failed to update items" });
    }
  }

  app.post("/api/planning-hub/attach", (req, res) => setAssignment(req, res, true));
  app.post("/api/planning-hub/detach", (req, res) => setAssignment(req, res, false));

  // ───── Create a new proposed action under the scope ─────
  app.post("/api/planning-hub/items", async (req, res) => {
    const loaded = await loadScope(req, res);
    if (!loaded) return;
    try {
      const { scope, id, ctx } = loaded;
      const { type, title, date, platform, format } = req.body ?? {};
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
      const assign = scope === "campaign"
        ? { campaignId: id, solutionAreaId: null }
        : { campaignId: null, solutionAreaId: id };

      if (type === "social") {
        const [row] = await db.insert(generatedPosts).values({
          id: randomUUID(),
          tenantDomain: ctx.tenantDomain,
          platform: platform || "linkedin",
          content: String(title).trim(),
          scheduledDate: when,
          status: "draft",
          ...assign,
        } as any).returning();
        return res.status(201).json({ type, id: row.id });
      }
      if (type === "email") {
        const [row] = await db.insert(generatedEmails).values({
          id: randomUUID(),
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId || null,
          platform: "outlook",
          tone: "professional",
          subject: String(title).trim(),
          htmlBody: "",
          status: "draft",
          scheduledAt: when,
          createdBy: ctx.userId,
          ...assign,
        } as any).returning();
        return res.status(201).json({ type, id: row.id });
      }
      // content
      const calendar = await getOrCreateManualCalendar(ctx);
      const [row] = await db.insert(contentBriefs).values({
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
        ...assign,
      } as any).returning();
      return res.status(201).json({ type, id: row.id });
    } catch (err: any) {
      console.error("[planning-hub create item]", err.message);
      res.status(500).json({ error: err.message || "Failed to create item" });
    }
  });
}
