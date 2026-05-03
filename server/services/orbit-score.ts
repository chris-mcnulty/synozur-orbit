/**
 * Orbit Score (0-100) — weekly composite over five components:
 *
 *   1. Share of Voice (sov)              — competitor SoV from seo_metrics
 *   2. SEO Visibility (seoVisibility)    — keyword rank improvement
 *   3. Publishing Velocity               — content_assets created this week
 *   4. Funnel Efficiency                 — conversions / orbit_clicks
 *   5. Recommendation Completion         — accepted vs. dismissed/pending
 *
 * Weights are adjusted by businessType (B2B vs. B2C) per spec.
 */

import { db } from "../db";
import {
  analyticsDaily,
  contentAssets,
  recommendations,
  seoMetrics,
  orbitScores,
  orbitScoreBenchmarks,
  tenants,
  organizations,
  markets,
  companyProfiles,
  competitors,
} from "@shared/schema";
import { and, eq, gte, lte, sql, isNull, isNotNull, inArray } from "drizzle-orm";

export interface OrbitScoreComponents {
  sovTrend: number;
  publishRate: number;
  actionCompletion: number;
  socialEngagement: number;
  competitorFreshness: number;
  weights: Record<string, number>;
}

// B2B leans on SoV and competitor coverage; B2C tilts toward publish rate
// and social engagement.
const WEIGHTS_B2B: Record<string, number> = {
  sovTrend: 0.30,
  publishRate: 0.15,
  actionCompletion: 0.20,
  socialEngagement: 0.10,
  competitorFreshness: 0.25,
};

const WEIGHTS_B2C: Record<string, number> = {
  sovTrend: 0.25,
  publishRate: 0.25,
  actionCompletion: 0.15,
  socialEngagement: 0.20,
  competitorFreshness: 0.15,
};

