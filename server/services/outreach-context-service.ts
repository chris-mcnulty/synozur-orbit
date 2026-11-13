import { and, eq, desc } from "drizzle-orm";
import { db } from "../db";
import { externalOutreachActivities, marketingContacts, outreachCampaigns, prospects } from "@shared/schema";
import type { OutreachContextSnapshot } from "@shared/outreach-context";
import { buildOutreachContextBlock, contextFingerprint } from "./outreach-context-core";
import { resolvedMessagingGroup } from "@shared/relationship-messaging-group";

export class OutreachContextError extends Error {
  constructor(message: string, public status = 409, public code = "OUTREACH_CONTEXT_CHANGED") { super(message); }
}

export async function outreachContextPerson(tenantDomain: string, prospectId: string, marketId?: string | null) {
  const [row] = await db.select({ person: prospects, contact: marketingContacts, campaign: outreachCampaigns })
    .from(prospects)
    .innerJoin(marketingContacts, and(eq(marketingContacts.id, prospects.contactId), eq(marketingContacts.tenantDomain, tenantDomain)))
    .innerJoin(outreachCampaigns, and(eq(outreachCampaigns.id, prospects.campaignId), eq(outreachCampaigns.tenantDomain, tenantDomain)))
    .where(and(eq(prospects.id, prospectId), eq(prospects.tenantDomain, tenantDomain)));
  if (!row || (marketId && row.campaign.marketId && row.campaign.marketId !== marketId)) {
    throw new OutreachContextError("Contact not found in this campaign and market.", 404);
  }
  return row;
}

export async function getOutreachContext(tenantDomain: string, prospectId: string, marketId?: string | null) {
  const row = await outreachContextPerson(tenantDomain, prospectId, marketId);
  // Shared contact history across campaigns, always tenant-scoped.
  const activities = await db.select().from(externalOutreachActivities).where(and(
    eq(externalOutreachActivities.tenantDomain, tenantDomain), eq(externalOutreachActivities.contactId, row.contact.id),
  )).orderBy(desc(externalOutreachActivities.occurredAt), desc(externalOutreachActivities.id));
  const { messagingGroup: group, messagingGroupAutomatic } = resolvedMessagingGroup(row.person);
  const familiarity = row.person.familiarity ?? "unknown";
  const briefs = row.campaign.messagingBriefs ?? [];
  const fingerprint = contextFingerprint({
    contact: row.contact.id, group, brief: briefs.find(b => b.group === group) ?? null,
    hold: row.contact.outreachHold, activities: activities.map(({ direction, ...activity }) =>
      direction === "inbound" ? { ...activity, direction } : activity),
    // Preserve fingerprints issued before familiarity existed for unchanged unknown contacts.
    ...(familiarity !== "unknown" ? { familiarity } : {}),
  });
  return { activities, removed: !!row.person.removedAt, hold: row.contact.outreachHold, messagingGroup: group, messagingGroupAutomatic, familiarity, briefs, fingerprint,
    recentActivity: activities.some(a => a.occurredAt.getTime() >= Date.now() - 7 * 86400000) };
}

export async function outreachCompositionContext(tenantDomain: string, prospectId: string, confirmedFingerprint?: string) {
  const ctx = await getOutreachContext(tenantDomain, prospectId);
  if (ctx.removed) throw new OutreachContextError("This contact was removed from this campaign. History is retained; new outreach is blocked.", 409, "OUTREACH_REMOVED");
  if (ctx.hold) throw new OutreachContextError("Outreach is on hold for this contact across campaigns. Remove the hold deliberately before drafting.", 409, "OUTREACH_ON_HOLD");
  if ((ctx.activities.length || ctx.messagingGroup || ctx.familiarity !== "unknown") && confirmedFingerprint !== ctx.fingerprint) {
    throw new OutreachContextError("Review this contact's correspondence and selected messaging group before drafting.");
  }
  return {
    snapshot: { fingerprint: ctx.fingerprint, group: ctx.messagingGroup } satisfies OutreachContextSnapshot,
    brief: ctx.briefs.find(b => b.group === ctx.messagingGroup),
    block: buildOutreachContextBlock(ctx.messagingGroup, ctx.briefs, ctx.activities, ctx.familiarity),
  };
}

export async function validateOutreachContext(tenantDomain: string, prospectId: string, snapshot?: OutreachContextSnapshot | null) {
  const current = await getOutreachContext(tenantDomain, prospectId);
  if (current.removed) throw new OutreachContextError("This contact was removed from this campaign. Approval is blocked.", 409, "OUTREACH_REMOVED");
  if (current.hold) throw new OutreachContextError("Outreach is on hold for this contact. Nothing was sent.", 409, "OUTREACH_ON_HOLD");
  if (snapshot ? snapshot.fingerprint !== current.fingerprint : current.activities.length > 0 || !!current.messagingGroup || current.familiarity !== "unknown") {
    throw new OutreachContextError("The contact's correspondence or messaging direction changed. Review the current context and generate a new draft before approval.");
  }
}
