/**
 * Unified Executive Summary ("Briefing Room") routes.
 *
 *   GET  /api/executive-summary/latest     latest run (any status) for the tenant
 *   GET  /api/executive-summary            recent runs (history, limit 12)
 *   GET  /api/executive-summary/settings   auto-run preference
 *   PUT  /api/executive-summary/settings   toggle auto-run (executiveSummaryAuto gate)
 *   POST /api/executive-summary/generate   start a run (202; client polls latest)
 *
 * Feature gates: on-demand = executiveSummary; scheduling = executiveSummaryAuto.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { unifiedExecSummaries, unifiedExecSummarySettings } from "@shared/schema";
import { getRequestContext, ContextError } from "../context";
import { guardFeature, denyReadOnly } from "./helpers";
import { startExecutiveSummary } from "../services/unified-exec-summary-service";

function sendContextError(res: Response, err: unknown): void {
  if (err instanceof ContextError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[executive-summary] error:", err);
  res.status(500).json({ error: "Internal server error" });
}

export function registerExecutiveSummaryRoutes(app: Express): void {
  app.get("/api/executive-summary/latest", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "executiveSummary"))) return;
    try {
      const ctx = await getRequestContext(req);
      const [latest] = await db
        .select()
        .from(unifiedExecSummaries)
        .where(eq(unifiedExecSummaries.tenantDomain, ctx.tenantDomain))
        .orderBy(desc(unifiedExecSummaries.createdAt))
        .limit(1);
      res.json(latest ?? null);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  app.get("/api/executive-summary", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "executiveSummary"))) return;
    try {
      const ctx = await getRequestContext(req);
      const runs = await db
        .select({
          id: unifiedExecSummaries.id,
          status: unifiedExecSummaries.status,
          trigger: unifiedExecSummaries.trigger,
          createdAt: unifiedExecSummaries.createdAt,
          completedAt: unifiedExecSummaries.completedAt,
        })
        .from(unifiedExecSummaries)
        .where(eq(unifiedExecSummaries.tenantDomain, ctx.tenantDomain))
        .orderBy(desc(unifiedExecSummaries.createdAt))
        .limit(12);
      res.json(runs);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  app.get("/api/executive-summary/settings", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "executiveSummary"))) return;
    try {
      const ctx = await getRequestContext(req);
      const [settings] = await db
        .select()
        .from(unifiedExecSummarySettings)
        .where(eq(unifiedExecSummarySettings.tenantDomain, ctx.tenantDomain));
      res.json(settings ?? { tenantDomain: ctx.tenantDomain, autoEnabled: false, frequency: "weekly" });
    } catch (err) {
      sendContextError(res, err);
    }
  });

  app.put("/api/executive-summary/settings", async (req: Request, res: Response) => {
    // Auto-runs depend on the base feature: enforce both gates.
    if (!(await guardFeature(req, res, "executiveSummary"))) return;
    if (!(await guardFeature(req, res, "executiveSummaryAuto"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const autoEnabled = req.body?.autoEnabled === true;
      const [row] = await db
        .insert(unifiedExecSummarySettings)
        .values({ tenantDomain: ctx.tenantDomain, autoEnabled, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: unifiedExecSummarySettings.tenantDomain,
          set: { autoEnabled, updatedAt: new Date() },
        })
        .returning();
      res.json(row);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  app.get("/api/executive-summary/:id", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "executiveSummary"))) return;
    try {
      const ctx = await getRequestContext(req);
      const [run] = await db
        .select()
        .from(unifiedExecSummaries)
        .where(and(eq(unifiedExecSummaries.id, req.params.id), eq(unifiedExecSummaries.tenantDomain, ctx.tenantDomain)));
      if (!run) return res.status(404).json({ error: "Summary not found" });
      res.json(run);
    } catch (err) {
      sendContextError(res, err);
    }
  });

  app.post("/api/executive-summary/generate", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "executiveSummary"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;

      // Atomically claim the tenant's single in-flight slot (advisory lock +
      // in-transaction check inside the service); null claim = 409. The run
      // continues in the background; the client polls /latest.
      const claimed = await startExecutiveSummary({ tenantDomain: ctx.tenantDomain, userId: ctx.userId, trigger: "manual" });
      if (!claimed) {
        return res.status(409).json({ error: "A summary is already being generated. It will appear here when ready." });
      }
      res.status(202).json({ started: true, id: claimed });
    } catch (err) {
      sendContextError(res, err);
    }
  });
}
