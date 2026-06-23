/**
 * HubSpot contact resolver — unified contact resolution layer.
 *
 * Provides a SINGLE canonical path used by both the marketing-email and
 * sales-outreach systems to map an email address to a HubSpot contact ID.
 *
 * Resolution priority
 * ───────────────────
 *   1. prospects.hubspotContactId   — sales already resolved this contact
 *   2. hubspotContactIdCache        — shared cross-system cache (upsertable)
 *   3. HubSpot search by email      — live API lookup
 *   4. auto-create (if enabled)     — creates contact + associates company
 *
 * When a contact ID is resolved via steps 3 or 4 it is written to
 * hubspotContactIdCache so subsequent lookups (either path) hit the cache.
 *
 * Public exports
 * ──────────────
 * resolveHubspotContactId(email, tenantDomain, opts)
 *   Single-contact canonical resolver. Called from the sales path whenever
 *   a prospect hubspotContactId is needed, and per-email from the batch
 *   marketing send path.
 *
 * _resolveContactWithDeps(email, tenantDomain, opts, deps)
 *   Pure core implementation with injected async callbacks. Exported for
 *   unit testing without DB or HubSpot network calls.
 *
 * preWarmMarketingCache(tenantDomain, email, contactId)
 *   Upserts into hubspotContactIdCache so the next marketing send finds the
 *   ID without hitting the HubSpot API. Safe to fire-and-forget.
 *
 * resolveSendRecipientContacts(opts)
 *   Batch resolver for a marketing send — calls resolveHubspotContactId per
 *   recipient and persists results onto email_send_recipients.
 */

import { and, eq, isNotNull, isNull, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  emailSendRecipients,
  emailRecipients,
  prospects,
  hubspotContactIdCache,
} from "@shared/schema";
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

/** Injected dependency callbacks for the core resolver. All take no parameters
 *  because they are closures over the email / tenantDomain / client already
 *  captured at the call site — this keeps the signature stable for tests. */
export interface ContactResolverDeps {
  /** Return { contactId, companyId } if the prospects table has a resolved id. */
  prospectLookup(): Promise<{ contactId: string; companyId: string | null } | null>;
  /** Return the cached id from hubspotContactIdCache, or null. */
  cacheLookup(): Promise<string | null>;
  /** Search HubSpot by email; return the contact id or null. */
  hubspotSearch(): Promise<string | null>;
  /** Create a new HubSpot contact; return the new id. */
  hubspotCreate(): Promise<string>;
  /** Associate a contact with a company (best-effort, may throw). */
  associateCompany(contactId: string, companyId: string): Promise<void>;
  /** Persist the resolved id to hubspotContactIdCache. */
  writeCache(contactId: string): Promise<void>;
  /** Whether auto-create is enabled for the tenant. */
  autoCreateEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Core pure resolver (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Pure resolution logic with injected deps. Tests can pass vi.fn() stubs for
 * each dep and assert that the priority chain is respected without any DB or
 * HubSpot network calls.
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

  // Step 2: shared cross-system cache
  const cached = await deps.cacheLookup();
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
  if (prospect?.companyId) {
    await deps.associateCompany(created, prospect.companyId).catch(() => {});
  }
  await deps.writeCache(created).catch(() => {});
  return created;
}

// ---------------------------------------------------------------------------
// Public single-contact resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a single email address to a HubSpot contact ID using the canonical
 * priority chain. Used by both the sales-outreach and marketing-email paths.
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
    // Lazy-load HubSpot client (may throw if no connection).
    let client: Awaited<ReturnType<typeof getTenantClient>>["client"] | null = null;
    const getClient = async () => {
      if (!client) client = (await getTenantClient(tenantDomain)).client;
      return client;
    };

    const conn = await storage.getHubspotConnection(tenantDomain);
    const autoCreateEnabled = !!(conn?.autoCreateHubspotContacts);

