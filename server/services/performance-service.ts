/**
 * Marketing Performance Service
 *
 * Computes a closed-loop content performance report by joining first-party
 * click data (marketing_links / marketing_link_clicks) and GA4 conversions
 * (analytics_daily) to content through campaigns, benchmarking against the
 * prior equal-length period, then asking the analyst model for a summary and
 * loop-closing recommendations.
 *
 * Attribution granularity note: conversions/clicks key on campaigns (the
 * lowest level the data supports), so per-content figures are campaign-
 * attributed — a content asset inherits the totals of the campaigns its posts
 * ran in. This is surfaced honestly in the report.
 */

import { db } from "../db";
import {
  generatedPosts,
  marketingLinks,
  marketingLinkClicks,
  analyticsDaily,
  campaigns,
  contentAssets,
  type MarketingPerformanceMetrics,
} from "@shared/schema";
import { and, eq, gte, lt, lte, inArray, isNull, or, sql } from "drizzle-orm";
import { loadStrategicContext, formatStrategicContextForPrompt } from "./strategic-context";
import { completeForFeature } from "./ai-provider";
import {
  indexVsBaseline,
  rankContent,
  parsePerformanceResponse,
  formatMetricsForPrompt,
  type ContentPerf,
  type ParsedRecommendation,
} from "./performance-core";

const SYSTEM_PROMPT =
  "You are a B2B marketing performance analyst. You are conversion-first and evidence-based: you only draw " +
  "conclusions the data supports, you call out what is NOT working as clearly as what is, and every " +
  "recommendation is specific and actionable for the next content cycle. Respond with valid JSON only.";

export interface PerformanceParams {
  tenantDomain: string;
  marketId?: string;
  isDefaultMarket?: boolean;
  periodStart: Date;
  periodEnd: Date;
}

export interface PerformanceResult {
  metrics: MarketingPerformanceMetrics;
  summary: string | null;
  recommendations: ParsedRecommendation[];
}

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

async function clicksByCampaign(
  tenantDomain: string,
  marketId: string,
  isDefaultMarket: boolean,
  from: Date,
  to: Date,
) {
  return db
    .select({ campaignId: marketingLinks.campaignId, clicks: sql<number>`count(*)::int` })
    .from(marketingLinkClicks)
    .innerJoin(marketingLinks, eq(marketingLinkClicks.linkId, marketingLinks.id))
    .where(
      and(
        eq(marketingLinkClicks.tenantDomain, tenantDomain),
        eq(marketingLinkClicks.isBot, false),
        isDefaultMarket
          ? or(eq(marketingLinks.marketId, marketId), isNull(marketingLinks.marketId))
          : eq(marketingLinks.marketId, marketId),
        gte(marketingLinkClicks.clickedAt, from),
        lte(marketingLinkClicks.clickedAt, to),
      ),
    )
    .groupBy(marketingLinks.campaignId);
}

