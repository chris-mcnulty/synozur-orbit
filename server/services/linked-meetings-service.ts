import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { outreachCampaigns, prospects } from "@shared/schema";
import { defaultMeetingContact, type MeetingContact } from "@shared/conference-meetings";
import { sharedBookingFields } from "@shared/linked-meetings";
import { MeetingError } from "./conference-meetings-service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = typeof prospects.$inferSelect;

/** All booking edits/link changes take the same campaign lock before membership locks. */
export async function withMeetingRows<T>(tenant: string, id: string, work: (tx: Tx, rows: Row[], current: Row) => Promise<T>) {
  const [lookup] = await db.select({ campaignId: prospects.campaignId }).from(prospects)
    .where(and(eq(prospects.id, id), eq(prospects.tenantDomain, tenant)));
  if (!lookup) throw new MeetingError("Contact not found.", 404);
  return db.transaction(async tx => {
    const [campaign] = await tx.select().from(outreachCampaigns)
      .where(and(eq(outreachCampaigns.id, lookup.campaignId), eq(outreachCampaigns.tenantDomain, tenant))).for("update");
    if (!campaign?.conferenceId) throw new MeetingError("Event campaign not found.", 404);
    const rows = await tx.select().from(prospects)
      .where(and(eq(prospects.campaignId, campaign.id), eq(prospects.tenantDomain, tenant))).for("update");
    const current = rows.find(row => row.id === id && !row.removedAt);
    if (!current) throw new MeetingError("Contact not found.", 404);
    return work(tx, rows, current);
  });
}

export async function linkMeetingContacts(tenant: string, id: string, contactIds: string[], expected?: {
  contactIds: string[]; booking: ReturnType<typeof sharedBookingFields>;
}) {
  return withMeetingRows(tenant, id, async (tx, rows, current) => {
    const meeting = { ...defaultMeetingContact(), ...current.meeting };
    if (meeting.stage !== "meeting_booked" || !meeting.meetingAt || !meeting.meetingOwner.trim()) {
      throw new MeetingError("Save a booked meeting with a date, time and owner before linking contacts.", 422);
    }
    const group = meeting.sharedMeetingId || id;
    if (expected) {
      const currentIds = rows.filter(row => !row.removedAt && (meeting.sharedMeetingId
        ? row.meeting?.sharedMeetingId === group : row.id === id)).map(row => row.id).sort();
      if (JSON.stringify(currentIds) !== JSON.stringify([...new Set(expected.contactIds)].sort())
        || JSON.stringify(sharedBookingFields(meeting)) !== JSON.stringify(sharedBookingFields(expected.booking))) {
        throw new MeetingError("The meeting or its linked people changed. Refresh and review before saving links.");
      }
    }
    const ids = new Set([...contactIds, id]);
    if (!ids.has(group)) throw new MeetingError("Keep the original meeting contact selected. It owns the shared invitation.");
    const selected = rows.filter(row => ids.has(row.id) && !row.removedAt);
    if (selected.length !== ids.size) throw new MeetingError("Choose active contacts from this campaign only.", 404);
    for (const row of selected) {
      const other = { ...defaultMeetingContact(), ...row.meeting };
      if (other.sharedMeetingId && other.sharedMeetingId !== group) throw new MeetingError("A selected contact is already linked to another meeting.");
      if (["declined", "unavailable", "do_not_contact"].includes(other.stage) || other.attendance === "not_attending") {
        throw new MeetingError("Review the excluded contact's meeting status before linking them.");
      }
      if (row.id !== id && !other.sharedMeetingId && other.stage === "meeting_booked"
        && JSON.stringify(sharedBookingFields(other)) !== JSON.stringify(sharedBookingFields(meeting))) {
        throw new MeetingError("A selected contact has a different booked meeting. Resolve those details before linking.");
      }
    }
    // Share the invitation-claim lock so a simultaneous send cannot create a
    // second invitation while two formerly separate contact bookings are linked.
    for (const memberId of [...ids].sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenant}:${memberId}`}, 0))`);
    }
    const invitations = await tx.execute(sql`SELECT prospect_id FROM conference_calendar_invitations
      WHERE tenant_domain = ${tenant} AND prospect_id IN (${sql.join([...ids].map(value => sql`${value}`), sql`, `)}) FOR UPDATE`);
    if (invitations.rows.some(row => row.prospect_id !== group)) {
      throw new MeetingError("A selected contact already has a separate calendar invitation. Resolve it before linking; no invitation was cancelled.");
    }
    const existingMembers = rows.filter(row => row.meeting?.sharedMeetingId === group);
    const affected = new Map([...existingMembers, ...selected].map(row => [row.id, row]));
    for (const row of affected.values()) {
      const next: MeetingContact = { ...defaultMeetingContact(), ...row.meeting };
      if (ids.has(row.id)) {
        Object.assign(next, sharedBookingFields(meeting), { stage: "meeting_booked" });
        if (ids.size > 1) next.sharedMeetingId = group;
        else delete next.sharedMeetingId;
      } else {
        // Detaching removes only the shared booking, never relationship or outreach history.
        delete next.sharedMeetingId;
        next.meetingAt = ""; next.meetingLocation = ""; next.meetingOwner = ""; next.participants = "";
        if (next.stage === "meeting_booked") next.stage = "shortlisted";
      }
      await tx.update(prospects).set({ meeting: next, updatedAt: new Date() })
        .where(and(eq(prospects.id, row.id), eq(prospects.tenantDomain, tenant)));
    }
    return { contactIds: [...ids], sharedMeetingId: ids.size > 1 ? group : null };
  });
}
