import type { Express } from "express";
import { z } from "zod";
import { ContextError, getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { ClassificationError, updateCampaignClassification } from "../services/campaign-classification-service";
import { rescoreCampaignProspect } from "../services/prospect-rescore-service";

export function registerCampaignClassificationRoutes(app: Express) {
  app.post("/api/sales-outreach/campaigns/:id/prospects/:prospectId/rescore", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      if (!["Analyst", "Domain Admin", "Global Admin"].includes(ctx.userRole)) return res.status(403).json({ error: "Your role cannot rescore contacts." });
      res.json(await rescoreCampaignProspect(ctx.tenantDomain, ctx.marketId, req.params.id, req.params.prospectId, req.body));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => i.message).join("; ") });
      if (error instanceof ClassificationError || error instanceof ContextError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: "Could not save and rescore. No changes were saved." });
    }
  });
  app.patch("/api/sales-outreach/campaigns/:id/prospects/classification", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      if (!["Analyst", "Domain Admin", "Global Admin"].includes(ctx.userRole)) {
        return res.status(403).json({ error: "Your role cannot change campaign classifications." });
      }
      res.json(await updateCampaignClassification(ctx.tenantDomain, ctx.marketId, req.params.id, req.body));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => i.message).join("; ") });
      if (error instanceof ClassificationError || error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("[campaign-classification]", error instanceof Error ? error.name : "Unknown error");
      res.status(500).json({ error: "Could not save campaign classifications. No changes were saved." });
    }
  });
}
