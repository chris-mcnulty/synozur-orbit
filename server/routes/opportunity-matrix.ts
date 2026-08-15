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
import { and, desc, eq, inArray } from "drizzle-orm";
import { opportunityMatrixCells, marketSegments } from "@shared/schema";
import { getRequestContext, ContextError } from "../context";
import { guardFeature, guardManualAction } from "./helpers";
import { getMarketModelProvider } from "../services/market-model/market-model-provider";
import { computeRoiScore, computeWhitespaceFlags } from "../services/market-model/market-matrix-core";
import { CANONICAL_CHANNELS, needKeyOf, type NeedsMap } from "@shared/market-intelligence";

const DEFAULT_MAX_SEGMENTS = 6;
const DEFAULT_MAX_NEEDS = 3;
const SCORE_CONCURRENCY = 4;

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "string" ? parseInt(v, 10) : (v as number);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** Bounded-concurrency map (keeps AI fan-out from tripping rate limits). */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
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
      const maxSegments = clampInt(req.body?.maxSegments, 1, 12, DEFAULT_MAX_SEGMENTS);
      const maxNeeds = clampInt(req.body?.maxNeeds, 1, 6, DEFAULT_MAX_NEEDS);
      const channels = CANONICAL_CHANNELS.map((c) => ({ key: c.key, label: c.label }));

      // Top segments by priority.
      const segments = (
        await db
          .select()
          .from(marketSegments)
          .where(
            and(
              eq(marketSegments.tenantDomain, ctx.tenantDomain),
              eq(marketSegments.marketId, ctx.marketId),
              eq(marketSegments.status, "active"),
            ),
          )
          .orderBy(desc(marketSegments.priorityScore), desc(marketSegments.createdAt))
      ).slice(0, maxSegments);

      // Build (segment, need) tasks from each segment's Needs Map pains.
      const tasks: Array<{ segmentId: string; segmentName: string; samMid: number | undefined; need: string }> = [];
      for (const seg of segments) {
        const pains = ((seg.needsMap as NeedsMap | null)?.pains ?? []).slice(0, maxNeeds);
        for (const need of pains) {
          tasks.push({ segmentId: seg.id, segmentName: seg.name, samMid: seg.samMid ?? undefined, need });
        }
      }

      if (tasks.length === 0) {
        return res.json({
          cellsCreated: 0,
          segmentsProcessed: 0,
          message: "No segment needs found — generate Needs Maps first, then rebuild the matrix.",
        });
      }

      // Reserve quota only once there's real work; auto-commits on 2xx.
      if (!(await guardManualAction(req, res, "generateOpportunityMatrix"))) return;

      const provider = getMarketModelProvider();
      const perTask = await mapWithConcurrency(tasks, SCORE_CONCURRENCY, async (task) => {
        try {
          const { cells } = await provider.scoreMatrix({
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
            userId: ctx.userId,
            segmentName: task.segmentName,
            samMid: task.samMid,
            need: task.need,
            channels,
          });
          return cells.map((c) => ({
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
            segmentId: task.segmentId,
            needKey: needKeyOf(task.need),
            needLabel: task.need,
            channelKey: c.channelKey,
            revenuePotential: c.revenuePotential,
            executionEffort: c.executionEffort,
            roiScore: computeRoiScore(c.revenuePotential, c.executionEffort),
            scoreRationale: c.rationale ?? null,
            isWhitespace: false,
            source: "ai" as const,
          }));
        } catch (err: any) {
          console.warn(`[opportunity-matrix] scoring failed for "${task.segmentName}"/"${task.need}": ${err?.message ?? err}`);
          return [];
        }
      });

      const rows = perTask.flat();
      if (rows.length === 0) {
        return res.status(422).json({ error: "Scoring produced no cells — check the AI provider configuration." });
      }

      // Whitespace is relative to this batch.
      const flags = computeWhitespaceFlags(rows.map((r) => r.roiScore));
      rows.forEach((r, i) => (r.isWhitespace = flags[i]));

      // Replace cells for the segments we regenerated (leaves other segments intact).
      const segmentIds = Array.from(new Set(rows.map((r) => r.segmentId)));
      await db.transaction(async (tx) => {
        await tx
          .delete(opportunityMatrixCells)
          .where(
            and(
              eq(opportunityMatrixCells.tenantDomain, ctx.tenantDomain),
              inArray(opportunityMatrixCells.segmentId, segmentIds),
            ),
          );
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          await tx.insert(opportunityMatrixCells).values(rows.slice(i, i + BATCH));
        }
      });

      res.json({
        cellsCreated: rows.length,
        segmentsProcessed: segmentIds.length,
        needsProcessed: tasks.length,
        whitespaceCount: flags.filter(Boolean).length,
      });
    } catch (err) {
      sendErr(res, err);
    }
  });

  // ── PATCH cell (user override) ────────────────────────────────────────────────
  app.patch("/api/opportunity-matrix/:id", async (req: Request, res: Response) => {
    if (!(await guardFeature(req, res, "opportunityMatrix"))) return;
    try {
      const ctx = await getRequestContext(req);
      const [cell] = await db
        .select()
        .from(opportunityMatrixCells)
        .where(
          and(
            eq(opportunityMatrixCells.id, req.params.id),
            eq(opportunityMatrixCells.tenantDomain, ctx.tenantDomain),
          ),
        );
      if (!cell) return res.status(404).json({ error: "Cell not found" });

      const b = req.body ?? {};
      const rev = b.revenuePotential !== undefined ? clamp0to100(Number(b.revenuePotential)) : (cell.revenuePotential ?? 0);
      const eff = b.executionEffort !== undefined ? clamp0to100(Number(b.executionEffort)) : (cell.executionEffort ?? 0);
      const updates: Record<string, any> = { updatedAt: new Date(), source: "user" };
      if (b.revenuePotential !== undefined) updates.revenuePotential = rev;
      if (b.executionEffort !== undefined) updates.executionEffort = eff;
      if (b.revenuePotential !== undefined || b.executionEffort !== undefined) {
        updates.roiScore = computeRoiScore(rev, eff);
      }
      if (b.scoreRationale !== undefined) updates.scoreRationale = b.scoreRationale ?? null;

      const [updated] = await db
        .update(opportunityMatrixCells)
        .set(updates)
        .where(eq(opportunityMatrixCells.id, cell.id))
        .returning();
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
