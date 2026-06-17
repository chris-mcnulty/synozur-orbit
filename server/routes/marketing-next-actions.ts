/**
 * Marketing "next actions" routes.
 *
 * Surfaces the batch-level "what's the next step" rollup for marketing
 * campaigns — scoped to one campaign (campaign page) and across all active
 * campaigns (marketing hub). Read-only; gated on the `campaigns` feature.
 */

import type { Express } from "express";
import { db } from "../db";
import { campaigns } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import {
  getCampaignNextActions,
  getCrossCampaignNextActions,
} from "../services/campaign-next-actions-service";

export function registerMarketingNextActionsRoutes(app: Express) {
  // Next actions for one campaign, grouped by batch.
  app.get("/api/marketing/campaigns/:id/next-actions", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "campaigns"))) return;
      const ctx = await getRequestContext(req);
      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantDomain, ctx.tenantDomain)));
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const groups = await getCampaignNextActions(ctx.tenantDomain, campaign.id);
      res.json({ groups });
    } catch (err: any) {
      console.error("[marketing-next-actions:campaign]", err);
      res.status(500).json({ error: err.message || "Failed to load next actions" });
    }
  });

  // Cross-campaign next actions for the marketing hub.
  app.get("/api/marketing/next-actions", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "campaigns"))) return;
      const ctx = await getRequestContext(req);
      const campaignsOut = await getCrossCampaignNextActions(ctx.tenantDomain);
      res.json({ campaigns: campaignsOut });
    } catch (err: any) {
      console.error("[marketing-next-actions:hub]", err);
      res.status(500).json({ error: err.message || "Failed to load next actions" });
    }
  });
}
