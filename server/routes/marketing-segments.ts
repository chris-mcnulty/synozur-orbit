/**
 * Marketing Segments Routes
 *
 * Endpoints:
 *   GET    /api/marketing-segments              — list all segments for the tenant
 *   POST   /api/marketing-segments              — create a new segment
 *   GET    /api/marketing-segments/:id          — get a single segment
 *   PATCH  /api/marketing-segments/:id          — update a segment
 *   DELETE /api/marketing-segments/:id          — delete a segment
 *   POST   /api/marketing-segments/:id/refresh  — force-refresh membership
 *   GET    /api/marketing-segments/:id/members  — paginated member list
 *   POST   /api/marketing-segments/preview      — live count preview (no write)
 *
 * All routes are gated by the `marketingContacts` feature flag.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, count } from "drizzle-orm";
import {
  marketingSegments,
  marketingSegmentMembers,
  marketingContacts,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { storage } from "../storage";
import {
  refreshSegmentMembership,
  previewSegmentCount,
  getSegmentMemberEmails,
} from "../services/segment-evaluation-service";
import { syncSegmentToHubSpotList } from "../services/hubspot-service";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function guardSegments(req: Request, res: Response): Promise<string | null> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  try {
    const ctx = await getRequestContext(req);
    const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
    const plan = tenant?.plan ?? "free";
    const gate = await checkFeatureAccessAsync(plan, "marketingContacts");
    if (!gate.allowed) {
      res.status(403).json({
        error: gate.reason,
        upgradeRequired: gate.upgradeRequired,
        requiredPlan: gate.requiredPlan,
      });
      return null;
    }
    return ctx.tenantDomain;
  } catch (err: any) {
    const status = err?.status ?? 500;
    res.status(status).json({
      error: status === 401 ? "Not authenticated" : status === 403 ? "Forbidden" : "Internal server error",
    });
    return null;
  }
}

/**
 * Write guard: requires Domain Admin or Global Admin role in addition to the
 * feature flag check. Segment configuration (create/edit/delete/refresh/HubSpot
 * mirror) is administrative — regular editors should not be able to alter the
 * targeting rules that govern who receives email.
 */
