import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { outreachCampaigns, prospects, marketingContacts, outreachTouches, externalOutreachActivities } from "@shared/schema";
import { buildOutreachWorkspace, nextStepCompletions } from "./outreach-workspace-core";

export class OutreachWorkspaceError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export async function loadOutreachWorkspace(tenant: string, marketId: string, campaignId: string) {
  const [campaign] = await db.select().from(outreachCampaigns).where(and(
    eq(outreachCampaigns.id, campaignId), eq(outreachCampaigns.tenantDomain, tenant),
  ));
  if (!campaign || (campaign.marketId && campaign.marketId !== marketId)) throw new OutreachWorkspaceError("Campaign not found", 404);
  const [rows, touches] = await Promise.all([
    db.select({ person: prospects, firstName: marketingContacts.firstName, lastName: marketingContacts.lastName,
      email: marketingContacts.email, companyName: marketingContacts.company,
      outreachHold: marketingContacts.outreachHold, emailOptOut: marketingContacts.emailOptOut })
      .from(prospects).innerJoin(marketingContacts, and(eq(prospects.contactId, marketingContacts.id), eq(marketingContacts.tenantDomain, tenant)))
      .where(and(eq(prospects.campaignId, campaign.id), eq(prospects.tenantDomain, tenant), isNull(prospects.removedAt))),
    db.select({ id: outreachTouches.id, prospectId: outreachTouches.prospectId, status: outreachTouches.status,
      generatedAt: outreachTouches.generatedAt, sentAt: outreachTouches.sentAt }).from(outreachTouches)
      .where(and(eq(outreachTouches.campaignId, campaign.id), eq(outreachTouches.tenantDomain, tenant))),
  ]);
  const contactIds = [...new Set(rows.map(row => row.person.contactId))];
  const activities = contactIds.length ? await db.select({
    id: externalOutreachActivities.id, updatedAt: externalOutreachActivities.updatedAt,
    campaignId: externalOutreachActivities.campaignId,
    contactId: externalOutreachActivities.contactId, direction: externalOutreachActivities.direction,
    outcome: externalOutreachActivities.outcome, occurredAt: externalOutreachActivities.occurredAt,
    followUpAt: externalOutreachActivities.followUpAt,
  }).from(externalOutreachActivities).where(and(
    inArray(externalOutreachActivities.contactId, contactIds), eq(externalOutreachActivities.tenantDomain, tenant),
  )) : [];
  const people = rows.map(({ person, ...contact }) => ({ ...person, ...contact,
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || "Unnamed contact" }));
  return buildOutreachWorkspace(campaign, people, touches,
    activities.filter(activity => activity.campaignId === campaign.id), new Date(), activities);
}

export async function completeOutreachNextStep(tenant: string, marketId: string, userId: string, campaignId: string,
  input: { prospectId: string; itemId: string; version: string; completed: boolean }) {
  return db.transaction(async tx => {
    const [person] = await tx.select().from(prospects).where(and(
      eq(prospects.id, input.prospectId), eq(prospects.campaignId, campaignId),
      eq(prospects.tenantDomain, tenant), isNull(prospects.removedAt),
    )).for("update");
    if (!person) throw new OutreachWorkspaceError("Contact not found in this campaign.", 404);
    const workspace = await loadOutreachWorkspace(tenant, marketId, campaignId);
    const item = [...workspace.items, ...workspace.completedItems].find(step => step.id === input.itemId && step.prospectId === person.id);
    if (!item || item.version !== input.version) throw new OutreachWorkspaceError("This next step changed. Refresh and review it before marking it done.");
    const completions = nextStepCompletions(person.signals);
    if (input.completed) completions[item.id] = { version: item.version, completedAt: new Date().toISOString(), completedBy: userId };
    else delete completions[item.id];
    if (Object.keys(completions).length > 1000) throw new OutreachWorkspaceError("This contact has too many saved completion records. No records were discarded.");
    await tx.update(prospects).set({
      signals: { ...person.signals, nextStepCompletions: completions },
      updatedAt: new Date(),
    }).where(and(eq(prospects.id, person.id), eq(prospects.tenantDomain, tenant), eq(prospects.campaignId, campaignId)));
    return { completed: input.completed, itemId: item.id };
  });
}
