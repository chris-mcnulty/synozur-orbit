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
 *   1. prospects.hubspotContactId  — sales already resolved this contact
 *   2. hubspotContactIdCache       — durable cross-system cache; both paths
 *                                    can upsert freely (no FK constraints)
 *   3. HubSpot search by email     — live API lookup
 *   4. auto-create (if enabled)    — creates contact + associates company
 *
 * After steps 3 or 4 the resolved ID is written to hubspotContactIdCache so
 * subsequent resolves hit the cache. email_recipients is also back-filled as
 * a secondary write (list-scoped cache). Unlike hubspotContactIdCache,
 * email_recipients has a NOT NULL listId FK and cannot be INSERT-ed without a
 * known list, so its backfill is UPDATE-only.
 *
 * Why a dedicated cache table?
 * `preWarmMarketingCache` is called from sales routes after writing a contact
 * ID to a prospect. At that point no email_recipients row may exist yet (the
 * contact has never received a marketing email). hubspotContactIdCache has no
 * FK constraints and accepts true upserts from both systems.
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
 *   Upserts into hubspotContactIdCache so the next marketing send skips the
 *   HubSpot API call. Called fire-and-forget from sales routes after writing
 *   a prospect's hubspotContactId.
 *
 * resolveSendRecipientContacts(opts)
 *   Batch resolver for a marketing send — calls resolveHubspotContactId per
 *   recipient with a MAX_CREATE_PER_SEND cap, then persists results.
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
 *  HubSpot create API was actually called (step 4). Steps 1–3 set it false,
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
  /** Return the cached id from hubspotContactIdCache, or null. */
  cacheLookup(): Promise<string | null>;
  /** Search HubSpot by email; return the contact id or null. */
  hubspotSearch(): Promise<string | null>;
  /** Create a new HubSpot contact; return the new id. */
  hubspotCreate(): Promise<string>;
  /** Associate a contact with a company (best-effort, may throw). */
  associateCompany(contactId: string, companyId: string): Promise<void>;
  /** Upsert the resolved id to hubspotContactIdCache + backfill email_recipients. */
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

  // Step 2: shared cross-system cache (hubspotContactIdCache)
  const cached = await deps.cacheLookup();
  if (cached) return { contactId: cached, wasCreated: false };

  // Step 3: HubSpot search
  const found = await deps.hubspotSearch();
  if (found) {
    await deps.writeCache(found).catch(() => {});
    return { contactId: found, wasCreated: false };
  }

  // Step 4: auto-create
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
 * call site for the marketing-email path (batch resolver calls it per email).
 * Returns ResolveOutcome { contactId, wasCreated }. Never throws.
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
        await upsertContactCache(tenantDomain, norm, contactId);
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
 * Upsert the resolved contact ID into hubspotContactIdCache so the next
 * marketing send finds it without a HubSpot API call.
 *
 * This is a TRUE upsert into the shared cache table (no FK constraints).
 * email_recipients is also back-filled as a secondary optimization.
 * Safe to fire-and-forget.
 */
export async function preWarmMarketingCache(
  tenantDomain: string,
  email: string,
  contactId: string,
): Promise<void> {
  const norm = normalizeEmail(email);
  if (!norm || !contactId) return;
  await upsertContactCache(tenantDomain, norm, contactId);
  await backfillListCache(tenantDomain, norm, contactId).catch(() => {});
}

// ---------------------------------------------------------------------------
// Batch resolver (marketing send path)
// ---------------------------------------------------------------------------

/**
 * Resolve all recipients of a send to HubSpot contact IDs and persist the
 * results onto email_send_recipients. Calls resolveHubspotContactId per
 * recipient (single canonical call site). Uses wasCreated from the outcome
 * to gate MAX_CREATE_PER_SEND accurately — HubSpot search hits (steps 1–3)
 * return wasCreated=false and do NOT burn the creation budget.
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

      // wasCreated=true ONLY when hubspotCreate() actually fired (step 4).
      // Search hits (step 3) return wasCreated=false and do not burn the cap.
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

/** Upsert the resolved contact ID into the shared cross-system cache. */
async function upsertContactCache(
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
