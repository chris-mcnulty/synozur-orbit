import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { conferences, marketingContacts, outreachCampaigns, prospects } from "@shared/schema";
import { meetingContactEditSchema } from "@shared/conference-meetings";
import { signThreadMeetingReview, verifyThreadLocation } from "./email-thread-location";
import { emailThreadSaveSchema, threadMeetingSchema, type ThreadContact, type ThreadMeeting } from "@shared/email-thread";
import { EmailThreadError } from "./email-thread-parser";
import { isValidLinkedInProfileUrl } from "@shared/linkedin-outreach";
import { z } from "zod";

const fields = ["name", "email", "title", "companyName", "linkedinUrl", "phone"] as const;
function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function savedThreadMeetings(signals: unknown): ThreadMeeting[] {
  const parsed = z.array(threadMeetingSchema).safeParse(metadataObject(signals).emailThreadMeetingTimes);
  return parsed.success ? parsed.data : [];
}
export function contactThreadDetails(contact: typeof marketingContacts.$inferSelect): ThreadContact {
  return {
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    email: contact.email ?? "", title: contact.jobTitle ?? "", companyName: contact.company ?? "",
    linkedinUrl: contact.linkedinUrl ?? "",
    phone: typeof metadataObject(contact.metadata).phone === "string" ? String(metadataObject(contact.metadata).phone) : "",
  };
}
/** Compute fill-only changes. Never reinterpret a different identity as enrichment. */
export function threadContactPatch(current: ThreadContact, incoming: ThreadContact, optedOut: boolean) {
  if ((current.email && incoming.email && current.email.toLowerCase() !== incoming.email.toLowerCase()) ||
    (current.linkedinUrl && incoming.linkedinUrl && current.linkedinUrl.replace(/\/$/, "").toLowerCase() !== incoming.linkedinUrl.replace(/\/$/, "").toLowerCase())) {
    throw new EmailThreadError("The selected participant has a different email or LinkedIn identity. Choose the correct participant or add a separate contact.", 409);
  }
  const filledFields: string[] = [], skippedFields: string[] = [];
  const changes: Partial<ThreadContact> = {};
  for (const field of fields) {
    if (!incoming[field]) continue;
    if (current[field]?.trim() || optedOut) skippedFields.push(field);
    else { changes[field] = incoming[field]; filledFields.push(field); }
  }
  return { changes, filledFields, skippedFields };
}
export function mergeThreadMeetings(previous: ThreadMeeting[], incoming: ThreadMeeting[]) {
  const merged = [...previous];
  let added = 0;
  const key = (m: ThreadMeeting) => JSON.stringify([m.proposal, m.evidence, m.proposer, m.dateText, m.timeText, m.timezone, m.status]);
  const keys = new Set(previous.map(key));
  for (const m of incoming) {
    if (m.status === "declined") throw new EmailThreadError("Declined times cannot be saved as meeting recommendations.");
    if (!keys.has(key(m))) { merged.push({ ...m, needsConfirmation: true }); keys.add(key(m)); added++; }
  }
  if (merged.length > 50) throw new EmailThreadError("This contact already has too many saved meeting proposals. Save fewer proposals.");
  return { merged, added };
}

