/**
 * Single-contact-table support for Sales Outreach.
 *
 * After the prospects → marketing_contacts consolidation, a "prospect" is a
 * campaign-membership row (prospects table) whose person identity lives on
 * marketing_contacts. This module provides:
 *
 *  - ensureContactForPerson(): find-or-create the marketing contact for an
 *    incoming person (import/manual add), filling only missing fields on an
 *    existing contact — never overwriting richer data, never touching an
 *    opted-out contact's fields.
 *  - flattenProspect()/prospectContactSelection: helpers to produce the
 *    pre-consolidation "prospect" API shape (membership + person fields).
 *  - getProspectWithContact()/listProspectsWithContacts(): common reads.
 *  - updateContactPersonFields(): person-field edits routed to the contact.
 *
 * Opt-out rule: an existing contact with emailOptOut=true keeps all fields
 * untouched — but campaign membership is still allowed (sales may still work
 * the prospect on non-email channels; the email send guards check opt-out).
 */

import { randomUUID } from "crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  marketingContacts,
  marketingContactEvents,
  marketingSegmentMembers,
  marketingWorkflowEnrollments,
  outreachTouches,
  prospects,
  type MarketingContact,
  type Prospect,
  type ProspectWithContact,
} from "@shared/schema";
import { normaliseEmail } from "./marketing-contact-service";
import { preWarmMarketingCache } from "./hubspot-contact-resolver";

// ---------------------------------------------------------------------------
// Person shape + helpers
// ---------------------------------------------------------------------------

export interface IncomingPerson {
  name: string;
  title?: string | null;
  companyName?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  hubspotContactId?: string | null;
  hubspotCompanyId?: string | null;
}

/** Split a display name into first/last on the first whitespace. */
export function splitName(name: string): { firstName: string | null; lastName: string | null } {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || null };
}

/** Combine first/last back into the display name outreach surfaces render. */
export function contactDisplayName(c: Pick<MarketingContact, "firstName" | "lastName" | "email">): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.email || "";
}

