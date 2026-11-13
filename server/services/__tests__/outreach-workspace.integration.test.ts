import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { marketingContacts, outreachCampaigns, prospects, externalOutreachActivities, users } from "@shared/schema";
import { completeOutreachNextStep, loadOutreachWorkspace } from "../outreach-workspace-service";
import { defaultMeetingContact } from "@shared/conference-meetings";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const tenant = `workspace-completion-${randomUUID()}`;
let campaignId: string, personId: string, contactId: string, userId: string;
suite("persistent next-step completion and campaign progress", () => {
  beforeAll(async () => {
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    userId = user.id;
    const [campaign] = await db.insert(outreachCampaigns).values({ tenantDomain: tenant, name: "Completion test", createdBy: userId }).returning();
    campaignId = campaign.id;
    const [contact] = await db.insert(marketingContacts).values({ tenantDomain: tenant, firstName: "Example", lastName: "Person", company: "Example Co", outreachHold: true }).returning();
    contactId = contact.id;
    const [person] = await db.insert(prospects).values({
      tenantDomain: tenant, campaignId, contactId, signals: { preserved: "evidence" }, meeting: defaultMeetingContact(),
    }).returning();
    personId = person.id;
  });
  afterAll(async () => {
    await db.delete(outreachCampaigns).where(eq(outreachCampaigns.tenantDomain, tenant));
    await db.delete(marketingContacts).where(eq(marketingContacts.tenantDomain, tenant));
  });
  it("saves Done across reloads, preserves holds/signals, and supports Undo", async () => {
    const initial = await loadOutreachWorkspace(tenant, "", campaignId);
    const item = initial.items[0];
    const input = { prospectId: personId, itemId: item.id, version: item.version, completed: true };
    await completeOutreachNextStep(tenant, "", userId, campaignId, input);
    await completeOutreachNextStep(tenant, "", userId, campaignId, input); // idempotent retry
    const done = await loadOutreachWorkspace(tenant, "", campaignId);
    expect(done.items).toEqual([]);
    expect(done.completedItems[0]).toMatchObject({ id: item.id, version: item.version });
    expect(done.counts.held).toBe(1);
    const [stored] = await db.select().from(prospects).where(eq(prospects.id, personId));
    expect(stored.signals?.preserved).toBe("evidence");
    expect(stored.status).toBe("new");
    expect(stored.meeting).toEqual(defaultMeetingContact());
    await completeOutreachNextStep(tenant, "", userId, campaignId, { ...input, completed: false });
    expect((await loadOutreachWorkspace(tenant, "", campaignId)).items).toHaveLength(1);
  });
  it("rejects stale or cross-campaign requests without overwriting completion evidence", async () => {
    const item = (await loadOutreachWorkspace(tenant, "", campaignId)).items[0];
    const input = { prospectId: personId, itemId: item.id, version: item.version, completed: true };
    await expect(completeOutreachNextStep("other-tenant", "", userId, campaignId, input)).rejects.toMatchObject({ status: 404 });
    await expect(completeOutreachNextStep(tenant, "", userId, "other-campaign", input)).rejects.toMatchObject({ status: 404 });
    await expect(completeOutreachNextStep(tenant, "", userId, campaignId, { ...input, version: "f".repeat(64) })).rejects.toMatchObject({ status: 409 });
    expect((await loadOutreachWorkspace(tenant, "", campaignId)).items).toHaveLength(1);
  });
  it("reflects outside communications and agreed meetings, and reopens reviews for new evidence", async () => {
    await db.update(marketingContacts).set({ outreachHold: false }).where(eq(marketingContacts.id, contactId));
    const [activity] = await db.insert(externalOutreachActivities).values({
      tenantDomain: tenant, campaignId, contactId, channel: "email", direction: "inbound",
      occurredAt: new Date(), sender: "Operator", message: "Fixture conversation", outcome: "meeting_agreed", createdBy: userId,
    }).returning();
    const workspace = await loadOutreachWorkspace(tenant, "", campaignId);
    expect(workspace.counts).toMatchObject({ communicated: 1, externallyContacted: 1, replied: 1, meetings: 1, agreedMeetings: 1, bookedMeetings: 0 });
    expect(workspace.summary).toContain("Example Person (Example Co)");
    const item = workspace.items[0];
    await completeOutreachNextStep(tenant, "", userId, campaignId, { prospectId: personId, itemId: item.id, version: item.version, completed: true });
    expect((await loadOutreachWorkspace(tenant, "", campaignId)).items).toEqual([]);
    await db.update(externalOutreachActivities).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(externalOutreachActivities.id, activity.id));
    expect((await loadOutreachWorkspace(tenant, "", campaignId)).items[0].version).not.toBe(item.version);
    await db.update(prospects).set({ removedAt: new Date() }).where(eq(prospects.id, personId));
    expect((await loadOutreachWorkspace(tenant, "", campaignId)).counts).toMatchObject({ contacts: 0, externalCommunications: 0, meetings: 0, replied: 0 });
  });
});
