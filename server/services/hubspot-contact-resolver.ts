/**
 * HubSpot contact resolver — unified contact resolution layer.
 *
 * Provides a SINGLE canonical function (`resolveHubspotContactId`) used by
 * the marketing-email system to map an email address to a HubSpot contact ID.
 * The sales-outreach system calls `preWarmMarketingCache` after resolving a
 * prospect so marketing sends find the ID without a live HubSpot API call.
 *
 * Resolution priority
 * ─────────────────────────────────────────────────────────────────────────
 *   1. prospects.hubspotContactId       — sales already resolved this contact
 *   2. email_recipients.hubspotContactId — per-list cache; covers contacts
 *                                          that have already been on a list
 *   3. hubspotContactIdCache             — durable cross-system cache (no FK);
 *                                          written by sales prewarm and by the
 *                                          resolver after steps 4/5
 *   4. HubSpot search by email           — live API lookup
 *   5. auto-create (if enabled)          — creates contact + associates company
 *
 * Two-layer cache design:
 *   email_recipients (step 2)  — has a NOT NULL listId FK so INSERT is only
 *                                possible when a list row already exists.
 *                                Populated at send-time; covers returning
 *                                contacts that have been on a marketing list.
 *   hubspotContactIdCache (step 3) — no FK constraints; accepts true upserts
 *                                from both sales (preWarmMarketingCache) and
 *                                the resolver after a live lookup.
 *                                Covers prospects that were imported via sales
 *                                but have never been on a marketing list.
 *
 * After steps 4 or 5 the resolved ID is written to hubspotContactIdCache so
 * subsequent resolves skip the HubSpot API. email_recipients is back-filled
 * via UPDATE (existing rows only) as an additional secondary optimization.
 *
 * Public exports
 * ──────────────
 * _resolveContactWithDeps(email, tenantDomain, opts, deps)
 *   Pure DI-based core exported for unit tests — no DB or network needed.
 *   Returns ResolveOutcome { contactId, wasCreated }.
 *
 * resolveHubspotContactId(email, tenantDomain, opts)
 *   Canonical resolver. THE single call site for the marketing-email path.
 *   Returns ResolveOutcome { contactId, wasCreated }.
 *
 * preWarmMarketingCache(tenantDomain, email, contactId)
 *   Upserts into hubspotContactIdCache (true upsert, no FK constraints) so
 *   the next marketing send finds the ID at step 3 without a HubSpot API call.
 *   Safe to fire-and-forget.
 *
 * resolveSendRecipientContacts(opts)
 *   Batch resolver — calls resolveHubspotContactId per recipient with a
 *   MAX_CREATE_PER_SEND cap, then persists results onto email_send_recipients.
 */

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
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

// Per-send cap on auto-created contacts to protect against runaway CRM growth
// and HubSpot API rate limits. Recipients beyond the cap are left for the
// backfill job (a later phase) to pick up after the send.
const MAX_CREATE_PER_SEND = Number(process.env.MARKETING_HS_MAX_CREATE_PER_SEND ?? 500);

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

/** Structured return from the resolver. wasCreated is true ONLY when the
 *  HubSpot create API was actually called (step 5). Steps 1–4 set it false,
 *  so callers can count true auto-creates accurately. */
export interface ResolveOutcome {
  contactId: string | null;
  wasCreated: boolean;
}

/** Injected dependency callbacks for the core resolver. Each dep is a closure
 *  that captures email/tenantDomain/client — the interface stays stable for
 *  unit tests. */
