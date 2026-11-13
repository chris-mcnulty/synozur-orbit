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
    const { getConferenceWorkspace, saveMeeting, meetingCompositionContext } = await import("../conference-meetings-service");
    const { meetingContactFingerprint, proposeMeetingAngles } = await import("../conference-meetings-core");
    const { reviewConferenceRelationship } = await import("../conference-relationship-review");
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
    const review = await reviewConferenceRelationship(tenant, first.membershipId, 90, { requireAvailableSources: true });
    const reviewed = { ...result.contacts[0].meeting, review };
    const angles = proposeMeetingAngles(event.name, reviewed, review, []);
    await saveMeeting(tenant, first.membershipId, {
      ...reviewed, angles, anglesFingerprint: meetingContactFingerprint(result.fingerprint, reviewed),
      selectedAngleId: angles[1].id, selectedHook: angles[1].hook, selectedAsk: angles[1].ask,
    });
    const reloaded = await getConferenceWorkspace(tenant, campaign.id);
    expect(reloaded.contacts[0].meeting.anglesFingerprint).toBe(reloaded.contacts[0].meetingFingerprint);
    const direction = await meetingCompositionContext(tenant, first.membershipId);
    expect(direction?.context.operatorBrief).toBe(`${angles[1].hook}\n${angles[1].ask}`);
    // Exercise the real atomic database predicate, including JSONB key ordering,
    // legacy records, concurrent edits, and tenant isolation.
    const snapshot = reloaded.contacts[0].meeting;
    const reordered = Object.fromEntries(Object.entries(snapshot).reverse()) as typeof snapshot;
    await saveMeeting(tenant, first.membershipId, snapshot, reordered);
    for (const edit of [
      { stage: "do_not_contact" as const },
      { attendance: "not_attending" as const },
      { ownerNotes: "New operator instruction" },
    ]) {
      await saveMeeting(tenant, first.membershipId, snapshot);
      const newer = { ...snapshot, ...edit };
      await saveMeeting(tenant, first.membershipId, newer, snapshot);
      await expect(saveMeeting(tenant, first.membershipId, reviewed, snapshot)).rejects.toMatchObject({
        status: 409, message: expect.stringMatching(/Nothing was saved.*Refresh.*retry/),
      });
      const [preserved] = await db.select().from(prospects).where(eq(prospects.id, first.membershipId));
      expect(preserved.meeting).toEqual(newer);
    }
    await expect(saveMeeting("other-tenant.example.com", first.membershipId, snapshot, snapshot)).rejects.toMatchObject({ status: 409 });
    for (const legacy of [null, { ownerNotes: "Legacy note" }]) {
      await db.update(prospects).set({ meeting: legacy as any }).where(eq(prospects.id, first.membershipId));
      const normalized = { ...defaultMeetingContact(), ...legacy };
      await saveMeeting(tenant, first.membershipId, { ...normalized, review }, normalized);
    }
    await db.update(conferences).set({ tenantDomain: "wrong-tenant.example.com" }).where(eq(conferences.id, event.id));
    try {
      await expect(getConferenceWorkspace(tenant, campaign.id)).rejects.toThrow("Event not found");
    } finally {
      await db.update(conferences).set({ tenantDomain: tenant }).where(eq(conferences.id, event.id));
    }
  }, 30000);
  it("applies only a reviewed thread venue and rejects stale, removed and out-of-scope targets", async () => {
    const { db } = await import("../../db");
    const { users, conferences, outreachCampaigns, prospects, marketingContacts, conferenceCalendarInvitations } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { defaultMeetingContact } = await import("@shared/conference-meetings");
    const { emailThreadContact, saveEmailThread } = await import("../email-thread-service");
    const { signThreadLocation } = await import("../email-thread-location");
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    const [event] = await db.insert(conferences).values({ tenantDomain: tenant, name: "Thread venue test", createdBy: user.id }).returning();
    const [campaign] = await db.insert(outreachCampaigns).values({ tenantDomain: tenant, name: "Thread venue test", createdBy: user.id, conferenceId: event.id }).returning();
    const [contact] = await db.insert(marketingContacts).values({ tenantDomain: tenant, email: "thread@example.invalid" }).returning();
    const meeting = { ...defaultMeetingContact(), meetingAt: "2026-11-18T17:00:00Z", meetingLocation: "TBD",
      stage: "meeting_booked" as const, meetingOwner: "Host", participants: "Host and guest", ownerNotes: "Private note", followUp: "Keep follow-up" };
    const [person] = await db.insert(prospects).values({ tenantDomain: tenant, campaignId: campaign.id, contactId: contact.id, meeting, signals: { preserved: true } as any }).returning();
    const scope = { tenantDomain: tenant, campaignId: campaign.id, marketId: "test-market", userId: user.id };
    const suggestion = { location: "Multipurpose Room, Convene, Galleria Park Hotel", evidence: "We will meet in Multipurpose Room, Convene, Galleria Park Hotel.", status: "current" as const };
    const blank = { name: "", email: "", title: "", companyName: "", linkedinUrl: "", phone: "" };
    const review = await emailThreadContact(tenant, campaign.id, person.id, scope.marketId, user.id);
    expect("locationReview" in review && review.locationReview).toBeTruthy();
    if (!("locationReview" in review) || !review.locationReview) throw new Error("Missing review");
    const input = { prospectId: person.id, contact: blank, meetingTimes: [], confirmed: true, locationUpdate: {
      suggestion, evidenceToken: signThreadLocation(scope, suggestion), reviewToken: review.locationReview.token,
      expiresAt: review.locationReview.expiresAt, confirmed: true,
    } };
    const invitationsBefore = await db.select().from(conferenceCalendarInvitations).where(eq(conferenceCalendarInvitations.tenantDomain, tenant));
    const result = await saveEmailThread(tenant, scope.marketId, user.id, campaign.id, input);
    expect(result).toMatchObject({ meetingLocationSaved: true, filledFields: [], meetingTimesSaved: 0 });
    const [saved] = await db.select().from(prospects).where(eq(prospects.id, person.id));
    expect(saved).toEqual({ ...person, meeting: { ...meeting, meetingLocation: suggestion.location }, updatedAt: saved.updatedAt });
    expect(await db.select().from(conferenceCalendarInvitations).where(eq(conferenceCalendarInvitations.tenantDomain, tenant))).toEqual(invitationsBefore);
    await expect(saveEmailThread(tenant, scope.marketId, user.id, campaign.id, input)).rejects.toThrow(/stale/);
    await expect(saveEmailThread("wrong-tenant", scope.marketId, user.id, campaign.id, input)).rejects.toThrow(/Campaign not found/);
    await expect(saveEmailThread(tenant, "wrong-market", user.id, campaign.id, input)).rejects.toThrow(/evidence/);
    await expect(saveEmailThread(tenant, scope.marketId, "wrong-user", campaign.id, input)).rejects.toThrow(/evidence/);
    // A stale location review rolls back contact enrichment too.
    await expect(saveEmailThread(tenant, scope.marketId, user.id, campaign.id, { ...input, contact: { ...blank, title: "Do not save" } })).rejects.toThrow(/stale/);
    const [unchanged] = await db.select().from(marketingContacts).where(eq(marketingContacts.id, contact.id));
    expect(unchanged.jobTitle).toBeNull();
    await db.update(prospects).set({ removedAt: new Date() }).where(eq(prospects.id, person.id));
    await expect(saveEmailThread(tenant, scope.marketId, user.id, campaign.id, input)).rejects.toThrow(/Contact not found/);
    await db.update(prospects).set({ removedAt: null, meeting: null }).where(eq(prospects.id, person.id));
    const missing = await emailThreadContact(tenant, campaign.id, person.id, scope.marketId, user.id);
    expect(missing).toHaveProperty("locationUnavailable", expect.stringMatching(/No booking/));
    await expect(saveEmailThread(tenant, scope.marketId, user.id, campaign.id, input)).rejects.toThrow(/No existing linked meeting/);
  }, 30000);
});