/** Flatten a membership row + its contact into the legacy prospect shape. */
export function flattenProspect(membership: Prospect, contact: MarketingContact): ProspectWithContact {
  return {
    ...membership,
    name: contactDisplayName(contact),
    title: contact.jobTitle,
    companyName: contact.company,
    email: contact.email,
    linkedinUrl: contact.linkedinUrl,
    hubspotContactId: contact.hubspotContactId,
    hubspotCompanyId: contact.hubspotCompanyId,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Load one membership with its contact, flattened. Tenant check is caller's job. */
export async function getProspectWithContact(prospectId: string): Promise<ProspectWithContact | null> {
  const [row] = await db
    .select({ membership: prospects, contact: marketingContacts })
    .from(prospects)
    .innerJoin(marketingContacts, eq(prospects.contactId, marketingContacts.id))
    .where(eq(prospects.id, prospectId))
    .limit(1);
  return row ? flattenProspect(row.membership, row.contact) : null;
}

/** Load many memberships (by ids) with contacts, flattened. */
export async function getProspectsWithContacts(prospectIds: string[]): Promise<ProspectWithContact[]> {
  if (prospectIds.length === 0) return [];
  const rows = await db
    .select({ membership: prospects, contact: marketingContacts })
    .from(prospects)
    .innerJoin(marketingContacts, eq(prospects.contactId, marketingContacts.id))
    .where(inArray(prospects.id, prospectIds));
  return rows.map((r) => flattenProspect(r.membership, r.contact));
}

/** All memberships on a campaign, flattened. */
export async function listCampaignProspects(campaignId: string): Promise<ProspectWithContact[]> {
  const rows = await db
    .select({ membership: prospects, contact: marketingContacts })
    .from(prospects)
    .innerJoin(marketingContacts, eq(prospects.contactId, marketingContacts.id))
    .where(eq(prospects.campaignId, campaignId));
  return rows.map((r) => flattenProspect(r.membership, r.contact));
}

// ---------------------------------------------------------------------------
// Ensure-contact (replaces the promote flow for creates/imports)
// ---------------------------------------------------------------------------

/**
 * Find-or-create the marketing contact for an incoming person.
 *
 * - With an email: upsert by (tenant, normalized email). Existing contacts
 *   get only their missing fields filled (unless opted out — then untouched).
 * - Without an email: always creates a fresh contact (no dedupe key).
 *
 * Returns the contact id. `source` is only used for newly created contacts.
 */
export async function ensureContactForPerson(
  tenantDomain: string,
  person: IncomingPerson,
  source: string = "outreach",
): Promise<{ contactId: string; created: boolean }> {
  const email = normaliseEmail(person.email || "");
  const { firstName, lastName } = splitName(person.name);
  const now = new Date();

  if (email && email.includes("@")) {
    const [existing] = await db
      .select()
      .from(marketingContacts)
      .where(and(eq(marketingContacts.tenantDomain, tenantDomain), eq(marketingContacts.email, email)))
      .limit(1);

    if (existing) {
      if (!existing.emailOptOut) {
        const set: Partial<typeof marketingContacts.$inferInsert> = {};
        if (!existing.firstName && firstName) set.firstName = firstName;
        if (!existing.lastName && lastName) set.lastName = lastName;
        if (!existing.company && person.companyName?.trim()) set.company = person.companyName.trim();
        if (!existing.jobTitle && person.title?.trim()) set.jobTitle = person.title.trim();
        if (!existing.hubspotContactId && person.hubspotContactId) set.hubspotContactId = person.hubspotContactId;
        if (!existing.hubspotCompanyId && person.hubspotCompanyId) set.hubspotCompanyId = person.hubspotCompanyId;

        // LinkedIn URL needs care: if the existing contact has no LinkedIn URL
        // but another contact already holds the incoming one, merge that
        // LinkedIn-only contact into the email contact rather than issuing a
        // uniqueness-violating UPDATE.
        if (!existing.linkedinUrl && person.linkedinUrl) {
          const [linkedinHolder] = await db
            .select({ id: marketingContacts.id })
            .from(marketingContacts)
            .where(
              and(
                eq(marketingContacts.tenantDomain, tenantDomain),
                eq(marketingContacts.linkedinUrl, person.linkedinUrl),
              ),
            )
            .limit(1);

          if (linkedinHolder && linkedinHolder.id !== existing.id) {
            // Another contact holds this LinkedIn URL. Absorb it into the
            // keeper (email contact) — the merge also copies the linkedinUrl.
            await mergeContacts(tenantDomain, existing.id, linkedinHolder.id);
          } else {
            // Safe to set directly (no conflicting holder, or it's already us).
            set.linkedinUrl = person.linkedinUrl;
          }
        }

        if (Object.keys(set).length > 0) {
          await db
            .update(marketingContacts)
            .set({ ...set, updatedAt: now })
            .where(and(eq(marketingContacts.id, existing.id), eq(marketingContacts.emailOptOut, false)));
        }
      }
      if (person.hubspotContactId) {
        preWarmMarketingCache(tenantDomain, email, person.hubspotContactId).catch(() => {});
      }
      return { contactId: existing.id, created: false };
    }

    const id = randomUUID();
    const inserted = await db
      .insert(marketingContacts)
      .values({
        id,
        tenantDomain,
        email,
        firstName,
        lastName,
        company: person.companyName?.trim() || null,
        jobTitle: person.title?.trim() || null,
        linkedinUrl: person.linkedinUrl || null,
        hubspotContactId: person.hubspotContactId || null,
        hubspotCompanyId: person.hubspotCompanyId || null,
        source,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: marketingContacts.id });

    if (inserted.length === 0) {
      // The insert was rejected by a unique constraint. Two possible causes:
      //
      // (a) Email race: another request concurrently inserted the same email.
      //     Recovery: re-fetch by email.
      //
      // (b) LinkedIn index conflict: a LinkedIn-only contact (email=null) already
      //     holds the same linkedinUrl. The incoming import also carries an email,
      //     so we should set that email on the existing LinkedIn contact and fill
      //     its blank fields — unifying both identities into one contact.
      //     Recovery: re-fetch by linkedinUrl, then patch the email onto it.
      //
      // Never fall through to the unverified generated id: it was not persisted,
      // and a membership insert against it would fail its FK.

      // (a) Email race
      const [byEmail] = await db
        .select()
        .from(marketingContacts)
        .where(and(eq(marketingContacts.tenantDomain, tenantDomain), eq(marketingContacts.email, email)))
        .limit(1);
      if (byEmail) {
        if (person.hubspotContactId) {
          preWarmMarketingCache(tenantDomain, email, person.hubspotContactId).catch(() => {});
        }
        return { contactId: byEmail.id, created: false };
      }

      // (b) LinkedIn-only contact that now needs its email set
      const incomingLinkedinUrl = person.linkedinUrl || null;
      if (incomingLinkedinUrl) {
        const [byLinkedin] = await db
          .select()
          .from(marketingContacts)
          .where(
            and(
              eq(marketingContacts.tenantDomain, tenantDomain),
              eq(marketingContacts.linkedinUrl, incomingLinkedinUrl),
            ),
          )
          .limit(1);
        if (byLinkedin && !byLinkedin.emailOptOut) {
          // Apply the email and any other missing fields to the LinkedIn-only contact.
          const set: Partial<typeof marketingContacts.$inferInsert> = { email };
          if (!byLinkedin.firstName && firstName) set.firstName = firstName;
          if (!byLinkedin.lastName && lastName) set.lastName = lastName;
          if (!byLinkedin.company && person.companyName?.trim()) set.company = person.companyName.trim();
          if (!byLinkedin.jobTitle && person.title?.trim()) set.jobTitle = person.title.trim();
          if (!byLinkedin.hubspotContactId && person.hubspotContactId) set.hubspotContactId = person.hubspotContactId;
          if (!byLinkedin.hubspotCompanyId && person.hubspotCompanyId) set.hubspotCompanyId = person.hubspotCompanyId;
          await db
            .update(marketingContacts)
            .set({ ...set, updatedAt: now })
            .where(eq(marketingContacts.id, byLinkedin.id));
          if (person.hubspotContactId) {
            preWarmMarketingCache(tenantDomain, email, person.hubspotContactId).catch(() => {});
          }
          return { contactId: byLinkedin.id, created: false };
        }
        if (byLinkedin) return { contactId: byLinkedin.id, created: false };
      }

      throw new Error(`Failed to find or create marketing contact for ${email}`);
    }
    if (person.hubspotContactId) {
      preWarmMarketingCache(tenantDomain, email, person.hubspotContactId).catch(() => {});
    }
    return { contactId: id, created: true };
  }

  // No email — try to match by LinkedIn URL before creating a new contact.
  const linkedinUrl = person.linkedinUrl || null;

  if (linkedinUrl) {
    const [byLinkedin] = await db
      .select()
      .from(marketingContacts)
      .where(
        and(
          eq(marketingContacts.tenantDomain, tenantDomain),
          eq(marketingContacts.linkedinUrl, linkedinUrl),
        ),
      )
      .limit(1);

    if (byLinkedin) {
      if (!byLinkedin.emailOptOut) {
        const set: Partial<typeof marketingContacts.$inferInsert> = {};
        if (!byLinkedin.firstName && firstName) set.firstName = firstName;
        if (!byLinkedin.lastName && lastName) set.lastName = lastName;
        if (!byLinkedin.company && person.companyName?.trim()) set.company = person.companyName.trim();
        if (!byLinkedin.jobTitle && person.title?.trim()) set.jobTitle = person.title.trim();
        if (!byLinkedin.hubspotContactId && person.hubspotContactId) set.hubspotContactId = person.hubspotContactId;
        if (!byLinkedin.hubspotCompanyId && person.hubspotCompanyId) set.hubspotCompanyId = person.hubspotCompanyId;
        if (Object.keys(set).length > 0) {
          await db
            .update(marketingContacts)
            .set({ ...set, updatedAt: now })
            .where(and(eq(marketingContacts.id, byLinkedin.id), eq(marketingContacts.emailOptOut, false)));
        }
      }
      return { contactId: byLinkedin.id, created: false };
    }
  }

  // No email, no LinkedIn match — create a standalone contact row (nullable email).
  const id = randomUUID();
  const inserted = await db
    .insert(marketingContacts)
    .values({
      id,
      tenantDomain,
      email: null,
      firstName,
      lastName,
      company: person.companyName?.trim() || null,
      jobTitle: person.title?.trim() || null,
      linkedinUrl,
      hubspotContactId: person.hubspotContactId || null,
      hubspotCompanyId: person.hubspotCompanyId || null,
      source,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: marketingContacts.id });

  if (inserted.length === 0 && linkedinUrl) {
    // Lost a concurrent race on the linkedin unique index — fetch the winner.
    const [raced] = await db
      .select({ id: marketingContacts.id })
      .from(marketingContacts)
      .where(
        and(
          eq(marketingContacts.tenantDomain, tenantDomain),
          eq(marketingContacts.linkedinUrl, linkedinUrl),
        ),
      )
      .limit(1);
    if (raced) return { contactId: raced.id, created: false };
  }

  return { contactId: id, created: true };
}

// ---------------------------------------------------------------------------
// Contact merge (deduplication)
// ---------------------------------------------------------------------------

export interface MergeResult {
  keeperId: string;
  duplicateId: string;
  prospectsRepointed: number;
  eventsRepointed: number;
}

/**
 * Merge `duplicateId` into `keeperId` within the same tenant.
 *
 * The entire operation runs in a single transaction. Steps:
 *  1. Back-fill any missing person fields on the keeper from the duplicate.
 *  2. Resolve prospect membership collisions:
 *     a. For campaigns where the keeper already has a membership, copy any
 *        richer research/scoring data from the duplicate membership, repoint
 *        the duplicate's touches to the keeper's membership, then delete the
 *        duplicate membership.
 *     b. For campaigns where the keeper has no membership, repoint the
 *        duplicate membership directly to the keeper.
 *  3. Repoint marketing_contact_events from duplicate → keeper.
 *  4. Repoint marketing_segment_members (delete keeper-already-in-segment
 *     duplicates to respect the (segmentId, contactId) PK).
 *  5. Repoint marketing_workflow_enrollments from duplicate → keeper.
 *  6. Delete the duplicate contact (no remaining FK children).
 *
 * Both contacts must belong to `tenantDomain`; throws otherwise.
 */
export async function mergeContacts(
  tenantDomain: string,
  keeperId: string,
  duplicateId: string,
): Promise<MergeResult> {
  if (keeperId === duplicateId) throw new Error("keeperId and duplicateId must differ");

  // Pre-flight: load both contacts before entering the transaction.
  const [keeper, duplicate] = await Promise.all([
    db.select().from(marketingContacts).where(eq(marketingContacts.id, keeperId)).limit(1),
    db.select().from(marketingContacts).where(eq(marketingContacts.id, duplicateId)).limit(1),
  ]);

  if (!keeper[0]) throw new Error(`Keeper contact ${keeperId} not found`);
  if (!duplicate[0]) throw new Error(`Duplicate contact ${duplicateId} not found`);
  if (keeper[0].tenantDomain !== tenantDomain) throw new Error("Keeper contact does not belong to this tenant");
  if (duplicate[0].tenantDomain !== tenantDomain) throw new Error("Duplicate contact does not belong to this tenant");

  return db.transaction(async (tx) => {
    const k = keeper[0];
    const d = duplicate[0];
    const now = new Date();

    // 1. Back-fill missing person fields on the keeper.
    const contactSet: Partial<typeof marketingContacts.$inferInsert> = {};
    if (!k.email && d.email) contactSet.email = d.email;
    if (!k.firstName && d.firstName) contactSet.firstName = d.firstName;
    if (!k.lastName && d.lastName) contactSet.lastName = d.lastName;
    if (!k.company && d.company) contactSet.company = d.company;
    if (!k.jobTitle && d.jobTitle) contactSet.jobTitle = d.jobTitle;
    if (!k.linkedinUrl && d.linkedinUrl) contactSet.linkedinUrl = d.linkedinUrl;
    if (!k.hubspotContactId && d.hubspotContactId) contactSet.hubspotContactId = d.hubspotContactId;
    if (!k.hubspotCompanyId && d.hubspotCompanyId) contactSet.hubspotCompanyId = d.hubspotCompanyId;
    // Preserve the stricter opt-out state.
    if (d.emailOptOut && !k.emailOptOut) {
      contactSet.emailOptOut = true;
      contactSet.emailOptOutAt = d.emailOptOutAt ?? now;
      contactSet.emailOptOutSource = d.emailOptOutSource ?? "contact_merge";
    }
    if (Object.keys(contactSet).length > 0) {
      await tx
        .update(marketingContacts)
        .set({ ...contactSet, updatedAt: now })
        .where(eq(marketingContacts.id, keeperId));
    }

    // 2. Resolve prospect membership collisions.
    const [dupMemberships, keeperMemberships] = await Promise.all([
      tx
        .select({ id: prospects.id, campaignId: prospects.campaignId, researchDossier: prospects.researchDossier, icpScore: prospects.icpScore, scoreBreakdown: prospects.scoreBreakdown, disqualifiedReason: prospects.disqualifiedReason, signals: prospects.signals, createdAt: prospects.createdAt })
        .from(prospects)
        .where(eq(prospects.contactId, duplicateId)),
      tx
        .select({ id: prospects.id, campaignId: prospects.campaignId, researchDossier: prospects.researchDossier, icpScore: prospects.icpScore, scoreBreakdown: prospects.scoreBreakdown, disqualifiedReason: prospects.disqualifiedReason, signals: prospects.signals, createdAt: prospects.createdAt })
        .from(prospects)
        .where(eq(prospects.contactId, keeperId)),
    ]);

    const keeperByCampaign = new Map(keeperMemberships.map((m) => [m.campaignId, m]));
    const colliding = dupMemberships.filter((m) => keeperByCampaign.has(m.campaignId));
    const nonColliding = dupMemberships.filter((m) => !keeperByCampaign.has(m.campaignId));

    let prospectsRepointed = 0;

    if (colliding.length > 0) {
      for (const dup of colliding) {
        const keeperMembership = keeperByCampaign.get(dup.campaignId)!;

        // 2a-i. Repoint touches from the colliding duplicate membership → keeper membership
        //       BEFORE deleting it (outreach_touches.prospect_id cascades on delete).
        await tx
          .update(outreachTouches)
          .set({ prospectId: keeperMembership.id, updatedAt: now } as any)
          .where(eq(outreachTouches.prospectId, dup.id));

        // 2a-ii. Merge richer research/scoring data from the duplicate membership
        //        onto the keeper's membership.
        const membershipSet: Record<string, unknown> = { updatedAt: now };
        if (!keeperMembership.researchDossier && dup.researchDossier) membershipSet.researchDossier = dup.researchDossier;
        if (keeperMembership.icpScore === null && dup.icpScore !== null) membershipSet.icpScore = dup.icpScore;
        if (!keeperMembership.scoreBreakdown && dup.scoreBreakdown) membershipSet.scoreBreakdown = dup.scoreBreakdown;
        if (!keeperMembership.disqualifiedReason && dup.disqualifiedReason) membershipSet.disqualifiedReason = dup.disqualifiedReason;
        if (!keeperMembership.signals && dup.signals) membershipSet.signals = dup.signals;
        // Preserve the earliest created_at.
        if (dup.createdAt < keeperMembership.createdAt) membershipSet.createdAt = dup.createdAt;

        await tx
          .update(prospects)
          .set(membershipSet as any)
          .where(eq(prospects.id, keeperMembership.id));

        // 2a-iii. Delete the duplicate membership (all its touches have been repointed).
        await tx.delete(prospects).where(eq(prospects.id, dup.id));
      }
    }

    if (nonColliding.length > 0) {
      // 2b. Non-colliding: repoint directly to the keeper contact.
      await tx
        .update(prospects)
        .set({ contactId: keeperId, updatedAt: now })
        .where(inArray(prospects.id, nonColliding.map((m) => m.id)));
      prospectsRepointed = nonColliding.length;
    }

    // 3. Repoint timeline events.
    const eventsResult = await tx
      .update(marketingContactEvents)
      .set({ contactId: keeperId, tenantDomain })
      .where(eq(marketingContactEvents.contactId, duplicateId))
      .returning({ id: marketingContactEvents.id });
    const eventsRepointed = eventsResult.length;

    // 4. Repoint segment memberships.
    //    marketing_segment_members has PK (segmentId, contactId), so we must
    //    delete any row where the keeper is already in the same segment.
    const dupSegments = await tx
      .select({ segmentId: marketingSegmentMembers.segmentId })
      .from(marketingSegmentMembers)
      .where(eq(marketingSegmentMembers.contactId, duplicateId));

    if (dupSegments.length > 0) {
      const dupSegmentIds = dupSegments.map((s) => s.segmentId);
      const keeperSegments = await tx
        .select({ segmentId: marketingSegmentMembers.segmentId })
        .from(marketingSegmentMembers)
        .where(and(eq(marketingSegmentMembers.contactId, keeperId), inArray(marketingSegmentMembers.segmentId, dupSegmentIds)));

      const keeperSegmentSet = new Set(keeperSegments.map((s) => s.segmentId));
      const segmentsToDelete = dupSegmentIds.filter((sid) => keeperSegmentSet.has(sid));
      const segmentsToRepoint = dupSegmentIds.filter((sid) => !keeperSegmentSet.has(sid));

      if (segmentsToDelete.length > 0) {
        await tx
          .delete(marketingSegmentMembers)
          .where(and(eq(marketingSegmentMembers.contactId, duplicateId), inArray(marketingSegmentMembers.segmentId, segmentsToDelete)));
      }
      if (segmentsToRepoint.length > 0) {
        await tx
          .update(marketingSegmentMembers)
          .set({ contactId: keeperId })
          .where(and(eq(marketingSegmentMembers.contactId, duplicateId), inArray(marketingSegmentMembers.segmentId, segmentsToRepoint)));
      }
    }

    // 5. Repoint workflow enrollments.
    await tx
      .update(marketingWorkflowEnrollments)
      .set({ contactId: keeperId, updatedAt: now })
      .where(eq(marketingWorkflowEnrollments.contactId, duplicateId));

    // 6. Delete the duplicate contact (all FK children repointed above).
    await tx.delete(marketingContacts).where(eq(marketingContacts.id, duplicateId));

    return { keeperId, duplicateId, prospectsRepointed, eventsRepointed };
  });
}

// ---------------------------------------------------------------------------
// Membership insert (conflict-safe)
// ---------------------------------------------------------------------------

/**
 * Insert a campaign-membership row, safely handling the unique
 * (campaign_id, contact_id) constraint: a repeated/concurrent add returns the
 * existing membership id with created=false instead of erroring or duplicating.
 */
export async function addCampaignMembership(
  values: typeof prospects.$inferInsert,
): Promise<{ membershipId: string; created: boolean }> {
  const [inserted] = await db
    .insert(prospects)
    .values(values)
    .onConflictDoNothing({ target: [prospects.campaignId, prospects.contactId] })
    .returning({ id: prospects.id });
  if (inserted) return { membershipId: inserted.id, created: true };

  const [existing] = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.campaignId, values.campaignId), eq(prospects.contactId, values.contactId)))
    .limit(1);
  if (!existing) {
    throw new Error("Failed to add prospect to campaign (membership insert conflicted but no existing row found)");
  }
  return { membershipId: existing.id, created: false };
}