export async function computePerformanceReport(params: PerformanceParams): Promise<PerformanceResult> {
  const { tenantDomain, periodStart, periodEnd } = params;
  const marketId = params.marketId || "";
  const isDefaultMarket = !!params.isDefaultMarket;
  // analytics_daily / marketing_links store NULL marketId for the default
  // market (see ga-client), so match both the id and NULL for default markets.
  const analyticsMarketScope = isDefaultMarket
    ? or(eq(analyticsDaily.marketId, marketId), isNull(analyticsDaily.marketId))
    : eq(analyticsDaily.marketId, marketId);

  // ── Posts in period (grouped in JS by campaign + source asset) ────────────
  // generated_posts has no marketId, so scope to the active market via the
  // post's campaign. Standalone posts (no campaign — e.g. repurposed variants)
  // have no market and are kept (they belong to the tenant, not a market).
  const posts = await db
    .select({
      id: generatedPosts.id,
      campaignId: generatedPosts.campaignId,
      sourceAssetId: generatedPosts.sourceAssetId,
    })
    .from(generatedPosts)
    .leftJoin(campaigns, eq(generatedPosts.campaignId, campaigns.id))
    .where(
      and(
        eq(generatedPosts.tenantDomain, tenantDomain),
        gte(generatedPosts.createdAt, periodStart),
        lte(generatedPosts.createdAt, periodEnd),
        or(eq(campaigns.marketId, marketId), isNull(generatedPosts.campaignId)),
      ),
    );

  const postsByCampaign = new Map<string, number>();
  const assetAgg = new Map<string, { posts: number; campaignIds: Set<string> }>();
  for (const p of posts) {
    const cid = p.campaignId ?? "__none__";
    postsByCampaign.set(cid, (postsByCampaign.get(cid) ?? 0) + 1);
    if (p.sourceAssetId) {
      const a = assetAgg.get(p.sourceAssetId) ?? { posts: 0, campaignIds: new Set<string>() };
      a.posts++;
      if (p.campaignId) a.campaignIds.add(p.campaignId);
      assetAgg.set(p.sourceAssetId, a);
    }
  }

  // ── Clicks (current + baseline) ───────────────────────────────────────────
  const clickRows = await clicksByCampaign(tenantDomain, marketId, isDefaultMarket, periodStart, periodEnd);
  const clicksByCampaignId = new Map<string, number>();
  let totalClicks = 0;
  for (const r of clickRows) {
    clicksByCampaignId.set(r.campaignId ?? "__none__", r.clicks);
    totalClicks += r.clicks;
  }

  // ── GA4 conversions in period, by campaign string ─────────────────────────
  const analyticsRows = await db
    .select({
      campaign: analyticsDaily.campaign,
      conversions: analyticsDaily.conversions,
      revenue: analyticsDaily.revenue,
      sessions: analyticsDaily.sessions,
    })
    .from(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.tenantDomain, tenantDomain),
        analyticsMarketScope,
        gte(analyticsDaily.date, dayStr(periodStart)),
        lte(analyticsDaily.date, dayStr(periodEnd)),
      ),
    );
  const convByUtm = new Map<string, { conversions: number; revenue: number }>();
  let totalConversions = 0;
  let totalRevenue = 0;
  let totalSessions = 0;
  for (const r of analyticsRows) {
    totalConversions += r.conversions;
    totalRevenue += r.revenue;
    totalSessions += r.sessions;
    const key = (r.campaign ?? "").toLowerCase();
    if (key) {
      const e = convByUtm.get(key) ?? { conversions: 0, revenue: 0 };
      e.conversions += r.conversions;
      e.revenue += r.revenue;
      convByUtm.set(key, e);
    }
  }

  // ── Campaign metadata + utm→campaignId map ────────────────────────────────
  const campaignIds = Array.from(new Set(posts.map((p) => p.campaignId).filter((x): x is string => !!x)));
  const campaignRows = campaignIds.length
    ? await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(inArray(campaigns.id, campaignIds))
    : [];
  const campaignName = new Map(campaignRows.map((c) => [c.id, c.name]));

  const linkRows = await db
    .select({ campaignId: marketingLinks.campaignId, utmCampaign: marketingLinks.utmCampaign })
    .from(marketingLinks)
    .where(and(eq(marketingLinks.tenantDomain, tenantDomain), eq(marketingLinks.marketId, marketId)));
  const convByCampaignId = new Map<string, { conversions: number; revenue: number }>();
  for (const l of linkRows) {
    if (!l.campaignId || !l.utmCampaign) continue;
    const conv = convByUtm.get(l.utmCampaign.toLowerCase());
    if (conv) {
      const e = convByCampaignId.get(l.campaignId) ?? { conversions: 0, revenue: 0 };
      e.conversions += conv.conversions;
      e.revenue += conv.revenue;
      convByCampaignId.set(l.campaignId, e);
    }
  }

  // ── byCampaign rows ───────────────────────────────────────────────────────
  const allCampaignKeys = new Set<string>(
    Array.from(postsByCampaign.keys()).concat(Array.from(clicksByCampaignId.keys())),
  );
  const byCampaign = Array.from(allCampaignKeys).map((key) => {
    const isNone = key === "__none__";
    const conv = isNone ? undefined : convByCampaignId.get(key);
    return {
      campaignId: isNone ? null : key,
      name: isNone ? "(no campaign)" : campaignName.get(key) ?? "(unknown campaign)",
      posts: postsByCampaign.get(key) ?? 0,
      clicks: clicksByCampaignId.get(key) ?? 0,
      conversions: conv?.conversions ?? 0,
      revenue: conv?.revenue ?? 0,
    };
  }).sort((a, b) => b.clicks - a.clicks || b.conversions - a.conversions);

  // ── perContent rows (campaign-attributed clicks) ──────────────────────────
  const assetIds = Array.from(assetAgg.keys());
  const assetRows = assetIds.length
    ? await db.select({ id: contentAssets.id, title: contentAssets.title }).from(contentAssets).where(inArray(contentAssets.id, assetIds))
    : [];
  const assetTitle = new Map(assetRows.map((a) => [a.id, a.title]));
  const perContentRaw: ContentPerf[] = assetIds.map((id) => {
    const agg = assetAgg.get(id)!;
    const cids = Array.from(agg.campaignIds);
    const clicks = cids.reduce((sum, cid) => sum + (clicksByCampaignId.get(cid) ?? 0), 0);
    return {
      assetId: id,
      title: assetTitle.get(id) ?? "(untitled)",
      postsPublished: agg.posts,
      clicks,
      campaigns: cids.map((cid) => campaignName.get(cid) ?? cid),
    };
  });
  const perContent = rankContent(perContentRaw);

  // ── Benchmark vs prior equal-length period ────────────────────────────────
  const durMs = Math.max(periodEnd.getTime() - periodStart.getTime(), 86_400_000);
  const days = Math.max(1, Math.round(durMs / 86_400_000));
  const baseStart = new Date(periodStart.getTime() - durMs);
  const baseEnd = new Date(periodStart.getTime() - 1);

  const baseClickRows = await clicksByCampaign(tenantDomain, marketId, isDefaultMarket, baseStart, baseEnd);
  const baseClicks = baseClickRows.reduce((s, r) => s + r.clicks, 0);
  // analytics_daily is keyed by whole UTC days. Use an exclusive upper bound at
  // the period's start day so the baseline window can't overlap the current
  // period by a day when periodStart isn't aligned to UTC midnight.
  const baseConvRows = await db
    .select({ conversions: analyticsDaily.conversions })
    .from(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.tenantDomain, tenantDomain),
        analyticsMarketScope,
        gte(analyticsDaily.date, dayStr(baseStart)),
        lt(analyticsDaily.date, dayStr(periodStart)),
      ),
    );
  const baseConversions = baseConvRows.reduce((s, r) => s + r.conversions, 0);
  const hasBaseline = baseClicks > 0 || baseConversions > 0;

  const metrics: MarketingPerformanceMetrics = {
    totals: {
      posts: posts.length,
      clicks: totalClicks,
      conversions: totalConversions,
      revenue: totalRevenue,
      sessions: totalSessions,
    },
    benchmark: hasBaseline
      ? {
          hasBaseline: true,
          clicksIndex: indexVsBaseline(totalClicks, days, baseClicks, days) ?? undefined,
          conversionsIndex: indexVsBaseline(totalConversions, days, baseConversions, days) ?? undefined,
        }
      : { hasBaseline: false },
    byCampaign,
    perContent,
  };

  // ── Analyst synthesis (degrades gracefully if the AI call fails) ──────────
  let summary: string | null = null;
  let recommendations: ParsedRecommendation[] = [];
  try {
    const strategicCtx = await loadStrategicContext(tenantDomain, params.marketId, params.isDefaultMarket);
    const strategicBlock = formatStrategicContextForPrompt(strategicCtx);
    const prompt = [
      `Analyze this content marketing performance for ${dayStr(periodStart)} → ${dayStr(periodEnd)} and recommend what to do next cycle.`,
      strategicBlock,
      `## Metrics\n${formatMetricsForPrompt(metrics)}`,
      `## Notes\n- Conversions/clicks are campaign-attributed (lowest granularity the data supports).\n- If conversions are 0, GA4 may not be connected — focus on clicks + publishing as leading indicators and say so.`,
      `## Output JSON\n{ "summary": string (3-5 sentences, conversion-first), "recommendations": [{ "title": string, "description": string (specific + actionable for the editorial calendar), "impact": "High" | "Medium" | "Low" }] (3-6 items) }`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await completeForFeature("marketing_tasks", prompt, {
      tenantDomain,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 3000,
    });
    const parsed = parsePerformanceResponse(result.text);
    summary = parsed.summary;
    recommendations = parsed.recommendations;
  } catch (err) {
    console.error("[performance] analyst synthesis failed:", err);
  }

  return { metrics, summary, recommendations };
}
