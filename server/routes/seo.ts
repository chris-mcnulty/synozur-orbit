import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { ContextError, getRequestContext, type RequestContext } from "../context";
import { guardFeature, hasAdminAccess, hasContentAccess, toContextFilter, validateResourceContext, guardManualAction } from "./helpers";
import { runSerpQuery, normalizeDomain, type SerpQueryEntity } from "../services/seo-provider";
import type { InsertSeoMetric } from "@shared/schema";

const createKeywordSchema = z.object({
  keyword: z.string().trim().min(1, "Keyword is required").max(200, "Keyword too long"),
  country: z.string().trim().min(2).max(8).default("us"),
  locale: z.string().trim().min(2).max(8).default("en"),
});

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function collectSeoEntities(
  ctx: SeoRefreshContext,
): Promise<Array<SerpQueryEntity & { type: "baseline" | "competitor" }>> {
  const ctxFilter = toSeoContextFilter(ctx);
  const entities: Array<SerpQueryEntity & { type: "baseline" | "competitor" }> = [];

  const profile = await storage.getCompanyProfileByContext(ctxFilter);
  if (profile?.websiteUrl) {
    entities.push({
      id: profile.id,
      name: profile.companyName || "Our Company",
      url: profile.websiteUrl,
      type: "baseline",
    });
  }

  const competitors = await storage.getCompetitorsByContext(ctxFilter);
  for (const c of competitors) {
    if (!c.url) continue;
    entities.push({
      id: c.id,
      name: c.name,
      url: c.url,
      type: "competitor",
    });
  }
  return entities;
}