export async function emailThreadContact(tenantDomain: string, campaignId: string, prospectId: string, marketId?: string, userId?: string) {
  const [row] = await db.select({ person: prospects, contact: marketingContacts }).from(prospects)
    .innerJoin(marketingContacts, and(eq(marketingContacts.id, prospects.contactId), eq(marketingContacts.tenantDomain, tenantDomain)))
    .where(and(eq(prospects.id, prospectId), eq(prospects.campaignId, campaignId), eq(prospects.tenantDomain, tenantDomain)));
  if (!row || row.person.removedAt) throw new EmailThreadError("Contact not found in this campaign.", 404);
  const result = { contact: contactThreadDetails(row.contact), meetingTimes: savedThreadMeetings(row.person.signals) };
  if (!marketId || !userId) return result;
  if (row.person.marketId && row.person.marketId !== marketId) throw new EmailThreadError("Contact not found in this market.", 404);
  const [campaign] = await db.select().from(outreachCampaigns).where(and(eq(outreachCampaigns.id, campaignId), eq(outreachCampaigns.tenantDomain, tenantDomain)));
  if (!campaign || (campaign.marketId && campaign.marketId !== marketId)) throw new EmailThreadError("Campaign not found.", 404);
  if (!campaign.conferenceId || !row.person.meeting?.meetingAt || ["archived", "deleted"].includes(campaign.status)) {
    return { ...result, locationUnavailable: "This contact has no existing scheduled meeting in this campaign. No booking will be created." };
  }
  const [conference] = await db.select().from(conferences).where(and(eq(conferences.id, campaign.conferenceId), eq(conferences.tenantDomain, tenantDomain)));
  if (!conference || conference.status === "deleted" || (conference.marketId && conference.marketId !== marketId)) {
    return { ...result, locationUnavailable: "The linked event is unavailable in this market. No meeting will be changed." };
  }
  const expiresAt = Date.now() + 15 * 60_000;
  return { ...result, locationReview: {
    currentLocation: row.person.meeting.meetingLocation || "", expiresAt,
    token: signThreadMeetingReview({ tenantDomain, campaignId, marketId, userId }, prospectId, conference.id, row.person.meeting, expiresAt),
  } };
}

