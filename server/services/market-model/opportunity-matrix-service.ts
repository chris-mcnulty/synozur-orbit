/**
 * Opportunity Matrix generation service (Task #544) — shared by the matrix route
 * and the Market Study Wizard (#547) so both produce identical, output-compatible
 * cells. Fans provider.scoreMatrix across top segments × Needs-Map pains ×
 * canonical channels, derives ROI, flags whitespace across the batch, and
 * replaces cells for the regenerated segments transactionally.
 */

import { db } from "../../db";
import { and, desc, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { opportunityMatrixCells, marketSegments, competitors, markets, type Competitor } from "@shared/schema";
import { getMarketModelProvider } from "./market-model-provider";
import { computeRoiScore, computeWhitespaceFlagsWithPresence, type CompetitorContext, type PresenceScore } from "./market-matrix-core";
import { replaceSources } from "../market-intelligence-sources";
import { CANONICAL_CHANNELS, needKeyOf, type NeedsMap, type MarketIntelligenceSourceInput } from "@shared/market-intelligence";

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
  opts: { maxSegments?: number; maxNeeds?: number; segmentIds?: string[] } = {},
): Promise<MatrixGenResult> {
  const maxSegments = clamp(opts.maxSegments, 1, 12, DEFAULT_MAX_SEGMENTS);
  const maxNeeds = clamp(opts.maxNeeds, 1, 6, DEFAULT_MAX_NEEDS);
  const channels = CANONICAL_CHANNELS.map((c) => ({ key: c.key, label: c.label }));

  // When explicit segmentIds are given (the study wizard passes its own set),
  // score exactly those. Otherwise fall back to the market's top-N by priority.
  const scopeWhere = and(
    eq(marketSegments.tenantDomain, ctx.tenantDomain),
    eq(marketSegments.marketId, ctx.marketId),
    eq(marketSegments.status, "active"),
  );
  const segments = opts.segmentIds?.length
    ? await db.select().from(marketSegments).where(and(scopeWhere, inArray(marketSegments.id, opts.segmentIds)))
    : (
        await db
          .select()
          .from(marketSegments)
          .where(scopeWhere)
          .orderBy(desc(marketSegments.priorityScore), desc(marketSegments.createdAt))
      ).slice(0, maxSegments);

  const tasks: Array<{ segmentId: string; segmentName: string; samMid: number | undefined; need: string }> = [];
  // Track the current valid needKeys per segment so reconciliation can drop cells
  // for needs that were removed/renamed or trimmed by a lower maxNeeds.
  const currentKeysBySegment = new Map<string, Set<string>>();
  for (const seg of segments) {
    const allPains = (seg.needsMap as NeedsMap | null)?.pains ?? [];
    // Dedupe by generated needKey so two pains that slug to the same key never
    // produce a duplicate (segmentId, needKey, channelKey) that aborts the insert.
    const seenKeys = new Set<string>();
    const uniquePains: string[] = [];
    for (const need of allPains) {
      if (!need?.trim()) continue;
      const key = needKeyOf(need);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      uniquePains.push(need);
      if (uniquePains.length >= maxNeeds) break;
    }
    currentKeysBySegment.set(seg.id, seenKeys);
    for (const need of uniquePains) {
      tasks.push({ segmentId: seg.id, segmentName: seg.name, samMid: seg.samMid ?? undefined, need });
    }
  }
  if (tasks.length === 0) throw new NoMatrixWorkError();

  // Research-area competitor intelligence (Task #749): tenant/market competitors
  // ground the whitespace flag in real competitor presence per cell. No tracked
  // competitors → presence stays null and whitespace falls back to the ROI proxy.
  const competitorRows = await loadCompetitorsForMarket(ctx.tenantDomain, ctx.marketId);
  const competitorContexts = competitorRows.map(toCompetitorContext);
  const competitorByName = new Map(competitorRows.map((c) => [c.name.trim().toLowerCase(), c]));

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
      // All-or-nothing per combo: a partial response (some channels missing) would
      // replace the combo's prior full row set with an incomplete one. Treat it as
      // a failure so preserve-on-failure keeps the existing cells intact.
      if (cells.length < channels.length) {
        console.warn(`[opportunity-matrix] partial scoring for "${task.segmentName}"/"${task.need}" (${cells.length}/${channels.length}) — preserving prior cells`);
        return [];
      }

      // Competitor-presence pass: best-effort — a failure (or no competitors)
      // leaves presence null so the cell keeps the top-ROI proxy behavior.
      let presenceByChannel = new Map<string, PresenceScore>();
      if (competitorContexts.length > 0) {
        try {
          const { scores } = await provider.assessCompetitorPresence({
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
            userId: ctx.userId,
            segmentName: task.segmentName,
            need: task.need,
            channels,
            competitors: competitorContexts,
          });
          presenceByChannel = new Map(scores.map((s) => [s.channelKey, s]));
        } catch (err: any) {
          console.warn(`[opportunity-matrix] presence assessment failed for "${task.segmentName}"/"${task.need}": ${err?.message ?? err}`);
        }
      }

      return cells.map((c) => {
        const presence = presenceByChannel.get(c.channelKey);
        return {
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
          competitorPresence: presence?.competitorPresence ?? null,
          presenceRationale: presence?.rationale ?? null,
          topCompetitors: presence?.topCompetitors ?? [],
          isWhitespace: false,
          source: "ai" as const,
        };
      });
    } catch (err: any) {
      console.warn(`[opportunity-matrix] scoring failed for "${task.segmentName}"/"${task.need}": ${err?.message ?? err}`);
      return [];
    }
  });

  const rows = perTask.flat();
  // Total failure: preserve whatever cells already exist rather than wiping them.
  if (rows.length === 0) {
    return { cellsCreated: 0, segmentsProcessed: 0, needsProcessed: tasks.length, whitespaceCount: 0 };
  }

  const succeededCombos = new Map<string, { segmentId: string; needKey: string }>();
  for (const r of rows) succeededCombos.set(`${r.segmentId}::${r.needKey}`, { segmentId: r.segmentId, needKey: r.needKey });

  await db.transaction(async (tx) => {
    // (1) Drop obsolete cells for each attempted segment — needKeys no longer in
    //     its current set (need removed/renamed, or trimmed by maxNeeds).
    for (const [segmentId, keys] of currentKeysBySegment.entries()) {
      const keyList = Array.from(keys);
      await tx
        .delete(opportunityMatrixCells)
        .where(
          and(
            eq(opportunityMatrixCells.tenantDomain, ctx.tenantDomain),
            eq(opportunityMatrixCells.segmentId, segmentId),
            keyList.length > 0 ? notInArray(opportunityMatrixCells.needKey, keyList) : undefined,
          ),
        );
    }
    // (2) Replace only combos that actually produced rows (preserve-on-failure:
    //     a combo still in currentKeys but with no rows keeps its prior cells).
    for (const c of succeededCombos.values()) {
      await tx
        .delete(opportunityMatrixCells)
        .where(
          and(
            eq(opportunityMatrixCells.tenantDomain, ctx.tenantDomain),
            eq(opportunityMatrixCells.segmentId, c.segmentId),
            eq(opportunityMatrixCells.needKey, c.needKey),
          ),
        );
    }
    const BATCH = 500;
    // topCompetitors feeds provenance, not the cells table — strip it here.
    const dbRows = rows.map(({ topCompetitors: _tc, ...rest }) => rest);
    for (let i = 0; i < dbRows.length; i += BATCH) {
      await tx.insert(opportunityMatrixCells).values(dbRows.slice(i, i + BATCH));
    }
  });

  // Provenance (Task #749): record which competitor intelligence backed each
  // cell's presence score in market_intelligence_sources (scopeType matrix_cell).
  if (competitorRows.length > 0) {
    try {
      await recordPresenceProvenance(ctx, rows, competitorByName);
    } catch (err: any) {
      console.warn(`[opportunity-matrix] provenance recording failed: ${err?.message ?? err}`);
    }
  }

  // Whitespace is market-relative — recompute across all cells, not just this batch.
  const whitespaceCount = await recomputeWhitespace(ctx.tenantDomain, ctx.marketId);

  // Stamp the explicit rebuild timestamp only when every requested segment×need
  // combination succeeded. Partial generation (preserve-on-failure) keeps old
  // cells for failed combos, so their competitor-presence data is still stale —
  // advancing the anchor there would mask real staleness from the UI.
  const isCompleteRebuild = succeededCombos.size === tasks.length;
  if (ctx.marketId && isCompleteRebuild) {
    try {
      await db
        .update(markets)
        .set({ matrixLastRebuiltAt: new Date() })
        .where(eq(markets.id, ctx.marketId));
    } catch (err: any) {
      console.warn(`[opportunity-matrix] failed to stamp matrixLastRebuiltAt: ${err?.message ?? err}`);
    }
  }

  const segmentIds = Array.from(new Set(rows.map((r) => r.segmentId)));
  return {
    cellsCreated: rows.length,
    segmentsProcessed: segmentIds.length,
    needsProcessed: tasks.length,
    whitespaceCount,
  };
}

