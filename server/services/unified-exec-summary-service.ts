/**
 * Unified Executive Summary ("Briefing Room") — one cross-area, tenant-level
 * AI-synthesized report spanning Research, Strategy, Marketing, and Sales.
 *
 * Architecture: five deterministic COLLECTORS each assemble compact structured
 * facts from their area (degrading gracefully to "no signal" when an area has
 * no data), then ONE synthesis call turns the combined fact sheet into the
 * five-section narrative. Runs are persisted in executive_summaries so the
 * report can be regenerated on demand and compared period-over-period.
 */

import { db } from "../db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql as dsql } from "drizzle-orm";
import {
  AI_FEATURES,
  unifiedExecSummaries,
  unifiedExecSummarySettings,
  intelligenceBriefings,
  marketSegments,
  opportunityMatrixCells,
  marketStudies,
  longFormRecommendations,
  contentBriefs,
  generatedPosts,
  generatedEmails,
  outreachCampaigns,
  prospects,
  type UnifiedExecSummaryData,
  type UnifiedExecSummarySection,
} from "@shared/schema";
import { completeForFeature } from "./ai-provider";
import { logAiUsage } from "./ai-usage-logger";

const DAY_MS = 24 * 60 * 60 * 1000;

type Facts = Record<string, unknown>;

// ─── Collectors ───────────────────────────────────────────────────────────────
// Each collector is defensive: any failure or empty area yields null, which the
// synthesis prompt reports as "no signal this period" instead of failing the run.

async function collectMarketPosition(tenantDomain: string): Promise<Facts | null> {
  try {
    const [briefing] = await db
      .select()
      .from(intelligenceBriefings)
      .where(eq(intelligenceBriefings.tenantDomain, tenantDomain))
      .orderBy(desc(intelligenceBriefings.createdAt))
      .limit(1);
    if (!briefing) return null;
    const data = (briefing.briefingData ?? {}) as any;
    return {
      latestBriefingDate: briefing.createdAt,
      periodEnd: briefing.periodEnd,
      signalCount: briefing.signalCount,
      competitorCount: briefing.competitorCount,
      executiveSummary: typeof data.executiveSummary === "string" ? data.executiveSummary.slice(0, 2000) : undefined,
      themes: Array.isArray(data.themes) ? data.themes.slice(0, 6) : undefined,
      narrativeExcerpt: typeof data.narrative === "string" ? data.narrative.slice(0, 1500) : undefined,
    };
  } catch (e) {
    console.warn("[exec-summary] market position collector failed:", e);
    return null;
  }
}

async function collectWhereToPlay(tenantDomain: string): Promise<Facts | null> {
  try {
    const segments = await db
      .select({
        id: marketSegments.id,
        name: marketSegments.name,
        samMid: marketSegments.samMid,
        priorityScore: marketSegments.priorityScore,
        priorityRationale: marketSegments.priorityRationale,
      })
      .from(marketSegments)
      .where(and(eq(marketSegments.tenantDomain, tenantDomain), isNull(marketSegments.marketId), eq(marketSegments.status, "active")))
      .orderBy(desc(marketSegments.priorityScore))
      .limit(6);

    const topCells = await db
      .select({
        needLabel: opportunityMatrixCells.needLabel,
        channelKey: opportunityMatrixCells.channelKey,
        roiScore: opportunityMatrixCells.roiScore,
        isWhitespace: opportunityMatrixCells.isWhitespace,
        segmentId: opportunityMatrixCells.segmentId,
      })
      .from(opportunityMatrixCells)
      .where(and(eq(opportunityMatrixCells.tenantDomain, tenantDomain), isNull(opportunityMatrixCells.marketId), isNotNull(opportunityMatrixCells.roiScore)))
      .orderBy(desc(opportunityMatrixCells.roiScore))
      .limit(8);

    const [study] = await db
      .select({
        completedAt: marketStudies.completedAt,
        executiveSummary: marketStudies.executiveSummary,
      })
      .from(marketStudies)
      .where(and(eq(marketStudies.tenantDomain, tenantDomain), isNull(marketStudies.marketId), eq(marketStudies.status, "completed")))
      .orderBy(desc(marketStudies.createdAt))
      .limit(1);

    const [gtm] = await db
      .select({
        lastGeneratedAt: longFormRecommendations.lastGeneratedAt,
        content: longFormRecommendations.content,
      })
      .from(longFormRecommendations)
      .where(and(
        eq(longFormRecommendations.tenantDomain, tenantDomain),
        eq(longFormRecommendations.type, "gtm_plan"),
        eq(longFormRecommendations.status, "generated"),
      ))
      .orderBy(desc(longFormRecommendations.lastGeneratedAt))
      .limit(1);

    if (segments.length === 0 && topCells.length === 0 && !study && !gtm) return null;
    const segNames = new Map(segments.map((s) => [s.id, s.name]));
    return {
      topSegments: segments.map((s) => ({
        name: s.name,
        samMid: s.samMid,
        priorityScore: s.priorityScore,
        rationale: s.priorityRationale?.slice(0, 300),
      })),
      topOpportunities: topCells.map((c) => ({
        segment: segNames.get(c.segmentId) ?? undefined,
        need: c.needLabel,
        channel: c.channelKey,
        roiScore: c.roiScore,
        whitespace: c.isWhitespace,
      })),
      latestStudySummary: study?.executiveSummary?.slice(0, 1500),
      latestStudyCompletedAt: study?.completedAt,
      gtmPlanGeneratedAt: gtm?.lastGeneratedAt,
      gtmPlanExcerpt: gtm?.content?.slice(0, 1200),
    };
  } catch (e) {
    console.warn("[exec-summary] where-to-play collector failed:", e);
    return null;
  }
}

