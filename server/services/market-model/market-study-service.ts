/**
 * Market Study Wizard orchestrator (Task #547)
 *
 * Sequences #543 (segment modeling + sizing) and #544 (opportunity matrix) into
 * one background pipeline from a brief/URL, then writes an executive summary.
 * Modeled on full-regeneration-service: startMarketStudy() creates the durable
 * market_studies row and fires the pipeline (not awaited); the client polls the
 * study row for staged progress. Output-compatible — segments and matrix cells
 * land in the same tables hand-built data uses, so downstream flows can't tell a
 * wizard run from manual work.
 *
 * Durability note: progress is persisted to the row at each stage transition, so
 * reads survive restarts. A process killed mid-run leaves the row "running"
 * (same tradeoff as full-regeneration); a stale-sweep is a later enhancement.
 */

import { db } from "../../db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { marketStudies, marketSegments, opportunityMatrixCells, AI_FEATURES } from "@shared/schema";
import {
  type StudyDepth,
  type StudyStage,
  type StudyStageStatus,
  type NeedsMap,
  type Firmographics,
} from "@shared/market-intelligence";
import { getMarketModelProvider } from "./market-model-provider";
import { generateMatrixForMarket, NoMatrixWorkError } from "./opportunity-matrix-service";
import { replaceSources } from "../market-intelligence-sources";
import { completeForFeature } from "../ai-provider";
import { logAiUsage } from "../ai-usage-logger";
import {
  depthConfig,
  initialStages,
  buildExecSummaryPrompt,
  EXEC_SUMMARY_SYSTEM_PROMPT,
} from "./market-study-core";

export interface StudyContext {
  tenantDomain: string;
  marketId: string;
  userId: string;
}
export interface StartStudyOptions {
  inputType: "brief" | "url";
  inputValue?: string;
  depth: StudyDepth;
  parentStudyId?: string;
}

/** Create the study row and kick off the background pipeline. Returns the study id. */
export async function startMarketStudy(ctx: StudyContext, opts: StartStudyOptions): Promise<string> {
  const [row] = await db
    .insert(marketStudies)
    .values({
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      inputType: opts.inputType,
      inputValue: opts.inputValue ?? null,
      depth: opts.depth,
      status: "pending",
      stages: initialStages(),
      parentStudyId: opts.parentStudyId ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: marketStudies.id });

  // Fire-and-forget; the pipeline persists its own progress and terminal state.
  runStudyInBackground(row.id, ctx, opts).catch((err) =>
    console.error(`[market-study] uncaught error for ${row.id}:`, err),
  );
  return row.id;
}

