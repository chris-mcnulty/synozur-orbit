/**
 * Task #101 — Outcome Metrics, Orbit Score & ROI dashboard endpoints.
 *
 *  - GET    /api/insights/outcomes              — combined dashboard payload
 *  - GET    /api/insights/outcomes.csv          — CSV export
 *  - GET    /api/insights/outcomes.pdf          — PDF export (basic)
 *  - GET    /api/insights/ga/status             — connection status
 *  - GET    /api/insights/ga/connect            — start OAuth
 *  - GET    /api/insights/ga/callback           — OAuth callback
 *  - GET    /api/insights/ga/properties         — list available GA4 properties
 *  - POST   /api/insights/ga/property           — set selected property
 *  - DELETE /api/insights/ga/connection         — disconnect
 *  - POST   /api/insights/refresh               — manual refresh of analytics + score
 */

import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  analyticsConnections,
  analyticsDaily,
  orbitScores,
  orbitScoreBenchmarks,
  recommendations,
  seoMetrics,
  markets,
  tenants,
  companyProfiles,
  organizations,
  marketingLinks,
  marketingLinkClicks,
  marketingTasks,
} from "@shared/schema";
import { and, eq, gte, lte, sql, isNull, isNotNull, desc, inArray } from "drizzle-orm";
import { ContextError, getRequestContext } from "../context";
import { guardFeature, toContextFilter } from "./helpers";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import {
  isGaConfigured,
  buildGaAuthUrl,
  exchangeCodeForTokens,
  listGaProperties,
  runDailyAnalyticsPull,
} from "../services/ga-client";
import {
  computeOrbitScoreFor,
  getMonday,
  isoWeekStart,
  runWeeklyOrbitScoreJob,
} from "../services/orbit-score";
import { encryptSecret } from "../utils/encryption";
import { storage } from "../storage";
import crypto from "crypto";

/**
 * Tenant-level integrations (GA4 connect/disconnect, property selection,
 * manual refresh) must be restricted to admins. Standard users on an
 * outcomeMetrics-entitled plan can still *view* the dashboard but cannot
 * mutate the tenant integration.
 */
function isTenantAdmin(role: string): boolean {
  // Tenant integrations belong to the tenant: only the tenant's own admin
  // (Domain Admin) and the Replit operator (Global Admin) can mutate them.
  // Consultants have read access through the dashboard but cannot connect or
  // disconnect a tenant's GA property.
  return role === "Domain Admin" || role === "Global Admin";
}

