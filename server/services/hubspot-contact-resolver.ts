/**
 * HubSpot contact resolver — unified contact resolution layer.
 *
 * Provides a SINGLE canonical function (`resolveHubspotContactId`) used by
 * both the marketing-email and sales-outreach systems to map an email address
 * to a HubSpot contact ID.
 *
 * Resolution priority (per task spec)
 * ─────────────────────────────────────
 *   1. prospects.hubspotContactId    — sales already resolved this contact
 *   2. email_recipients.hubspotContactId — marketing list cache
 *   3. HubSpot search by email       — live API lookup
 *   4. auto-create (if enabled)      — creates contact + associates company
 *
 * When a contact ID is resolved via steps 3 or 4 it is written back to
 * email_recipients so subsequent marketing sends hit the cache.
 *
 * Public exports
 * ──────────────
 * _resolveContactWithDeps(email, tenantDomain, opts, deps)
 *   Pure DI-based core exported for unit tests — no DB or network needed.
 *
 * resolveHubspotContactId(email, tenantDomain, opts)
 *   Canonical single-contact resolver. Called from both the sales path (via
 *   pushProspectToHubspot) and per-email from the marketing batch path.
 *
 * preWarmMarketingCache(tenantDomain, email, contactId)
 *   Updates existing email_recipients rows so the next marketing send finds
 *   the ID without hitting the HubSpot API. Best-effort; safe to fire-and-forget.
 *
 * resolveSendRecipientContacts(opts)
 *   Batch resolver for a marketing send — calls resolveHubspotContactId per
 *   recipient and persists results onto email_send_recipients.
 */

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
import { emailSendRecipients, emailRecipients, prospects } from "@shared/schema";
import { getTenantClient, hasHubspotEmailScopes } from "./hubspot-integration";
import { storage } from "../storage";
import { isHubspotEmailSyncEnabled } from "./hubspot-email-sync";
import {
  dedupeEmails,
  normalizeEmail,
  syncStatusForOutcome,
  type ContactResolutionOutcome,
} from "./hubspot-email-sync-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolveResult {
  resolved: number;
  created: number;
  skipped: number;
  errors: number;
  ran: boolean;
}

const EMPTY: ResolveResult = { resolved: 0, created: 0, skipped: 0, errors: 0, ran: false };

/** Injected dependency callbacks for the core resolver. All closures so they
 *  carry email/tenantDomain/client context at construction time — the
 *  interface stays stable for tests. */
