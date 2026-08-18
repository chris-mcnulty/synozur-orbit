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
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  marketingContacts,
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
        if (!existing.linkedinUrl && person.linkedinUrl) set.linkedinUrl = person.linkedinUrl;
        if (!existing.hubspotContactId && person.hubspotContactId) set.hubspotContactId = person.hubspotContactId;
        if (!existing.hubspotCompanyId && person.hubspotCompanyId) set.hubspotCompanyId = person.hubspotCompanyId;
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
      // Lost a concurrent race — the contact now exists; fetch it. Never fall
      // through to the unverified generated id: it was not persisted, and a
      // membership insert against it would fail its FK.
      const [raced] = await db
        .select({ id: marketingContacts.id })
        .from(marketingContacts)
        .where(and(eq(marketingContacts.tenantDomain, tenantDomain), eq(marketingContacts.email, email)))
        .limit(1);
      if (raced) return { contactId: raced.id, created: false };
      throw new Error(`Failed to find or create marketing contact for ${email}`);
    }
    if (person.hubspotContactId) {
      preWarmMarketingCache(tenantDomain, email, person.hubspotContactId).catch(() => {});
    }
    return { contactId: id, created: true };
  }

  // No email — create a standalone contact row (nullable email).
  const id = randomUUID();
  await db.insert(marketingContacts).values({
    id,
    tenantDomain,
    email: null,
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
  });
  return { contactId: id, created: true };
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