export function registerSeoRoutes(app: Express) {
  app.get("/api/seo/keywords", async (req, res) => {
    if (!await guardFeature(req, res, "seoTracking")) return;
    try {
      const ctx = await getRequestContext(req);
      const keywords = await storage.getTrackedKeywordsByContext(toContextFilter(ctx));
      res.json(keywords);
    } catch (error) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/seo/keywords", async (req, res) => {
    if (!await guardFeature(req, res, "seoTracking")) return;
    try {
      const ctx = await getRequestContext(req);
      if (!hasContentAccess(ctx.userRole)) {
        return res.status(403).json({ error: "Only Domain or Global Admins can manage tracked keywords" });
      }
      const body = createKeywordSchema.parse(req.body);

      const existing = await storage.getTrackedKeywordsByContext(toContextFilter(ctx));
      if (existing.some((k) => k.keyword.toLowerCase() === body.keyword.toLowerCase() && k.country === body.country.toLowerCase())) {
        return res.status(409).json({ error: "Keyword is already tracked in this market" });
      }

      const created = await storage.createTrackedKeyword({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.isDefaultMarket ? null : ctx.marketId,
        keyword: body.keyword,
        country: body.country.toLowerCase(),
        locale: body.locale.toLowerCase(),
        createdBy: ctx.userId,
      });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/seo/keywords/:id", async (req, res) => {
    if (!await guardFeature(req, res, "seoTracking")) return;
    try {
      const ctx = await getRequestContext(req);
      if (!hasContentAccess(ctx.userRole)) {
        return res.status(403).json({ error: "Only Domain or Global Admins can manage tracked keywords" });
      }
      const keyword = await storage.getTrackedKeyword(req.params.id);
      if (!keyword) return res.status(404).json({ error: "Keyword not found" });
      if (!validateResourceContext(keyword, ctx)) return res.status(403).json({ error: "Access denied" });
      await storage.deleteTrackedKeyword(req.params.id);
      res.status(204).send();
    } catch (error) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/seo/refresh", async (req, res) => {
    if (!await guardFeature(req, res, "seoTracking")) return;
    if (!await guardManualAction(req, res, "seoSweep")) return;
    try {
      const ctx = await getRequestContext(req);
      const result = await refreshSeoForContext(ctx);
      res.json(result);
    } catch (error) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/seo/metrics", async (req, res) => {
    if (!await guardFeature(req, res, "seoTracking")) return;
    try {
      const ctx = await getRequestContext(req);
      const metrics = await storage.getLatestSeoMetricsByContext(toContextFilter(ctx));
      res.json(metrics);
    } catch (error) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/seo/keywords/:id/history", async (req, res) => {
    if (!await guardFeature(req, res, "seoTracking")) return;
    try {
      const ctx = await getRequestContext(req);
      const keyword = await storage.getTrackedKeyword(req.params.id);
      if (!keyword) return res.status(404).json({ error: "Keyword not found" });
      if (!validateResourceContext(keyword, ctx)) return res.status(403).json({ error: "Access denied" });
      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      const history = await storage.getSeoMetricsByKeyword(req.params.id, limit);
      res.json(history);
    } catch (error) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/seo/share-of-voice", async (req, res) => {
    if (!await guardFeature(req, res, "seoTracking")) return;
    try {
      const ctx = await getRequestContext(req);
      const data = await buildShareOfVoice(ctx);
      res.json(data);
    } catch (error) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/seo/share-of-voice.csv", async (req, res) => {
    if (!await guardFeature(req, res, "seoTracking")) return;
    try {
      const ctx = await getRequestContext(req);
      const data = await buildShareOfVoice(ctx);

      const headers = ["Entity", "Type", "Domain", "Average Rank", "Keywords Ranking", "Total Estimated Traffic", "Share of Voice (%)"];
      const rows = data.entities.map((e) => [
        escapeCsv(e.name),
        escapeCsv(e.type),
        escapeCsv(e.domain ?? ""),
        escapeCsv(e.averageRank !== null ? e.averageRank.toFixed(1) : ""),
        escapeCsv(e.keywordsRanking),
        escapeCsv(e.totalTraffic),
        escapeCsv((e.shareOfVoice / 100).toFixed(2)),
      ]);
      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

      const date = new Date().toISOString().split("T")[0];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="share-of-voice-${date}.csv"`);
      res.send(csv);
    } catch (error) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/competitors/:id/seo", async (req, res) => {
    if (!await guardFeature(req, res, "seoTracking")) return;
    try {
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) return res.status(403).json({ error: "Access denied" });

      const ctxFilter = toContextFilter(ctx);
      const [keywords, metrics, competitorMetrics] = await Promise.all([
        storage.getTrackedKeywordsByContext(ctxFilter),
        storage.getLatestSeoMetricsByContext(ctxFilter),
        storage.getSeoMetricsForCompetitor(ctxFilter, req.params.id),
      ]);

      const byKeyword: Record<string, { latest: any; previous: any }> = {};
      for (const m of competitorMetrics) {
        const slot = byKeyword[m.keywordId] || { latest: null, previous: null };
        if (!slot.latest) slot.latest = m;
        else if (!slot.previous) slot.previous = m;
        byKeyword[m.keywordId] = slot;
      }

      const rows = keywords.map((k) => {
        const slot = byKeyword[k.id] || { latest: null, previous: null };
        const previousRank = slot.previous?.rank ?? null;
        const currentRank = slot.latest?.rank ?? null;
        let change: number | null = null;
        if (currentRank !== null && previousRank !== null) {
          // Positive change = moved up in rankings (lower number).
          change = previousRank - currentRank;
        }
        return {
          keywordId: k.id,
          keyword: k.keyword,
          country: k.country,
          rank: currentRank,
          previousRank,
          weekOverWeekChange: change,
          estimatedTraffic: slot.latest?.estimatedTraffic ?? 0,
          shareOfVoice: slot.latest?.shareOfVoice ?? 0,
          capturedAt: slot.latest?.capturedAt ?? null,
        };
      });

      res.json({
        competitorId: req.params.id,
        keywords: rows,
        baselineMetrics: metrics.filter((m) => m.entityType === "baseline"),
      });
    } catch (error) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });
}

export interface SeoRefreshContext {
  tenantDomain: string;
  tenantId: string;
  marketId: string;
  isDefaultMarket?: boolean;
}

function toSeoContextFilter(ctx: SeoRefreshContext) {
  return {
    tenantId: ctx.tenantId,
    marketId: ctx.marketId,
    tenantDomain: ctx.tenantDomain,
    isDefaultMarket: ctx.isDefaultMarket ?? false,
  };
}

/**
 * Maximum SERP queries (≈ tracked keywords) we'll process for a single tenant
 * in one refresh. Acts as a per-tenant guardrail so a heavy refresh doesn't
 * blow through the SERP API plan in a single sweep. Configure via
 * SERP_MAX_KEYWORDS_PER_REFRESH; default 100.
 */
const DEFAULT_MAX_KEYWORDS_PER_REFRESH = 100;

function getMaxKeywordsPerRefresh(): number {
  const raw = process.env.SERP_MAX_KEYWORDS_PER_REFRESH;
  if (raw === undefined) return DEFAULT_MAX_KEYWORDS_PER_REFRESH;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_KEYWORDS_PER_REFRESH;
  return parsed;
}

export async function refreshSeoForContext(
  ctx: SeoRefreshContext,
): Promise<{ keywordsProcessed: number; rowsRecorded: number; entitiesTracked: number; keywordsSkipped?: number }> {
  const ctxFilter = toSeoContextFilter(ctx);
  const allKeywords = await storage.getTrackedKeywordsByContext(ctxFilter);
  if (allKeywords.length === 0) {
    return { keywordsProcessed: 0, rowsRecorded: 0, entitiesTracked: 0 };
  }

  const entities = await collectSeoEntities(ctx);
  if (entities.length === 0) {
    return { keywordsProcessed: 0, rowsRecorded: 0, entitiesTracked: 0 };
  }

  const cap = getMaxKeywordsPerRefresh();
  const keywords = allKeywords.slice(0, cap);
  const keywordsSkipped = allKeywords.length - keywords.length;
  if (keywordsSkipped > 0) {
    console.warn(
      `[SEO Refresh] Tenant ${ctx.tenantDomain} has ${allKeywords.length} keywords, ` +
      `capping this refresh at ${cap} to preserve SERP quota (skipped ${keywordsSkipped}). ` +
      `Raise SERP_MAX_KEYWORDS_PER_REFRESH if needed.`,
    );
  }

  let rowsRecorded = 0;
  for (const keyword of keywords) {
    const results = await runSerpQuery({
      keyword: keyword.keyword,
      country: keyword.country,
      locale: keyword.locale,
      entities: entities.map(({ id, name, url }) => ({ id, name, url })),
    });

    const inserts: InsertSeoMetric[] = results.map((r) => {
      const entityType = entities.find((e) => e.id === r.entityId)?.type ?? "competitor";
      return {
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.isDefaultMarket ? null : ctx.marketId,
        keywordId: keyword.id,
        entityType,
        entityId: r.entityId,
        entityName: r.entityName,
        entityDomain: r.entityDomain ?? normalizeDomain(entities.find((e) => e.id === r.entityId)?.url),
        rank: r.rank,
        estimatedTraffic: r.estimatedTraffic,
        shareOfVoice: r.shareOfVoice,
      };
    });

    const recorded = await storage.recordSeoMetrics(inserts);
    rowsRecorded += recorded.length;
  }

  return {
    keywordsProcessed: keywords.length,
    rowsRecorded,
    entitiesTracked: entities.length,
    ...(keywordsSkipped > 0 ? { keywordsSkipped } : {}),
  };
}

async function buildShareOfVoice(ctx: RequestContext) {
  const ctxFilter = toContextFilter(ctx);
  const [keywords, metrics] = await Promise.all([
    storage.getTrackedKeywordsByContext(ctxFilter),
    storage.getLatestSeoMetricsByContext(ctxFilter),
  ]);

  type EntitySummary = {
    entityId: string;
    name: string;
    type: "baseline" | "competitor";
    domain: string | null;
    averageRank: number | null;
    keywordsRanking: number;
    totalTraffic: number;
    shareOfVoice: number;
  };

  const summaryByEntity = new Map<string, EntitySummary>();
  let totalTraffic = 0;

  for (const m of metrics) {
    if (!m.entityId) continue;
    const existing = summaryByEntity.get(m.entityId) || {
      entityId: m.entityId,
      name: m.entityName,
      type: (m.entityType === "baseline" ? "baseline" : "competitor") as "baseline" | "competitor",
      domain: m.entityDomain,
      averageRank: null,
      keywordsRanking: 0,
      totalTraffic: 0,
      shareOfVoice: 0,
    };
    existing.totalTraffic += m.estimatedTraffic;
    if (m.rank !== null) {
      existing.keywordsRanking += 1;
    }
    summaryByEntity.set(m.entityId, existing);
    totalTraffic += m.estimatedTraffic;
  }

  const ranksByEntity = new Map<string, number[]>();
  for (const m of metrics) {
    if (!m.entityId || m.rank === null) continue;
    const arr = ranksByEntity.get(m.entityId) || [];
    arr.push(m.rank);
    ranksByEntity.set(m.entityId, arr);
  }
  for (const [entityId, ranks] of Array.from(ranksByEntity.entries())) {
    const summary = summaryByEntity.get(entityId);
    if (!summary || ranks.length === 0) continue;
    summary.averageRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  }

  for (const summary of Array.from(summaryByEntity.values())) {
    summary.shareOfVoice = totalTraffic > 0
      ? Math.round((summary.totalTraffic / totalTraffic) * 10000)
      : 0;
  }

  const entities = Array.from(summaryByEntity.values()).sort((a, b) => b.shareOfVoice - a.shareOfVoice);

  return {
    keywordCount: keywords.length,
    entityCount: entities.length,
    totalTraffic,
    entities,
    metrics,
    keywords,
  };
}
