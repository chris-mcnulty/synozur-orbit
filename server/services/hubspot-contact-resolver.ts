/**
 * HubSpot contact resolver — unified contact resolution layer.
 *
 * Provides a SINGLE canonical function (`resolveHubspotContactId`) used by
 * both the marketing-email and sales-outreach systems to map an email address
 * to a HubSpot contact ID.
 *
 * Resolution priority
 * ─────────────────────────────────────
 *   1. prospects.hubspotContactId     — sales already resolved this contact
 *   2. hubspotContactIdCache          — durable cross-system cache (true upsert,
 *                                       no FK constraints; written by both paths)
 *   3. HubSpot search by email        — live API lookup
 *   4. auto-create (if enabled)       — creates contact + associates company
 *
 * Why hubspotContactIdCache and not email_recipients?
 * email_recipients has a NOT NULL listId FK, so INSERT is impossible without a
 * known list. hubspotContactIdCache (migration 0055) has no FK constraints and
 * supports true upsert — making it viable for cross-system prewarming.
 * email_recipients is still back-filled as a secondary cache for list-level reads.
 *
 * Public exports
 * ──────────────
 * _resolveContactWithDeps(email, tenantDomain, opts, deps)
 *   Pure DI-based core exported for unit tests — no DB or network needed.
 *
 * resolveHubspotContactId(email, tenantDomain, opts)
 *   Canonical single-contact resolver. Called from both paths.
 *
 * preWarmMarketingCache(tenantDomain, email, contactId)
 *   Upserts into hubspotContactIdCache so the next send finds the ID without
 *   a HubSpot API call. Safe to fire-and-forget.
 *
 * resolveSendRecipientContacts(opts)
 *   Batch resolver for a marketing send — calls resolveHubspotContactId per
 *   recipient and persists results onto email_send_recipients.
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
  /** Return the cached id from hubspotContactIdCache, or null. */
  cacheLookup(): Promise<string | null>;
  /** Search HubSpot by email; return the contact id or null. */
  hubspotSearch(): Promise<string | null>;
  /** Create a new HubSpot contact; return the new id. */
  hubspotCreate(): Promise<string>;
  /** Associate a contact with a company (best-effort, may throw). */
  associateCompany(contactId: string, companyId: string): Promise<void>;
  /** Upsert the resolved id to hubspotContactIdCache (primary cross-system cache). */
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
 * Priority: prospect cache → shared cache → HubSpot search → auto-create.
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

  // Step 2: shared cross-system cache (hubspotContactIdCache)
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
       *  auto-created contacts still get associated with the company even before
       *  the prospect itself has been synced to HubSpot. */
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
        // Returning null contactId causes the resolver to fall through to next step.
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
        await upsertContactIdCache(tenantDomain, norm, contactId);
        // Secondary back-fill: update any existing list-level email_recipients rows.
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
 * Upsert the resolved contact ID into hubspotContactIdCache so the next
 * marketing send finds it without a HubSpot API call.
 * Unlike email_recipients (which requires a NOT NULL listId FK), this table
 * has no FK constraints and supports true upsert. Safe to fire-and-forget.
 */
export async function preWarmMarketingCache(
  tenantDomain: string,
  email: string,
  contactId: string,
): Promise<void> {
  const norm = normalizeEmail(email);
  if (!norm || !contactId) return;
  await upsertContactIdCache(tenantDomain, norm, contactId);
  // Also back-fill any existing list rows as a secondary optimization.
  await backfillListCache(tenantDomain, norm, contactId).catch(() => {});
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
      // Connection predates marketing-email scopes; leave pending for backfill.
      await markStatus(sendId, emails, null, "pending");
      return { ...EMPTY, ran: false };
    }

    const nameByEmail = new Map(rows.map((r) => [normalizeEmail(r.email), r.name ?? null]));
    const autoCreate = !!(conn.autoCreateHubspotContacts);
    const result: ResolveResult = { resolved: 0, created: 0, skipped: 0, errors: 0, ran: true };

    for (const email of emails) {
      const norm = normalizeEmail(email);

      // Snapshot whether this email is already in the cache before resolving,
      // so we can accurately distinguish "found" (cache/search hit) from "created".
      const preCached = await hasCacheEntry(tenantDomain, norm);

      const contactId = await resolveHubspotContactId(norm, tenantDomain, {
        autoCreate,
        name: nameByEmail.get(norm) ?? null,
      });

      const outcome: ContactResolutionOutcome = !contactId
        ? "not_found"
        : preCached
          ? "found"
          : autoCreate
            ? "created"  // Not in cache before + autoCreate on = new contact (or new to us)
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

/** True when hubspotContactIdCache already has an entry for tenant+email. */
async function hasCacheEntry(tenantDomain: string, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: hubspotContactIdCache.hubspotContactId })
    .from(hubspotContactIdCache)
    .where(
      and(
        eq(hubspotContactIdCache.tenantDomain, tenantDomain),
        eq(hubspotContactIdCache.email, email),
      ),
    )
    .limit(1);
  return !!row?.id;
}

/** Upsert the resolved contact ID into the shared cross-system cache. */
async function upsertContactIdCache(
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
 *  resolved contact ID. email_recipients requires a NOT NULL listId FK so
 *  INSERT is not possible; this updates rows that already exist. */
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
