import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const tenant = `conference-meetings-test-${randomUUID()}.example.com`;
suite("conference meeting persistence and isolation", () => {
  afterAll(async () => {
    const { db } = await import("../../db");
    const { outreachCampaigns, conferences, marketingContacts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(outreachCampaigns).where(eq(outreachCampaigns.tenantDomain, tenant));
    await db.delete(conferences).where(eq(conferences.tenantDomain, tenant));
    await db.delete(marketingContacts).where(eq(marketingContacts.tenantDomain, tenant));
  });
  it("round-trips shared presence, private goals and contact prep without copying contacts", async () => {
    const { db } = await import("../../db");
    const { users, conferences, outreachCampaigns, prospects } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { defaultMeetingContact, eventPresenceSchema, meetingBriefSchema } = await import("@shared/conference-meetings");
    const { ensureContactForPerson, addCampaignMembership } = await import("../prospect-contact-service");
    const { getConferenceWorkspace, saveMeeting } = await import("../conference-meetings-service");
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    expect(user, "Development test database needs an existing user").toBeDefined();
    const [event] = await db.insert(conferences).values({
      tenantDomain: tenant, name: "Test-only conference", createdBy: user.id,
      presence: eventPresenceSchema.parse({ timezone: "America/Los_Angeles", confirmation: "confirmed", team: "Test team" }),
    }).returning();
    const [campaign] = await db.insert(outreachCampaigns).values({
      tenantDomain: tenant, name: "Test-only meeting campaign", createdBy: user.id, conferenceId: event.id,
      meetingBrief: meetingBriefSchema.parse({ goals: "Private customer check-ins" }),
    }).returning();
    const { contactId } = await ensureContactForPerson(tenant, { name: "Test-only contact", email: "test@example.invalid" }, "wiza");
    const first = await addCampaignMembership({ tenantDomain: tenant, campaignId: campaign.id, contactId, source: "wiza" });
    const second = await addCampaignMembership({ tenantDomain: tenant, campaignId: campaign.id, contactId, source: "salesnav" });
    expect(second.membershipId).toBe(first.membershipId);
    await saveMeeting(tenant, first.membershipId, { ...defaultMeetingContact(), relationships: ["customer", "partner"], attendance: "unknown" });
    const result = await getConferenceWorkspace(tenant, campaign.id);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].meeting.relationships).toEqual(["customer", "partner"]);
    expect(result.contacts[0].meetingFingerprint).toHaveLength(64);
    expect(result.conference.presence?.team).toBe("Test team");
    expect(result.brief?.goals).toBe("Private customer check-ins");
    expect(JSON.stringify(result.conference)).not.toContain("Private customer check-ins");
    await expect(getConferenceWorkspace("other-tenant.example.com", campaign.id)).rejects.toThrow("Campaign not found");
    await saveMeeting("other-tenant.example.com", first.membershipId, { ...defaultMeetingContact(), stage: "do_not_contact" });
    const [unchanged] = await db.select().from(prospects).where(eq(prospects.id, first.membershipId));
    expect(unchanged.meeting?.stage).toBe("shortlisted");
    await db.update(conferences).set({ tenantDomain: "wrong-tenant.example.com" }).where(eq(conferences.id, event.id));
    try {
      await expect(getConferenceWorkspace(tenant, campaign.id)).rejects.toThrow("Event not found");
    } finally {
      await db.update(conferences).set({ tenantDomain: tenant }).where(eq(conferences.id, event.id));
    }
  }, 30000);
});