export async function saveEmailThread(tenantDomain: string, marketId: string, userId: string, campaignId: string, input: unknown) {
  const value = emailThreadSaveSchema.parse(input);
  if (value.locationUpdate && !value.prospectId) throw new EmailThreadError("Choose an existing campaign contact for a location update.");
  if (value.contact.email && !z.string().email().safeParse(value.contact.email).success) throw new EmailThreadError("Enter a valid email address.");
  if (value.contact.linkedinUrl && !isValidLinkedInProfileUrl(value.contact.linkedinUrl)) throw new EmailThreadError("Enter a valid LinkedIn person profile URL.");
  const incoming = { ...value.contact, email: value.contact.email.toLowerCase() };
  return db.transaction(async tx => {
    const [campaign] = await tx.select().from(outreachCampaigns).where(and(eq(outreachCampaigns.id, campaignId), eq(outreachCampaigns.tenantDomain, tenantDomain))).for("update");
    if (!campaign || (campaign.marketId && campaign.marketId !== marketId)) throw new EmailThreadError("Campaign not found.", 404);
    let membership: typeof prospects.$inferSelect | undefined;
    let contact: typeof marketingContacts.$inferSelect | undefined;
    if (value.prospectId) {
      [membership] = await tx.select().from(prospects).where(and(eq(prospects.id, value.prospectId), eq(prospects.campaignId, campaignId), eq(prospects.tenantDomain, tenantDomain))).for("update");
      if (!membership || membership.removedAt) throw new EmailThreadError("Contact not found in this campaign.", 404);
      [contact] = await tx.select().from(marketingContacts).where(and(eq(marketingContacts.id, membership.contactId), eq(marketingContacts.tenantDomain, tenantDomain))).for("update");
    } else {
      const identities = [
        ...(incoming.email ? [sql`lower(${marketingContacts.email}) = ${incoming.email}`] : []),
        ...(incoming.linkedinUrl ? [eq(marketingContacts.linkedinUrl, incoming.linkedinUrl)] : []),
      ];
      const lookup = async () => identities.length ? tx.select().from(marketingContacts)
        .where(and(eq(marketingContacts.tenantDomain, tenantDomain), or(...identities))).for("update") : [];
      const matches = await lookup();
      if (matches.length > 1) throw new EmailThreadError("These details match different existing contacts. Select the intended campaign contact.", 409);
      contact = matches[0];
      if (!contact) {
        const [created] = await tx.insert(marketingContacts).values({
          tenantDomain, email: incoming.email || null, linkedinUrl: incoming.linkedinUrl || null, source: "email_thread",
        }).onConflictDoNothing().returning();
        contact = created ?? (await lookup())[0];
      }
    }
    if (!contact) throw new EmailThreadError("The contact could not be saved. Please retry.", 409);
    let meetingLocationSaved = false;
    if (value.locationUpdate) {
      if (membership?.marketId && membership.marketId !== marketId) throw new EmailThreadError("Contact not found in this market.", 404);
      if (!membership?.meeting?.meetingAt || !campaign.conferenceId || ["archived", "deleted"].includes(campaign.status)) {
        throw new EmailThreadError("No existing linked meeting is available. No booking was created.", 409);
      }
      const [conference] = await tx.select().from(conferences).where(and(eq(conferences.id, campaign.conferenceId), eq(conferences.tenantDomain, tenantDomain))).for("share");
      if (!conference || conference.status === "deleted" || (conference.marketId && conference.marketId !== marketId)) throw new EmailThreadError("Event not found in this market.", 404);
      const update = value.locationUpdate;
      verifyThreadLocation({ tenantDomain, marketId, userId, campaignId }, update.suggestion, update.evidenceToken, update.reviewToken,
        membership.id, conference.id, membership.meeting, update.expiresAt);
      const location = meetingContactEditSchema.shape.meetingLocation.parse(update.suggestion.location);
      if (location !== membership.meeting.meetingLocation) {
        // The membership is locked and the signed full snapshot was verified.
        // Only this JSONB key changes; calendar state and every other field remain untouched.
        await tx.update(prospects).set({
          meeting: sql`jsonb_set(${prospects.meeting}, '{meetingLocation}', ${JSON.stringify(location)}::jsonb)`,
          updatedAt: new Date(),
        }).where(and(eq(prospects.id, membership.id), eq(prospects.tenantDomain, tenantDomain), eq(prospects.campaignId, campaignId)));
        meetingLocationSaved = true;
      }
    }
    const { changes, filledFields, skippedFields } = threadContactPatch(contactThreadDetails(contact), incoming, contact.emailOptOut);
    const patch: Partial<typeof marketingContacts.$inferInsert> = {};
    if (changes.name) { const [first, ...last] = changes.name.split(/\s+/); patch.firstName = first; patch.lastName = last.join(" ") || null; }
    if (changes.email) patch.email = changes.email;
    if (changes.title) patch.jobTitle = changes.title;
    if (changes.companyName) patch.company = changes.companyName;
    if (changes.linkedinUrl) patch.linkedinUrl = changes.linkedinUrl;
    if (changes.phone) patch.metadata = { ...metadataObject(contact.metadata), phone: changes.phone };
    if (Object.keys(patch).length) await tx.update(marketingContacts).set({ ...patch, updatedAt: new Date() }).where(and(eq(marketingContacts.id, contact.id), eq(marketingContacts.tenantDomain, tenantDomain)));
    if (!membership) {
      [membership] = await tx.select().from(prospects).where(and(eq(prospects.campaignId, campaignId), eq(prospects.contactId, contact.id), eq(prospects.tenantDomain, tenantDomain))).for("update");
      if (membership?.removedAt) throw new EmailThreadError("This contact was removed from the campaign. Pasting a thread does not restore it.", 409);
      if (!membership) {
        const [created] = await tx.insert(prospects).values({ campaignId, tenantDomain, marketId: campaign.marketId, contactId: contact.id, ownerUserId: userId, source: "email_thread", status: "new" })
          .onConflictDoNothing({ target: [prospects.campaignId, prospects.contactId] }).returning();
        membership = created;
        if (!membership) {
          [membership] = await tx.select().from(prospects).where(and(eq(prospects.campaignId, campaignId), eq(prospects.contactId, contact.id), eq(prospects.tenantDomain, tenantDomain))).for("update");
        }
      }
    }
    if (!membership || membership.removedAt) throw new EmailThreadError("Campaign contact is unavailable.", 409);
    const times = mergeThreadMeetings(savedThreadMeetings(membership.signals), value.meetingTimes);
    if (times.added) await tx.update(prospects).set({
      signals: { ...membership.signals, emailThreadMeetingTimes: times.merged }, updatedAt: new Date(),
    }).where(and(eq(prospects.id, membership.id), eq(prospects.tenantDomain, tenantDomain)));
    return { prospectId: membership.id, filledFields, skippedFields, meetingTimesSaved: times.added, meetingLocationSaved };
  });
}
