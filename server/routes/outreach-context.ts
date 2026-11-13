import type { Express, Request, Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { bulkMessagingSchema, contactFamiliarities, externalActivitySchema, messagingGroups, segmentBriefsSchema } from "@shared/outreach-context";
import { externalOutreachActivities, marketingContacts, outreachCampaigns, prospects } from "@shared/schema";
import { db } from "../db";
import { ContextError, getRequestContext } from "../context";
import { guardFeature } from "./helpers";
import { getOutreachContext, outreachContextPerson, OutreachContextError } from "../services/outreach-context-service";

async function setContactHold(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tenantDomain: string, contactId: string, hold: boolean) {
  await tx.update(marketingContacts).set({ outreachHold: hold }).where(and(eq(marketingContacts.id, contactId), eq(marketingContacts.tenantDomain, tenantDomain)));
  if (hold) await tx.update(prospects).set({ nextActionAt: null }).where(and(eq(prospects.contactId, contactId), eq(prospects.tenantDomain, tenantDomain)));
}

export function registerOutreachContextRoutes(app: Express) {
  const handle = (write: boolean, fn: (req: Request, res: Response, ctx: Awaited<ReturnType<typeof getRequestContext>>) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        if (!(await guardFeature(req, res, "salesOutreachCampaigns"))) return;
        const ctx = await getRequestContext(req);
        if (write && !["Analyst", "Domain Admin", "Global Admin"].includes(ctx.userRole)) {
          return res.status(403).json({ error: "Your role cannot edit outreach context." });
        }
        await fn(req, res, ctx);
      } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => i.message).join("; ") });
        if (error instanceof OutreachContextError || error instanceof ContextError) {
          return res.status(error.status).json({ error: error.message, ...(error instanceof OutreachContextError ? { code: error.code } : {}) });
        }
        console.error("[outreach-context]", error instanceof Error ? error.name : "Unknown error");
        res.status(500).json({ error: "Could not process outreach context. Please retry." });
      }
    };
  const base = "/api/sales-outreach/prospects/:id";
  app.get(`${base}/outreach-context`, handle(false, async (req, res, ctx) =>
    res.json(await getOutreachContext(ctx.tenantDomain, req.params.id, ctx.marketId))));
  app.patch(`${base}/outreach-context`, handle(true, async (req, res, ctx) => {
    const body = z.object({ hold: z.boolean().optional(), messagingGroup: z.enum(messagingGroups).nullable().optional(), familiarity: z.enum(contactFamiliarities).optional() }).strict().parse(req.body);
    const row = await outreachContextPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    await db.transaction(async tx => {
      if (body.hold !== undefined) {
        await setContactHold(tx, ctx.tenantDomain, row.contact.id, body.hold);
      }
      if (body.messagingGroup !== undefined) await tx.update(prospects).set({ messagingGroup: body.messagingGroup }).where(and(eq(prospects.id, row.person.id), eq(prospects.tenantDomain, ctx.tenantDomain)));
      if (body.familiarity !== undefined) await tx.update(prospects).set({ familiarity: body.familiarity }).where(and(eq(prospects.id, row.person.id), eq(prospects.tenantDomain, ctx.tenantDomain)));
    });
    res.json(await getOutreachContext(ctx.tenantDomain, req.params.id, ctx.marketId));
  }));
  const activityBase = `${base}/external-activities`;
  app.post(activityBase, handle(true, async (req, res, ctx) => {
    const { pauseOutreach, ...body } = externalActivitySchema.parse(req.body);
    const row = await outreachContextPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    const created = await db.transaction(async tx => {
      const [entry] = await tx.insert(externalOutreachActivities).values({
        ...body, occurredAt: new Date(body.occurredAt), followUpAt: body.followUpAt ? new Date(body.followUpAt) : null,
        tenantDomain: ctx.tenantDomain, contactId: row.contact.id, campaignId: row.campaign.id, createdBy: ctx.userId,
      }).returning();
      if (pauseOutreach) await setContactHold(tx, ctx.tenantDomain, row.contact.id, true);
      if (body.outcome === "replied" || body.outcome === "meeting_agreed") {
        await tx.update(prospects).set({ status: "replied", nextActionAt: null, updatedAt: new Date() })
          .where(and(eq(prospects.id, row.person.id), eq(prospects.tenantDomain, ctx.tenantDomain), isNull(prospects.removedAt)));
      }
      return entry;
    });
    res.status(201).json(created);
  }));
  app.patch(`${activityBase}/:activityId`, handle(true, async (req, res, ctx) => {
    const { pauseOutreach, ...body } = externalActivitySchema.parse(req.body);
    const row = await outreachContextPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    const updated = await db.transaction(async tx => {
    const [entry] = await tx.update(externalOutreachActivities).set({
      ...body, occurredAt: new Date(body.occurredAt), followUpAt: body.followUpAt ? new Date(body.followUpAt) : null, updatedAt: new Date(),
    }).where(and(eq(externalOutreachActivities.id, req.params.activityId), eq(externalOutreachActivities.tenantDomain, ctx.tenantDomain),
      eq(externalOutreachActivities.contactId, row.contact.id))).returning();
    if (!entry) throw new OutreachContextError("Activity not found.", 404);
    if (pauseOutreach) await setContactHold(tx, ctx.tenantDomain, row.contact.id, true);
    if (body.outcome === "replied" || body.outcome === "meeting_agreed") {
      await tx.update(prospects).set({ status: "replied", nextActionAt: null, updatedAt: new Date() })
        .where(and(eq(prospects.id, row.person.id), eq(prospects.tenantDomain, ctx.tenantDomain), isNull(prospects.removedAt)));
    }
    return entry;
    });
    res.json(updated);
  }));
  app.delete(`${activityBase}/:activityId`, handle(true, async (req, res, ctx) => {
    const row = await outreachContextPerson(ctx.tenantDomain, req.params.id, ctx.marketId);
    const deleted = await db.delete(externalOutreachActivities).where(and(
      eq(externalOutreachActivities.id, req.params.activityId), eq(externalOutreachActivities.tenantDomain, ctx.tenantDomain),
      eq(externalOutreachActivities.contactId, row.contact.id))).returning({ id: externalOutreachActivities.id });
    if (!deleted.length) throw new OutreachContextError("Activity not found.", 404);
    res.json({ deleted: true });
  }));
  const campaignBase = "/api/sales-outreach/campaigns/:id/messaging-briefs";
  const campaignFor = async (req: Request, ctx: Awaited<ReturnType<typeof getRequestContext>>) => {
    const [campaign] = await db.select().from(outreachCampaigns).where(and(eq(outreachCampaigns.id, req.params.id), eq(outreachCampaigns.tenantDomain, ctx.tenantDomain)));
    if (!campaign || (ctx.marketId && campaign.marketId && campaign.marketId !== ctx.marketId)) throw new OutreachContextError("Campaign not found.", 404);
    return campaign;
  };
  app.get(campaignBase, handle(false, async (req, res, ctx) => res.json((await campaignFor(req, ctx)).messagingBriefs ?? [])));
  app.post("/api/sales-outreach/campaigns/:id/prospects/remove", handle(true, async (req, res, ctx) => {
    const body = z.object({
      prospectIds: z.array(z.string().min(1)).min(1).max(200)
        .refine(ids => new Set(ids).size === ids.length, "Select each contact only once"),
      confirmed: z.literal(true),
    }).strict().parse(req.body);
    const campaign = await campaignFor(req, ctx);
    const removed = await db.transaction(async tx => {
      const rows = await tx.update(prospects).set({
        removedAt: new Date(), status: "dormant", nextActionAt: null, updatedAt: new Date(),
      }).where(and(eq(prospects.tenantDomain, ctx.tenantDomain),
        eq(prospects.campaignId, campaign.id), inArray(prospects.id, body.prospectIds)))
        .returning({ id: prospects.id });
      if (rows.length !== body.prospectIds.length) throw new OutreachContextError(
        "The selection changed or includes contacts outside this campaign. Nothing was removed. Refresh and select again.", 409);
      return rows.length;
    });
    res.json({ removed });
  }));
  app.patch("/api/sales-outreach/campaigns/:id/outreach-context", handle(true, async (req, res, ctx) => {
    const body = bulkMessagingSchema.parse(req.body);
    const campaign = await campaignFor(req, ctx);
    const updated = await db.transaction(async tx => {
      const rows = await tx.update(prospects).set({
        ...(body.messagingGroup !== undefined ? { messagingGroup: body.messagingGroup } : {}),
        ...(body.familiarity !== undefined ? { familiarity: body.familiarity } : {}),
        updatedAt: new Date(),
      }).where(and(
        eq(prospects.tenantDomain, ctx.tenantDomain), eq(prospects.campaignId, campaign.id),
        inArray(prospects.id, body.prospectIds),
      )).returning({ id: prospects.id });
      // Throw inside the transaction so mixed-scope or stale selections change nothing.
      if (rows.length !== body.prospectIds.length) throw new OutreachContextError(
        "Some selected contacts are no longer in this campaign. Refresh the directory and select them again.", 409);
      return rows.length;
    });
    res.json({ updated });
  }));
  app.put(campaignBase, handle(true, async (req, res, ctx) => {
    const body = z.object({ briefs: segmentBriefsSchema }).strict().parse(req.body);
    const campaign = await campaignFor(req, ctx);
    await db.update(outreachCampaigns).set({ messagingBriefs: body.briefs, updatedAt: new Date() })
      .where(and(eq(outreachCampaigns.id, campaign.id), eq(outreachCampaigns.tenantDomain, ctx.tenantDomain)));
    res.json(body.briefs);
  }));
}
