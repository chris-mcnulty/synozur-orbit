/**
 * Opportunity Matrix generation service (Task #544) — shared by the matrix route
 * and the Market Study Wizard (#547) so both produce identical, output-compatible
 * cells. Fans provider.scoreMatrix across top segments × Needs-Map pains ×
 * canonical channels, derives ROI, flags whitespace across the batch, and
 * replaces cells for the regenerated segments transactionally.
 */

import { db } from "../../db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { opportunityMatrixCells, marketSegments } from "@shared/schema";
import { getMarketModelProvider } from "./market-model-provider";
import { computeRoiScore, computeWhitespaceFlags } from "./market-matrix-core";
import { CANONICAL_CHANNELS, needKeyOf, type NeedsMap } from "@shared/market-intelligence";

export const DEFAULT_MAX_SEGMENTS = 6;
export const DEFAULT_MAX_NEEDS = 3;
const SCORE_CONCURRENCY = 4;

/** No segment needs to score — caller should surface "generate Needs Maps first". */
export class NoMatrixWorkError extends Error {
  constructor() {
    super("No segment needs to score — generate Needs Maps first.");
    this.name = "NoMatrixWorkError";
  }
}

export interface MatrixGenContext {
  tenantDomain: string;
  marketId: string;
  userId?: string | null;
}

export interface MatrixGenResult {
  cellsCreated: number;
  segmentsProcessed: number;
  needsProcessed: number;
  whitespaceCount: number;
}

/** Bounded-concurrency map so AI fan-out doesn't trip rate limits. */
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

export async function generateMatrixForMarket(
  ctx: MatrixGenContext,
  opts: { maxSegments?: number; maxNeeds?: number } = {},
): Promise<MatrixGenResult> {
  const maxSegments = clamp(opts.maxSegments, 1, 12, DEFAULT_MAX_SEGMENTS);
  const maxNeeds = clamp(opts.maxNeeds, 1, 6, DEFAULT_MAX_NEEDS);
  const channels = CANONICAL_CHANNELS.map((c) => ({ key: c.key, label: c.label }));

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

  const tasks: Array<{ segmentId: string; segmentName: string; samMid: number | undefined; need: string }> = [];
  for (const seg of segments) {
    const pains = ((seg.needsMap as NeedsMap | null)?.pains ?? []).slice(0, maxNeeds);
    for (const need of pains) {
      tasks.push({ segmentId: seg.id, segmentName: seg.name, samMid: seg.samMid ?? undefined, need });
    }
  }
  if (tasks.length === 0) throw new NoMatrixWorkError();

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
    return { cellsCreated: 0, segmentsProcessed: 0, needsProcessed: tasks.length, whitespaceCount: 0 };
  }

  const flags = computeWhitespaceFlags(rows.map((r) => r.roiScore));
  rows.forEach((r, i) => (r.isWhitespace = flags[i]));

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

  return {
    cellsCreated: rows.length,
    segmentsProcessed: segmentIds.length,
    needsProcessed: tasks.length,
    whitespaceCount: flags.filter(Boolean).length,
  };
}

function clamp(v: number | undefined, lo: number, hi: number, dflt: number): number {
  if (v == null || !Number.isFinite(v)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
