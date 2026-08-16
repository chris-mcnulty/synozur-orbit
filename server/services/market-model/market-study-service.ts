/**
 * Market Study Wizard orchestrator (Task #547)
 *
 * Sequences #543 (segment modeling + sizing) and #544 (opportunity matrix) into
 * one background pipeline from a brief/URL, then writes an executive summary.
 * startMarketStudy() creates the durable market_studies row and enqueues the
 * pipeline on the shared job queue (global concurrency limit + timeout); the
 * client polls the study row for staged progress. Output-compatible — segments
 * and matrix cells land in the same tables hand-built data uses, so downstream
 * flows can't tell a wizard run from manual work.
 *
 * Durability: progress is persisted to the row at each stage transition; the
 * pipeline honors the queue's abort signal at stage boundaries; and any row left
 * "running" by a restart or hang is reconciled by sweepStaleStudies (startup +
 * 15-min interval, wired in scheduled-jobs.ts).
 */

import { db } from "../../db";
import { crawlCompetitorWebsite } from "../web-crawler";
import { validateUrlWithDnsCheck } from "../../utils/url-validator";
import { and, desc, eq, inArray } from "drizzle-orm";
import { marketStudies, marketSegments, opportunityMatrixCells, AI_FEATURES } from "@shared/schema";
import { enqueue } from "../job-queue";
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
import { storage } from "../../storage";
import {
  depthConfig,
  initialStages,
  buildExecSummaryPrompt,
  EXEC_SUMMARY_SYSTEM_PROMPT,
  COMPETITOR_DISCOVERY_SYSTEM_PROMPT,
  buildCompetitorDiscoveryPrompt,
  parseCompetitorSuggestions,
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
  /** Optional ACV (whole USD). Enables Census bottom-up + triangulation; without
   *  it, sizing is top-down (web-search) only. */
  acv?: number;
}

// A dominate-depth run does N segments × sizing (each a web search) sequentially
// plus the matrix fan-out, so give it generous headroom before the queue aborts.
const STUDY_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Discover competitors from the study's brief/URL, create them in the market, and
 * return the count of newly-persisted records. Non-fatal: caller catches all errors.
 *
 * Exported for unit testing only — not part of the public API.
 */
export async function discoverCompetitorsForStudy(opts: {
  tenantDomain: string;
  marketId: string;
  userId: string;
  inputType: "url" | "brief";
  inputValue: string;
  count: number;
}): Promise<number> {
  if (!opts.inputValue.trim()) return 0;

  // When the input is a URL, crawl it first so the AI has real page content
  // (titles, offering text, descriptions) rather than just a bare URL string.
  // This mirrors the auto-build pipeline (auto-build-service.ts ~L220-256).
  // Crawl failures are non-fatal — we fall back to URL-only discovery.
  let websiteContent: string | undefined;
  if (opts.inputType === "url") {
    try {
      // SSRF guard: fail-closed DNS validation before crawling. Rejects direct
      // private addresses, unresolvable hosts, and hosts that resolve to private
      // IPs. The HTTP fallback in the crawler also re-validates each redirect hop
      // with the same check. A residual TOCTOU window exists (DNS may change
      // between our check and Node's internal TCP resolution), documented in
      // followRedirectsSafe in web-crawler.ts.
      const urlCheck = await validateUrlWithDnsCheck(opts.inputValue);
      if (!urlCheck.isValid) {
        console.warn(`[market-study] URL crawl skipped — SSRF guard rejected ${opts.inputValue}: ${urlCheck.error}`);
      } else {
        const crawlResult = await crawlCompetitorWebsite(opts.inputValue);
        if (crawlResult) {
          const pages = Array.isArray(crawlResult.pages) ? crawlResult.pages : [];
          if (pages.length > 0) {
            websiteContent = pages
              .map((p: any) => `Page: ${p.title || p.url}\n${(p.content || p.text || "").substring(0, 500)}`)
              .join("\n---\n")
              .substring(0, 3000);
          }
        }
      }
    } catch (crawlErr: any) {
      console.warn(`[market-study] URL crawl for discovery failed (non-critical): ${crawlErr?.message ?? crawlErr}`);
    }
  }

  const prompt = buildCompetitorDiscoveryPrompt({
    inputType: opts.inputType,
    inputValue: opts.inputValue,
    count: opts.count,
    websiteContent,
  });
  const res = await completeForFeature(AI_FEATURES.MARKET_STUDY, prompt, {
    tenantDomain: opts.tenantDomain,
    systemPrompt: COMPETITOR_DISCOVERY_SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: 1500,
  });
  await logAiUsage(
    { tenantDomain: opts.tenantDomain, marketId: opts.marketId, userId: opts.userId },
    "market_study", res.provider, res.model,
    { input_tokens: res.usage.inputTokens, output_tokens: res.usage.outputTokens },
    res.durationMs, { step: "discover_competitors" },
  );

  const suggestions = parseCompetitorSuggestions(res.text);
  let created = 0;
  for (const s of suggestions) {
    try {
      // Normalise URL scheme so storage.createCompetitor doesn't reject it.
      const url = /^https?:\/\//i.test(s.url) ? s.url : `https://${s.url}`;
      const org = await storage.findOrCreateOrganization(url, s.name);
      await storage.incrementOrgRefCount(org.id);
      await storage.createCompetitor({
        name: s.name,
        url,
        tenantDomain: opts.tenantDomain,
        marketId: opts.marketId,
        organizationId: org.id,
        userId: opts.userId,
      });
      created++;
    } catch {
      // Duplicate URL or validation failure — skip silently.
    }
  }
  return created;
}