async function collectMarketingExecution(tenantDomain: string): Promise<Facts | null> {
  try {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [posts] = await db
      .select({ count: dsql<number>`count(*)::int` })
      .from(generatedPosts)
      .where(and(eq(generatedPosts.tenantDomain, tenantDomain), gte(generatedPosts.createdAt, since)));
    const [emailsSent] = await db
      .select({ count: dsql<number>`count(*)::int` })
      .from(generatedEmails)
      .where(and(eq(generatedEmails.tenantDomain, tenantDomain), isNotNull(generatedEmails.sentAt), gte(generatedEmails.sentAt, since)));
    const [briefs] = await db
      .select({ count: dsql<number>`count(*)::int` })
      .from(contentBriefs)
      .where(and(eq(contentBriefs.tenantDomain, tenantDomain), gte(contentBriefs.createdAt, since)));
    const briefsByStatus = await db
      .select({ status: contentBriefs.status, count: dsql<number>`count(*)::int` })
      .from(contentBriefs)
      .where(and(eq(contentBriefs.tenantDomain, tenantDomain), gte(contentBriefs.createdAt, since)))
      .groupBy(contentBriefs.status);

    const total = (posts?.count ?? 0) + (emailsSent?.count ?? 0) + (briefs?.count ?? 0);
    if (total === 0) return null;
    return {
      windowDays: 30,
      socialPostsCreated: posts?.count ?? 0,
      emailsSent: emailsSent?.count ?? 0,
      contentBriefsCreated: briefs?.count ?? 0,
      contentBriefsByStatus: Object.fromEntries(briefsByStatus.map((r) => [r.status, r.count])),
    };
  } catch (e) {
    console.warn("[exec-summary] marketing execution collector failed:", e);
    return null;
  }
}

async function collectSalesDevelopment(tenantDomain: string): Promise<Facts | null> {
  try {
    const campaigns = await db
      .select({
        id: outreachCampaigns.id,
        name: outreachCampaigns.name,
        goalType: outreachCampaigns.goalType,
        status: outreachCampaigns.status,
      })
      .from(outreachCampaigns)
      .where(and(eq(outreachCampaigns.tenantDomain, tenantDomain), inArray(outreachCampaigns.status, ["active", "running", "draft"])))
      .orderBy(desc(outreachCampaigns.updatedAt))
      .limit(6);
    if (campaigns.length === 0) return null;

    const prospectRows = await db
      .select({ status: prospects.status, count: dsql<number>`count(*)::int` })
      .from(prospects)
      .where(eq(prospects.tenantDomain, tenantDomain))
      .groupBy(prospects.status);
    const [avgScore] = await db
      .select({ avg: dsql<number>`round(avg(${prospects.icpScore}))::int` })
      .from(prospects)
      .where(and(eq(prospects.tenantDomain, tenantDomain), isNotNull(prospects.icpScore)));

    return {
      campaigns: campaigns.map((c) => ({ name: c.name, goalType: c.goalType, status: c.status })),
      prospectsByStatus: Object.fromEntries(prospectRows.map((r) => [r.status, r.count])),
      avgIcpScore: avgScore?.avg ?? null,
    };
  } catch (e) {
    console.warn("[exec-summary] sales development collector failed:", e);
    return null;
  }
}

