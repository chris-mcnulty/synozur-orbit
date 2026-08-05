/**
 * Lead Scoring Routes
 *
 * GET  /api/lead-scoring/rules                — list scoring rules for tenant
 * POST /api/lead-scoring/rules                — create a rule
 * PUT  /api/lead-scoring/rules/:id            — update a rule
 * DELETE /api/lead-scoring/rules/:id          — delete a rule
 * GET  /api/lead-scoring/thresholds           — lifecycle thresholds
 * PUT  /api/lead-scoring/thresholds           — upsert thresholds (bulk)
 * POST /api/lead-scoring/suggest              — AI-generate starter rules
 * POST /api/lead-scoring/recompute            — recompute all scores for tenant
 * GET  /api/lead-scoring/distribution         — score histogram buckets
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, asc, sql } from "drizzle-orm";
import {
  marketingScoringRules,
  marketingLifecycleThresholds,
  marketingContacts,
} from "@shared/schema";
import { getRequestContext } from "../context";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { storage } from "../storage";
import {
  suggestScoringRules,
  recomputeAllScores,
} from "../services/lead-scoring-service";

// ---------------------------------------------------------------------------
// Auth guard (requires marketingContacts feature)
// ---------------------------------------------------------------------------

async function guardScoring(req: Request, res: Response): Promise<string | null> {
  if (!req.session?.userId) {
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
    const status = err?.status === 401 ? 401 : err?.status === 403 ? 403 : 500;
    res.status(status).json({ error: "Request failed" });
    return null;
  }
}

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  if (!req.session?.userId) { res.status(401).json({ error: "Not authenticated" }); return false; }
  const ctx = await getRequestContext(req);
  const user = await storage.getUser(ctx.userId);
  if (!user || !["Domain Admin", "Global Admin"].includes(user.role)) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Register routes
// ---------------------------------------------------------------------------

export function registerLeadScoringRoutes(app: Express) {
  // ── LIST RULES ────────────────────────────────────────────────────────────
  app.get("/api/lead-scoring/rules", async (req: Request, res: Response) => {
    const tenantDomain = await guardScoring(req, res);
    if (!tenantDomain) return;

    const rules = await db
      .select()
      .from(marketingScoringRules)
      .where(eq(marketingScoringRules.tenantDomain, tenantDomain))
      .orderBy(asc(marketingScoringRules.createdAt));

    res.json(rules);
  });

  // ── CREATE RULE ───────────────────────────────────────────────────────────
  app.post("/api/lead-scoring/rules", async (req: Request, res: Response) => {
    const tenantDomain = await guardScoring(req, res);
    if (!tenantDomain) return;
    if (!await requireAdmin(req, res)) return;

    const { name, ruleType, conditionJson, points, isActive = true } = req.body ?? {};
    if (!name || !ruleType || !conditionJson || points === undefined) {
      return res.status(400).json({ error: "name, ruleType, conditionJson, and points are required" });
    }
    if (!["property", "event"].includes(ruleType)) {
      return res.status(400).json({ error: "ruleType must be 'property' or 'event'" });
    }
    if (typeof points !== "number") {
      return res.status(400).json({ error: "points must be a number" });
    }

    const [rule] = await db
      .insert(marketingScoringRules)
      .values({ tenantDomain, name, ruleType, conditionJson, points, isActive })
      .returning();

    res.status(201).json(rule);
  });

  // ── UPDATE RULE ───────────────────────────────────────────────────────────
  app.put("/api/lead-scoring/rules/:id", async (req: Request, res: Response) => {
    const tenantDomain = await guardScoring(req, res);
    if (!tenantDomain) return;
    if (!await requireAdmin(req, res)) return;

    const { name, ruleType, conditionJson, points, isActive } = req.body ?? {};
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (ruleType !== undefined) updates.ruleType = ruleType;
    if (conditionJson !== undefined) updates.conditionJson = conditionJson;
    if (points !== undefined) updates.points = points;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db
      .update(marketingScoringRules)
      .set(updates)
      .where(
        and(
          eq(marketingScoringRules.id, req.params.id),
          eq(marketingScoringRules.tenantDomain, tenantDomain),
        ),
      )
      .returning();

    if (!updated) return res.status(404).json({ error: "Rule not found" });
    res.json(updated);
  });

  // ── DELETE RULE ───────────────────────────────────────────────────────────
  app.delete("/api/lead-scoring/rules/:id", async (req: Request, res: Response) => {
    const tenantDomain = await guardScoring(req, res);
    if (!tenantDomain) return;
    if (!await requireAdmin(req, res)) return;

    const [deleted] = await db
      .delete(marketingScoringRules)
      .where(
        and(
          eq(marketingScoringRules.id, req.params.id),
          eq(marketingScoringRules.tenantDomain, tenantDomain),
        ),
      )
      .returning();

    if (!deleted) return res.status(404).json({ error: "Rule not found" });
    res.json({ ok: true });
  });

  // ── LIST THRESHOLDS ───────────────────────────────────────────────────────
  app.get("/api/lead-scoring/thresholds", async (req: Request, res: Response) => {
    const tenantDomain = await guardScoring(req, res);
    if (!tenantDomain) return;

    const rows = await db
      .select()
      .from(marketingLifecycleThresholds)
      .where(eq(marketingLifecycleThresholds.tenantDomain, tenantDomain))
      .orderBy(asc(marketingLifecycleThresholds.minScore));

    // Return defaults if no custom thresholds configured
    if (rows.length === 0) {
      return res.json([
        { stage: "lead", minScore: 10 },
        { stage: "mql", minScore: 40 },
        { stage: "sql", minScore: 80 },
        { stage: "opportunity", minScore: 120 },
        { stage: "customer", minScore: 200 },
      ]);
    }

    res.json(rows);
  });

  // ── UPSERT THRESHOLDS (bulk) ──────────────────────────────────────────────
  app.put("/api/lead-scoring/thresholds", async (req: Request, res: Response) => {
    const tenantDomain = await guardScoring(req, res);
    if (!tenantDomain) return;
    if (!await requireAdmin(req, res)) return;

    const thresholds: Array<{ stage: string; minScore: number }> = req.body?.thresholds ?? [];
    const VALID_STAGES = ["lead", "mql", "sql", "opportunity", "customer"];

    for (const t of thresholds) {
      if (!VALID_STAGES.includes(t.stage) || typeof t.minScore !== "number") {
        return res.status(400).json({ error: `Invalid threshold: ${JSON.stringify(t)}` });
      }
    }

    // Upsert each
    for (const t of thresholds) {
      await db
        .insert(marketingLifecycleThresholds)
        .values({ tenantDomain, stage: t.stage, minScore: t.minScore })
        .onConflictDoUpdate({
          target: [
            marketingLifecycleThresholds.tenantDomain,
            marketingLifecycleThresholds.stage,
          ],
          set: { minScore: t.minScore, updatedAt: new Date() },
        });
    }

    res.json({ ok: true, updated: thresholds.length });
  });

  // ── AI RULE SUGGESTIONS ───────────────────────────────────────────────────
  app.post("/api/lead-scoring/suggest", async (req: Request, res: Response) => {
    const tenantDomain = await guardScoring(req, res);
    if (!tenantDomain) return;
    if (!await requireAdmin(req, res)) return;

    try {
      const suggestions = await suggestScoringRules(tenantDomain);
      res.json({ suggestions });
    } catch (err: any) {
      console.error("[lead-scoring] suggest failed:", err.message);
      res.status(500).json({ error: "AI suggestion failed" });
    }
  });

  // ── BULK RECOMPUTE ────────────────────────────────────────────────────────
  app.post("/api/lead-scoring/recompute", async (req: Request, res: Response) => {
    const tenantDomain = await guardScoring(req, res);
    if (!tenantDomain) return;
    if (!await requireAdmin(req, res)) return;

    try {
      const result = await recomputeAllScores(tenantDomain);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[lead-scoring] bulk recompute failed:", err.message);
      res.status(500).json({ error: "Recompute failed" });
    }
  });

  // ── SCORE DISTRIBUTION HISTOGRAM ─────────────────────────────────────────
  app.get("/api/lead-scoring/distribution", async (req: Request, res: Response) => {
    const tenantDomain = await guardScoring(req, res);
    if (!tenantDomain) return;

    // Return counts per lifecycle stage + total count + average score
    const rows = await db
      .select({
        lifecycleStage: marketingContacts.lifecycleStage,
        count: sql<number>`count(*)::int`,
        avgScore: sql<number>`round(avg(score))::int`,
        minScore: sql<number>`min(score)::int`,
        maxScore: sql<number>`max(score)::int`,
      })
      .from(marketingContacts)
      .where(eq(marketingContacts.tenantDomain, tenantDomain))
      .groupBy(marketingContacts.lifecycleStage);

    res.json(rows);
  });
}
