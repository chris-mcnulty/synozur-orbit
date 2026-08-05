/**
 * Marketing Contact Service
 *
 * Core upsert/ingest logic for the marketing_contacts + marketing_contact_events
 * tables. Consumed by:
 *   - POST /api/marketing-contacts/ingest-event  (webhook from synozur-webbase)
 *   - POST /api/marketing-contacts/backfill       (admin-only one-shot backfill)
 *   - hubspot-service.ts enrichment job
 */

import { db } from "../db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  marketingContacts,
  marketingContactEvents,
  emailRecipients,
  emailSendRecipients,
  emailSends,
  marketingLinkClicks,
  marketingLinks,
  type MarketingContact,
  type InsertMarketingContact,
  type InsertMarketingContactEvent,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Canonical email normalisation.  Every write path must run the incoming
 * address through this function so mixed-case variants (e.g. "User@Example.com"
 * from HubSpot) always resolve to the same lowercase DB key.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const LIFECYCLE_STAGES = [
  "subscriber",
  "lead",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "evangelist",
] as const;

/**
 * Returns true when `next` represents a higher lifecycle stage than `current`.
 * Never downgrades: if next is equal or lower, returns false.
 */
export function shouldAdvanceLifecycleStage(
  current: string | null | undefined,
  next: string | null | undefined,
): boolean {
  if (!next) return false;
  const currentIdx = LIFECYCLE_STAGES.indexOf((current ?? "subscriber") as any);
  const nextIdx = LIFECYCLE_STAGES.indexOf(next as any);
  if (nextIdx === -1) return false; // unknown stage — ignore
  return nextIdx > currentIdx;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContactEventType =
  | "form_submit"
  | "page_view"
  | "email_sent"
  | "email_open"
  | "email_click"
  | "link_click"
  | "social_engage";

export interface IngestEventPayload {
  tenantDomain: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  eventType: ContactEventType;
  source?: string | null;
  occurredAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpsertContactResult {
  contact: MarketingContact;
  created: boolean;
}

// ---------------------------------------------------------------------------
// Upsert contact
// ---------------------------------------------------------------------------

/**
 * Upsert a contact by (tenantDomain, email). Only updates non-null provided
 * fields so a page_view can't blank out a name captured from a form_submit.
 */
export async function upsertContact(opts: {
  tenantDomain: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  source?: string;
  hubspotContactId?: string | null;
  lifecycleStage?: string | null;
  metadata?: Record<string, unknown> | null;
  lastEventAt?: Date | null;
}): Promise<UpsertContactResult> {
  const now = new Date();
  const id = randomUUID();

  const insertValues: InsertMarketingContact = {
    id,
    tenantDomain: opts.tenantDomain,
    email: normaliseEmail(opts.email),
    firstName: opts.firstName?.trim() || null,
    lastName: opts.lastName?.trim() || null,
    company: opts.company?.trim() || null,
    jobTitle: opts.jobTitle?.trim() || null,
    lifecycleStage: opts.lifecycleStage || "subscriber",
    hubspotContactId: opts.hubspotContactId || null,
    source: opts.source || "manual",
    metadata: opts.metadata || null,
    lastEventAt: opts.lastEventAt || now,
  };

  // Build the set clause for ON CONFLICT — only update columns that are
  // actually provided (non-null) so existing richer data is preserved.
  const updateSet: Record<string, unknown> = {
    updatedAt: now,
  };
  if (opts.firstName) updateSet.firstName = opts.firstName.trim();
  if (opts.lastName) updateSet.lastName = opts.lastName.trim();
  if (opts.company) updateSet.company = opts.company.trim();
  if (opts.jobTitle) updateSet.jobTitle = opts.jobTitle.trim();
  if (opts.hubspotContactId) updateSet.hubspotContactId = opts.hubspotContactId;
  // Only advance lifecycle stage — never downgrade. Use a SQL CASE expression
  // so the rule is enforced atomically in the DB without an extra SELECT.
  if (opts.lifecycleStage) {
    const stages = LIFECYCLE_STAGES.join("','");
    updateSet.lifecycleStage = sql`CASE
      WHEN array_position(
        ARRAY['${sql.raw(stages)}']::text[],
        ${opts.lifecycleStage}::text
      ) > array_position(
        ARRAY['${sql.raw(stages)}']::text[],
        ${marketingContacts.lifecycleStage}
      )
      THEN ${opts.lifecycleStage}::text
      ELSE ${marketingContacts.lifecycleStage}
    END`;
  }
  if (opts.metadata) updateSet.metadata = opts.metadata;
  if (opts.lastEventAt) updateSet.lastEventAt = opts.lastEventAt;

  // Retry loop: two concurrent ingest requests for the same (tenantDomain, email)
  // can both attempt an INSERT before either commits.  PostgreSQL's unique index
  // prevents a duplicate row, but whichever transaction loses the race sees a
  // 23505 unique-violation error instead of the normal ON CONFLICT path.
  // Retrying lets the loser fall through to the UPDATE branch on the next attempt.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const [row] = await db
        .insert(marketingContacts)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [marketingContacts.tenantDomain, marketingContacts.email],
          set: updateSet,
        })
        .returning();

      const created = row.id === id;
      return { contact: row, created };
    } catch (err: any) {
      // 23505 = unique_violation — retry so the next attempt hits ON CONFLICT DO UPDATE.
      if (attempt < MAX_ATTEMPTS && err?.code === "23505") {
        continue;
      }
      throw err;
    }
  }

  // Unreachable — the loop always returns or throws, but TypeScript needs this.
  throw new Error("upsertContact: exceeded retry limit");
}