export function getMonday(d: Date = new Date()): Date {
  const date = new Date(d);
  const day = date.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function isoWeekStart(d: Date = new Date()): string {
  return getMonday(d).toISOString().slice(0, 10);
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

interface ComputeArgs {
  tenantDomain: string;
  marketId: string | null;
  weekStart: string; // YYYY-MM-DD (Monday)
  businessType: "b2b" | "b2c";
}

export async function computeOrbitScoreFor(args: ComputeArgs): Promise<{
  score: number;
  components: OrbitScoreComponents;
}> {
  const { tenantDomain, marketId, weekStart, businessType } = args;
  const weekEnd = new Date(weekStart + "T00:00:00Z");
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const weekStartDate = new Date(weekStart + "T00:00:00Z");

  const marketCond = marketId
    ? (col: any) => eq(col, marketId)
    : (col: any) => isNull(col);

  // Component 1: SoV trend — average baseline shareOfVoice for the week vs the prior week
  let sovTrend = 50;
  try {
    const sovRows = await db.select({ sov: seoMetrics.shareOfVoice })
      .from(seoMetrics)
      .where(and(
        eq(seoMetrics.tenantDomain, tenantDomain),
        marketCond(seoMetrics.marketId),
        eq(seoMetrics.entityType, "baseline"),
        gte(seoMetrics.capturedAt, weekStartDate),
        lte(seoMetrics.capturedAt, weekEnd),
      ));
    const priorStart = new Date(weekStartDate); priorStart.setUTCDate(priorStart.getUTCDate() - 7);
    const priorRows = await db.select({ sov: seoMetrics.shareOfVoice })
      .from(seoMetrics)
      .where(and(
        eq(seoMetrics.tenantDomain, tenantDomain),
        marketCond(seoMetrics.marketId),
        eq(seoMetrics.entityType, "baseline"),
        gte(seoMetrics.capturedAt, priorStart),
        lte(seoMetrics.capturedAt, weekStartDate),
      ));
    const cur = sovRows.length ? sovRows.reduce((s, r) => s + (Number(r.sov) || 0), 0) / sovRows.length : 0;
    const prev = priorRows.length ? priorRows.reduce((s, r) => s + (Number(r.sov) || 0), 0) / priorRows.length : 0;
    // Score = current SoV (0-100) plus a small momentum bonus/penalty for delta.
    sovTrend = clamp(cur + Math.max(-15, Math.min(15, cur - prev)));
  } catch { /* leave default */ }

  // Component 2: Publish rate — content_assets created this week (capped at 8 → 100)
  const [assetRow] = await db.select({ n: sql<number>`count(*)::int` })
    .from(contentAssets)
    .where(and(
      eq(contentAssets.tenantDomain, tenantDomain),
      marketCond(contentAssets.marketId),
      gte(contentAssets.createdAt, weekStartDate),
      lte(contentAssets.createdAt, weekEnd),
    ));
  const publishRate = clamp((Number(assetRow?.n || 0) / 8) * 100);

  // Component 3: Action completion — accepted vs (accepted + dismissed + pending)
  const recRows = await db.select({ status: recommendations.status, n: sql<number>`count(*)::int` })
    .from(recommendations)
    .where(and(
      eq(recommendations.tenantDomain, tenantDomain),
      marketCond(recommendations.marketId),
      gte(recommendations.createdAt, weekStartDate),
      lte(recommendations.createdAt, weekEnd),
    ))
    .groupBy(recommendations.status);
  const accepted = Number(recRows.find((r) => r.status === "accepted")?.n || 0);
  const total = recRows.reduce((s, r) => s + Number(r.n || 0), 0);
  const actionCompletion = clamp(total === 0 ? 50 : (accepted / total) * 100);

  // Component 4: Social engagement — sum of follower/post counts across baseline
  // engagement snapshots, scaled. When social monitoring isn't in use, we
  // default to the publish-rate score so the component doesn't penalize.
  let socialEngagement = publishRate;
  try {
    const [profile] = await db.select().from(companyProfiles)
      .where(eq(companyProfiles.tenantDomain, tenantDomain)).limit(1);
    if (profile) {
      const snapshots = [profile.linkedInEngagement, profile.instagramEngagement, profile.twitterEngagement, profile.facebookEngagement]
        .filter((s) => s && typeof s === "object") as any[];
      if (snapshots.length > 0) {
        const totals = snapshots.reduce((acc, s) => acc + (Number(s.posts || 0) + Number(s.reactions || 0) + Number(s.likes || 0) + Number(s.comments || 0)), 0);
        socialEngagement = clamp(Math.min(100, Math.log10(Math.max(totals, 1)) * 25));
      }
    }
  } catch { /* leave default */ }

  // Component 5: Competitor coverage freshness — % of competitors crawled in the last 14 days
  let competitorFreshness = 50;
  try {
    const compRows = await db.select({ lastCrawl: competitors.lastCrawl, lastFull: competitors.lastFullCrawl })
      .from(competitors)
      .where(eq(competitors.tenantDomain, tenantDomain));
    if (compRows.length > 0) {
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const fresh = compRows.filter((c) => {
        const lc = c.lastFull ? new Date(c.lastFull).getTime() : (c.lastCrawl ? Date.parse(c.lastCrawl) : 0);
        return Number.isFinite(lc) && lc >= cutoff;
      }).length;
      competitorFreshness = clamp((fresh / compRows.length) * 100);
    }
  } catch { /* leave default */ }

  const weights = businessType === "b2c" ? WEIGHTS_B2C : WEIGHTS_B2B;
  const score = clamp(
    sovTrend * weights.sovTrend +
    publishRate * weights.publishRate +
    actionCompletion * weights.actionCompletion +
    socialEngagement * weights.socialEngagement +
    competitorFreshness * weights.competitorFreshness,
  );

  return {
    score,
    components: {
      sovTrend,
      publishRate,
      actionCompletion,
      socialEngagement,
      competitorFreshness,
      weights,
    },
  };
}

/**
 * Compute Orbit Scores for the previous ISO week for every tenant+market.
 * Idempotent — replaces the row for that (tenant, market, weekStart).
 */
export async function runWeeklyOrbitScoreJob(): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;
  const monday = getMonday(new Date());
  const lastWeek = new Date(monday);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const weekStart = lastWeek.toISOString().slice(0, 10);

  const tenantRows = await db.select({
    domain: tenants.domain,
  }).from(tenants);

  for (const t of tenantRows) {
    if (!t.domain) continue;
    // SIC code via the tenant's first companyProfile → organization
    let sicCode: string | null = null;
    const [profile] = await db.select({ organizationId: companyProfiles.organizationId })
      .from(companyProfiles).where(eq(companyProfiles.tenantDomain, t.domain)).limit(1);
    if (profile?.organizationId) {
      const [org] = await db.select({ sicCode: organizations.sicCode })
        .from(organizations).where(eq(organizations.id, profile.organizationId));
      sicCode = org?.sicCode || null;
    }

    const tenantMarkets = await db.select({
      id: markets.id,
      isDefault: markets.isDefault,
      businessType: markets.businessType,
    }).from(markets).innerJoin(tenants, eq(tenants.id, markets.tenantId))
      .where(eq(tenants.domain, t.domain));

    const marketsToScore = tenantMarkets.length > 0 ? tenantMarkets : [{ id: null as any, isDefault: true, businessType: "b2b" }];

    for (const m of marketsToScore) {
      try {
        const result = await computeOrbitScoreFor({
          tenantDomain: t.domain,
          marketId: m.isDefault ? null : m.id,
          weekStart,
          businessType: ((m.businessType as string) === "b2c" ? "b2c" : "b2b"),
        });
        // Replace any existing row for this week
        await db.delete(orbitScores).where(and(
          eq(orbitScores.tenantDomain, t.domain),
          eq(orbitScores.weekStart, weekStart),
          m.isDefault ? isNull(orbitScores.marketId) : eq(orbitScores.marketId, m.id),
        ));
        await db.insert(orbitScores).values({
          tenantDomain: t.domain,
          marketId: m.isDefault ? null : m.id,
          weekStart,
          score: result.score,
          components: result.components,
          businessType: (m.businessType as string) === "b2c" ? "b2c" : "b2b",
          sicCode,
        });
        updated++;
      } catch (err) {
        failed++;
        console.error("[Orbit Score] Failed for", t.domain, m.id, err);
      }
    }
  }

  return { updated, failed };
}

/**
 * Recompute industry benchmark cohorts for the latest week. Only publishes
 * a benchmark when a SIC bucket has ≥5 distinct tenants (k-anonymity guard).
 */
export async function runBenchmarkAggregationJob(): Promise<{ buckets: number }> {
  const monday = getMonday(new Date());
  const lastWeek = new Date(monday);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const weekStart = lastWeek.toISOString().slice(0, 10);

  const rows = await db.select({
    sicCode: orbitScores.sicCode,
    score: orbitScores.score,
    components: orbitScores.components,
    tenantDomain: orbitScores.tenantDomain,
  }).from(orbitScores)
    .where(and(eq(orbitScores.weekStart, weekStart), isNotNull(orbitScores.sicCode)));

  const buckets = new Map<string, { scores: number[]; tenants: Set<string>; comps: Record<string, number[]> }>();
  for (const r of rows) {
    const sic = r.sicCode!;
    let b = buckets.get(sic);
    if (!b) { b = { scores: [], tenants: new Set(), comps: {} }; buckets.set(sic, b); }
    b.scores.push(r.score);
    b.tenants.add(r.tenantDomain);
    const c = (r.components as any) || {};
    for (const k of ["sovTrend", "publishRate", "actionCompletion", "socialEngagement", "competitorFreshness"]) {
      (b.comps[k] = b.comps[k] || []).push(Number(c[k] || 0));
    }
  }

  function pct(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(p * (sorted.length - 1));
    return Math.round(sorted[idx]);
  }

  await db.delete(orbitScoreBenchmarks).where(eq(orbitScoreBenchmarks.weekStart, weekStart));

  let published = 0;
  for (const [sic, b] of Array.from(buckets.entries())) {
    if (b.tenants.size < 5) continue;
    const componentP50: Record<string, number> = {};
    for (const k of Object.keys(b.comps)) componentP50[k] = pct(b.comps[k], 0.5);
    await db.insert(orbitScoreBenchmarks).values({
      sicCode: sic,
      weekStart,
      p50: pct(b.scores, 0.5),
      p75: pct(b.scores, 0.75),
      sampleSize: b.tenants.size,
      componentP50,
    });
    published++;
  }
  return { buckets: published };
}