async function guardTenantAdmin(req: any, res: any): Promise<{ ctx: any } | null> {
  try {
    const ctx = await getRequestContext(req);
    if (!isTenantAdmin(ctx.userRole)) {
      res.status(403).json({ error: "Admin access required to manage tenant integrations" });
      return null;
    }
    return { ctx };
  } catch (err) {
    if (err instanceof ContextError) res.status(err.status).json({ error: err.message });
    else res.status(500).json({ error: "Internal error" });
    return null;
  }
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseDateRange(req: any): { start: string; end: string } {
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStart = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  // Accept both `from`/`to` (task contract) and `start`/`end` (legacy).
  const startRaw = String(req.query.from || req.query.start || defaultStart);
  const endRaw = String(req.query.to || req.query.end || defaultEnd);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  return {
    start: dateRe.test(startRaw) ? startRaw : defaultStart,
    end: dateRe.test(endRaw) ? endRaw : defaultEnd,
  };
}

/**
 * Best-effort CRM pipeline attribution. Orbit's HubSpot connection is currently
 * a single global Replit OAuth (not per-tenant); we surface deals whose
 * associated company.domain matches the tenant's domain. When HubSpot is not
 * connected, returns null and the dashboard treats pipeline as unavailable.
 *
 * Per-tenant HubSpot OAuth is tracked as follow-up #115 — when shipped, this
 * helper should switch to a per-tenant token lookup.
 */
async function getTenantPipeline(tenantDomain: string, start: string, end: string): Promise<{
  newDeals: number; pipelineValueCents: number; wonDeals: number; wonValueCents: number; source: "hubspot" | null;
} | null> {
  try {
    const { Client } = await import("@hubspot/api-client");
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL ? "depl " + process.env.WEB_REPL_RENEWAL : null;
    if (!hostname || !xReplitToken) return null;
    const conn = await fetch(`https://${hostname}/api/v2/connection?include_secrets=true&connector_names=hubspot`, {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
    }).then((r) => r.json()).then((d: any) => d.items?.[0]).catch(() => null);
    const accessToken = conn?.settings?.access_token || conn?.settings?.oauth?.credentials?.access_token;
    if (!accessToken) return null;
    const hs = new Client({ accessToken });
    const startMs = new Date(start + "T00:00:00Z").getTime();
    const endMs = new Date(end + "T23:59:59Z").getTime();
    const search = await hs.crm.deals.searchApi.doSearch({
      filterGroups: [{
        filters: [
          { propertyName: "createdate", operator: "BETWEEN" as any, value: String(startMs), highValue: String(endMs) },
          { propertyName: "domain", operator: "EQ" as any, value: tenantDomain },
        ],
      }],
      properties: ["amount", "dealstage", "createdate", "hs_is_closed_won"],
      limit: 100,
    } as any).catch(() => null);
    let newDeals = 0, pipelineValueCents = 0, wonDeals = 0, wonValueCents = 0;
    for (const d of search?.results || []) {
      newDeals++;
      const amount = Math.round(parseFloat(String((d.properties as any)?.amount || "0")) * 100) || 0;
      pipelineValueCents += amount;
      if (String((d.properties as any)?.hs_is_closed_won) === "true") {
        wonDeals++; wonValueCents += amount;
      }
    }
    return { newDeals, pipelineValueCents, wonDeals, wonValueCents, source: "hubspot" };
  } catch {
    return null;
  }
}

function indexAgainst(currentValue: number, currentDays: number, baselineValue: number, baselineDays: number): number | null {
  if (!baselineValue || !baselineDays || !currentDays) return null;
  const cur = currentValue / currentDays;
  const base = baselineValue / baselineDays;
  if (base === 0) return null;
  return Math.round((cur / base) * 100);
}

async function getMarketBusinessType(tenantDomain: string, marketId: string | null): Promise<"b2b" | "b2c"> {
  if (!marketId) return "b2b";
  const [m] = await db.select({ bt: markets.businessType }).from(markets).where(eq(markets.id, marketId));
  return (m?.bt as string) === "b2c" ? "b2c" : "b2b";
}

async function getTenantSicCode(tenantDomain: string): Promise<string | null> {
  const [profile] = await db.select({ organizationId: companyProfiles.organizationId })
    .from(companyProfiles).where(eq(companyProfiles.tenantDomain, tenantDomain)).limit(1);
  if (!profile?.organizationId) return null;
  const [org] = await db.select({ sicCode: organizations.sicCode })
    .from(organizations).where(eq(organizations.id, profile.organizationId));
  return org?.sicCode || null;
}

async function buildOutcomesPayload(opts: {
  tenantDomain: string;
  marketId: string | null;
  start: string;
  end: string;
  benchmarksAllowed: boolean;
}) {
  const { tenantDomain, marketId, start, end } = opts;

  const marketCond = marketId
    ? (col: any) => eq(col, marketId)
    : (col: any) => isNull(col);

  // Daily analytics inside the window — by source/medium and totals
  const dailyRows = await db
    .select()
    .from(analyticsDaily)
    .where(and(
      eq(analyticsDaily.tenantDomain, tenantDomain),
      marketCond(analyticsDaily.marketId),
      gte(analyticsDaily.date, start),
      lte(analyticsDaily.date, end),
    ))
    .orderBy(analyticsDaily.date);

  const dailyTotals: Record<string, { sessions: number; users: number; conversions: number; revenue: number; orbitClicks: number }> = {};
  const sourceTotals: Record<string, { source: string; medium: string; sessions: number; conversions: number; revenue: number; orbitClicks: number }> = {};
  // campaignTotals preserves the campaign dimension so we can attribute
  // outcomes back to the recommendation/marketing-link that produced it.
  const campaignTotals: Record<string, { campaign: string; sessions: number; conversions: number; revenue: number; orbitClicks: number }> = {};
  for (const r of dailyRows) {
    if (!dailyTotals[r.date]) dailyTotals[r.date] = { sessions: 0, users: 0, conversions: 0, revenue: 0, orbitClicks: 0 };
    dailyTotals[r.date].sessions += r.sessions;
    dailyTotals[r.date].users += r.users;
    dailyTotals[r.date].conversions += r.conversions;
    dailyTotals[r.date].revenue += r.revenue;
    dailyTotals[r.date].orbitClicks += r.orbitClicks;
    const k = `${r.source}|${r.medium}`;
    if (!sourceTotals[k]) sourceTotals[k] = { source: r.source, medium: r.medium, sessions: 0, conversions: 0, revenue: 0, orbitClicks: 0 };
    sourceTotals[k].sessions += r.sessions;
    sourceTotals[k].conversions += r.conversions;
    sourceTotals[k].revenue += r.revenue;
    sourceTotals[k].orbitClicks += r.orbitClicks;
    if (r.campaign) {
      if (!campaignTotals[r.campaign]) campaignTotals[r.campaign] = { campaign: r.campaign, sessions: 0, conversions: 0, revenue: 0, orbitClicks: 0 };
      campaignTotals[r.campaign].sessions += r.sessions;
      campaignTotals[r.campaign].conversions += r.conversions;
      campaignTotals[r.campaign].revenue += r.revenue;
      campaignTotals[r.campaign].orbitClicks += r.orbitClicks;
    }
  }

  const dailySeries = Object.entries(dailyTotals)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Latest 12 weekly scores
  const scoreRows = await db
    .select()
    .from(orbitScores)
    .where(and(
      eq(orbitScores.tenantDomain, tenantDomain),
      marketCond(orbitScores.marketId),
    ))
    .orderBy(desc(orbitScores.weekStart))
    .limit(12);

  const businessType = await getMarketBusinessType(tenantDomain, marketId);

  // If no historical score, compute one on the fly for the current week
  let latestScore = scoreRows[0];
  if (!latestScore) {
    const weekStart = isoWeekStart(new Date());
    const computed = await computeOrbitScoreFor({ tenantDomain, marketId, weekStart, businessType });
    latestScore = {
      id: "ephemeral",
      tenantDomain,
      marketId: marketId ?? null,
      weekStart,
      score: computed.score,
      components: computed.components as any,
      businessType,
      sicCode: null,
      createdAt: new Date(),
    } as any;
  }

  // SoV trend — average baseline shareOfVoice per day
  const sovRows = await db
    .select({
      date: sql<string>`to_char(${seoMetrics.capturedAt}, 'YYYY-MM-DD')`,
      sov: sql<number>`avg(${seoMetrics.shareOfVoice})::int`,
    })
    .from(seoMetrics)
    .where(and(
      eq(seoMetrics.tenantDomain, tenantDomain),
      marketCond(seoMetrics.marketId),
      eq(seoMetrics.entityType, "baseline"),
      gte(seoMetrics.capturedAt, new Date(start + "T00:00:00Z")),
      lte(seoMetrics.capturedAt, new Date(end + "T23:59:59Z")),
    ))
    .groupBy(sql`to_char(${seoMetrics.capturedAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${seoMetrics.capturedAt}, 'YYYY-MM-DD')`);

  // Top actions — recommendations attributable to traffic + conversions in
  // this window. We attribute by joining recommendations -> marketing_links
  // (which carry source_recommendation_id and a UTM campaign) -> the
  // campaignTotals computed above. Fallback signals: marketing_link_clicks
  // counts, plus thumbs-up + priority.
  const recRows = await db
    .select()
    .from(recommendations)
    .where(and(
      eq(recommendations.tenantDomain, tenantDomain),
      marketCond(recommendations.marketId),
      gte(recommendations.createdAt, new Date(start + "T00:00:00Z")),
    ))
    .orderBy(desc(recommendations.isPriority), desc(recommendations.thumbsUp))
    .limit(50);

  // Resolve attribution from recommendations -> marketing_tasks -> campaigns.
  // marketing_tasks.source_recommendation_id ties tasks back to the rec that
  // produced them; tasks belong to a marketing_plan whose campaigns/links
  // carry the UTM dimension we joined on above.
  const recIds = recRows.map((r) => r.id);
  const taskRows = recIds.length === 0 ? [] : await db
    .select({ recId: marketingTasks.sourceRecommendationId, status: marketingTasks.status })
    .from(marketingTasks)
    .where(and(
      isNotNull(marketingTasks.sourceRecommendationId),
      inArray(marketingTasks.sourceRecommendationId, recIds),
    ));
  const taskCounts = new Map<string, { total: number; completed: number }>();
  for (const t of taskRows) {
    if (!t.recId) continue;
    const c = taskCounts.get(t.recId) || { total: 0, completed: 0 };
    c.total++;
    if (t.status === "completed") c.completed++;
    taskCounts.set(t.recId, c);
  }

  // Marketing-link clicks attributable to each recommendation: any link in
  // this tenant+market whose campaign matches a campaign carried by a task
  // descended from the rec. We simplify by treating utm_campaign == rec.id
  // as a strong signal and falling back to campaign field on campaigns.
  const linkAggRows = recIds.length === 0 ? [] : await db
    .select({
      campaign: marketingLinks.utmCampaign,
      clicks: sql<number>`count(${marketingLinkClicks.id})::int`,
    })
    .from(marketingLinks)
    .leftJoin(marketingLinkClicks, and(
      eq(marketingLinkClicks.linkId, marketingLinks.id),
      eq(marketingLinkClicks.isBot, false),
      gte(marketingLinkClicks.clickedAt, new Date(start + "T00:00:00Z")),
      lte(marketingLinkClicks.clickedAt, new Date(end + "T23:59:59Z")),
    ))
    .where(and(
      eq(marketingLinks.tenantDomain, tenantDomain),
      marketCond(marketingLinks.marketId),
      isNotNull(marketingLinks.utmCampaign),
    ))
    .groupBy(marketingLinks.utmCampaign);

  const clicksByCampaign = new Map<string, number>();
  for (const r of linkAggRows) if (r.campaign) clicksByCampaign.set(r.campaign, Number(r.clicks || 0));

  const topActions = recRows
    .map((r) => {
      const tc = taskCounts.get(r.id) || { total: 0, completed: 0 };
      // Match by convention: utm_campaign === r.id, plus any campaign
      // containing the rec id (defensive for legacy slugs).
      const matchedCampaigns = Array.from(clicksByCampaign.keys()).filter((c) => c === r.id || c.includes(r.id));
      const orbitClicks = matchedCampaigns.reduce((s, c) => s + (clicksByCampaign.get(c) || 0), 0);
      const ct = matchedCampaigns.reduce((acc, c) => {
        const t = campaignTotals[c]; if (!t) return acc;
        return { sessions: acc.sessions + t.sessions, conversions: acc.conversions + t.conversions, revenue: acc.revenue + t.revenue };
      }, { sessions: 0, conversions: 0, revenue: 0 });
      const score =
        orbitClicks +
        ct.conversions * 5 +
        Math.floor(ct.revenue / 1000) +
        tc.completed * 3 + tc.total +
        (r.thumbsUp || 0) +
        (r.isPriority ? 10 : 0);
      return {
        id: r.id,
        title: r.title,
        area: r.area,
        impact: r.impact,
        status: r.status,
        isPriority: r.isPriority,
        attributableScore: score,
        attributable: { orbitClicks, sessions: ct.sessions, conversions: ct.conversions, revenue: ct.revenue, tasksCompleted: tc.completed, tasksTotal: tc.total, campaigns: matchedCampaigns },
      };
    })
    .sort((a, b) => b.attributableScore - a.attributableScore)
    .slice(0, 5);

  // SEO movers — top gainers and losers by rank delta vs the prior 7 days
  const sevenDaysBeforeStart = new Date(new Date(start + "T00:00:00Z").getTime() - 7 * 86400000);
  const moverRows = await db.select({
    keywordId: seoMetrics.keywordId,
    entityName: seoMetrics.entityName,
    rank: seoMetrics.rank,
    capturedAt: seoMetrics.capturedAt,
  }).from(seoMetrics).where(and(
    eq(seoMetrics.tenantDomain, tenantDomain),
    marketCond(seoMetrics.marketId),
    eq(seoMetrics.entityType, "baseline"),
    isNotNull(seoMetrics.rank),
    gte(seoMetrics.capturedAt, sevenDaysBeforeStart),
    lte(seoMetrics.capturedAt, new Date(end + "T23:59:59Z")),
  )).orderBy(seoMetrics.keywordId, seoMetrics.capturedAt);

  const byKeyword = new Map<string, Array<{ rank: number; capturedAt: Date; entityName: string }>>();
  for (const r of moverRows) {
    if (r.rank == null) continue;
    const arr = byKeyword.get(r.keywordId) || [];
    arr.push({ rank: r.rank, capturedAt: r.capturedAt!, entityName: r.entityName });
    byKeyword.set(r.keywordId, arr);
  }
  const movers: Array<{ keywordId: string; entityName: string; from: number; to: number; delta: number }> = [];
  for (const [keywordId, arr] of Array.from(byKeyword.entries())) {
    if (arr.length < 2) continue;
    const first = arr[0]; const last = arr[arr.length - 1];
    movers.push({ keywordId, entityName: last.entityName, from: first.rank, to: last.rank, delta: first.rank - last.rank });
  }
  const seoGainers = [...movers].filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const seoLosers = [...movers].filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);

  // Benchmark (only for users on industryBenchmarks plan)
  let benchmark: { p50: number; p75: number; sampleSize: number; componentP50: any; sicCode: string } | null = null;
  if (opts.benchmarksAllowed) {
    const sic = await getTenantSicCode(tenantDomain);
    if (sic && latestScore?.weekStart) {
      const [bench] = await db.select().from(orbitScoreBenchmarks)
        .where(and(eq(orbitScoreBenchmarks.sicCode, sic), eq(orbitScoreBenchmarks.weekStart, latestScore.weekStart)));
      if (bench) {
        benchmark = {
          p50: bench.p50,
          p75: bench.p75,
          sampleSize: bench.sampleSize,
          componentP50: bench.componentP50,
          sicCode: sic,
        };
      }
    }
  }

  // Connection status
  const [conn] = await db
    .select()
    .from(analyticsConnections)
    .where(and(
      eq(analyticsConnections.tenantDomain, tenantDomain),
      marketId ? eq(analyticsConnections.marketId, marketId) : isNull(analyticsConnections.marketId),
    ));

  // "Since Orbit started" baseline — first recorded weekly score and the
  // earliest baseline SoV row. Lets the dashboard show how far the tenant
  // has come (not just the last 90 days).
  const [firstScoreRow] = await db.select()
    .from(orbitScores)
    .where(and(eq(orbitScores.tenantDomain, tenantDomain), marketCond(orbitScores.marketId)))
    .orderBy(orbitScores.weekStart)
    .limit(1);
  const [firstSovRow] = await db.select({ sov: seoMetrics.shareOfVoice, capturedAt: seoMetrics.capturedAt })
    .from(seoMetrics)
    .where(and(
      eq(seoMetrics.tenantDomain, tenantDomain),
      marketCond(seoMetrics.marketId),
      eq(seoMetrics.entityType, "baseline"),
      isNotNull(seoMetrics.shareOfVoice),
    ))
    .orderBy(seoMetrics.capturedAt)
    .limit(1);
  // Baseline outcome metrics: aggregate the first 30 days of analytics_daily
  // for this tenant+market and compare to the current window for an indexed
  // delta the dashboard can render against the "since-start" baseline.
  const [firstAnalyticsRow] = await db.select({ d: analyticsDaily.date })
    .from(analyticsDaily)
    .where(and(eq(analyticsDaily.tenantDomain, tenantDomain), marketCond(analyticsDaily.marketId)))
    .orderBy(analyticsDaily.date).limit(1);

  let baselineTotals: { sessions: number; conversions: number; revenue: number; orbitClicks: number; days: number; from: string; to: string } | null = null;
  if (firstAnalyticsRow?.d) {
    const baselineEnd = new Date(new Date(firstAnalyticsRow.d + "T00:00:00Z").getTime() + 29 * 86400000)
      .toISOString().slice(0, 10);
    const baseRows = await db.select().from(analyticsDaily).where(and(
      eq(analyticsDaily.tenantDomain, tenantDomain),
      marketCond(analyticsDaily.marketId),
      gte(analyticsDaily.date, firstAnalyticsRow.d),
      lte(analyticsDaily.date, baselineEnd),
    ));
    const days = new Set<string>();
    let bs = 0, bc = 0, br = 0, bo = 0;
    for (const r of baseRows) { bs += r.sessions; bc += r.conversions; br += r.revenue; bo += r.orbitClicks; days.add(r.date); }
    baselineTotals = { sessions: bs, conversions: bc, revenue: br, orbitClicks: bo, days: days.size, from: firstAnalyticsRow.d, to: baselineEnd };
  }

  const pipelineCurrent = await getTenantPipeline(tenantDomain, start, end);
  const pipelineBaseline = baselineTotals
    ? await getTenantPipeline(tenantDomain, baselineTotals.from, baselineTotals.to)
    : null;

  const totals = dailySeries.reduce((acc, r) => {
    acc.sessions += r.sessions;
    acc.users += r.users;
    acc.conversions += r.conversions;
    acc.revenue += r.revenue;
    acc.orbitClicks += r.orbitClicks;
    return acc;
  }, { sessions: 0, users: 0, conversions: 0, revenue: 0, orbitClicks: 0 });

  const sinceStart = {
    firstScore: firstScoreRow ? { score: firstScoreRow.score, weekStart: firstScoreRow.weekStart } : null,
    currentScore: latestScore ? { score: latestScore.score, weekStart: latestScore.weekStart } : null,
    scoreDelta: firstScoreRow && latestScore ? latestScore.score - firstScoreRow.score : null,
    firstSov: firstSovRow ? { value: Number(firstSovRow.sov || 0), capturedAt: firstSovRow.capturedAt } : null,
    baseline: baselineTotals,
    indexed: baselineTotals ? {
      // Index = current / baseline * 100 (per-day-normalized so different
      // window lengths still compare apples-to-apples). Returns null when
      // baseline value is zero, so the UI can render "n/a".
      sessions: indexAgainst(totals.sessions, dailySeries.length, baselineTotals.sessions, baselineTotals.days),
      conversions: indexAgainst(totals.conversions, dailySeries.length, baselineTotals.conversions, baselineTotals.days),
      revenue: indexAgainst(totals.revenue, dailySeries.length, baselineTotals.revenue, baselineTotals.days),
      pipeline: pipelineCurrent && pipelineBaseline
        ? indexAgainst(pipelineCurrent.pipelineValueCents, dailySeries.length || 1, pipelineBaseline.pipelineValueCents, baselineTotals.days)
        : null,
    } : null,
    pipeline: pipelineCurrent ? {
      current: pipelineCurrent,
      baseline: pipelineBaseline,
    } : null,
  };

  return {
    range: { start, end },
    score: {
      value: latestScore.score,
      weekStart: latestScore.weekStart,
      components: latestScore.components,
      businessType: latestScore.businessType,
    },
    scoreHistory: scoreRows.map((s) => ({
      weekStart: s.weekStart,
      score: s.score,
      components: s.components,
    })).reverse(),
    totals,
    dailySeries,
    sources: Object.values(sourceTotals).sort((a, b) => b.sessions - a.sessions).slice(0, 20),
    sovTrend: sovRows.map((r) => ({ date: r.date, sov: Number(r.sov) })),
    topActions,
    seoMovers: { gainers: seoGainers, losers: seoLosers },
    sinceStart,
    pipeline: pipelineCurrent ? {
      ...pipelineCurrent,
      crmConnected: true,
    } : { crmConnected: false, source: null, newDeals: 0, pipelineValueCents: 0, wonDeals: 0, wonValueCents: 0 },
    benchmark,
    connection: conn ? {
      provider: conn.provider,
      status: conn.status,
      propertyId: conn.propertyId,
      propertyName: conn.propertyName,
      lastSyncAt: conn.lastSyncAt,
      lastError: conn.lastError,
    } : null,
    gaConfigured: isGaConfigured(),
  };
}

