import type { Express } from "express";
import { db } from "../db";
import { marketingPerformanceReports, recommendations } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { computePerformanceReport } from "../services/performance-service";

export function registerMarketingPerformanceRoutes(app: Express) {
  // Generate a performance report for a period (default: last 30 days). Persists
  // the report and emits the analyst's recommendations as `recommendations`
  // rows so they surface in the recommendations feed and ground the next
  // editorial-calendar generation — closing the loop.
  app.post("/api/marketing/performance-report", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "marketingPerformance"))) return;
      const ctx = await getRequestContext(req);

      const now = new Date();
      const periodEnd = req.body?.periodEnd ? new Date(req.body.periodEnd) : now;
      const periodStart = req.body?.periodStart
        ? new Date(req.body.periodStart)
        : new Date(periodEnd.getTime() - 30 * 86_400_000);

      const { metrics, summary, recommendations: recs } = await computePerformanceReport({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        isDefaultMarket: ctx.isDefaultMarket,
        periodStart,
        periodEnd,
      });

      const result = await db.transaction(async (tx) => {
        let emitted: typeof recommendations.$inferSelect[] = [];
        if (recs.length > 0) {
          emitted = await tx
            .insert(recommendations)
            .values(
              recs.map((r) => ({
                id: randomUUID(),
                title: r.title,
                description: r.description,
                area: "Marketing",
                impact: r.impact,
                status: "pending",
                tenantDomain: ctx.tenantDomain,
                marketId: ctx.marketId || null,
              })),
            )
            .returning();
        }

        const [report] = await tx
          .insert(marketingPerformanceReports)
          .values({
            id: randomUUID(),
            tenantDomain: ctx.tenantDomain,
            marketId: ctx.marketId || null,
            periodStart,
            periodEnd,
            summary,
            metrics,
            recommendationsEmitted: emitted.length,
            createdBy: ctx.userId,
          })
          .returning();

        return { report, emitted };
      });

      res.status(201).json({ report: result.report, recommendations: result.emitted });
    } catch (err: any) {
      console.error("[performance-report generate]", err);
      res.status(500).json({ error: err.message || "Failed to generate performance report" });
    }
  });

  // List reports for the active tenant/market.
  app.get("/api/marketing/performance-reports", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const rows = await db
        .select()
        .from(marketingPerformanceReports)
        .where(
          and(
            eq(marketingPerformanceReports.tenantDomain, ctx.tenantDomain),
            eq(marketingPerformanceReports.marketId, ctx.marketId),
          ),
        )
        .orderBy(desc(marketingPerformanceReports.createdAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[performance-report list]", err);
      res.status(500).json({ error: err.message || "Failed to list performance reports" });
    }
  });
}
