/**
 * HubSpot contact resolver — unified contact resolution layer.
 *
 * Provides a SINGLE canonical function (`resolveHubspotContactId`) used by
 * both the marketing-email and sales-outreach systems to map an email address
 * to a HubSpot contact ID.
 *
 * Resolution priority (per task spec; no new schema required)
 * ─────────────────────────────────────────────────────────────
 *   1. prospects.hubspotContactId       — sales already resolved this contact
 *   2. email_recipients.hubspotContactId — tenant-scoped marketing list cache
 *   3. HubSpot search by email           — live API lookup
 *   4. auto-create (if enabled)          — creates contact + associates company
 *
 * When a contact ID is resolved via steps 3 or 4 it is written back to any
 * existing email_recipients rows so subsequent sends hit the list cache.
 * email_recipients has a NOT NULL listId FK — INSERT is not possible without a
 * known list; writeRecipientCache therefore issues UPDATE on existing rows only.
 *
 * Public exports
 * ──────────────
 * _resolveContactWithDeps(email, tenantDomain, opts, deps)
 *   Pure DI-based core exported for unit tests — no DB or network needed.
 *   Returns { contactId, wasCreated } so callers can count true auto-creates.
 *
 * resolveHubspotContactId(email, tenantDomain, opts)
 *   Canonical single-contact resolver. The ONLY call site for both paths.
 *
 * preWarmMarketingCache(tenantDomain, email, contactId)
 *   Updates existing email_recipients rows so the next marketing send finds
 *   the ID without a HubSpot API call. UPDATE-only (no INSERT due to FK).
 *   Safe to fire-and-forget.
 *
 * resolveSendRecipientContacts(opts)
 *   Batch resolver for a marketing send — calls the internal resolver per
 *   recipient with a MAX_CREATE_PER_SEND cap and persists results onto
 *   email_send_recipients.
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

// Per-send cap on auto-created contacts to protect against runaway CRM growth
// and HubSpot API rate limits. Recipients beyond this cap are left for the
// backfill job (scheduled for a later phase) to pick up after the send.
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

/** Injected dependency callbacks for the core resolver. All closures that
 *  capture email/tenantDomain/client at construction time — the interface
 *  stays stable for unit tests. */
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
  /** Update existing email_recipients rows with the resolved id (UPDATE-only). */
  writeRecipientCache(contactId: string): Promise<void>;
  /** Whether the tenant has auto-create enabled. */
  autoCreateEnabled: boolean;
}

/** Structured return from the core resolver so callers can track true creates. */
export interface ResolveOutcome {
  contactId: string | null;
  wasCreated: boolean;
}

// ---------------------------------------------------------------------------
// Core pure resolver (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Pure resolution logic with injected deps. Tests pass vi.fn() stubs for
 * each dep and assert priority chain without DB or HubSpot network calls.
 *
 * Returns { contactId, wasCreated } so the batch resolver can accurately
 * count true auto-creates and enforce MAX_CREATE_PER_SEND without counting
 * HubSpot search hits against the cap.
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
    await deps.writeRecipientCache(prospect.contactId).catch(() => {});
    return { contactId: prospect.contactId, wasCreated: false };
  }

  // Step 2: marketing list cache (email_recipients.hubspotContactId)
  const cached = await deps.recipientCacheLookup();
  if (cached) return { contactId: cached, wasCreated: false };

  // Step 3: HubSpot search
  const found = await deps.hubspotSearch();
  if (found) {
    await deps.writeRecipientCache(found).catch(() => {});
    return { contactId: found, wasCreated: false };
  }

  // Step 4: auto-create
  if (!opts.autoCreate || !deps.autoCreateEnabled) return { contactId: null, wasCreated: false };
  const created = await deps.hubspotCreate();
  // Associate with company when the prospect row has a hubspotCompanyId.
  // companyId is returned even when contactId is null (prospects have both fields).
  const companyId = prospect?.companyId ?? null;
  if (companyId) {
    await deps.associateCompany(created, companyId).catch(() => {});
  }
  await deps.writeRecipientCache(created).catch(() => {});
  return { contactId: created, wasCreated: true };
}

// ---------------------------------------------------------------------------
// Private internal resolver with real DB deps (builds deps, tracks wasCreated)
// ---------------------------------------------------------------------------

/**
 * Internal helper used by both `resolveHubspotContactId` and the batch
 * resolver. Builds the full set of DB/API deps in one place and calls
 * `_resolveContactWithDeps`. Returns structured { contactId, wasCreated }
 * so the batch resolver can count true auto-creates accurately.
 * Never throws — returns null contactId on any failure.
 */
async function _resolveWithOutcome(
  email: string,
  tenantDomain: string,
  opts: { autoCreate?: boolean; name?: string | null },
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
       *  (b) row with only companyId — so newly auto-created contacts can be
       *      associated with the prospect's company even before the prospect
       *      itself has been synced to HubSpot. */
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
        // No contact ID yet — check for company ID for the auto-create path.
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
        // Null contactId causes the resolver to fall through to next step.
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

      async writeRecipientCache(contactId) {
        await backfillListCache(tenantDomain, norm, contactId);
      },

      autoCreateEnabled,
    };

    return await _resolveContactWithDeps(norm, tenantDomain, opts, deps);
  } catch {
    return { contactId: null, wasCreated: false };
  }
}

// ---------------------------------------------------------------------------
// Public single-contact resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a single email address to a HubSpot contact ID. This is THE single
 * call site used by both paths. Never throws — returns null on any failure.
 */
export async function resolveHubspotContactId(
  email: string,
  tenantDomain: string,
  opts: { autoCreate?: boolean; name?: string | null } = {},
): Promise<string | null> {
  const { contactId } = await _resolveWithOutcome(email, tenantDomain, opts);
  return contactId;
}

// ---------------------------------------------------------------------------
// Pre-warm helper (called from sales routes after writing prospect contactId)
// ---------------------------------------------------------------------------

/**
 * Update any existing email_recipients rows for this tenant+email with the
 * resolved contact ID so the next marketing send finds it in the list cache
 * without a HubSpot API call.
 * UPDATE-only — email_recipients requires a NOT NULL listId FK so INSERT is
 * not possible without a known list. Safe to fire-and-forget.
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
 * results onto email_send_recipients. Uses `_resolveWithOutcome` per recipient
 * so `wasCreated` accurately gates the MAX_CREATE_PER_SEND cap — HubSpot
 * search hits (existing contacts) do NOT count against the creation budget.
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
    let createCount = 0;

    for (const email of emails) {
      const norm = normalizeEmail(email);

      // Respect per-send create cap: once hit, disable auto-create for the
      // remainder so excess recipients are left for backfill.
      const allowCreate = autoCreate && createCount < MAX_CREATE_PER_SEND;

      // Use _resolveWithOutcome (not the public resolveHubspotContactId) so we
      // get wasCreated to accurately gate the cap. HubSpot search hits
      // (steps 1–3) return wasCreated=false and do NOT burn the budget.
      const { contactId, wasCreated } = await _resolveWithOutcome(norm, tenantDomain, {
        autoCreate: allowCreate,
        name: nameByEmail.get(norm) ?? null,
      });

      // wasCreated is only true when hubspotCreate() was actually called.
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

/** Update existing email_recipients rows with the resolved contact ID.
 *  email_recipients has a NOT NULL listId FK — INSERT without a list is
 *  impossible; this only touches rows that already exist. */
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
