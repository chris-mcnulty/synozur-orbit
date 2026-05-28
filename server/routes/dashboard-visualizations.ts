import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, guardFeature } from "./helpers";

function parseDate(value: unknown, fallback: Date): Date {
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return fallback;
}

function parseCompetitorIds(value: unknown): string[] | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

type Bucket = "day" | "week" | "month";

function parseBucket(value: unknown): Bucket {
  if (value === "day" || value === "month") return value;
  return "week";
}

// Truncate a date to the start of its bucket (UTC). Keeps things SQL-free so we don't need
// vendor-specific date_trunc behaviour for the small response set sizes the dashboard returns.
function bucketStart(date: Date, bucket: Bucket): string {
  const d = new Date(date.getTime());
  d.setUTCHours(0, 0, 0, 0);
  if (bucket === "week") {
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day);
  } else if (bucket === "month") {
    d.setUTCDate(1);
  }
  return d.toISOString().split("T")[0];
}

interface DateRangeParams {
  from: Date;
  until: Date;
}

function defaultRange(req: any): DateRangeParams {
  const until = parseDate(req.query.until, new Date());
  const ninetyDays = new Date(until.getTime() - 90 * 24 * 60 * 60 * 1000);
  const from = parseDate(req.query.from, ninetyDays);
  return { from, until };
}