async function collectPreviousSummary(tenantDomain: string): Promise<Facts | null> {
  try {
    const [prev] = await db
      .select({ createdAt: unifiedExecSummaries.createdAt, summaryData: unifiedExecSummaries.summaryData })
      .from(unifiedExecSummaries)
      .where(and(eq(unifiedExecSummaries.tenantDomain, tenantDomain), eq(unifiedExecSummaries.status, "completed")))
      .orderBy(desc(unifiedExecSummaries.createdAt))
      .limit(1);
    if (!prev?.summaryData) return null;
    // Only feed back the headline — not priorActions highlights. Feeding back
    // specific segment/persona names from a previous (potentially stale) run
    // causes the AI to repeat them in the new synthesis even when the current
    // fact sheet no longer contains them.
    return {
      generatedAt: prev.createdAt,
      headline: prev.summaryData.headline,
    };
  } catch {
    return null;
  }
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the chief-of-staff analyst for a go-to-market intelligence platform. You write crisp, factual executive briefings for a company's leadership. Never invent numbers or facts not present in the fact sheet. Where an area has no data, say so in one short sentence and move on. Markdown allowed inside section bodies (short paragraphs and bullets; no headings).`;

const SECTION_SPECS: Array<{ key: string; title: string }> = [
  { key: "market_position", title: "Market & Competitive Position" },
  { key: "where_to_play", title: "Where to Play" },
  { key: "marketing_execution", title: "Marketing Execution" },
  { key: "sales_development", title: "Sales Development" },
  { key: "executive_actions", title: "Recommended Executive Actions" },
];

/**
 * Bound tenant-controlled fact content before it reaches the model: strings
 * capped at 500 chars, arrays at 10 items, recursion depth at 6. A final
 * whole-prompt budget in buildSynthesisPrompt backstops anything left.
 */
export function deepClip(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (typeof value === "string") return value.length > 500 ? value.slice(0, 500) + "…" : value;
  if (Array.isArray(value)) return value.slice(0, 10).map((v) => deepClip(v, depth + 1));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = deepClip(v, depth + 1);
    }
    return out;
  }
  return value;
}

const FACT_SHEET_CHAR_BUDGET = 24_000;

function buildSynthesisPrompt(facts: Record<string, Facts | null>): string {
  return [
    "Write a unified executive summary from this cross-area fact sheet (JSON; null = no signal in that area this period):",
    "",
    JSON.stringify(facts, null, 1).slice(0, FACT_SHEET_CHAR_BUDGET),
    "",
    "Produce exactly these five sections, in order:",
    ...SECTION_SPECS.map((s, i) => `${i + 1}. ${s.key} — "${s.title}"`),
    "",
    "Rules:",
    "- executive_actions: 3-5 prioritized cross-area actions, each with a one-sentence rationale, as the highlights array (body summarizes the theme).",
    "- If previousSummary is present, briefly note what changed since it where relevant. Do NOT repeat specific segment names, persona names, or ROI scores from previousSummary unless they also appear in the current whereToPlay facts.",
    "- Each section: 2-4 highlights (short bullet strings) plus a body of 1-3 short paragraphs.",
    "- headline: one sentence capturing the company's current GTM posture.",
    "",
    'Return ONLY this JSON: { "headline": "...", "sections": [ { "key": "...", "title": "...", "highlights": ["..."], "body": "..." } ] }',
  ].join("\n");
}

function parseSynthesis(text: string): { headline: string; sections: UnifiedExecSummarySection[] } {
  const cleaned = (text || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  let obj: any = null;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { obj = JSON.parse(m[0]); } catch { /* fall through */ }
    }
  }
  if (!obj || !Array.isArray(obj.sections)) throw new Error("Synthesis returned unparseable output");
  const byKey = new Map<string, any>(obj.sections.map((s: any) => [String(s?.key), s]));
  const sections: UnifiedExecSummarySection[] = SECTION_SPECS.map((spec) => {
    const s = byKey.get(spec.key) ?? {};
    return {
      key: spec.key,
      title: spec.title,
      body: typeof s.body === "string" ? s.body : "No signal this period.",
      highlights: Array.isArray(s.highlights) ? s.highlights.filter((h: any) => typeof h === "string").slice(0, 6) : [],
    };
  });
  return { headline: typeof obj.headline === "string" ? obj.headline : "", sections };
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * Generate a unified executive summary for a tenant. Creates the run row up
 * front (status=generating) and finalizes it completed/failed. Returns the id.
 */
type RunOpts = {
  tenantDomain: string;
  userId?: string;
  trigger?: "manual" | "scheduled";
};

/**
 * Atomic one-in-flight claim per tenant: an advisory xact lock serializes
 * concurrent claimers (manual clicks AND the scheduler), and the in-flight
 * check + insert happen inside the same transaction. Runs stuck in
 * "generating" for >10 minutes are treated as abandoned. Returns the new run
 * id, or null when another run is already in flight.
 */