async function runStudyInBackground(studyId: string, ctx: StudyContext, opts: StartStudyOptions): Promise<void> {
  const cfg = depthConfig(opts.depth);
  const stages = initialStages();
  const provider = getMarketModelProvider();

  const setStage = async (key: string, status: StudyStageStatus, detail?: string) => {
    const s = stages.find((x) => x.key === key);
    if (s) {
      s.status = status;
      if (detail !== undefined) s.detail = detail;
    }
    const current = stages.find((x) => x.status === "running")?.label ?? s?.label ?? null;
    await db.update(marketStudies).set({ stages, currentStage: current }).where(eq(marketStudies.id, studyId));
  };

  try {
    await db.update(marketStudies).set({ status: "running", startedAt: new Date() }).where(eq(marketStudies.id, studyId));

    // ── Stage: input — inventory existing segments ──────────────────────────
    await setStage("input", "running");
    const existing = await db
      .select()
      .from(marketSegments)
      .where(
        and(
          eq(marketSegments.tenantDomain, ctx.tenantDomain),
          eq(marketSegments.marketId, ctx.marketId),
          eq(marketSegments.status, "active"),
        ),
      )
      .orderBy(desc(marketSegments.priorityScore), desc(marketSegments.createdAt));
    await setStage("input", "done", existing.length ? `${existing.length} existing segment(s)` : "No existing segments — proposing from brief");

    // ── Stage: segments — reuse or propose ───────────────────────────────────
    await setStage("segments", "running");
    let segmentIds: string[];
    if (existing.length > 0) {
      segmentIds = existing.slice(0, cfg.maxSegments).map((s) => s.id);
      await setStage("segments", "done", `Using ${segmentIds.length} existing segment(s)`);
    } else {
      const brief = (opts.inputValue ?? "").trim();
      if (!brief) throw new Error("A brief or URL is required to model segments in an empty market.");
      const { segments: proposed } = await provider.proposeSegments({ ...ctx, brief, count: cfg.proposeCount });
      if (proposed.length === 0) throw new Error("Could not propose any segments from the brief.");
      const inserted = await db
        .insert(marketSegments)
        .values(
          proposed.map((p) => ({
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId,
            name: p.name,
            description: p.description ?? null,
            firmographics: p.firmographics,
            needsMap: { pains: p.pains, triggers: [], barriers: [], buyingCriteria: [] } as NeedsMap,
            needsMapSource: "ai",
            createdBy: ctx.userId,
          })),
        )
        .returning({ id: marketSegments.id });
      segmentIds = inserted.map((r) => r.id);
      await setStage("segments", "done", `Proposed ${segmentIds.length} segment(s)`);
    }

    // ── Stage: sizing — needs map + TAM/SAM + priority per segment ────────────
    await setStage("sizing", "running");
    let sized = 0;
    for (const segId of segmentIds) {
      const [seg] = await db.select().from(marketSegments).where(eq(marketSegments.id, segId));
      if (!seg) continue;
      try {
        const firmo = (seg.firmographics as Firmographics) ?? {};
        let needsMap = seg.needsMap as NeedsMap;
        if (!needsMap?.pains?.length) {
          const nm = await provider.buildNeedsMap({ ...ctx, segmentName: seg.name, description: seg.description ?? undefined, firmographics: firmo });
          needsMap = nm.needsMap;
          await db.update(marketSegments).set({ needsMap, needsMapSource: "ai" }).where(eq(marketSegments.id, segId));
        }
        const { sizing, sources } = await provider.estimateSizing({ ...ctx, segmentName: seg.name, description: seg.description ?? undefined, firmographics: firmo });
        await db
          .update(marketSegments)
          .set({
            tamLow: sizing.tam.low, tamMid: sizing.tam.mid, tamHigh: sizing.tam.high,
            samLow: sizing.sam.low, samMid: sizing.sam.mid, samHigh: sizing.sam.high,
            sizingCurrency: sizing.tam.currency, sizingMethod: sizing.method,
            sizingConfidence: sizing.confidence, sizingRationale: sizing.rationale, lastEstimatedAt: new Date(),
          })
          .where(eq(marketSegments.id, segId));
        await replaceSources({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, scopeType: "segment_sizing", scopeId: segId, sources });

        const pr = await provider.scoreSegmentPriority({ ...ctx, segmentName: seg.name, samMid: sizing.sam.mid || undefined, needsMap });
        await db.update(marketSegments).set({ priorityScore: pr.score, priorityScoreSource: "ai", priorityRationale: pr.rationale }).where(eq(marketSegments.id, segId));
        sized++;
        await setStage("sizing", "running", `Sized ${sized}/${segmentIds.length}`);
      } catch (e: any) {
        console.warn(`[market-study] sizing failed for segment ${segId}: ${e?.message ?? e}`);
      }
    }
    await setStage("sizing", sized > 0 ? "done" : "failed", `Sized ${sized}/${segmentIds.length}`);

    // ── Stage: matrix ─────────────────────────────────────────────────────────
    await setStage("matrix", "running");
    let matrix = { cellsCreated: 0, whitespaceCount: 0 };
    try {
      const r = await generateMatrixForMarket(ctx, { maxSegments: cfg.maxSegments, maxNeeds: cfg.maxNeeds });
      matrix = { cellsCreated: r.cellsCreated, whitespaceCount: r.whitespaceCount };
      if (r.cellsCreated === 0) await setStage("matrix", "failed", "Scoring produced no cells");
      else await setStage("matrix", "done", `${matrix.cellsCreated} cells · ${matrix.whitespaceCount} whitespace`);
    } catch (e: any) {
      if (e instanceof NoMatrixWorkError) await setStage("matrix", "skipped", "No segment needs to score");
      else {
        console.warn(`[market-study] matrix failed: ${e?.message ?? e}`);
        await setStage("matrix", "failed", e?.message);
      }
    }

    // ── Stage: summary ────────────────────────────────────────────────────────
    await setStage("summary", "running");
    const segs = segmentIds.length
      ? await db.select().from(marketSegments).where(inArray(marketSegments.id, segmentIds))
      : [];
    const segNameById = new Map(segs.map((s) => [s.id, s.name]));
    const topCells = segmentIds.length
      ? await db
          .select()
          .from(opportunityMatrixCells)
          .where(
            and(
              eq(opportunityMatrixCells.tenantDomain, ctx.tenantDomain),
              eq(opportunityMatrixCells.marketId, ctx.marketId),
              inArray(opportunityMatrixCells.segmentId, segmentIds),
            ),
          )
          .orderBy(desc(opportunityMatrixCells.roiScore))
          .limit(10)
      : [];

    let executiveSummary: string | null = null;
    try {
      const prompt = buildExecSummaryPrompt({
        brief: opts.inputValue ?? undefined,
        segments: segs.map((s) => ({ name: s.name, tamMid: s.tamMid, samMid: s.samMid, priorityScore: s.priorityScore })),
        opportunities: topCells.map((c) => ({
          segmentName: segNameById.get(c.segmentId) ?? "Segment",
          need: c.needLabel,
          channel: c.channelKey,
          roiScore: c.roiScore ?? 0,
          isWhitespace: c.isWhitespace,
        })),
      });
      const res = await completeForFeature(AI_FEATURES.MARKET_STUDY, prompt, {
        tenantDomain: ctx.tenantDomain,
        systemPrompt: EXEC_SUMMARY_SYSTEM_PROMPT,
        temperature: 0.4,
        maxTokens: 1500,
      });
      executiveSummary = res.text;
      await logAiUsage(
        { tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, userId: ctx.userId },
        "market_study", res.provider, res.model,
        { input_tokens: res.usage.inputTokens, output_tokens: res.usage.outputTokens },
        res.durationMs, { step: "exec_summary" },
      );
      await setStage("summary", "done");
    } catch (e: any) {
      console.warn(`[market-study] exec summary failed: ${e?.message ?? e}`);
      await setStage("summary", "failed", e?.message);
    }

    // ── Finalize ──────────────────────────────────────────────────────────────
    // Terminal status reflects the critical stages (segments, sizing). A failed
    // matrix/summary stage stays visible in `stages` but doesn't fail the study,
    // since the sized segments are still useful output. There is no "partial"
    // state in the status model, so a critical failure marks the run failed.
    const criticalFailed = stages.some((s) => (s.key === "segments" || s.key === "sizing") && s.status === "failed");
    await db
      .update(marketStudies)
      .set({
        status: criticalFailed ? "failed" : "completed",
        completedAt: new Date(),
        executiveSummary,
        resultRefs: { segmentIds, cellCount: matrix.cellsCreated, whitespaceCount: matrix.whitespaceCount },
        stages,
      })
      .where(eq(marketStudies.id, studyId));
  } catch (err: any) {
    const running = stages.find((s) => s.status === "running");
    if (running) running.status = "failed";
    await db
      .update(marketStudies)
      .set({ status: "failed", error: err?.message ?? String(err), completedAt: new Date(), stages: stages as StudyStage[] })
      .where(eq(marketStudies.id, studyId));
    console.error(`[market-study] ${studyId} failed:`, err?.message ?? err);
  }
}