// ---------------------------------------------------------------------------
// Append event
// ---------------------------------------------------------------------------

export async function appendContactEvent(opts: {
  contactId: string;
  tenantDomain: string;
  eventType: ContactEventType;
  source?: string | null;
  occurredAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const occurredAt = opts.occurredAt || new Date();

  await db.insert(marketingContactEvents).values({
    id: randomUUID(),
    contactId: opts.contactId,
    tenantDomain: opts.tenantDomain,
    eventType: opts.eventType,
    source: opts.source || null,
    occurredAt,
    metadata: opts.metadata || null,
  } as InsertMarketingContactEvent);

  // Keep lastEventAt current on the contact row.
  await db
    .update(marketingContacts)
    .set({ lastEventAt: occurredAt, updatedAt: new Date() })
    .where(
      and(
        eq(marketingContacts.id, opts.contactId),
        sql`${marketingContacts.lastEventAt} IS NULL OR ${marketingContacts.lastEventAt} < ${occurredAt}`,
      ),
    );
}

// ---------------------------------------------------------------------------
// Ingest event (upsert contact + append event)
// ---------------------------------------------------------------------------

export async function ingestEvent(
  payload: IngestEventPayload,
): Promise<{ contact: MarketingContact; eventId: string }> {
  const occurredAt = payload.occurredAt || new Date();

  const { contact } = await upsertContact({
    tenantDomain: payload.tenantDomain,
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
    company: payload.company,
    jobTitle: payload.jobTitle,
    source: payload.source || payload.eventType,
    lastEventAt: occurredAt,
  });

  const eventId = randomUUID();
  await db.insert(marketingContactEvents).values({
    id: eventId,
    contactId: contact.id,
    tenantDomain: payload.tenantDomain,
    eventType: payload.eventType,
    source: payload.source || null,
    occurredAt,
    metadata: payload.metadata || null,
  } as InsertMarketingContactEvent);

  return { contact, eventId };
}

// ---------------------------------------------------------------------------
// Backfill from existing data
// ---------------------------------------------------------------------------

/**
 * One-shot backfill: hydrate the timeline from three existing data sources:
 *   1. email_recipients  → email_sent events (one per list member)
 *   2. email_send_recipients → email_sent / email_open / email_click events
 *   3. marketing_link_clicks → link_click events (for known-email links only)
 *
 * This is idempotent: contacts are upserted and events are always new rows
 * (so re-running adds duplicates of historical events). Typically you only
 * run this once at feature activation.
 *
 * Returns a summary of how many contacts/events were created.
 */
export async function backfillContactTimeline(tenantDomain: string): Promise<{
  contactsCreated: number;
  contactsFound: number;
  eventsCreated: number;
}> {
  let contactsCreated = 0;
  let contactsFound = 0;
  let eventsCreated = 0;

  // ── 1. email_recipients → subscriber contacts ───────────────────────────
  const recipientRows = await db
    .select({
      email: emailRecipients.email,
      name: emailRecipients.name,
      createdAt: emailRecipients.createdAt,
    })
    .from(emailRecipients)
    .where(eq(emailRecipients.tenantDomain, tenantDomain));

  // Deduplicate by normalised email so mixed-case duplicates in legacy data
  // (e.g. "User@Example.com" and "user@example.com") resolve to one contact
  // before we attempt any DB writes.
  const recipientsByEmail = new Map<string, typeof recipientRows[number]>();
  for (const r of recipientRows) {
    const key = normaliseEmail(r.email);
    if (!recipientsByEmail.has(key)) {
      recipientsByEmail.set(key, r);
    }
  }

  for (const r of recipientsByEmail.values()) {
    const parts = (r.name || "").split(" ");
    const firstName = parts[0] || null;
    const lastName = parts.slice(1).join(" ") || null;

    const { created } = await upsertContact({
      tenantDomain,
      email: r.email,
      firstName,
      lastName,
      source: "backfill",
      lastEventAt: r.createdAt,
    });
    if (created) contactsCreated++;
    else contactsFound++;
  }

  // ── 2. email_send_recipients → sent/open/click events ───────────────────
  // Join through email_sends to confirm same tenant.
  const sendRecipientRows = await db
    .select({
      email: emailSendRecipients.email,
      name: emailSendRecipients.name,
      sentAt: emailSendRecipients.sentAt,
      openedAt: emailSendRecipients.openedAt,
      clickedAt: emailSendRecipients.clickedAt,
      tenantDomain: emailSendRecipients.tenantDomain,
      sendId: emailSendRecipients.sendId,
    })
    .from(emailSendRecipients)
    .innerJoin(emailSends, eq(emailSendRecipients.sendId, emailSends.id))
    .where(
      and(
        eq(emailSendRecipients.tenantDomain, tenantDomain),
        isNotNull(emailSendRecipients.sentAt),
      ),
    );

  // Deduplicate by normalised email within this batch for the same reason as above.
  // When multiple sends went to mixed-case variants of the same address we want
  // a single contact row; events from all variants are still inserted below.
  const sendContactsByEmail = new Map<string, string>(); // normalised email → contact.id

  for (const r of sendRecipientRows) {
    const normalised = normaliseEmail(r.email);
    const parts = (r.name || "").split(" ");
    const firstName = parts[0] || null;
    const lastName = parts.slice(1).join(" ") || null;

    let contactId: string;
    if (sendContactsByEmail.has(normalised)) {
      // Already upserted within this batch — reuse the id and skip the count.
      contactId = sendContactsByEmail.get(normalised)!;
    } else {
      const { contact, created } = await upsertContact({
        tenantDomain,
        email: r.email,
        firstName,
        lastName,
        source: "backfill",
        lastEventAt: r.sentAt,
      });
      contactId = contact.id;
      sendContactsByEmail.set(normalised, contactId);
      if (created) contactsCreated++;
      else contactsFound++;
    }

    // Re-bind `contact` shape so the event-insert block below compiles cleanly.
    const contact = { id: contactId };

    if (r.sentAt) {
      await db.insert(marketingContactEvents).values({
        id: randomUUID(),
        contactId: contact.id,
        tenantDomain,
        eventType: "email_sent",
        source: "backfill",
        occurredAt: r.sentAt,
        metadata: { sendId: r.sendId },
      } as InsertMarketingContactEvent);
      eventsCreated++;
    }

    if (r.openedAt) {
      await db.insert(marketingContactEvents).values({
        id: randomUUID(),
        contactId: contact.id,
        tenantDomain,
        eventType: "email_open",
        source: "backfill",
        occurredAt: r.openedAt,
        metadata: { sendId: r.sendId },
      } as InsertMarketingContactEvent);
      eventsCreated++;
    }

    if (r.clickedAt) {
      await db.insert(marketingContactEvents).values({
        id: randomUUID(),
        contactId: contact.id,
        tenantDomain,
        eventType: "email_click",
        source: "backfill",
        occurredAt: r.clickedAt,
        metadata: { sendId: r.sendId },
      } as InsertMarketingContactEvent);
      eventsCreated++;
    }
  }

  // ── 3. marketing_link_clicks are anonymous (no email) — skip for now ─────
  // We would need a cookie/session join to attribute link clicks to a known
  // email address. This is Phase 2 (contact identity resolution).

  return { contactsCreated, contactsFound, eventsCreated };
}

// ---------------------------------------------------------------------------
// Enrich from HubSpot contact data
// ---------------------------------------------------------------------------

/**
 * Enrich a contact record with data pulled from HubSpot. Only fills in blank
 * Orbit-side fields — never overwrites values already captured by Orbit.
 */
export async function enrichContactFromHubSpot(opts: {
  tenantDomain: string;
  email: string;
  hubspotContactId: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  lifecycleStage?: string | null;
}): Promise<void> {
  const [existing] = await db
    .select()
    .from(marketingContacts)
    .where(
      and(
        eq(marketingContacts.tenantDomain, opts.tenantDomain),
        eq(marketingContacts.email, normaliseEmail(opts.email)),
      ),
    )
    .limit(1);

  const updateSet: Record<string, unknown> = {
    hubspotContactId: opts.hubspotContactId,
    updatedAt: new Date(),
  };

  if (!existing?.firstName && opts.firstName) updateSet.firstName = opts.firstName.trim();
  if (!existing?.lastName && opts.lastName) updateSet.lastName = opts.lastName.trim();
  if (!existing?.company && opts.company) updateSet.company = opts.company.trim();
  if (!existing?.jobTitle && opts.jobTitle) updateSet.jobTitle = opts.jobTitle.trim();
  if (shouldAdvanceLifecycleStage(existing?.lifecycleStage, opts.lifecycleStage)) {
    updateSet.lifecycleStage = opts.lifecycleStage;
  }

  if (existing) {
    await db
      .update(marketingContacts)
      .set(updateSet)
      .where(
        and(
          eq(marketingContacts.tenantDomain, opts.tenantDomain),
          eq(marketingContacts.email, normaliseEmail(opts.email)),
        ),
      );
  } else {
    // Normalise to lowercase before the upsert so HubSpot mixed-case addresses
    // (e.g. "User@Example.com") always resolve to the canonical lowercase record.
    await upsertContact({
      tenantDomain: opts.tenantDomain,
      email: normaliseEmail(opts.email),
      firstName: opts.firstName,
      lastName: opts.lastName,
      company: opts.company,
      jobTitle: opts.jobTitle,
      lifecycleStage: opts.lifecycleStage || "lead",
      hubspotContactId: opts.hubspotContactId,
      source: "hubspot",
    });
  }
}
