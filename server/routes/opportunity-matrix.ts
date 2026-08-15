/**
 * GTM Opportunity Matrix Routes — Task #544
 *
 *   GET   /api/opportunity-matrix            list cells (ranked by ROI) for tenant+market
 *   POST  /api/opportunity-matrix/generate   score segments × needs × channels (metered)
 *   PATCH /api/opportunity-matrix/:id         user override of a cell
 *
 * Gated by the `opportunityMatrix` feature flag, scoped to tenantDomain +
 * marketId. Generation fans AI scoring across the top segments' needs; bounded
 * by maxSegments/maxNeeds and metered by the generateOpportunityMatrix quota.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { opportunityMatrixCells } from "@shared/schema";
import { getRequestContext, ContextError } from "../context";
import { guardFeature, guardManualAction, denyReadOnly } from "./helpers";
import { computeRoiScore } from "../services/market-model/market-matrix-core";
import { generateMatrixForMarket, NoMatrixWorkError, recomputeWhitespace } from "../services/market-model/opportunity-matrix-service";

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "string" ? parseInt(v, 10) : (v as number);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function sendErr(res: Response, err: unknown): void {
  if (err instanceof ContextError) res.status(err.status).json({ error: err.message });
  else {
    console.error("[opportunity-matrix] error:", (err as any)?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export function registerOpportunityMatrixRoutes(app: Express): void {
  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get("/api/opportunity-matrix", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "opportunityMatrix"))) return;
    try {
      const ctx = await getRequestContext(req);
      const rows = await db
        .select()
        .from(opportunityMatrixCells)
        .where(
          and(
            eq(opportunityMatrixCells.tenantDomain, ctx.tenantDomain),
            eq(opportunityMatrixCells.marketId, ctx.marketId),
          ),
        )
        .orderBy(desc(opportunityMatrixCells.roiScore));
      res.json(rows);
    } catch (err) {
      sendErr(res, err);
    }
  });

  // ── GENERATE (metered) ───────────────────────────────────────────────────────
  app.post("/api/opportunity-matrix/generate", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "opportunityMatrix"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      // Reserve quota now; a 4xx below (e.g. no needs) leaves it uncommitted.
      if (!(await guardManualAction(req, res, "generateOpportunityMatrix"))) return;
      const result = await generateMatrixForMarket(
        { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
        {
          maxSegments: clampInt(req.body?.maxSegments, 1, 12, 6),
          maxNeeds: clampInt(req.body?.maxNeeds, 1, 6, 3),
        },
      );
      if (result.cellsCreated === 0) {
        return res.status(422).json({ error: "Scoring produced no cells — check the AI provider configuration." });
      }
      res.json(result);
    } catch (err) {
      if (err instanceof NoMatrixWorkError) {
        return res.status(422).json({ error: err.message });
      }
      sendErr(res, err);
    }
  });

  // ── PATCH cell (user override) ────────────────────────────────────────────────
  app.patch("/api/opportunity-matrix/:id", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "opportunityMatrix"))) return;
    try {
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const [cell] = await db
        .select()
        .from(opportunityMatrixCells)
        .where(
          and(
            eq(opportunityMatrixCells.id, req.params.id),
            eq(opportunityMatrixCells.tenantDomain, ctx.tenantDomain),
            eq(opportunityMatrixCells.marketId, ctx.marketId),
          ),
        );
      if (!cell) return res.status(404).json({ error: "Cell not found" });

      const b = req.body ?? {};
      const rev = b.revenuePotential !== undefined ? clamp0to100(Number(b.revenuePotential)) : (cell.revenuePotential ?? 0);
      const eff = b.executionEffort !== undefined ? clamp0to100(Number(b.executionEffort)) : (cell.executionEffort ?? 0);
      const scoreChanged = b.revenuePotential !== undefined || b.executionEffort !== undefined;
      const updates: Record<string, any> = { updatedAt: new Date(), source: "user" };
      if (b.revenuePotential !== undefined) updates.revenuePotential = rev;
      if (b.executionEffort !== undefined) updates.executionEffort = eff;
      if (scoreChanged) updates.roiScore = computeRoiScore(rev, eff);
      if (b.scoreRationale !== undefined) updates.scoreRationale = b.scoreRationale ?? null;

      await db.update(opportunityMatrixCells).set(updates).where(eq(opportunityMatrixCells.id, cell.id));

      // A changed ROI shifts the batch-relative whitespace flags — recompute them
      // across the market so no cell keeps (or misses) a stale whitespace badge.
      if (scoreChanged) await recomputeWhitespace(ctx.tenantDomain, ctx.marketId);

      const [updated] = await db.select().from(opportunityMatrixCells).where(eq(opportunityMatrixCells.id, cell.id));
      res.json(updated);
    } catch (err) {
      sendErr(res, err);
    }
  });
}

function clamp0to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