async function claimRun(opts: RunOpts): Promise<string | null> {
  const run = await db.transaction(async (tx) => {
    await tx.execute(dsql`SELECT pg_advisory_xact_lock(hashtext(${"unified_exec_summary:" + opts.tenantDomain}))`);
    const inflight = await tx
      .select({ id: unifiedExecSummaries.id })
      .from(unifiedExecSummaries)
      .where(and(
        eq(unifiedExecSummaries.tenantDomain, opts.tenantDomain),
        eq(unifiedExecSummaries.status, "generating"),
        gte(unifiedExecSummaries.createdAt, new Date(Date.now() - 10 * 60 * 1000)),
      ))
      .limit(1);
    if (inflight.length > 0) return null;
    const [row] = await tx
      .insert(unifiedExecSummaries)
      .values({
        tenantDomain: opts.tenantDomain,
        status: "generating",
        trigger: opts.trigger ?? "manual",
        generatedBy: opts.userId ?? null,
      })
      .returning({ id: unifiedExecSummaries.id });
    return row;
  });
  return run?.id ?? null;
}

/** Execute a claimed run: collect facts, synthesize, finalize the run row. */
async function runClaimedSummary(runId: string, opts: RunOpts): Promise<string> {
  try {
    // previousSummary is collected BEFORE this run completes, so it naturally
    // points at the last completed report.
    const [marketPosition, whereToPlay, marketingExecution, salesDevelopment, previousSummary] =
      await Promise.all([
        collectMarketPosition(opts.tenantDomain),
        collectWhereToPlay(opts.tenantDomain),
        collectMarketingExecution(opts.tenantDomain),
        collectSalesDevelopment(opts.tenantDomain),
        collectPreviousSummary(opts.tenantDomain),
      ]);
    const facts = deepClip({ marketPosition, whereToPlay, marketingExecution, salesDevelopment, previousSummary }) as Record<string, Facts | null>;

    const res = await completeForFeature(AI_FEATURES.EXECUTIVE_SUMMARY, buildSynthesisPrompt(facts), {
      tenantDomain: opts.tenantDomain,
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.4,
      maxTokens: 4000,
    });
    await logAiUsage(
      { tenantDomain: opts.tenantDomain, userId: opts.userId },
      "executive_summary",
      res.provider,
      res.model,
      { input_tokens: res.usage.inputTokens, output_tokens: res.usage.outputTokens },
      res.durationMs,
      { trigger: opts.trigger ?? "manual" },
    );

    const { headline, sections } = parseSynthesis(res.text);
    const summaryData: UnifiedExecSummaryData = { headline, sections, facts };
    await db
      .update(unifiedExecSummaries)
      .set({ status: "completed", summaryData, completedAt: new Date() })
      .where(eq(unifiedExecSummaries.id, runId));
    return runId;
  } catch (e: any) {
    const message = e?.message ?? String(e);
    console.error(`[exec-summary] generation failed for ${opts.tenantDomain}:`, message);
    await db
      .update(unifiedExecSummaries)
      .set({ status: "failed", error: message.slice(0, 2000), completedAt: new Date() })
      .where(eq(unifiedExecSummaries.id, runId));
    throw e;
  }
}

/**
 * Claim + generate synchronously (used by the scheduler). Returns the run id,
 * or null when another run was already in flight.
 */
export async function generateExecutiveSummary(opts: RunOpts): Promise<string | null> {
  const claimed = await claimRun(opts);
  if (!claimed) return null;
  return runClaimedSummary(claimed, opts);
}

/**
 * Claim a run atomically and continue generation in the background.
 * Returns the run id, or null when another run is already in flight.
 */
export async function startExecutiveSummary(opts: {
  tenantDomain: string;
  userId?: string;
  trigger?: "manual" | "scheduled";
}): Promise<string | null> {
  const claimed = await claimRun(opts);
  if (!claimed) return null;
  runClaimedSummary(claimed, opts).catch(() => {
    /* failure is persisted on the run row */
  });
  return claimed;
}

/** Tenants whose auto-run is due (enabled + last run older than ~7 days). */
export async function getDueAutoSummaryTenants(): Promise<string[]> {
  const cutoff = new Date(Date.now() - 7 * DAY_MS + 30 * 60 * 1000); // 30min slack on hourly ticks
  const rows = await db
    .select({ tenantDomain: unifiedExecSummarySettings.tenantDomain, lastAutoRunAt: unifiedExecSummarySettings.lastAutoRunAt })
    .from(unifiedExecSummarySettings)
    .where(eq(unifiedExecSummarySettings.autoEnabled, true));
  return rows
    .filter((r) => !r.lastAutoRunAt || r.lastAutoRunAt < cutoff)
    .map((r) => r.tenantDomain);
}

export async function stampAutoRun(tenantDomain: string): Promise<void> {
  await db
    .insert(unifiedExecSummarySettings)
    .values({ tenantDomain, autoEnabled: true, lastAutoRunAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: unifiedExecSummarySettings.tenantDomain,
      set: { lastAutoRunAt: new Date(), updatedAt: new Date() },
    });
}
