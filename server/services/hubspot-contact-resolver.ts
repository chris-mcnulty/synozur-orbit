/**
 * HubSpot contact resolver — marketing-email sync Phase 1.
 *
 * Maps the recipients of an email send to HubSpot contact ids so later phases
 * can attach engagement to the right contact timeline. For each recipient we:
 *   1. reuse a cached id from email_recipients when present,
 *   2. otherwise search HubSpot by email (batched), and
 *   3. optionally create a contact when none exists and the tenant has
 *      auto-create enabled (default on; admin opt-out).
 *
 * Resolution is best-effort and runs AFTER the SendGrid send — it never blocks
 * or fails delivery. Standalone-safe: with no HubSpot connection every
 * recipient is marked `skipped`.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { emailSendRecipients, emailRecipients } from "@shared/schema";
import { getTenantClient } from "./hubspot-integration";
import { storage } from "../storage";
import { isHubspotEmailSyncEnabled } from "./hubspot-email-sync";
import { dedupeEmails, syncStatusForOutcome, type ContactResolutionOutcome } from "./hubspot-email-sync-core";

// HubSpot search caps: max 100 values per IN filter / page.
const SEARCH_CHUNK = 100;
// Bound how many contacts we'll create inline per send to protect against
// runaway CRM growth + API rate limits; excess is left `skipped` for the
// backfill job (later phase) to pick up.
const MAX_CREATE_PER_SEND = Number(process.env.MARKETING_HS_MAX_CREATE_PER_SEND || 500);

export interface ResolveResult {
  resolved: number;
  created: number;
  skipped: number;
  errors: number;
  ran: boolean;
}

const EMPTY: ResolveResult = { resolved: 0, created: 0, skipped: 0, errors: 0, ran: false };

/**
 * Resolve all recipients of a send to HubSpot contact ids and persist the
 * results onto email_send_recipients (and back-fill the email_recipients
 * cache). Never throws — returns counts for audit/diagnostics.
 */
export async function resolveSendRecipientContacts(opts: {
  tenantDomain: string;
  sendId: string;
}): Promise<ResolveResult> {
  const { tenantDomain, sendId } = opts;
  try {
    const rows = await db
      .select({ email: emailSendRecipients.email })
      .from(emailSendRecipients)
      .where(eq(emailSendRecipients.sendId, sendId));
    const emails = dedupeEmails(rows.map((r) => r.email));
    if (emails.length === 0) return { ...EMPTY, ran: true };

    // Feature gate: a downgrade / manual override disables sync even if a
    // connection exists. Mark skipped so reporting stays accurate.
    if (!(await isHubspotEmailSyncEnabled(tenantDomain))) {
      await markStatus(sendId, emails, null, "skipped");
      return { ...EMPTY, skipped: emails.length, ran: false };
    }

    const conn = await storage.getHubspotConnection(tenantDomain);
    if (!conn) {
      // No CRM connection — mark everything skipped so reporting is accurate.
      await markStatus(sendId, emails, null, "skipped");
      return { ...EMPTY, skipped: emails.length, ran: false };
    }

    // 1) Cache hit: pull any contact ids already resolved on the list rows.
    const cached = await loadCachedContactIds(tenantDomain, emails);

    const toLookup = emails.filter((e) => !cached.has(e));
    const { client } = await getTenantClient(tenantDomain);

    // 2) Search HubSpot by email for the remainder.
    const found = await searchContactsByEmail(client, toLookup);

    // 3) Create missing contacts when auto-create is enabled.
    const missing = toLookup.filter((e) => !found.has(e));
    const created = new Map<string, string>();
    if (conn.autoCreateHubspotContacts) {
      const nameByEmail = await loadNames(sendId, missing);
      let createdCount = 0;
      for (const email of missing) {
        if (createdCount >= MAX_CREATE_PER_SEND) break;
        try {
          const id = await createContact(client, email, nameByEmail.get(email) ?? null);
          created.set(email, id);
          createdCount += 1;
        } catch {
          // leave as skipped/error below
        }
      }
    }

    // Persist per recipient.
    const result: ResolveResult = { resolved: 0, created: 0, skipped: 0, errors: 0, ran: true };
    for (const email of emails) {
      const id = cached.get(email) ?? found.get(email) ?? created.get(email) ?? null;
      let outcome: ContactResolutionOutcome;
      if (cached.has(email) || found.has(email)) outcome = "found";
      else if (created.has(email)) outcome = "created";
      else outcome = "not_found";

      await markStatus(sendId, [email], id, syncStatusForOutcome(outcome));
      if (id) await backfillCache(tenantDomain, email, id);

      if (outcome === "found" || outcome === "created") result.resolved += 1;
      if (outcome === "created") result.created += 1;
      if (outcome === "not_found") result.skipped += 1;
    }
    return result;
  } catch {
    // Resolution is best-effort; swallow so the send result is unaffected.
    return { ...EMPTY, ran: false, errors: 1 };
  }
}

