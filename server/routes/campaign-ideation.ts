import type { Express } from "express";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { ideateCampaigns } from "../services/campaign-ideation-service";
import { scanNewsForSubjects } from "../services/news-monitoring";

export function registerCampaignIdeationRoutes(app: Express) {
  // Scan news for arbitrary subjects/companies (not limited to tracked
  // competitors). Best-effort; used by the campaign ideation step.
  app.post("/api/news/scan", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "campaigns"))) return;
      await getRequestContext(req);
      const subjects = Array.isArray(req.body?.subjects) ? req.body.subjects : [];
      const news = await scanNewsForSubjects(subjects);
      res.json({ news });
    } catch (err: any) {
      console.error("[news scan]", err);
      res.status(500).json({ error: err.message || "Failed to scan news" });
    }
  });

  // Suggest candidate campaign ideas from grounding + latest intelligence
  // indicators/action items + a news scan of named subjects. The user can
  // adopt an idea (prefilling the campaign form) or bypass it entirely.
  app.post("/api/campaigns/ideate", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "campaigns"))) return;
      const ctx = await getRequestContext(req);
      const { message, subjects, count } = req.body ?? {};

      const result = await ideateCampaigns({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        isDefaultMarket: ctx.isDefaultMarket,
        message: typeof message === "string" ? message : undefined,
        subjects: Array.isArray(subjects) ? subjects : undefined,
        count: count ? Number(count) : undefined,
      });

      res.json(result);
    } catch (err: any) {
      console.error("[campaigns ideate]", err);
      res.status(500).json({ error: err.message || "Failed to generate campaign ideas" });
    }
  });
}
