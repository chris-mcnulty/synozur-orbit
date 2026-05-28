import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import {
  toContextFilter,
  validateResourceContext,
  guardFeature,
  guardManualAction,
} from "./helpers";
import { socialLinkSchemas } from "@shared/schema";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { monitorCompetitorPricing } from "../services/pricing-intelligence";

const pricingUrlBodySchema = z.object({
  pricingPageUrl: socialLinkSchemas.pricingPageUrl.optional().nullable(),
});

export function registerPricingIntelligenceRoutes(app: Express) {
  // List pricing snapshots for a competitor (most-recent first)
  app.get("/api/competitors/:id/pricing", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "pricingIntelligence"))) return;
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const limitRaw = req.query.limit;
      const limit = typeof limitRaw === "string" ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200) : 50;
      const snapshots = await storage.getPricingSnapshotsForCompetitor(competitor.id, limit);

      return res.json({
        pricingPageUrl: competitor.pricingPageUrl || null,
        latestSnapshotAt: snapshots[0]?.capturedAt || null,
        latest: snapshots[0] || null,
        snapshots,
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("[Pricing] List error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update the pricing page URL on a competitor
  app.put("/api/competitors/:id/pricing-url", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "pricingIntelligence"))) return;
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const parsed = pricingUrlBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const next = parsed.data.pricingPageUrl?.trim() || null;
      const updated = await storage.updateCompetitor(competitor.id, { pricingPageUrl: next });
      return res.json({ id: updated.id, pricingPageUrl: updated.pricingPageUrl });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("[Pricing] URL update error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger a fresh pricing snapshot for a competitor
  app.post("/api/competitors/:id/pricing/refresh", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "pricingIntelligence"))) return;
      if (!(await guardManualAction(req, res, "pricingRefresh"))) return;
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (!competitor.pricingPageUrl) {
        return res.status(400).json({
          error: "No pricing page URL configured for this competitor",
          code: "no_pricing_url",
        });
      }

      const result = await monitorCompetitorPricing(competitor.id, {
        userId: req.session.userId,
        tenantDomain: ctx.tenantDomain,
      });

      return res.json(result);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("[Pricing] Refresh error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a specific pricing snapshot (e.g. spurious result). Admin-friendly cleanup.
  app.delete("/api/competitors/:id/pricing/snapshots/:snapshotId", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "pricingIntelligence"))) return;
      const ctx = await getRequestContext(req);
      const competitor = await storage.getCompetitor(req.params.id);
      if (!competitor) return res.status(404).json({ error: "Competitor not found" });
      if (!validateResourceContext(competitor, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const snapshot = await storage.getPricingSnapshot(req.params.snapshotId);
      if (!snapshot || snapshot.competitorId !== competitor.id) {
        return res.status(404).json({ error: "Snapshot not found" });
      }
      await storage.deletePricingSnapshot(snapshot.id);
      return res.json({ ok: true });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("[Pricing] Snapshot delete error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