export interface ContactResolverDeps {
  /** Return { contactId, companyId } if the prospects table has a resolved id. */
  prospectLookup(): Promise<{ contactId: string; companyId: string | null } | null>;
  /** Return the cached id from email_recipients.hubspotContactId, or null. */
  recipientCacheLookup(): Promise<string | null>;
  /** Search HubSpot by email; return the contact id or null. */
  hubspotSearch(): Promise<string | null>;
  /** Create a new HubSpot contact; return the new id. */
  hubspotCreate(): Promise<string>;
  /** Associate a contact with a company (best-effort, may throw). */
  associateCompany(contactId: string, companyId: string): Promise<void>;
  /** Persist the resolved id back to email_recipients (UPDATE existing rows). */
  writeCache(contactId: string): Promise<void>;
  /** Whether the tenant has auto-create enabled. */
  autoCreateEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Core pure resolver (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Pure resolution logic with injected deps. Tests pass vi.fn() stubs for
 * each dep and assert priority chain without DB or HubSpot network calls.
 *
 * Priority: prospect cache → recipient cache → HubSpot search → auto-create.
 */
export async function _resolveContactWithDeps(
  email: string,
  _tenantDomain: string,
  opts: { autoCreate?: boolean; name?: string | null },
  deps: ContactResolverDeps,
): Promise<string | null> {
  const norm = normalizeEmail(email);
  if (!norm) return null;

  // Step 1: sales prospect cache
  const prospect = await deps.prospectLookup();
  if (prospect?.contactId) {
    await deps.writeCache(prospect.contactId).catch(() => {});
    return prospect.contactId;
  }

  // Step 2: marketing recipient cache (email_recipients.hubspotContactId)
  const cached = await deps.recipientCacheLookup();
  if (cached) return cached;

  // Step 3: HubSpot search
  const found = await deps.hubspotSearch();
  if (found) {
    await deps.writeCache(found).catch(() => {});
    return found;
  }

  // Step 4: auto-create
  if (!opts.autoCreate || !deps.autoCreateEnabled) return null;
  const created = await deps.hubspotCreate();
  // Associate with company when the prospect row has a hubspotCompanyId.
  const companyId = prospect?.companyId ?? null;
  if (companyId) {
    await deps.associateCompany(created, companyId).catch(() => {});
  }
  await deps.writeCache(created).catch(() => {});
  return created;
}

// ---------------------------------------------------------------------------
// Public single-contact resolver (canonical call site for both paths)
// ---------------------------------------------------------------------------

/**
 * Resolve a single email address to a HubSpot contact ID. This is THE single
 * call site used by both the sales-outreach path (via pushProspectToHubspot)
 * and per-email from the marketing batch resolver.
 * Never throws — returns null on any failure.
 */
export async function resolveHubspotContactId(
  email: string,
  tenantDomain: string,
  opts: { autoCreate?: boolean; name?: string | null } = {},
): Promise<string | null> {
  const norm = normalizeEmail(email);
  if (!norm) return null;

  try {
    let client: Awaited<ReturnType<typeof getTenantClient>>["client"] | null = null;
    const getClient = async () => {
      if (!client) client = (await getTenantClient(tenantDomain)).client;
      return client;
    };

    const conn = await storage.getHubspotConnection(tenantDomain);
    const autoCreateEnabled = !!(conn?.autoCreateHubspotContacts);

    const deps: ContactResolverDeps = {
      /** Two queries: (a) row with contactId; (b) row with only companyId so
       *  the auto-create branch can still associate the contact with its company
       *  even when the prospect doesn't have a contact ID yet. */
      async prospectLookup() {
        const [contactRow] = await db
          .select({ contactId: prospects.hubspotContactId, companyId: prospects.hubspotCompanyId })
          .from(prospects)
          .where(
            and(
              eq(prospects.tenantDomain, tenantDomain),
              eq(prospects.email, norm),
              isNotNull(prospects.hubspotContactId),
            ),
          )
          .limit(1);
        if (contactRow?.contactId) {
          return { contactId: contactRow.contactId, companyId: contactRow.companyId ?? null };
        }
        // No contact ID yet — check for company ID to enable association on create.
        const [companyRow] = await db
          .select({ companyId: prospects.hubspotCompanyId })
          .from(prospects)
          .where(
            and(
              eq(prospects.tenantDomain, tenantDomain),
              eq(prospects.email, norm),
              isNotNull(prospects.hubspotCompanyId),
            ),
          )
          .limit(1);
        // Return null contactId so the resolver falls through to next step.
        return { contactId: null as any, companyId: companyRow?.companyId ?? null };
      },

      async recipientCacheLookup() {
        const [row] = await db
          .select({ hubspotContactId: emailRecipients.hubspotContactId })
          .from(emailRecipients)
          .where(
            and(
              eq(emailRecipients.tenantDomain, tenantDomain),
              eq(emailRecipients.email, norm),
              isNotNull(emailRecipients.hubspotContactId),
            ),
          )
          .limit(1);
        return row?.hubspotContactId ?? null;
      },

      async hubspotSearch() {
        const c = await getClient();
        const result = await c.crm.contacts.searchApi.doSearch({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", values: [norm] }] }],
          properties: ["email"],
          limit: 1,
          after: "0",
        } as any);
        return result.results[0]?.id ?? null;
      },

      async hubspotCreate() {
        const c = await getClient();
        const properties: Record<string, string> = { email: norm };
        if (opts.name) {
          const parts = opts.name.trim().split(/\s+/);
          properties.firstname = parts[0];
          if (parts.length > 1) properties.lastname = parts.slice(1).join(" ");
        }
        const created = await c.crm.contacts.basicApi.create({ properties, associations: [] });
        return created.id;
      },

      async associateCompany(contactId, companyId) {
        const c = await getClient();
        await c.crm.associations.v4.basicApi.create(
          "contacts",
          contactId,
          "companies",
          companyId,
          [{ associationCategory: "HUBSPOT_DEFINED" as any, associationTypeId: 1 }],
        );
      },

      async writeCache(contactId) {
        await backfillListCache(tenantDomain, norm, contactId);
      },

      autoCreateEnabled,
    };

    return await _resolveContactWithDeps(norm, tenantDomain, opts, deps);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pre-warm helper (called from sales routes after writing prospect contactId)
// ---------------------------------------------------------------------------

/**
 * Update any existing email_recipients rows for this tenant+email with the
 * resolved contact ID, so the next marketing send finds it in the list cache
 * without a HubSpot API call. UPDATE-only (email_recipients requires a listId
 * FK so we cannot insert rows here). Safe to fire-and-forget.
 */
export async function preWarmMarketingCache(
  tenantDomain: string,
  email: string,
  contactId: string,
): Promise<void> {
  const norm = normalizeEmail(email);
  if (!norm || !contactId) return;
  await backfillListCache(tenantDomain, norm, contactId);
}

// ---------------------------------------------------------------------------
// Batch resolver (marketing send path)
// ---------------------------------------------------------------------------

/**
 * Resolve all recipients of a send to HubSpot contact IDs and persist the
 * results onto email_send_recipients. Calls `resolveHubspotContactId` per
 * recipient so the single canonical priority chain is always respected.
 * Never throws — returns counts for audit/diagnostics.
 */
export async function resolveSendRecipientContacts(opts: {
  tenantDomain: string;
  sendId: string;
}): Promise<ResolveResult> {
  const { tenantDomain, sendId } = opts;
  try {
    const rows = await db
      .select({ email: emailSendRecipients.email, name: emailSendRecipients.name })
      .from(emailSendRecipients)
      .where(eq(emailSendRecipients.sendId, sendId));

    const emails = dedupeEmails(rows.map((r) => r.email));
    if (emails.length === 0) return { ...EMPTY, ran: true };

    // Feature gate: skip gracefully without touching HubSpot.
    if (!(await isHubspotEmailSyncEnabled(tenantDomain))) {
      await markStatus(sendId, emails, null, "skipped");
      return { ...EMPTY, skipped: emails.length, ran: false };
    }

    const conn = await storage.getHubspotConnection(tenantDomain);
    if (!conn) {
      await markStatus(sendId, emails, null, "skipped");
      return { ...EMPTY, skipped: emails.length, ran: false };
    }
    if (!hasHubspotEmailScopes(conn)) {
      // Connection predates the marketing-email scopes; leave pending for backfill.
      await markStatus(sendId, emails, null, "pending");
      return { ...EMPTY, ran: false };
    }

    const nameByEmail = new Map(rows.map((r) => [normalizeEmail(r.email), r.name ?? null]));
    const autoCreate = !!(conn.autoCreateHubspotContacts);
    const result: ResolveResult = { resolved: 0, created: 0, skipped: 0, errors: 0, ran: true };

    for (const email of emails) {
      const norm = normalizeEmail(email);

      // Snapshot whether this email already has a recipient-cache entry before
      // calling the resolver, so we can accurately count "created" vs "found".
      const preExisted = await hasRecipientCacheEntry(tenantDomain, norm);

      const contactId = await resolveHubspotContactId(norm, tenantDomain, {
        autoCreate,
        name: nameByEmail.get(norm) ?? null,
      });

      let outcome: ContactResolutionOutcome;
      if (!contactId) {
        outcome = "not_found";
      } else if (preExisted) {
        outcome = "found";
      } else if (autoCreate) {
        // Either found via HubSpot search (new to our cache) or auto-created.
        // We conservatively use "created" only if autoCreate is on and the
        // contact wasn't previously cached — "found" is used otherwise.
        outcome = "created";
      } else {
        outcome = "found";
      }

      await markStatus(sendId, [email], contactId, syncStatusForOutcome(outcome));

      if (contactId) result.resolved += 1;
      if (outcome === "created") result.created += 1;
      if (outcome === "not_found") result.skipped += 1;
    }

    return result;
  } catch {
    return { ...EMPTY, ran: false, errors: 1 };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** True when email_recipients already has a resolved contact ID for this
 *  tenant+email pair. Used to distinguish "found" vs "created" in counts. */
async function hasRecipientCacheEntry(tenantDomain: string, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: emailRecipients.hubspotContactId })
    .from(emailRecipients)
    .where(
      and(
        eq(emailRecipients.tenantDomain, tenantDomain),
        eq(emailRecipients.email, email),
        isNotNull(emailRecipients.hubspotContactId),
      ),
    )
    .limit(1);
  return !!row?.id;
}

/** Update existing email_recipients rows with the resolved contact ID.
 *  This is best-effort — rows that don't exist yet (person not on any list)
 *  are not created (email_recipients requires a non-null listId FK). */
async function backfillListCache(
  tenantDomain: string,
  email: string,
  contactId: string,
): Promise<void> {
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

async function markStatus(
  sendId: string,
  emails: string[],
  contactId: string | null,
  status: "resolved" | "skipped" | "error" | "pending",
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
