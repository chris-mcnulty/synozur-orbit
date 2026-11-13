import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { users, conferences, outreachCampaigns, prospects, marketingContacts } from "@shared/schema";
import { defaultMeetingContact } from "@shared/conference-meetings";
import { bookedMeetingCount, sharedBookingFields } from "@shared/linked-meetings";
import { linkMeetingContacts } from "../linked-meetings-service";
import { getConferenceWorkspace, saveMeeting } from "../conference-meetings-service";
import { getCalendarInvitation, sendCalendarInvitation } from "../conference-calendar-service";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const tenant = `linked-meetings-${randomUUID()}`;
let campaignId: string, first: string, second: string, third: string;
suite("shared meeting persistence and scope", () => {
  beforeAll(async () => {
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    const [event] = await db.insert(conferences).values({
      tenantDomain: tenant, name: "Shared meeting test event", createdBy: user.id,
    }).returning();
    const [campaign] = await db.insert(outreachCampaigns).values({
      tenantDomain: tenant, name: "Shared meeting test campaign", conferenceId: event.id, createdBy: user.id,
    }).returning();
    campaignId = campaign.id;
    const people = await db.insert(marketingContacts).values(["First", "Second", "Third"].map(firstName => ({
      tenantDomain: tenant, firstName, company: "Example Company",
    }))).returning();
    const members = await db.insert(prospects).values(people.map((contact, index) => ({
      tenantDomain: tenant, campaignId, contactId: contact.id,
      meeting: { ...defaultMeetingContact(), relationshipNotes: `Private ${index}`,
        ...(index === 0 ? { stage: "meeting_booked" as const, meetingAt: "2099-07-01T15:00:00Z", meetingOwner: "Owner", meetingLocation: "Lobby" } : {}) },
    }))).returning();
    [first, second, third] = members.map(row => row.id);
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM conference_calendar_invitations WHERE tenant_domain = ${tenant}`);
    await db.delete(outreachCampaigns).where(eq(outreachCampaigns.tenantDomain, tenant));
    await db.delete(conferences).where(eq(conferences.tenantDomain, tenant));
    await db.delete(marketingContacts).where(eq(marketingContacts.tenantDomain, tenant));
  });
  it("links two contacts, shares booking fields, keeps private notes and counts one meeting", async () => {
    await linkMeetingContacts(tenant, first, [first, second]);
    const workspace = await getConferenceWorkspace(tenant, campaignId);
    const a = workspace.contacts.find(contact => contact.id === first)!;
    const b = workspace.contacts.find(contact => contact.id === second)!;
    expect(a.meeting.sharedMeetingId).toBe(first);
    expect(b.meeting.sharedMeetingId).toBe(first);
    expect(b.meeting.meetingAt).toBe(a.meeting.meetingAt);
    expect(b.meeting.meetingLocation).toBe("Lobby");
    expect(b.meeting.relationshipNotes).toBe("Private 1");
    expect(bookedMeetingCount(workspace.contacts)).toBe(1);
    await expect(linkMeetingContacts(tenant, first, [first], {
      contactIds: [first], booking: sharedBookingFields(a.meeting),
    })).rejects.toThrow(/linked people changed/);
    // A preview created before this contact was linked cannot send an independent invitation.
    await expect(sendCalendarInvitation(tenant, second, undefined, "fixture", {}, "stale")).rejects.toThrow(/shared meeting/);
    const newer = { ...b.meeting, meetingLocation: "Cafe", meetingAt: "2099-07-01T16:00:00Z", ownerNotes: "Second only" };
    await saveMeeting(tenant, second, newer, b.meeting);
    const updated = await getConferenceWorkspace(tenant, campaignId);
    expect(updated.contacts.find(contact => contact.id === first)?.meeting.meetingLocation).toBe("Cafe");
    expect(updated.contacts.find(contact => contact.id === first)?.meeting.ownerNotes).toBe("");
    await expect(saveMeeting(tenant, first, a.meeting, a.meeting)).rejects.toThrow(/changed/);
  });
  it("keeps one existing invitation and blocks merging an independently invited contact", async () => {
    const state = { status: "sent", organizerUserId: "fixture-user", eventId: "fixture-event", preview: { fingerprint: "f".repeat(64) } };
    await db.execute(sql`INSERT INTO conference_calendar_invitations (prospect_id, tenant_domain, transaction_id, state)
      VALUES (${first}, ${tenant}, ${randomUUID()}, ${JSON.stringify(state)}::jsonb)`);
    await linkMeetingContacts(tenant, first, [first, second]);
    expect(await getCalendarInvitation(tenant, first)).toEqual(state);
    await db.execute(sql`INSERT INTO conference_calendar_invitations (prospect_id, tenant_domain, transaction_id, state)
      VALUES (${third}, ${tenant}, ${randomUUID()}, ${JSON.stringify(state)}::jsonb)`);
    await expect(linkMeetingContacts(tenant, first, [first, second, third])).rejects.toThrow(/separate calendar invitation/);
    const [unlinked] = await db.select().from(prospects).where(eq(prospects.id, third));
    expect(unlinked.meeting?.sharedMeetingId).toBeUndefined();
    expect(await getCalendarInvitation(tenant, third)).toEqual(state);
  });
  it("rejects foreign, missing and removed memberships, and cannot remove the invitation owner", async () => {
    await expect(linkMeetingContacts("foreign", first, [first, second])).rejects.toMatchObject({ status: 404 });
    await expect(linkMeetingContacts(tenant, first, [first, "missing"])).rejects.toMatchObject({ status: 404 });
    await expect(linkMeetingContacts(tenant, second, [second])).rejects.toThrow(/original meeting contact/);
    await db.update(prospects).set({ removedAt: new Date() }).where(eq(prospects.id, third));
    await expect(linkMeetingContacts(tenant, first, [first, third])).rejects.toMatchObject({ status: 404 });
    const rows = await db.select().from(prospects).where(and(eq(prospects.tenantDomain, tenant), eq(prospects.campaignId, campaignId)));
    expect(bookedMeetingCount(rows.map(row => ({ id: row.id, meeting: { ...defaultMeetingContact(), ...row.meeting } })))).toBe(1);
  });
  it("unlinks a person without deleting personal notes or the retained invitation", async () => {
    await linkMeetingContacts(tenant, first, [first]);
    const workspace = await getConferenceWorkspace(tenant, campaignId);
    const detached = workspace.contacts.find(contact => contact.id === second)!;
    expect(detached.meeting.sharedMeetingId).toBeUndefined();
    expect(detached.meeting.meetingAt).toBe("");
    expect(detached.meeting.relationshipNotes).toBe("Private 1");
    expect(detached.meeting.ownerNotes).toBe("Second only");
    expect(bookedMeetingCount(workspace.contacts)).toBe(1);
    expect(await getCalendarInvitation(tenant, first)).toHaveProperty("eventId", "fixture-event");
  });
});