    const deps: ContactResolverDeps = {
      async prospectLookup() {
        const [row] = await db
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
        if (!row?.contactId) return null;
        return { contactId: row.contactId, companyId: row.companyId ?? null };
      },

      async cacheLookup() {
        const [row] = await db
          .select({ hubspotContactId: hubspotContactIdCache.hubspotContactId })
          .from(hubspotContactIdCache)
          .where(
            and(
              eq(hubspotContactIdCache.tenantDomain, tenantDomain),
              eq(hubspotContactIdCache.email, norm),
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
        await upsertCache(tenantDomain, norm, contactId);
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
 * Upsert a resolved contact ID into the shared cache so the next marketing
 * send finds it without a HubSpot API call. Safe to fire-and-forget
 * (catch(() => {}) at the call site).
 */
export async function preWarmMarketingCache(
  tenantDomain: string,
  email: string,
  contactId: string,
): Promise<void> {
  const norm = normalizeEmail(email);
  if (!norm || !contactId) return;
  await upsertCache(tenantDomain, norm, contactId);
}

// ---------------------------------------------------------------------------
// Batch resolver (marketing send path)
// ---------------------------------------------------------------------------

/**
 * Resolve all recipients of a send to HubSpot contact IDs and persist the
 * results onto email_send_recipients. Calls resolveHubspotContactId per
 * recipient so the shared priority chain is always respected. Never throws —
 * returns counts for audit/diagnostics.
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

    // Feature gate check — mark skipped/pending without touching HubSpot.
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
      await markStatus(sendId, emails, null, "pending");
      return { ...EMPTY, ran: false };
    }

    const nameByEmail = new Map(rows.map((r) => [normalizeEmail(r.email), r.name ?? null]));

    const result: ResolveResult = { resolved: 0, created: 0, skipped: 0, errors: 0, ran: true };

    for (const email of emails) {
      const norm = normalizeEmail(email);
      // Determine whether this is a new contact create by checking if
      // the cache/prospects have it before we call resolve.
      const preExists = await hasExistingContactId(tenantDomain, norm);

      const contactId = await resolveHubspotContactId(norm, tenantDomain, {
        autoCreate: conn.autoCreateHubspotContacts ?? false,
        name: nameByEmail.get(norm) ?? null,
      });

      let outcome: ContactResolutionOutcome;
      if (!contactId) {
        outcome = "not_found";
      } else if (preExists) {
        outcome = "found";
      } else {
        // resolveHubspotContactId created it (or searched HubSpot and found
        // it for the first time this send) — distinguish by whether it was
        // already in HubSpot vs genuinely new via auto-create.
        // For result accounting, created means the auto-create path ran.
        // We mark "created" here conservatively only when autoCreate was on
        // and it wasn't pre-existing — the exact distinction doesn't affect
        // downstream logic, only the result counter.
        outcome = conn.autoCreateHubspotContacts ? "created" : "found";
      }

      await markStatus(sendId, [email], contactId, syncStatusForOutcome(outcome));

      // Also backfill the list-level cache row if it exists.
      if (contactId) await backfillListCache(tenantDomain, norm, contactId);

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

/** True when the tenant+email already has a resolved contact ID in either
 *  the prospects table or the shared cache. Used to distinguish "found" vs
 *  "created" in the batch resolver result counts. */
async function hasExistingContactId(tenantDomain: string, email: string): Promise<boolean> {
  const [cacheRow] = await db
    .select({ id: hubspotContactIdCache.hubspotContactId })
    .from(hubspotContactIdCache)
    .where(
      and(
        eq(hubspotContactIdCache.tenantDomain, tenantDomain),
        eq(hubspotContactIdCache.email, email),
      ),
    )
    .limit(1);
  if (cacheRow) return true;

  const [prospectRow] = await db
    .select({ id: prospects.hubspotContactId })
    .from(prospects)
    .where(
      and(
        eq(prospects.tenantDomain, tenantDomain),
        eq(prospects.email, email),
        isNotNull(prospects.hubspotContactId),
      ),
    )
    .limit(1);
  return !!prospectRow?.id;
}

/** Upsert the resolved contact ID into the shared cross-system cache. */
async function upsertCache(
  tenantDomain: string,
  email: string,
  contactId: string,
): Promise<void> {
  // Drizzle does not expose onConflictDoUpdate in a cross-DB way without
  // the dialect-specific `.onConflictDoUpdate()`; use raw SQL via the PG
  // "ON CONFLICT" clause through Drizzle's insert + sql template.
  await db
    .insert(hubspotContactIdCache)
    .values({ tenantDomain, email, hubspotContactId: contactId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [hubspotContactIdCache.tenantDomain, hubspotContactIdCache.email],
      set: { hubspotContactId: contactId, updatedAt: new Date() },
    });
}

/** Back-fill the list-level email_recipients cache row when it exists. This
 *  is a secondary write — the primary cache is hubspotContactIdCache. */
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
