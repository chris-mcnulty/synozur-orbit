import type { Express } from "express";
import { getRequestContext } from "../context";
import { assessMarketingContextReadiness } from "../services/marketing-context-readiness";

/**
 * Marketing context grounding routes.
 *
 * Surfaces how complete a tenant's intrinsic marketing data is (the Orbit
 * equivalent of Cowork's variables.md) so users know whether content
 * generation will be well-grounded or generic.
 */
export function registerMarketingContextRoutes(app: Express) {
  app.get("/api/marketing/context-readiness", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      const report = await assessMarketingContextReadiness(
        ctx.tenantDomain,
        ctx.marketId,
        ctx.isDefaultMarket,
      );
      res.json(report);
    } catch (err: any) {
      console.error("[marketing-context-readiness]", err);
      res.status(500).json({ error: err.message || "Failed to assess marketing context readiness" });
    }
  });
}