async function guardSegmentsAdmin(req: Request, res: Response): Promise<string | null> {
  const tenantDomain = await guardSegments(req, res);
  if (!tenantDomain) return null;
  const caller = await storage.getUser(req.session.userId!);
  if (!caller || !["Global Admin", "Domain Admin"].includes(caller.role)) {
    res.status(403).json({ error: "Domain Admin access required to manage segments" });
    return null;
  }
  return tenantDomain;
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerMarketingSegmentsRoutes(app: Express): void {

  // ── GET /api/marketing-segments ──────────────────────────────────────────
  app.get("/api/marketing-segments", async (req: Request, res: Response) => {
    const tenantDomain = await guardSegments(req, res);
    if (!tenantDomain) return;
    try {
      const segments = await db
        .select()
        .from(marketingSegments)
        .where(eq(marketingSegments.tenantDomain, tenantDomain))
        .orderBy(desc(marketingSegments.createdAt));

      // Attach member counts
      const counts = await db
        .select({
          segmentId: marketingSegmentMembers.segmentId,
          memberCount: count(marketingSegmentMembers.contactId),
        })
        .from(marketingSegmentMembers)
        .where(eq(marketingSegmentMembers.tenantDomain, tenantDomain))
        .groupBy(marketingSegmentMembers.segmentId);

      const countMap = new Map(counts.map((c) => [c.segmentId, Number(c.memberCount)]));
      const result = segments.map((s) => ({
        ...s,
        memberCount: countMap.get(s.id) ?? 0,
      }));

      res.json(result);
    } catch (err: any) {
      console.error("[Segments] List error:", err.message);
      res.status(500).json({ error: "Failed to list segments" });
    }
  });

  // ── POST /api/marketing-segments ─────────────────────────────────────────
  app.post("/api/marketing-segments", async (req: Request, res: Response) => {
    const tenantDomain = await guardSegmentsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const { name, description, ruleJson, refreshIntervalMinutes, hubspotListId } = req.body;
      if (!name?.trim()) {
        return res.status(400).json({ error: "name is required" });
      }
      const [segment] = await db
        .insert(marketingSegments)
        .values({
          tenantDomain,
          name: name.trim(),
          description: description?.trim() ?? null,
          ruleJson: ruleJson ?? { logic: "AND", conditions: [] },
          refreshIntervalMinutes: refreshIntervalMinutes ?? 60,
          hubspotListId: hubspotListId?.trim() || null,
          isActive: true,
          createdBy: req.session.userId!,
        })
        .returning();

      // Immediately compute initial membership
      try {
        await refreshSegmentMembership(segment);
      } catch (refreshErr: any) {
        console.warn("[Segments] Initial refresh failed:", refreshErr.message);
      }

      res.status(201).json({ ...segment, memberCount: 0 });
    } catch (err: any) {
      console.error("[Segments] Create error:", err.message);
      res.status(500).json({ error: "Failed to create segment" });
    }
  });

  // ── GET /api/marketing-segments/:id ──────────────────────────────────────
  app.get("/api/marketing-segments/:id", async (req: Request, res: Response) => {
    const tenantDomain = await guardSegments(req, res);
    if (!tenantDomain) return;
    try {
      const [segment] = await db
        .select()
        .from(marketingSegments)
        .where(
          and(
            eq(marketingSegments.id, req.params.id),
            eq(marketingSegments.tenantDomain, tenantDomain),
          ),
        );
      if (!segment) return res.status(404).json({ error: "Segment not found" });

      const [countRow] = await db
        .select({ memberCount: count(marketingSegmentMembers.contactId) })
        .from(marketingSegmentMembers)
        .where(eq(marketingSegmentMembers.segmentId, segment.id));

      res.json({ ...segment, memberCount: Number(countRow?.memberCount ?? 0) });
    } catch (err: any) {
      console.error("[Segments] Get error:", err.message);
      res.status(500).json({ error: "Failed to get segment" });
    }
  });

  // ── PATCH /api/marketing-segments/:id ────────────────────────────────────
  app.patch("/api/marketing-segments/:id", async (req: Request, res: Response) => {
    const tenantDomain = await guardSegmentsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const [existing] = await db
        .select()
        .from(marketingSegments)
        .where(
          and(
            eq(marketingSegments.id, req.params.id),
            eq(marketingSegments.tenantDomain, tenantDomain),
          ),
        );
      if (!existing) return res.status(404).json({ error: "Segment not found" });

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (req.body.name !== undefined) updates.name = req.body.name.trim();
      if (req.body.description !== undefined) updates.description = req.body.description?.trim() ?? null;
      if (req.body.ruleJson !== undefined) updates.ruleJson = req.body.ruleJson;
      if (req.body.refreshIntervalMinutes !== undefined) updates.refreshIntervalMinutes = req.body.refreshIntervalMinutes;
      if (req.body.hubspotListId !== undefined) updates.hubspotListId = req.body.hubspotListId?.trim() || null;
      if (req.body.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);

      const [updated] = await db
        .update(marketingSegments)
        .set(updates)
        .where(eq(marketingSegments.id, req.params.id))
        .returning();

      // If rules changed, re-evaluate membership
      if (req.body.ruleJson !== undefined) {
        try {
          await refreshSegmentMembership(updated);
        } catch (refreshErr: any) {
          console.warn("[Segments] Post-update refresh failed:", refreshErr.message);
        }
      }

      const [countRow] = await db
        .select({ memberCount: count(marketingSegmentMembers.contactId) })
        .from(marketingSegmentMembers)
        .where(eq(marketingSegmentMembers.segmentId, updated.id));

      res.json({ ...updated, memberCount: Number(countRow?.memberCount ?? 0) });
    } catch (err: any) {
      console.error("[Segments] Update error:", err.message);
      res.status(500).json({ error: "Failed to update segment" });
    }
  });

  // ── DELETE /api/marketing-segments/:id ───────────────────────────────────
  app.delete("/api/marketing-segments/:id", async (req: Request, res: Response) => {
    const tenantDomain = await guardSegmentsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const [existing] = await db
        .select({ id: marketingSegments.id })
        .from(marketingSegments)
        .where(
          and(
            eq(marketingSegments.id, req.params.id),
            eq(marketingSegments.tenantDomain, tenantDomain),
          ),
        );
      if (!existing) return res.status(404).json({ error: "Segment not found" });

      await db.delete(marketingSegments).where(eq(marketingSegments.id, req.params.id));
      res.status(204).send();
    } catch (err: any) {
      console.error("[Segments] Delete error:", err.message);
      res.status(500).json({ error: "Failed to delete segment" });
    }
  });

  // ── POST /api/marketing-segments/:id/refresh ─────────────────────────────
  app.post("/api/marketing-segments/:id/refresh", async (req: Request, res: Response) => {
    const tenantDomain = await guardSegmentsAdmin(req, res);
    if (!tenantDomain) return;
    try {
      const [segment] = await db
        .select()
        .from(marketingSegments)
        .where(
          and(
            eq(marketingSegments.id, req.params.id),
            eq(marketingSegments.tenantDomain, tenantDomain),
          ),
        );
      if (!segment) return res.status(404).json({ error: "Segment not found" });

      const memberCount = await refreshSegmentMembership(segment);

      // Mirror to HubSpot if configured — best-effort
      if (segment.hubspotListId) {
        const emails = await getSegmentMemberEmails(segment.id, tenantDomain);
        syncSegmentToHubSpotList(tenantDomain, segment.hubspotListId, emails).catch((err) =>
          console.warn("[Segments] HubSpot sync failed:", err.message),
        );
      }

      res.json({ memberCount, refreshedAt: new Date().toISOString() });
    } catch (err: any) {
      console.error("[Segments] Refresh error:", err.message);
      res.status(500).json({ error: "Failed to refresh segment" });
    }
  });

  // ── GET /api/marketing-segments/:id/members ───────────────────────────────
  app.get("/api/marketing-segments/:id/members", async (req: Request, res: Response) => {
    const tenantDomain = await guardSegments(req, res);
    if (!tenantDomain) return;
    try {
      const [segment] = await db
        .select({ id: marketingSegments.id })
        .from(marketingSegments)
        .where(
          and(
            eq(marketingSegments.id, req.params.id),
            eq(marketingSegments.tenantDomain, tenantDomain),
          ),
        );
      if (!segment) return res.status(404).json({ error: "Segment not found" });

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
      const offset = (page - 1) * limit;

      const [totalRow] = await db
        .select({ total: count(marketingSegmentMembers.contactId) })
        .from(marketingSegmentMembers)
        .where(eq(marketingSegmentMembers.segmentId, req.params.id));

      const members = await db
        .select({
          contactId: marketingContacts.id,
          email: marketingContacts.email,
          firstName: marketingContacts.firstName,
          lastName: marketingContacts.lastName,
          company: marketingContacts.company,
          jobTitle: marketingContacts.jobTitle,
          lifecycleStage: marketingContacts.lifecycleStage,
          addedAt: marketingSegmentMembers.addedAt,
        })
        .from(marketingSegmentMembers)
        .innerJoin(
          marketingContacts,
          eq(marketingSegmentMembers.contactId, marketingContacts.id),
        )
        .where(eq(marketingSegmentMembers.segmentId, req.params.id))
        .orderBy(desc(marketingSegmentMembers.addedAt))
        .limit(limit)
        .offset(offset);

      res.json({
        members,
        total: Number(totalRow?.total ?? 0),
        page,
        limit,
      });
    } catch (err: any) {
      console.error("[Segments] Members error:", err.message);
      res.status(500).json({ error: "Failed to list segment members" });
    }
  });

  // ── POST /api/marketing-segments/preview ─────────────────────────────────
  app.post("/api/marketing-segments/preview", async (req: Request, res: Response) => {
    const tenantDomain = await guardSegments(req, res);
    if (!tenantDomain) return;
    try {
      const { ruleJson } = req.body;
      const count = await previewSegmentCount(tenantDomain, ruleJson ?? { logic: "AND", conditions: [] });
      res.json({ count });
    } catch (err: any) {
      console.error("[Segments] Preview error:", err.message);
      res.status(500).json({ error: "Failed to preview segment" });
    }
  });
}
