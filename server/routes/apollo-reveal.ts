import type { Express } from "express";
import { z } from "zod";
import { MAX_APOLLO_REVEAL_BATCH } from "@shared/apollo-reveal";
import { getRequestContext } from "../context";
import { guardFeature, denyReadOnly } from "./helpers";
import { getCampaign } from "../services/outreach-interview-service";
import { storage } from "../storage";
import { reserveManualAction, type ManualActionReservation } from "../services/manual-action-quota";
import { ApolloRevealError, verifyApolloPreviews } from "../services/apollo-reveal-core";
import { revealApolloPreviews } from "../services/apollo-reveal-service";

const requestSchema = z.object({
  tokens: z.array(z.string().min(1).max(8192)).min(1).max(MAX_APOLLO_REVEAL_BATCH),
  confirmCredits: z.literal(true),
}).strict();

export function registerApolloRevealRoutes(app: Express) {
  app.post("/api/sales-outreach/campaigns/:id/discover/reveal", async (req, res) => {
    const reservations: ManualActionReservation[] = [];
    let attempted = new Set<string>();
    let previewIds: string[] = [];
    try {
      if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const campaign = await getCampaign(ctx.tenantDomain, req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const body = requestSchema.safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: `Explicit credit confirmation and 1–${MAX_APOLLO_REVEAL_BATCH} preview tokens are required.` });
      const scope = { tenantDomain: ctx.tenantDomain, campaignId: campaign.id, userId: ctx.userId };
      // Validate the whole batch before any quota reservations or paid calls.
      const previews = verifyApolloPreviews(body.data.tokens, scope, process.env.SESSION_SECRET ?? "");
      previewIds = previews.map(p => p.preview.id);
      const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
      for (const _ of previews) {
        const reservation = await reserveManualAction(ctx.tenantDomain, tenant?.plan ?? "free", "enrichProspectContact", ctx.userId);
        if (!reservation.ok) return res.status(403).json({ error: reservation.reason, upgradeRequired: true, requiredPlan: reservation.requiredPlan });
        reservations.push(reservation);
      }
      const { attemptedIds, ...result } = await revealApolloPreviews(scope, body.data.tokens, previews);
      attempted = new Set(attemptedIds);
      res.json(result);
    } catch (err) {
      const status = err instanceof ApolloRevealError ? err.status : 500;
      res.status(status).json({ error: err instanceof ApolloRevealError ? err.message : "Apollo reveal could not complete. Do not retry automatically; prior attempts may have used credits." });
    } finally {
      await Promise.all(reservations.map((r, index) => r.commit(attempted.has(previewIds[index]))));
    }
  });
}