export function registerInsightsOutcomesRoutes(app: Express) {
  // Combined dashboard payload
  app.get("/api/insights/outcomes", async (req, res) => {
    if (!await guardFeature(req, res, "outcomeMetrics")) return;
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      const benchmarksAllowed = (await checkFeatureAccessAsync(tenant?.plan ?? "free", "industryBenchmarks")).allowed;
      const range = parseDateRange(req);
      const payload = await buildOutcomesPayload({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.isDefaultMarket ? null : ctx.marketId,
        start: range.start,
        end: range.end,
        benchmarksAllowed,
      });
      res.json(payload);
    } catch (err) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      console.error("[insights-outcomes] error", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  app.get("/api/insights/outcomes.csv", async (req, res) => {
    if (!await guardFeature(req, res, "outcomeMetrics")) return;
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      const benchmarksAllowed = (await checkFeatureAccessAsync(tenant?.plan ?? "free", "industryBenchmarks")).allowed;
      const range = parseDateRange(req);
      const data = await buildOutcomesPayload({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.isDefaultMarket ? null : ctx.marketId,
        start: range.start,
        end: range.end,
        benchmarksAllowed,
      });
      const lines: string[] = [];
      lines.push("section,key,value");
      lines.push(`score,value,${escapeCsv(data.score.value)}`);
      lines.push(`score,weekStart,${escapeCsv(data.score.weekStart)}`);
      for (const [k, v] of Object.entries(data.score.components || {})) {
        if (k === "weights") continue;
        lines.push(`component,${escapeCsv(k)},${escapeCsv(v)}`);
      }
      lines.push("");
      lines.push("date,sessions,users,conversions,revenue_cents,orbit_clicks");
      for (const r of data.dailySeries) {
        lines.push([r.date, r.sessions, r.users, r.conversions, r.revenue, r.orbitClicks].map(escapeCsv).join(","));
      }
      lines.push("");
      lines.push("source,medium,sessions,conversions,revenue_cents,orbit_clicks");
      for (const s of data.sources) {
        lines.push([s.source, s.medium, s.sessions, s.conversions, s.revenue, s.orbitClicks].map(escapeCsv).join(","));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="orbit-outcomes-${range.start}-to-${range.end}.csv"`);
      res.send(lines.join("\n"));
    } catch (err) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  app.get("/api/insights/outcomes.pdf", async (req, res) => {
    if (!await guardFeature(req, res, "outcomeMetrics")) return;
    try {
      const ctx = await getRequestContext(req);
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      const benchmarksAllowed = (await checkFeatureAccessAsync(tenant?.plan ?? "free", "industryBenchmarks")).allowed;
      const range = parseDateRange(req);
      const data = await buildOutcomesPayload({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.isDefaultMarket ? null : ctx.marketId,
        start: range.start,
        end: range.end,
        benchmarksAllowed,
      });

      const { withPdfPage } = await import("../services/pdf-browser-pool");
      const html = renderOutcomesPdfHtml(data, tenant?.name || ctx.tenantDomain);
      const pdfBuffer = await withPdfPage(async (page) => {
        await page.setContent(html, { waitUntil: "networkidle0" });
        return Buffer.from(await page.pdf({ format: "A4", printBackground: true, margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" } }));
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="orbit-outcomes-${range.start}-to-${range.end}.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      console.error("[insights-outcomes pdf] error", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // ── GA4 OAuth ─────────────────────────────────────────────────────────────

  app.get("/api/insights/ga/status", async (req, res) => {
    if (!await guardFeature(req, res, "outcomeMetrics")) return;
    try {
      const ctx = await getRequestContext(req);
      const [conn] = await db.select().from(analyticsConnections).where(and(
        eq(analyticsConnections.tenantDomain, ctx.tenantDomain),
        ctx.isDefaultMarket ? isNull(analyticsConnections.marketId) : eq(analyticsConnections.marketId, ctx.marketId),
      ));
      res.json({
        configured: isGaConfigured(),
        connection: conn ? {
          status: conn.status,
          propertyId: conn.propertyId,
          propertyName: conn.propertyName,
          lastSyncAt: conn.lastSyncAt,
          lastError: conn.lastError,
        } : null,
      });
    } catch (err) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/insights/ga/connect", async (req, res) => {
    if (!await guardFeature(req, res, "outcomeMetrics")) return;
    const auth = await guardTenantAdmin(req, res);
    if (!auth) return;
    try {
      if (!isGaConfigured()) return res.status(400).json({ error: "Google Analytics OAuth is not configured on this server (GOOGLE_CLIENT_ID/SECRET missing)" });
      const { ctx } = auth;
      const state = crypto.randomBytes(16).toString("hex");
      (req.session as any).gaOauthState = {
        state,
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.isDefaultMarket ? null : ctx.marketId,
        userId: ctx.userId,
      };
      res.json({ url: buildGaAuthUrl(state) });
    } catch (err) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/insights/ga/callback", async (req, res) => {
    try {
      const code = String(req.query.code || "");
      const stateParam = String(req.query.state || "");
      const stored = (req.session as any).gaOauthState;
      if (!code || !stored || stored.state !== stateParam) {
        return res.status(400).send("Invalid OAuth state. Please retry connecting.");
      }
      delete (req.session as any).gaOauthState;
      const tokens = await exchangeCodeForTokens(code);
      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

      // Upsert by (tenant, market)
      const [existing] = await db.select().from(analyticsConnections).where(and(
        eq(analyticsConnections.tenantDomain, stored.tenantDomain),
        stored.marketId ? eq(analyticsConnections.marketId, stored.marketId) : isNull(analyticsConnections.marketId),
      ));
      if (existing) {
        await db.update(analyticsConnections).set({
          accessTokenEnc: encryptSecret(tokens.accessToken),
          refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : existing.refreshTokenEnc,
          tokenExpiresAt: expiresAt,
          scope: tokens.scope || null,
          status: "connected",
          lastError: null,
          updatedAt: new Date(),
        }).where(eq(analyticsConnections.id, existing.id));
      } else {
        await db.insert(analyticsConnections).values({
          tenantDomain: stored.tenantDomain,
          marketId: stored.marketId,
          provider: "ga4",
          accessTokenEnc: encryptSecret(tokens.accessToken),
          refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
          tokenExpiresAt: expiresAt,
          scope: tokens.scope || null,
          status: "connected",
          connectedBy: stored.userId,
        });
      }
      // Send the user back to Settings → Integrations so they can pick a property.
      res.redirect("/app/settings/integrations?ga=connected");
    } catch (err) {
      console.error("[GA callback] error", err);
      res.status(500).send("Google Analytics connection failed: " + (err instanceof Error ? err.message : "unknown"));
    }
  });

  app.get("/api/insights/ga/properties", async (req, res) => {
    if (!await guardFeature(req, res, "outcomeMetrics")) return;
    try {
      const ctx = await getRequestContext(req);
      const [conn] = await db.select().from(analyticsConnections).where(and(
        eq(analyticsConnections.tenantDomain, ctx.tenantDomain),
        ctx.isDefaultMarket ? isNull(analyticsConnections.marketId) : eq(analyticsConnections.marketId, ctx.marketId),
      ));
      if (!conn) return res.json({ properties: [] });
      const properties = await listGaProperties(conn.id);
      res.json({ properties });
    } catch (err) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  const setPropertySchema = z.object({
    propertyId: z.string().min(1),
    propertyName: z.string().optional(),
  });

  app.post("/api/insights/ga/property", async (req, res) => {
    if (!await guardFeature(req, res, "outcomeMetrics")) return;
    const auth = await guardTenantAdmin(req, res);
    if (!auth) return;
    try {
      const { ctx } = auth;
      const body = setPropertySchema.parse(req.body);
      const [conn] = await db.select().from(analyticsConnections).where(and(
        eq(analyticsConnections.tenantDomain, ctx.tenantDomain),
        ctx.isDefaultMarket ? isNull(analyticsConnections.marketId) : eq(analyticsConnections.marketId, ctx.marketId),
      ));
      if (!conn) return res.status(404).json({ error: "No GA connection found" });
      await db.update(analyticsConnections)
        .set({ propertyId: body.propertyId, propertyName: body.propertyName || null, updatedAt: new Date() })
        .where(eq(analyticsConnections.id, conn.id));
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.delete("/api/insights/ga/connection", async (req, res) => {
    if (!await guardFeature(req, res, "outcomeMetrics")) return;
    const auth = await guardTenantAdmin(req, res);
    if (!auth) return;
    try {
      const { ctx } = auth;
      await db.delete(analyticsConnections).where(and(
        eq(analyticsConnections.tenantDomain, ctx.tenantDomain),
        ctx.isDefaultMarket ? isNull(analyticsConnections.marketId) : eq(analyticsConnections.marketId, ctx.marketId),
      ));
      res.status(204).send();
    } catch (err) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/insights/refresh", async (req, res) => {
    if (!await guardFeature(req, res, "outcomeMetrics")) return;
    const auth = await guardTenantAdmin(req, res);
    if (!auth) return;
    try {
      const { ctx } = auth;
      // Refresh is intentionally scoped to the caller's tenant + market so a
      // single user cannot trigger a global background fan-out.
      const businessType = await getMarketBusinessType(
        ctx.tenantDomain,
        ctx.isDefaultMarket ? null : ctx.marketId,
      );
      const weekStart = isoWeekStart(new Date());
      // Fire-and-forget: pull GA4 daily for the last 7 days for this
      // tenant+market, then recompute and persist the weekly Orbit Score.
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 86400000);
      const startDate = weekAgo.toISOString().slice(0, 10);
      const endDate = today.toISOString().slice(0, 10);
      runDailyAnalyticsPull({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.isDefaultMarket ? null : ctx.marketId,
        startDate,
        endDate,
      }).catch((e) => console.error("[refresh] GA pull error", e))
      .then(() => computeOrbitScoreFor({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.isDefaultMarket ? null : ctx.marketId,
        weekStart,
        businessType,
      })).then(async (result) => {
        if (!result) return;
        const sicCode = await getTenantSicCode(ctx.tenantDomain);
        await db.delete(orbitScores).where(and(
          eq(orbitScores.tenantDomain, ctx.tenantDomain),
          eq(orbitScores.weekStart, weekStart),
          ctx.isDefaultMarket ? isNull(orbitScores.marketId) : eq(orbitScores.marketId, ctx.marketId),
        ));
        await db.insert(orbitScores).values({
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.isDefaultMarket ? null : ctx.marketId,
          weekStart,
          score: result.score,
          components: result.components,
          businessType,
          sicCode,
        });
      }).catch((e) => console.error("[refresh] tenant score error", e));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Internal error" });
    }
  });
}

function renderOutcomesPdfHtml(data: any, tenantName: string): string {
  const componentsHtml = Object.entries(data.score.components || {})
    .filter(([k]) => k !== "weights")
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v}</td></tr>`)
    .join("");
  const sourcesHtml = data.sources.slice(0, 10).map((s: any) => `
    <tr>
      <td>${escapeHtml(s.source)}</td>
      <td>${escapeHtml(s.medium)}</td>
      <td style="text-align:right">${s.sessions}</td>
      <td style="text-align:right">${s.conversions}</td>
      <td style="text-align:right">${(s.revenue / 100).toFixed(2)}</td>
      <td style="text-align:right">${s.orbitClicks}</td>
    </tr>
  `).join("");
  const actionsHtml = data.topActions.map((a: any) => `<li><strong>${escapeHtml(a.title)}</strong> — ${escapeHtml(a.area)} · ${escapeHtml(a.impact)}</li>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Orbit Outcomes</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; color: #111; padding: 0; margin: 0; }
    h1 { color: #810FFB; margin: 0 0 4px; }
    h2 { color: #444; margin: 24px 0 8px; font-size: 16px; }
    .score { font-size: 64px; font-weight: 700; color: #810FFB; }
    .meta { color: #666; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    th, td { border-bottom: 1px solid #eee; padding: 6px 8px; text-align: left; }
    th { background: #f7f5fb; }
    .card { border: 1px solid #eee; border-radius: 8px; padding: 16px; margin-top: 12px; }
  </style></head><body>
    <h1>Orbit Outcomes Report</h1>
    <div class="meta">${escapeHtml(tenantName)} · ${data.range.start} → ${data.range.end}</div>
    <div class="card"><div class="score">${data.score.value}</div><div class="meta">Orbit Score · week of ${data.score.weekStart}</div>
    <table><thead><tr><th>Component</th><th style="text-align:right">Score</th></tr></thead><tbody>${componentsHtml}</tbody></table></div>
    <h2>Totals</h2>
    <table><tbody>
      <tr><td>Sessions</td><td style="text-align:right">${data.totals.sessions}</td></tr>
      <tr><td>Users</td><td style="text-align:right">${data.totals.users}</td></tr>
      <tr><td>Conversions</td><td style="text-align:right">${data.totals.conversions}</td></tr>
      <tr><td>Revenue</td><td style="text-align:right">$${(data.totals.revenue / 100).toFixed(2)}</td></tr>
      <tr><td>Orbit-attributed clicks</td><td style="text-align:right">${data.totals.orbitClicks}</td></tr>
    </tbody></table>
    <h2>Top sources</h2>
    <table><thead><tr><th>Source</th><th>Medium</th><th style="text-align:right">Sessions</th><th style="text-align:right">Conv</th><th style="text-align:right">Revenue</th><th style="text-align:right">Orbit clicks</th></tr></thead><tbody>${sourcesHtml}</tbody></table>
    <h2>Top recommended actions</h2>
    <ul>${actionsHtml || "<li>No pending recommendations.</li>"}</ul>
    ${data.benchmark ? `<h2>Industry benchmark (SIC ${escapeHtml(data.benchmark.sicCode)}, n=${data.benchmark.sampleSize})</h2>
      <p>Median score: ${data.benchmark.p50}. Top quartile: ${data.benchmark.p75}.</p>` : ""}
  </body></html>`;
}

function escapeHtml(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c] as string));
}