export interface ContactResolverDeps {
  /** Return { contactId, companyId } if the prospects table has a resolved id. */
  prospectLookup(): Promise<{ contactId: string; companyId: string | null } | null>;
  /** Return the cached id from email_recipients.hubspotContactId, or null.
   *  Covers contacts that have previously been on a marketing list. */
  recipientCacheLookup(): Promise<string | null>;
  /** Return the cached id from hubspotContactIdCache, or null.
   *  Covers contacts prewarmed via sales without an existing list row. */
  sharedCacheLookup(): Promise<string | null>;
  /** Search HubSpot by email; return the contact id or null. */
  hubspotSearch(): Promise<string | null>;
  /** Create a new HubSpot contact; return the new id. */
  hubspotCreate(): Promise<string>;
  /** Associate a contact with a company (best-effort, may throw). */
  associateCompany(contactId: string, companyId: string): Promise<void>;
  /** Upsert the resolved id to hubspotContactIdCache + back-fill email_recipients. */
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
 * Returns ResolveOutcome { contactId, wasCreated } so callers can distinguish
 * true auto-creates (wasCreated=true) from cache/search hits (wasCreated=false).
 */
export async function _resolveContactWithDeps(
  email: string,
  _tenantDomain: string,
  opts: { autoCreate?: boolean; name?: string | null },
  deps: ContactResolverDeps,
): Promise<ResolveOutcome> {
  const norm = normalizeEmail(email);
  if (!norm) return { contactId: null, wasCreated: false };

  // Step 1: sales prospect cache
  const prospect = await deps.prospectLookup();
  if (prospect?.contactId) {
    await deps.writeCache(prospect.contactId).catch(() => {});
    return { contactId: prospect.contactId, wasCreated: false };
  }

  // Step 2: per-list marketing cache (email_recipients.hubspotContactId)
  const listCached = await deps.recipientCacheLookup();
  if (listCached) return { contactId: listCached, wasCreated: false };

  // Step 3: shared cross-system cache (hubspotContactIdCache)
  // Covers prospects imported via sales that have never been on a list.
  const sharedCached = await deps.sharedCacheLookup();
  if (sharedCached) return { contactId: sharedCached, wasCreated: false };

  // Step 4: HubSpot search
  const found = await deps.hubspotSearch();
  if (found) {
    await deps.writeCache(found).catch(() => {});
    return { contactId: found, wasCreated: false };
  }

  // Step 5: auto-create
  if (!opts.autoCreate || !deps.autoCreateEnabled) {
    return { contactId: null, wasCreated: false };
  }
  const created = await deps.hubspotCreate();
  // Associate with company when the prospect row has a hubspotCompanyId.
  // companyId is returned even when contactId is null (company resolved before contact).
  const companyId = prospect?.companyId ?? null;
  if (companyId) {
    await deps.associateCompany(created, companyId).catch(() => {});
  }
  await deps.writeCache(created).catch(() => {});
  return { contactId: created, wasCreated: true };
}

// ---------------------------------------------------------------------------
// Public canonical resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a single email address to a HubSpot contact ID. This is THE single
 * call site for the marketing-email path. Never throws. Returns ResolveOutcome.
 */
export async function resolveHubspotContactId(
  email: string,
  tenantDomain: string,
  opts: { autoCreate?: boolean; name?: string | null } = {},
): Promise<ResolveOutcome> {
  const norm = normalizeEmail(email);
  if (!norm) return { contactId: null, wasCreated: false };

  try {
    let client: Awaited<ReturnType<typeof getTenantClient>>["client"] | null = null;
    const getClient = async () => {
      if (!client) client = (await getTenantClient(tenantDomain)).client;
      return client;
    };

    const conn = await storage.getHubspotConnection(tenantDomain);
    const autoCreateEnabled = !!(conn?.autoCreateHubspotContacts);

    const deps: ContactResolverDeps = {
      /** Two queries:
       *  (a) row with contactId — short-circuits the resolver.
       *  (b) row with only companyId — so newly auto-created contacts are
       *      associated with the correct company even when the prospect has
       *      not yet been synced to HubSpot. */
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

      async sharedCacheLookup() {
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
        // Primary: upsert into shared cross-system cache (true upsert, no FK).
        await upsertSharedCache(tenantDomain, norm, contactId);
        // Secondary: update any existing list-scoped email_recipients rows.
        await backfillListCache(tenantDomain, norm, contactId).catch(() => {});
      },

      autoCreateEnabled,
    };

    return await _resolveContactWithDeps(norm, tenantDomain, opts, deps);
  } catch {
    return { contactId: null, wasCreated: false };
  }
}

// ---------------------------------------------------------------------------
// Pre-warm helper (called from sales routes after writing prospect contactId)
// ---------------------------------------------------------------------------

/**
 * Upsert the resolved contact ID into hubspotContactIdCache so that the next
 * marketing send finds it at step 3 of the priority chain without a HubSpot
 * API call. This is a TRUE upsert — hubspotContactIdCache has no FK
 * constraints, unlike email_recipients which requires a NOT NULL listId.
 * Safe to fire-and-forget.
 */
export async function preWarmMarketingCache(
  tenantDomain: string,
  email: string,
  contactId: string,
): Promise<void> {
  const norm = normalizeEmail(email);
  if (!norm || !contactId) return;
  await upsertSharedCache(tenantDomain, norm, contactId);
  // Secondary back-fill for any existing list rows.
  await backfillListCache(tenantDomain, norm, contactId).catch(() => {});
}

// ---------------------------------------------------------------------------
// Batch resolver (marketing send path)
// ---------------------------------------------------------------------------

/**
 * Resolve all recipients of a send to HubSpot contact IDs and persist the
 * results. Calls resolveHubspotContactId per recipient (single call site).
 * Uses wasCreated from the outcome to gate MAX_CREATE_PER_SEND accurately —
 * cache/search hits return wasCreated=false and do NOT burn the cap.
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
    const autoCreate = !!(conn.autoCreateHubspotContacts);
    const result: ResolveResult = { resolved: 0, created: 0, skipped: 0, errors: 0, ran: true };
    let createCount = 0;

    for (const email of emails) {
      const norm = normalizeEmail(email);

      // Once MAX_CREATE_PER_SEND true creates have fired, disable auto-create
      // for remaining recipients — they are left for the backfill job.
      const allowCreate = autoCreate && createCount < MAX_CREATE_PER_SEND;

      const { contactId, wasCreated } = await resolveHubspotContactId(norm, tenantDomain, {
        autoCreate: allowCreate,
        name: nameByEmail.get(norm) ?? null,
      });

      // wasCreated=true ONLY when hubspotCreate() actually fired (step 5).
      // Cache and search hits (steps 1–4) return wasCreated=false.
      if (wasCreated) createCount += 1;

      const outcome: ContactResolutionOutcome = !contactId
        ? "not_found"
        : wasCreated
          ? "created"
          : "found";

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

/** Upsert the resolved id into the shared cross-system cache. No FK
 *  constraints — accepts writes from both sales and marketing paths. */
async function upsertSharedCache(
  tenantDomain: string,
  email: string,
  contactId: string,
): Promise<void> {
  await db
    .insert(hubspotContactIdCache)
    .values({ tenantDomain, email, hubspotContactId: contactId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [hubspotContactIdCache.tenantDomain, hubspotContactIdCache.email],
      set: { hubspotContactId: contactId, updatedAt: new Date() },
    });
}

/** Secondary back-fill: update existing email_recipients rows with the
 *  resolved contact ID. INSERT is not possible (NOT NULL listId FK). */
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