/** Tenant/market competitors that ground the presence assessment. */
async function loadCompetitorsForMarket(tenantDomain: string, marketId: string): Promise<Competitor[]> {
  const rows = await db
    .select()
    .from(competitors)
    .where(
      and(
        eq(competitors.tenantDomain, tenantDomain),
        eq(competitors.status, "Active"),
        // marketId is nullable on competitors (legacy rows) — include tenant-wide ones.
        or(eq(competitors.marketId, marketId), isNull(competitors.marketId)),
      ),
    )
    .orderBy(desc(competitors.lastFullCrawl), desc(competitors.createdAt));
  return rows.slice(0, MAX_COMPETITORS);
}

const MAX_COMPETITORS = 10;
const SUMMARY_MAX = 400;

/** Compact one competitor's Research intelligence into prompt-sized context. */
function toCompetitorContext(c: Competitor): CompetitorContext {
  const parts: string[] = [];
  if (c.industry) parts.push(c.industry);
  const analysis = c.analysisData as Record<string, unknown> | null;
  for (const key of ["positioning", "summary", "overview", "description"]) {
    const v = analysis?.[key];
    if (typeof v === "string" && v.trim()) {
      parts.push(v.trim());
      break;
    }
  }
  if (parts.length < 2) {
    const crawl = c.crawlData as { pages?: Array<{ content?: string }> } | null;
    const content = crawl?.pages?.[0]?.content;
    if (typeof content === "string" && content.trim()) parts.push(content.trim());
  }
  const summary = parts.join(" — ").replace(/\s+/g, " ").slice(0, SUMMARY_MAX) || undefined;
  return { name: c.name, url: c.url || undefined, summary };
}