// ---------------------------------------------------------------------------
// Person-field updates (edits, enrichment, HubSpot id writes)
// ---------------------------------------------------------------------------

export interface ContactPersonPatch {
  name?: string;
  title?: string | null;
  companyName?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  hubspotContactId?: string | null;
  hubspotCompanyId?: string | null;
}

/**
 * Write person-field edits to the contact. Email is normalized. Callers are
 * responsible for validation; this maps the legacy prospect field names onto
 * contact columns. Returns the updated contact.
 */
export async function updateContactPersonFields(
  contactId: string,
  patch: ContactPersonPatch,
): Promise<MarketingContact | null> {
  const set: Partial<typeof marketingContacts.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const { firstName, lastName } = splitName(patch.name);
    set.firstName = firstName;
    set.lastName = lastName;
  }
  if (patch.title !== undefined) set.jobTitle = patch.title;
  if (patch.companyName !== undefined) set.company = patch.companyName;
  if (patch.email !== undefined) {
    const norm = patch.email ? normaliseEmail(patch.email) : "";
    set.email = norm && norm.includes("@") ? norm : null;
  }
  if (patch.linkedinUrl !== undefined) set.linkedinUrl = patch.linkedinUrl;
  if (patch.hubspotContactId !== undefined) set.hubspotContactId = patch.hubspotContactId;
  if (patch.hubspotCompanyId !== undefined) set.hubspotCompanyId = patch.hubspotCompanyId;

  const [updated] = await db
    .update(marketingContacts)
    .set(set)
    .where(eq(marketingContacts.id, contactId))
    .returning();
  return updated ?? null;
}
