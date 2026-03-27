import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext } from "../context";

export function registerPositioningRoutes(app: Express) {
  app.get("/api/positioning-map", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const ctx = await getRequestContext(req);
      const positions = await storage.getPositioningMap(ctx.tenantDomain);
      res.json(positions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/positioning-map", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const ctx = await getRequestContext(req);
      const { entityId, entityType, entityName, x, y, xAxisLabel, yAxisLabel } = req.body;
      if (!entityId || !entityType || !entityName) {
        return res.status(400).json({ error: "entityId, entityType, entityName required" });
      }
      const position = await storage.upsertPosition({
        tenantDomain: ctx.tenantDomain,
        entityId,
        entityType,
        entityName,
        x: x != null && x !== "" ? Number(x) : 50,
        y: y != null && y !== "" ? Number(y) : 50,
        xAxisLabel: xAxisLabel || "Market Presence",
        yAxisLabel: yAxisLabel || "Innovation",
      });
      res.json(position);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