/**
 * Create the study row and enqueue the pipeline on the shared job queue. Returns
 * the study id immediately; the client polls the row for progress. The queue
 * provides global concurrency limiting/backpressure and a timeout; maxRetries=0
 * because the pipeline is not idempotent (a retry would re-run AI/Census and
 * re-insert rows). Restart/hang orphans are reconciled by sweepStaleStudies.
 */
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

  // Not awaited — the queue runs it when a slot frees up; the pipeline persists
  // its own progress and terminal state. The .catch handles queue-level failures
  // (timeout/abort/unexpected) that bypass the pipeline's own try/catch.
  enqueue(
    "analysis",
    `market-study:${row.id}`,
    (signal?: AbortSignal) => runStudyInBackground(row.id, ctx, opts, signal),
    {
      timeoutMs: STUDY_TIMEOUT_MS,
      maxRetries: 0,
      ctx: { tenantDomain: ctx.tenantDomain, targetId: row.id, targetName: (opts.inputValue ?? "Market study").slice(0, 120) },
    },
  ).catch((err) => {
    console.error(`[market-study] queue failure for ${row.id}:`, err?.message ?? err);
    void failStudyIfRunning(row.id, err?.message ?? "Study did not complete (timed out or was interrupted).");
  });

  return row.id;
}

/** Mark a study failed only if it is still pending/running (idempotent). */
export async function failStudyIfRunning(studyId: string, message: string): Promise<void> {
  try {
    await db
      .update(marketStudies)
      .set({ status: "failed", error: message, completedAt: new Date() })
      .where(and(eq(marketStudies.id, studyId), inArray(marketStudies.status, ["pending", "running"])));
  } catch (err: any) {
    console.error(`[market-study] failStudyIfRunning(${studyId}) error:`, err?.message ?? err);
  }
}

/**
 * Reconcile studies left "running" by a server restart or a hung run (the queue
 * and pipeline progress are in-memory). Marks any pending/running study older
 * than maxAgeMs as failed. Returns the number swept. Called on startup and on an
 * interval by the scheduler.
 */
export async function sweepStaleStudies(
  runningMaxMs = 30 * 60 * 1000,
  pendingMaxMs = 60 * 60 * 1000,
): Promise<number> {
  const now = Date.now();
  const rows = await db
    .select({ id: marketStudies.id, status: marketStudies.status, createdAt: marketStudies.createdAt, startedAt: marketStudies.startedAt })
    .from(marketStudies)
    .where(inArray(marketStudies.status, ["pending", "running"]));

  // Running: measure from startedAt (past the timeout ⇒ hung/orphaned).
  // Pending: measure from createdAt with a longer window so a genuinely queued
  // study behind a backlog isn't failed early. The guarded pending→running
  // transition in runStudyInBackground makes this safe — a swept row that later
  // dequeues sees status != pending and aborts instead of resurrecting.
  const toFail = rows.filter((s) => {
    if (s.status === "running") return new Date(s.startedAt ?? s.createdAt).getTime() < now - runningMaxMs;
    return new Date(s.createdAt).getTime() < now - pendingMaxMs;
  });
  for (const s of toFail) {
    await failStudyIfRunning(s.id, "Interrupted or unrecorded — swept as stale (server restart or hang).");
  }
  if (toFail.length > 0) console.log(`[market-study] swept ${toFail.length} stale study(ies)`);
  return toFail.length;
}