/** Row shape produced by generation, including the provenance-only topCompetitors. */
interface GeneratedRow {
  segmentId: string;
  needKey: string;
  channelKey: string;
  competitorPresence: number | null;
  presenceRationale: string | null;
  topCompetitors: string[];
}

/**
 * Write matrix_cell provenance rows: for each freshly inserted cell with a
 * presence assessment, cite the competitors that drove its presence score.
 */
async function recordPresenceProvenance(
  ctx: MatrixGenContext,
  rows: GeneratedRow[],
  competitorByName: Map<string, Competitor>,
): Promise<void> {
  const assessed = rows.filter((r) => r.competitorPresence != null);
  if (assessed.length === 0) return;

  const segmentIds = Array.from(new Set(assessed.map((r) => r.segmentId)));
  const inserted = await db
    .select({
      id: opportunityMatrixCells.id,
      segmentId: opportunityMatrixCells.segmentId,
      needKey: opportunityMatrixCells.needKey,
      channelKey: opportunityMatrixCells.channelKey,
    })
    .from(opportunityMatrixCells)
    .where(
      and(
        eq(opportunityMatrixCells.tenantDomain, ctx.tenantDomain),
        eq(opportunityMatrixCells.marketId, ctx.marketId),
        inArray(opportunityMatrixCells.segmentId, segmentIds),
      ),
    );
  const idByKey = new Map(inserted.map((c) => [`${c.segmentId}::${c.needKey}::${c.channelKey}`, c.id]));

  for (const r of assessed) {
    const cellId = idByKey.get(`${r.segmentId}::${r.needKey}::${r.channelKey}`);
    if (!cellId) continue;
    const cited = r.topCompetitors
      .map((n) => competitorByName.get(n.trim().toLowerCase()))
      .filter((c): c is Competitor => !!c);
    const sources: MarketIntelligenceSourceInput[] = cited.map((c) => ({
      title: c.name,
      url: c.url || undefined,
      publisher: "Orbit competitor intelligence",
      excerpt: r.presenceRationale ?? undefined,
      usedForField: "competitor_presence",
    }));
    // Even with no named competitors, record that a real assessment happened.
    if (sources.length === 0) {
      sources.push({
        title: `Competitor presence assessment (${competitorByName.size} tracked competitor${competitorByName.size === 1 ? "" : "s"})`,
        publisher: "Orbit competitor intelligence",
        excerpt: r.presenceRationale ?? undefined,
        usedForField: "competitor_presence",
      });
    }
    await replaceSources({
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      scopeType: "matrix_cell",
      scopeId: cellId,
      sources,
    });
  }
}

/**
 * Recompute the batch-relative whitespace flags across every cell in a market
 * (used after generation and after a manual cell override changes ROI). A cell
 * is whitespace when it clears the top-ROI bar AND (when assessed) competitor
 * presence is low; unassessed cells keep the top-ROI proxy. Only rows whose
 * flag actually changes are written. Returns the whitespace count.
 */
export async function recomputeWhitespace(tenantDomain: string, marketId: string): Promise<number> {
  const cells = await db
    .select({
      id: opportunityMatrixCells.id,
      roiScore: opportunityMatrixCells.roiScore,
      competitorPresence: opportunityMatrixCells.competitorPresence,
      isWhitespace: opportunityMatrixCells.isWhitespace,
    })
    .from(opportunityMatrixCells)
    .where(and(eq(opportunityMatrixCells.tenantDomain, tenantDomain), eq(opportunityMatrixCells.marketId, marketId)));
  if (cells.length === 0) return 0;

  const flags = computeWhitespaceFlagsWithPresence(
    cells.map((c) => ({ roiScore: c.roiScore ?? 0, competitorPresence: c.competitorPresence ?? null })),
  );
  const changed = cells
    .map((c, i) => ({ id: c.id, flag: flags[i] }))
    .filter((c, i) => c.flag !== cells[i].isWhitespace);

  if (changed.length > 0) {
    await db.transaction(async (tx) => {
      for (const c of changed) {
        await tx.update(opportunityMatrixCells).set({ isWhitespace: c.flag }).where(eq(opportunityMatrixCells.id, c.id));
      }
    });
  }
  return flags.filter(Boolean).length;
}

function clamp(v: number | undefined, lo: number, hi: number, dflt: number): number {
  if (v == null || !Number.isFinite(v)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
