import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter } from "./helpers";

export function registerPositioningMapRoutes(app: Express) {
  // F2: GET /api/positioning-map — retrieve all positions for current tenant/market
  app.get("/api/positioning-map", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const ctxFilter = toContextFilter(ctx);
      const positions = await storage.getPositionsByContext(ctxFilter);
      res.json({ positions });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // F2: PUT /api/positioning-map — upsert positions for current tenant/market
  app.put("/api/positioning-map", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const ctxFilter = toContextFilter(ctx);
      const { positions } = req.body as {
        positions: Array<{
          competitorId?: string;
          companyProfileId?: string;
          label: string;
          xAxis: string;
          yAxis: string;
          xValue: number;
          yValue: number;
        }>;
      };

      if (!Array.isArray(positions)) {
        return res.status(400).json({ error: "positions array is required" });
      }

      const toUpsert = positions.map((p) => ({
        tenantDomain: ctxFilter.tenantDomain,
        marketId: ctxFilter.marketId,
        competitorId: p.competitorId || null,
        companyProfileId: p.companyProfileId || null,
        label: p.label,
        xAxis: p.xAxis,
        yAxis: p.yAxis,
        xValue: Math.max(0, Math.min(100, Math.round(p.xValue))),
        yValue: Math.max(0, Math.min(100, Math.round(p.yValue))),
      }));

      const results = await storage.upsertPositions(toUpsert);
      res.json({ positions: results });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });
}