async function runStudyInBackground(studyId: string, ctx: StudyContext, opts: StartStudyOptions, signal?: AbortSignal): Promise<void> {
  const cfg = depthConfig(opts.depth);
  const stages = initialStages();
  const provider = getMarketModelProvider();

  // Honor the queue's timeout/abort at stage boundaries so a hung run stops and
  // is marked failed rather than orphaned.
  const abortIfCancelled = () => {
    if (signal?.aborted) throw new Error("Study cancelled — timed out or server shutting down.");
  };

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
    // Guarded transition: only start if still pending. If a restart/hang sweep
    // already failed this row, the (possibly still-enqueued) callback must not
    // resurrect it — abort instead of overwriting a terminal status.
    const started = await db
      .update(marketStudies)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(marketStudies.id, studyId), eq(marketStudies.status, "pending")))
      .returning({ id: marketStudies.id });
    if (started.length === 0) {
      console.warn(`[market-study] ${studyId} is no longer pending (swept or cancelled) — not running`);
      return;
    }

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

    // ── Stage: discovery — discover and create competitor records ─────────────
    abortIfCancelled();
    await setStage("discovery", "running");
    try {
      const discovered = await discoverCompetitorsForStudy({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        userId: ctx.userId,
        inputType: opts.inputType,
        inputValue: opts.inputValue ?? "",
        count: cfg.proposeCount, // reuse the segment proposal count as competitor count
      });
      await setStage("discovery", "done", `${discovered} competitor(s) added`);
    } catch (e: any) {
      console.warn(`[market-study] competitor discovery failed (non-critical): ${e?.message ?? e}`);
      await setStage("discovery", "skipped", "Could not discover competitors");
    }

    // ── Stage: segments — reuse or propose ───────────────────────────────────
    abortIfCancelled();
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
    const sizedIds: string[] = []; // segments that actually completed sizing
    for (const segId of segmentIds) {
      abortIfCancelled();
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
        const { sizing, sources } = await provider.estimateSizing({ ...ctx, segmentName: seg.name, description: seg.description ?? undefined, firmographics: firmo, acv: opts.acv });
        await db.transaction(async (tx) => {
          await tx
            .update(marketSegments)
            .set({
              tamLow: sizing.tam.low, tamMid: sizing.tam.mid, tamHigh: sizing.tam.high,
              samLow: sizing.sam.low, samMid: sizing.sam.mid, samHigh: sizing.sam.high,
              sizingCurrency: sizing.tam.currency, sizingMethod: sizing.method,
              sizingConfidence: sizing.confidence, sizingRationale: sizing.rationale, lastEstimatedAt: new Date(),
            })
            .where(eq(marketSegments.id, segId));
          await replaceSources({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId, scopeType: "segment_sizing", scopeId: segId, sources }, tx);
        });

        sized++;
        sizedIds.push(segId);
        await setStage("sizing", "running", `Sized ${sized}/${segmentIds.length}`);
      } catch (e: any) {
        console.warn(`[market-study] sizing failed for segment ${segId}: ${e?.message ?? e}`);
      }
    }

    // Priority is scored comparatively across ALL sized segments in one call:
    // per-segment isolated scoring clusters at 7-8 and carries no ordering.
    if (sizedIds.length > 0) {
      try {
        const sizedSegs = await db
          .select()
          .from(marketSegments)
          .where(and(
            inArray(marketSegments.id, sizedIds),
            eq(marketSegments.tenantDomain, ctx.tenantDomain),
            eq(marketSegments.marketId, ctx.marketId),
          ));
        const scores = await provider.scoreSegmentPriorities({
          ...ctx,
          segments: sizedSegs.map((s) => ({
            id: s.id,
            name: s.name,
            samMid: s.samMid ?? undefined,
            needsMap: s.needsMap as NeedsMap,
            firmographics: (s.firmographics as Firmographics) ?? undefined,
          })),
        });
        for (const [segId, pr] of scores) {
          await db
            .update(marketSegments)
            .set({ priorityScore: pr.score, priorityScoreSource: "ai", priorityRationale: pr.rationale })
            .where(and(eq(marketSegments.id, segId), eq(marketSegments.tenantDomain, ctx.tenantDomain)));
        }
      } catch (e: any) {
        console.warn(`[market-study] batch priority ranking failed: ${e?.message ?? e}`);
      }
    }
    await setStage("sizing", sized > 0 ? "done" : "failed", `Sized ${sized}/${segmentIds.length}`);

    // ── Stage: matrix — over exactly the segments this study sized ────────────
    abortIfCancelled();
    await setStage("matrix", "running");
    let matrix = { cellsCreated: 0, whitespaceCount: 0 };
    if (sizedIds.length === 0) {
      await setStage("matrix", "skipped", "No sized segments to score");
    } else {
      try {
        // Pass the study's own sized segments so a priority reshuffle during
        // sizing can't swap in unrelated top-N segments.
        const r = await generateMatrixForMarket(ctx, { maxNeeds: cfg.maxNeeds, segmentIds: sizedIds });
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
    }

    // ── Stage: summary ────────────────────────────────────────────────────────
    abortIfCancelled();
    await setStage("summary", "running");
    const segs = sizedIds.length
      ? await db.select().from(marketSegments).where(inArray(marketSegments.id, sizedIds))
      : [];
    const segNameById = new Map(segs.map((s) => [s.id, s.name]));
    const topCells = sizedIds.length
      ? await db
          .select()
          .from(opportunityMatrixCells)
          .where(
            and(
              eq(opportunityMatrixCells.tenantDomain, ctx.tenantDomain),
              eq(opportunityMatrixCells.marketId, ctx.marketId),
              inArray(opportunityMatrixCells.segmentId, sizedIds),
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
    // Final abort gate: if the queue timed out during the summary call, don't
    // write "completed" over a run the queue already failed.
    abortIfCancelled();
    await db
      .update(marketStudies)
      .set({
        status: criticalFailed ? "failed" : "completed",
        completedAt: new Date(),
        executiveSummary,
        // Only segments this study actually sized — never the unsized ones.
        resultRefs: { segmentIds: sizedIds, cellCount: matrix.cellsCreated, whitespaceCount: matrix.whitespaceCount },
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
