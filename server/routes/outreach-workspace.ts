import type { Express } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { ContextError, getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { outreachCampaigns, prospects, marketingContacts, outreachTouches, externalOutreachActivities } from "@shared/schema";
import { buildOutreachWorkspace } from "../services/outreach-workspace-core";

export function registerOutreachWorkspaceRoutes(app: Express) {
  for (const path of ["next-steps", "summary"] as const) {
    app[path === "summary" ? "post" : "get"](`/api/sales-outreach/campaigns/:id/${path}`, async (req, res) => {
      try {
        if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
        const ctx = await getRequestContext(req);
        const [campaign] = await db.select().from(outreachCampaigns).where(and(
          eq(outreachCampaigns.id, req.params.id), eq(outreachCampaigns.tenantDomain, ctx.tenantDomain),
        ));
        if (!campaign || (campaign.marketId && campaign.marketId !== ctx.marketId)) {
          return res.status(404).json({ error: "Campaign not found" });
        }
        const [rows, touches] = await Promise.all([
          db.select({ person: prospects, firstName: marketingContacts.firstName, lastName: marketingContacts.lastName,
            email: marketingContacts.email, companyName: marketingContacts.company,
            outreachHold: marketingContacts.outreachHold, emailOptOut: marketingContacts.emailOptOut })
            .from(prospects).innerJoin(marketingContacts, and(eq(prospects.contactId, marketingContacts.id), eq(marketingContacts.tenantDomain, ctx.tenantDomain)))
            .where(and(eq(prospects.campaignId, campaign.id), eq(prospects.tenantDomain, ctx.tenantDomain), isNull(prospects.removedAt))),
          db.select({ id: outreachTouches.id, prospectId: outreachTouches.prospectId, status: outreachTouches.status,
            generatedAt: outreachTouches.generatedAt, sentAt: outreachTouches.sentAt }).from(outreachTouches)
            .where(and(eq(outreachTouches.campaignId, campaign.id), eq(outreachTouches.tenantDomain, ctx.tenantDomain))),
        ]);
        const contactIds = [...new Set(rows.map(row => row.person.contactId))];
        // Shared contacts retain their conversation history across campaigns, but
        // only the active campaign's contacts and tenant may inform this workspace.
        const activities = contactIds.length ? await db.select({
            campaignId: externalOutreachActivities.campaignId,
            contactId: externalOutreachActivities.contactId, direction: externalOutreachActivities.direction,
            outcome: externalOutreachActivities.outcome, occurredAt: externalOutreachActivities.occurredAt,
            followUpAt: externalOutreachActivities.followUpAt }).from(externalOutreachActivities)
            .where(and(inArray(externalOutreachActivities.contactId, contactIds),
              eq(externalOutreachActivities.tenantDomain, ctx.tenantDomain))) : [];
        const people = rows.map(({ person, ...contact }) => ({ ...person, ...contact,
          name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || "Unnamed contact" }));
        const result = buildOutreachWorkspace(campaign, people, touches,
          activities.filter(activity => activity.campaignId === campaign.id), new Date(), activities);
        res.setHeader("Cache-Control", "no-store");
        res.json(path === "summary" ? result : { generatedAt: result.generatedAt, items: result.items });
      } catch (error) {
        if (error instanceof ContextError) return res.status(error.status).json({ error: error.message });
        console.error("[outreach-workspace]", error instanceof Error ? error.name : "Unknown error");
        res.status(500).json({ error: "Could not load the current campaign snapshot. Please retry." });
      }
    });
  }
}