async function loadCachedContactIds(tenantDomain: string, emails: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < emails.length; i += SEARCH_CHUNK) {
    const chunk = emails.slice(i, i + SEARCH_CHUNK);
    const rows = await db
      .select({ email: emailRecipients.email, hubspotContactId: emailRecipients.hubspotContactId })
      .from(emailRecipients)
      .where(and(eq(emailRecipients.tenantDomain, tenantDomain), inArray(emailRecipients.email, chunk)));
    for (const r of rows) {
      if (r.hubspotContactId) map.set(r.email.trim().toLowerCase(), r.hubspotContactId);
    }
  }
  return map;
}

async function loadNames(sendId: string, emails: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (emails.length === 0) return map;
  const rows = await db
    .select({ email: emailSendRecipients.email, name: emailSendRecipients.name })
    .from(emailSendRecipients)
    .where(and(eq(emailSendRecipients.sendId, sendId), inArray(emailSendRecipients.email, emails)));
  for (const r of rows) {
    if (r.name) map.set(r.email.trim().toLowerCase(), r.name);
  }
  return map;
}

async function searchContactsByEmail(
  client: Awaited<ReturnType<typeof getTenantClient>>["client"],
  emails: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < emails.length; i += SEARCH_CHUNK) {
    const chunk = emails.slice(i, i + SEARCH_CHUNK);
    const result = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "IN", values: chunk }] }],
      properties: ["email"],
      limit: SEARCH_CHUNK,
      after: "0",
    } as any);
    for (const c of result.results) {
      const email = ((c.properties as Record<string, string>)?.email || "").trim().toLowerCase();
      if (email) map.set(email, c.id);
    }
  }
  return map;
}

async function createContact(
  client: Awaited<ReturnType<typeof getTenantClient>>["client"],
  email: string,
  name: string | null,
): Promise<string> {
  const properties: Record<string, string> = { email };
  if (name) {
    const parts = name.trim().split(/\s+/);
    properties.firstname = parts[0];
    if (parts.length > 1) properties.lastname = parts.slice(1).join(" ");
  }
  const created = await client.crm.contacts.basicApi.create({ properties, associations: [] });
  return created.id;
}

async function markStatus(
  sendId: string,
  emails: string[],
  contactId: string | null,
  status: "resolved" | "skipped" | "error",
): Promise<void> {
  if (emails.length === 0) return;
  await db
    .update(emailSendRecipients)
    .set({
      hubspotContactId: contactId,
      hsSyncStatus: status,
      hsLastEventSyncedAt: new Date(),
      hsSyncError: status === "error" ? "contact resolution failed" : null,
    })
    .where(and(eq(emailSendRecipients.sendId, sendId), inArray(emailSendRecipients.email, emails)));
}

/** Cache the resolved id on any list rows for this tenant+email that lack one. */
async function backfillCache(tenantDomain: string, email: string, contactId: string): Promise<void> {
  await db
    .update(emailRecipients)
    .set({ hubspotContactId: contactId, hsSyncStatus: "resolved", hsLastSyncedAt: new Date() })
    .where(
      and(
        eq(emailRecipients.tenantDomain, tenantDomain),
        eq(emailRecipients.email, email),
        isNull(emailRecipients.hubspotContactId),
      ),
    );
}