export function registerDashboardVisualizationRoutes(app: Express) {
  // Engagement trends across platforms — raw time series (followers/posts/reactions/comments/likes)
  app.get("/api/dashboard/visualizations/engagement-trends", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "visualizationDashboard"))) return;
      const ctx = await getRequestContext(req);
      const { from, until } = defaultRange(req);
      const platforms = parseCompetitorIds(req.query.platforms);
      const competitorIds = parseCompetitorIds(req.query.competitorIds);

      const snapshots = await storage.getEngagementSnapshotsForTenant(ctx.tenantDomain, {
        since: from,
        until,
        marketId: ctx.marketId,
        competitorIds,
        platforms,
      });

      const points = snapshots.map(s => ({
        snapshotAt: s.capturedAt,
        competitorId: s.competitorId,
        platform: s.platform,
        followers: s.followers,
        posts: s.posts,
        reactions: s.reactions,
        comments: s.comments,
        likes: s.likes,
      }));

      return res.json({ from, until, points });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("[Viz] engagement-trends error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Posting frequency: count of social/blog activity per competitor per bucket
  app.get("/api/dashboard/visualizations/posting-frequency", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "visualizationDashboard"))) return;
      const ctx = await getRequestContext(req);
      const { from, until } = defaultRange(req);
      const bucket = parseBucket(req.query.bucket);

      const activities = await storage.getActivityByContext(toContextFilter(ctx));
      const filtered = activities.filter(a => {
        const created = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any);
        if (created < from || created > until) return false;
        if (!a.competitorId) return false;
        return a.type === "blog_post" || a.type === "social_update";
      });

      const counts = new Map<string, Map<string, number>>(); // bucket -> competitorId -> count
      for (const a of filtered) {
        const created = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any);
        const key = bucketStart(created, bucket);
        const inner = counts.get(key) || new Map<string, number>();
        inner.set(a.competitorId!, (inner.get(a.competitorId!) || 0) + 1);
        counts.set(key, inner);
      }

      const series: Array<{ bucket: string; competitorId: string; count: number }> = [];
      counts.forEach((byCompetitor, bucketKey) => {
        byCompetitor.forEach((count, competitorId) => {
          series.push({ bucket: bucketKey, competitorId, count });
        });
      });
      series.sort((a, b) => a.bucket.localeCompare(b.bucket));

      return res.json({ from, until, bucket, series });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("[Viz] posting-frequency error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Sentiment over time: average sentimentScore per competitor per bucket (where analysis exists)
  app.get("/api/dashboard/visualizations/sentiment-trends", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "visualizationDashboard"))) return;
      const ctx = await getRequestContext(req);
      const { from, until } = defaultRange(req);
      const bucket = parseBucket(req.query.bucket);

      const activities = await storage.getActivityByContext(toContextFilter(ctx));
      const filtered = activities.filter(a => {
        if (a.sentimentScore === null || a.sentimentScore === undefined) return false;
        if (!a.competitorId) return false;
        const ts = a.analyzedAt
          ? (a.analyzedAt instanceof Date ? a.analyzedAt : new Date(a.analyzedAt as any))
          : (a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any));
        return ts >= from && ts <= until;
      });

      const totals = new Map<string, Map<string, { sum: number; count: number }>>();
      for (const a of filtered) {
        const ts = a.analyzedAt
          ? (a.analyzedAt instanceof Date ? a.analyzedAt : new Date(a.analyzedAt as any))
          : (a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any));
        const bucketKey = bucketStart(ts, bucket);
        const inner = totals.get(bucketKey) || new Map<string, { sum: number; count: number }>();
        const prev = inner.get(a.competitorId!) || { sum: 0, count: 0 };
        prev.sum += a.sentimentScore as number;
        prev.count += 1;
        inner.set(a.competitorId!, prev);
        totals.set(bucketKey, inner);
      }

      const series: Array<{ bucket: string; competitorId: string; avgSentiment: number; count: number }> = [];
      totals.forEach((byCompetitor, bucketKey) => {
        byCompetitor.forEach((stats, competitorId) => {
          series.push({
            bucket: bucketKey,
            competitorId,
            avgSentiment: Number((stats.sum / stats.count).toFixed(3)),
            count: stats.count,
          });
        });
      });
      series.sort((a, b) => a.bucket.localeCompare(b.bucket));

      return res.json({ from, until, bucket, series });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("[Viz] sentiment-trends error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Activity by competitor: total activity counts per competitor per bucket
  app.get("/api/dashboard/visualizations/activity-by-competitor", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "visualizationDashboard"))) return;
      const ctx = await getRequestContext(req);
      const { from, until } = defaultRange(req);
      const bucket = parseBucket(req.query.bucket);

      const activities = await storage.getActivityByContext(toContextFilter(ctx));
      const filtered = activities.filter(a => {
        if (!a.competitorId) return false;
        const created = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any);
        return created >= from && created <= until;
      });

      const counts = new Map<string, Map<string, number>>();
      for (const a of filtered) {
        const created = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any);
        const bucketKey = bucketStart(created, bucket);
        const inner = counts.get(bucketKey) || new Map<string, number>();
        inner.set(a.competitorId!, (inner.get(a.competitorId!) || 0) + 1);
        counts.set(bucketKey, inner);
      }

      const series: Array<{ bucket: string; competitorId: string; count: number }> = [];
      counts.forEach((byCompetitor, bucketKey) => {
        byCompetitor.forEach((count, competitorId) => {
          series.push({ bucket: bucketKey, competitorId, count });
        });
      });
      series.sort((a, b) => a.bucket.localeCompare(b.bucket));

      return res.json({ from, until, bucket, series });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("[Viz] activity-by-competitor error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Bonus widget: pricing trend lines — entry-tier price per competitor over time
  app.get("/api/dashboard/visualizations/pricing-trends", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "visualizationDashboard"))) return;
      const ctx = await getRequestContext(req);
      const { from, until } = defaultRange(req);
      const competitorIds = parseCompetitorIds(req.query.competitorIds);

      const snapshots = await storage.getPricingSnapshotsForTenant(ctx.tenantDomain, {
        since: from,
        until,
        marketId: ctx.marketId,
        competitorIds,
      });

      const points = snapshots.map(s => {
        const tiers = Array.isArray(s.tiers) ? (s.tiers as any[]) : [];
        const numericTiers = tiers.filter(t => typeof t.priceAmount === "number");
        const cheapest = numericTiers.length
          ? numericTiers.reduce((min, t) => (t.priceAmount < min.priceAmount ? t : min), numericTiers[0])
          : null;
        const dearest = numericTiers.length
          ? numericTiers.reduce((max, t) => (t.priceAmount > max.priceAmount ? t : max), numericTiers[0])
          : null;
        return {
          snapshotAt: s.capturedAt,
          competitorId: s.competitorId,
          tierCount: tiers.length,
          cheapestTier: cheapest ? { name: cheapest.name, priceAmount: cheapest.priceAmount } : null,
          dearestTier: dearest ? { name: dearest.name, priceAmount: dearest.priceAmount } : null,
          currency: s.currency,
        };
      });

      return res.json({ from, until, points });
    } catch (error: any) {
      if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      console.error("[Viz] pricing-trends error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
