// HubSpot CRM Integration Service
// Uses Replit HubSpot connection for OAuth authentication

import { Client } from '@hubspot/api-client';
import { randomUUID } from "crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { marketingContacts, scheduledJobRuns } from "@shared/schema";
import { enqueue } from "./job-queue";

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=hubspot',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('HubSpot not connected');
  }
  return accessToken;
}

async function getHubSpotClient() {
  const accessToken = await getAccessToken();
  return new Client({ accessToken });
}

export interface NewAccountData {
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  companyDomain: string;
  jobTitle?: string;
  industry?: string;
  companySize?: string;
  country?: string;
  plan?: string;
}

export async function syncNewAccountToHubSpot(data: NewAccountData): Promise<{
  contactId: string;
  companyId: string;
  dealId: string;
} | null> {
  try {
    const client = await getHubSpotClient();

    // 1. Create or update Company
    let companyId: string;
    try {
      const existingCompanies = await client.crm.companies.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: 'domain',
            operator: 'EQ' as any,
            value: data.companyDomain
          }]
        }],
        properties: ['domain', 'name'],
        limit: 1,
        after: '0',
        sorts: []
      });

      if (existingCompanies.results.length > 0) {
        companyId = existingCompanies.results[0].id;
        await client.crm.companies.basicApi.update(companyId, {
          properties: {
            name: data.companyName,
            domain: data.companyDomain,
            industry: data.industry || '',
            numberofemployees: data.companySize || '',
            country: data.country || '',
          }
        });
        console.log(`[HubSpot] Updated existing company: ${companyId}`);
      } else {
        const newCompany = await client.crm.companies.basicApi.create({
          properties: {
            name: data.companyName,
            domain: data.companyDomain,
            industry: data.industry || '',
            numberofemployees: data.companySize || '',
            country: data.country || '',
          }
        });
        companyId = newCompany.id;
        console.log(`[HubSpot] Created new company: ${companyId}`);
      }
    } catch (error) {
      console.error('[HubSpot] Error creating/updating company:', error);
      throw error;
    }

    // 2. Create or update Contact
    let contactId: string;
    try {
      const existingContacts = await client.crm.contacts.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: 'email',
            operator: 'EQ' as any,
            value: data.email
          }]
        }],
        properties: ['email', 'firstname', 'lastname'],
        limit: 1,
        after: '0',
        sorts: []
      });

      if (existingContacts.results.length > 0) {
        contactId = existingContacts.results[0].id;
        await client.crm.contacts.basicApi.update(contactId, {
          properties: {
            firstname: data.firstName,
            lastname: data.lastName,
            email: data.email,
            jobtitle: data.jobTitle || '',
            company: data.companyName,
          }
        });
        console.log(`[HubSpot] Updated existing contact: ${contactId}`);
      } else {
        const newContact = await client.crm.contacts.basicApi.create({
          properties: {
            firstname: data.firstName,
            lastname: data.lastName,
            email: data.email,
            jobtitle: data.jobTitle || '',
            company: data.companyName,
          }
        });
        contactId = newContact.id;
        console.log(`[HubSpot] Created new contact: ${contactId}`);
      }

      // Associate contact with company
      await client.crm.associations.v4.basicApi.create(
        'contacts',
        contactId,
        'companies',
        companyId,
        [{ associationCategory: 'HUBSPOT_DEFINED' as any, associationTypeId: 1 }]
      );
      console.log(`[HubSpot] Associated contact ${contactId} with company ${companyId}`);
    } catch (error) {
      console.error('[HubSpot] Error creating/updating contact:', error);
      throw error;
    }

    // 3. Create Deal for new trial
    let dealId: string;
    try {
      // Get the first available pipeline and its first stage
      // This handles HubSpot accounts with custom pipelines
      let pipelineId = process.env.HUBSPOT_PIPELINE_ID || 'default';
      let dealstageId = process.env.HUBSPOT_DEALSTAGE_ID || '';
      
      // If no dealstage configured, try to get the first stage from the pipeline
      if (!dealstageId) {
        try {
          const pipelines = await client.crm.pipelines.pipelinesApi.getAll('deals');
          const targetPipeline = pipelines.results.find(p => p.id === pipelineId) || pipelines.results[0];
          if (targetPipeline) {
            pipelineId = targetPipeline.id;
            // Get the first stage (usually the earliest in the pipeline)
            const sortedStages = targetPipeline.stages.sort((a, b) => a.displayOrder - b.displayOrder);
            dealstageId = sortedStages[0]?.id || '';
            console.log(`[HubSpot] Using pipeline "${targetPipeline.label}" (${pipelineId}) with stage "${sortedStages[0]?.label}" (${dealstageId})`);
          }
        } catch (pipelineError) {
          console.warn('[HubSpot] Could not fetch pipelines, using defaults:', pipelineError);
          // Fall back to standard HubSpot defaults if pipeline API fails
          dealstageId = 'qualifiedtobuy';
        }
      }

      const dealName = `Orbit Trial - ${data.companyName}`;
      const newDeal = await client.crm.deals.basicApi.create({
        properties: {
          dealname: dealName,
          pipeline: pipelineId,
          dealstage: dealstageId,
          amount: '0',
          closedate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        }
      });
      dealId = newDeal.id;
      console.log(`[HubSpot] Created new deal: ${dealId}`);

      // Associate deal with contact and company
      await client.crm.associations.v4.basicApi.create(
        'deals',
        dealId,
        'contacts',
        contactId,
        [{ associationCategory: 'HUBSPOT_DEFINED' as any, associationTypeId: 3 }]
      );
      await client.crm.associations.v4.basicApi.create(
        'deals',
        dealId,
        'companies',
        companyId,
        [{ associationCategory: 'HUBSPOT_DEFINED' as any, associationTypeId: 5 }]
      );
      console.log(`[HubSpot] Associated deal with contact and company`);
    } catch (error: any) {
      // Log detailed error for pipeline/stage issues
      if (error?.body?.message) {
        console.error(`[HubSpot] Error creating deal: ${error.body.message}`);
      } else {
        console.error('[HubSpot] Error creating deal:', error);
      }
      throw error;
    }

    return { contactId, companyId, dealId };
  } catch (error) {
    console.error('[HubSpot] Failed to sync new account:', error);
    return null;
  }
}

export async function isHubSpotConfigured(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirror a segment's current member emails to a HubSpot static list.
 *
 * Uses the per-tenant OAuth client (getTenantClient) so it operates in the
 * correct CRM portal. The list must already exist in HubSpot — this function
 * only adds/removes members; it does not create the list.
 *
 * The sync is a full reconciliation: contacts in the segment are added to the
 * HubSpot list and contacts that are no longer in the segment are removed.
 * Empty segments cause all current members to be removed.
 */
export async function syncSegmentToHubSpotList(
  tenantDomain: string,
  hubspotListId: string,
  memberEmails: string[],
): Promise<{ added: number; removed: number; errors: number; rateLimited: number }> {

  const { getTenantClient, withHubspotRetry, isHubspotRateLimitError } = await import("./hubspot-integration");
  let client: any;
  try {
    const result = await getTenantClient(tenantDomain);
    client = result.client;
  } catch (err: any) {
    console.warn(
      `[HubSpot] Segment mirror skipped for ${tenantDomain} — not connected: ${err.message}`,
    );
    return { added: 0, removed: 0, errors: 0, rateLimited: 0 };
  }

  let added = 0;
  let removed = 0;
  let errors = 0;
  let rateLimited = 0;

  // ── Step 1: Fetch current HubSpot list membership ──────────────────────────
  const currentMemberIds = new Set<string>();
  try {
    let after: string | undefined;
    do {
      const page: any = await client.crm.lists.membershipsApi.getPage(
        hubspotListId,
        after,
        undefined,
        500,
      );
      for (const r of page.results ?? []) {
        currentMemberIds.add(String(r.recordId ?? r.id));
      }
      after = page.paging?.next?.after;
    } while (after);
  } catch (err: any) {
    console.error(`[HubSpot] Segment mirror: failed to fetch current members for list ${hubspotListId}: ${err.message}`);
    errors++;
  }

  // ── Step 2: Resolve segment member emails → HubSpot contact IDs ───────────
  const BATCH = 50;
  const desiredContactIds = new Set<string>();
  for (let i = 0; i < memberEmails.length; i += BATCH) {
    const batch = memberEmails.slice(i, i + BATCH);
    for (const email of batch) {
      try {
        const result: any = await withHubspotRetry(
          () =>
            client.crm.contacts.searchApi.doSearch({
              filterGroups: [
                { filters: [{ propertyName: "email", operator: "EQ" as any, value: email }] },
              ],
              properties: ["email"],
              limit: 1,
              after: "0",
              sorts: [],
            }),
          { label: `segment-mirror contact lookup (${tenantDomain} / ${email})` },
        );
        if (result.results.length > 0) {
          desiredContactIds.add(result.results[0].id);
        }
      } catch (err: any) {
        if (isHubspotRateLimitError(err)) {
          rateLimited++;
          console.warn(
            `[HubSpot] Segment mirror: rate-limited after retries for ${email} (${tenantDomain}) — contact will be missing from list until next sync`,
          );
        } else {
          console.error(`[HubSpot] Segment mirror: lookup failed for ${email}: ${err.message}`);
          errors++;
        }
      }
    }
    // Throttle to stay within HubSpot rate limits (100 req/10s)
    if (i + BATCH < memberEmails.length) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  // ── Step 3: Reconcile — add new members, remove lapsed ones ───────────────
  const toAdd = [...desiredContactIds].filter((id) => !currentMemberIds.has(id));
  const toRemove = [...currentMemberIds].filter((id) => !desiredContactIds.has(id));

  if (toAdd.length > 0 || toRemove.length > 0) {
    try {
      await client.crm.lists.membershipsApi.addAndRemoveMember(hubspotListId, {
        recordIdsToAdd: toAdd,
        recordIdsToRemove: toRemove,
      });
      added = toAdd.length;
      removed = toRemove.length;
    } catch (err: any) {
      console.error(`[HubSpot] Segment mirror: reconcile failed for list ${hubspotListId}: ${err.message}`);
      errors++;
    }
  }

  console.log(
    `[HubSpot] Segment mirror complete for list ${hubspotListId} — added=${added} removed=${removed} errors=${errors} rateLimited=${rateLimited}`,
  );
  return { added, removed, errors, rateLimited };
}
/**
 * Enrich marketing_contacts rows with data from a tenant's connected HubSpot portal.
 *
 * Uses the per-tenant OAuth client from hubspot-integration (getTenantClient) so it
 * operates within the correct CRM portal — it never mixes contacts across tenants.
 *
 * Reads up to `limit` unenriched contacts (or all when forceAll=true), searches
 * HubSpot by email, and fills in blank name/company/lifecycle fields without
 * overwriting Orbit-owned values.
 *
 * Designed to be called from:
 *   a) the daily HubSpot sweep in scheduled-jobs.ts (per-tenant, after syncTenant)
 *   b) the admin endpoint POST /api/admin/marketing-contacts/enrich-hubspot
 */
export async function syncHubSpotContactEnrichment(opts: {
  tenantDomain: string;
  limit?: number;
  forceAll?: boolean;
}): Promise<ContactEnrichmentStats> {
  const { tenantDomain, limit = 200, forceAll = false } = opts;

  // Use the per-tenant OAuth client — this is the same client the daily
  // HubSpot sweep uses, so it always operates on the correct CRM portal.
  const { getTenantClient, withHubspotRetry, isHubspotRateLimitError } = await import("./hubspot-integration");
  let client: any;
  try {
    const result = await getTenantClient(tenantDomain);
    client = result.client;
  } catch (err: any) {
    console.warn(
      `[HubSpot] contact enrichment skipped for ${tenantDomain} — not connected: ${err.message}`,
    );
    return {
      examined: 0,
      matched: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      enriched: 0,
      notFound: 0,
      errors: 0,
      rateLimited: 0,
    };
  }

  const { db } = await import("../db");
  const { marketingContacts } = await import("@shared/schema");
  const { enrichContactFromHubSpot } = await import("./marketing-contact-service");
  const { eq, and, isNull } = await import("drizzle-orm");

  // Assemble production-grade deps and delegate all enrichment logic to the
  // DI core. This ensures there is one authoritative implementation.
  const deps: ContactEnrichmentDeps = {
    loadContacts: async (td, lim, all) => {
      const conditions: any[] = [eq(marketingContacts.tenantDomain, td)];
      if (!all) conditions.push(isNull(marketingContacts.hubspotContactId));
      // Single contact table: contacts needing enrichment are simply those
      // without a hubspotContactId — but only rows with an email can be
      // searched in HubSpot.
      const { isNotNull } = await import("drizzle-orm");
      conditions.push(isNotNull(marketingContacts.email));
      const rows = await db
        .select({
          id: marketingContacts.id,
          email: marketingContacts.email,
        })
        .from(marketingContacts)
        .where(and(...conditions))
        .limit(lim);
      return rows.map((r) => ({ id: r.id, email: r.email! }));
    },

    searchHubSpot: async (email) => {
      const result: any = await withHubspotRetry(
        () =>
          client.crm.contacts.searchApi.doSearch({
            filterGroups: [
              { filters: [{ propertyName: "email", operator: "EQ" as any, value: email }] },
            ],
            properties: ["email", "firstname", "lastname", "company", "jobtitle", "lifecyclestage"],
            limit: 1,
            after: "0",
            sorts: [],
          }),
        { label: `contact email-search (${tenantDomain})` },
      );
      if (result.results.length === 0) return null;
      const hs = result.results[0];
      return { id: hs.id, properties: hs.properties as Record<string, string | null> };
    },

    enrichContact: (params) => enrichContactFromHubSpot(params),

    isRateLimitError: isHubspotRateLimitError,

    // Production pacing: 50 contacts per batch, 600 ms inter-batch pause to
    // stay within HubSpot's 5 req/s limit on the search endpoint.
    batchSize: 50,
    pauseFn: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  const result = await _syncHubSpotContactEnrichmentWithDeps({ tenantDomain, limit, forceAll }, deps);

  console.log(
    `[HubSpot] contact enrichment complete for ${tenantDomain} — examined=${result.examined} matched=${result.matched} updated=${result.updated} skipped=${result.skipped} failed=${result.failed} rateLimited=${result.rateLimited}`,
  );
  return result;
}

// ---------------------------------------------------------------------------
// DI-based core for syncHubSpotContactEnrichment — exported for unit tests
// ---------------------------------------------------------------------------

export interface EnrichmentContact {
  id: string;
  email: string;
  /** Populated when the contact was created from a prospect. Used to short-circuit
   *  the HubSpot email search when the linked prospect already has an ID. */
  sourceProspectId?: string | null;
}

export interface HubSpotContactResult {
  id: string;
  properties: Record<string, string | null>;
}

/**
 * Contact-enrichment outcomes for one bounded sweep.
 *
 * The legacy names remain for API compatibility with the manual enrichment
 * endpoint. The explicit names are used by scheduled-job history and the
 * operator-facing HubSpot settings summary.
 */
export interface ContactEnrichmentStats {
  examined: number;
  matched: number;
  updated: number;
  skipped: number;
  failed: number;
  enriched: number;
  notFound: number;
  errors: number;
  rateLimited: number;
}

export type SingleContactHubSpotSyncResult =
  | { status: "matched"; email: string; hubspotContactId: string }
  | { status: "not_found"; email: string }
  | { status: "no_email" };

export interface ContactEnrichmentDeps {
  /** Load unenriched contacts for a single tenant */
  loadContacts: (tenantDomain: string, limit: number, forceAll: boolean) => Promise<EnrichmentContact[]>;
  /**
   * When a contact has a sourceProspectId, return that prospect's
   * hubspotContactId so we can skip a live HubSpot API search.
   * Optional — when omitted the resolver falls through to searchHubSpot.
   */
  getProspectHubspotId?: (prospectId: string) => Promise<string | null>;
  /**
   * Search HubSpot for a contact by email. Returns null when not found.
   * May throw a rate-limit error after all retry attempts are exhausted.
   * The production adapter wraps this in withHubspotRetry.
   */
  searchHubSpot: (email: string) => Promise<HubSpotContactResult | null>;
  /** Write HubSpot-sourced fields back to the marketing_contacts row */
  enrichContact: (params: {
    tenantDomain: string;
    email: string;
    hubspotContactId: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    jobTitle: string | null;
    lifecycleStage: string | null;
  }) => Promise<void>;
  /** Returns true when an error is a HubSpot 429 rate-limit response */
  isRateLimitError: (err: unknown) => boolean;
  /**
   * Number of contacts processed per batch before pausing.
   * Default: 50. Override in tests to process all contacts without pausing.
   */
  batchSize?: number;
  /**
   * Inter-batch pause to stay within HubSpot's rate limits.
   * Default: 600 ms. Tests pass a no-op to keep suites fast.
   */
  pauseFn?: (ms: number) => Promise<void>;
}

const ENRICHMENT_LIFECYCLE_MAP: Record<string, string> = {
  subscriber: "subscriber",
  lead: "lead",
  marketingqualifiedlead: "mql",
  salesqualifiedlead: "sql",
  opportunity: "opportunity",
  customer: "customer",
  evangelist: "evangelist",
  other: "lead",
};

/**
 * Resolve one Orbit contact against the tenant's HubSpot portal immediately.
 *
 * This is deliberately separate from the scheduled batch sweep: a person
 * working in Contacts needs an answer for the record they are looking at now,
 * not a queue position in the next daily job. Orbit-owned values stay intact;
 * HubSpot only fills blank details and establishes the shared HubSpot ID.
 */
export async function syncSingleContactWithHubSpot(opts: {
  tenantDomain: string;
  contactId: string;
}): Promise<SingleContactHubSpotSyncResult> {
  const { tenantDomain, contactId } = opts;
  const { db } = await import("../db");
  const { marketingContacts } = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");

  const [contact] = await db
    .select({
      id: marketingContacts.id,
      email: marketingContacts.email,
    })
    .from(marketingContacts)
    .where(
      and(
        eq(marketingContacts.id, contactId),
        eq(marketingContacts.tenantDomain, tenantDomain),
      ),
    )
    .limit(1);

  if (!contact) {
    const error = new Error("Contact not found");
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }
  const email = contact.email;
  if (!email) return { status: "no_email" };

  const { getTenantClient, withHubspotRetry } = await import("./hubspot-integration");
  const { client } = await getTenantClient(tenantDomain);
  const result: any = await withHubspotRetry(
    () =>
      client.crm.contacts.searchApi.doSearch({
        filterGroups: [
          { filters: [{ propertyName: "email", operator: "EQ" as any, value: email }] },
        ],
        properties: ["email", "firstname", "lastname", "company", "jobtitle", "lifecyclestage"],
        limit: 1,
        after: "0",
        sorts: [],
      }),
    { label: `single-contact email-search (${tenantDomain})` },
  );

  if (result.results.length === 0) {
    return { status: "not_found", email };
  }

  const hubspotContact = result.results[0];
  const props = hubspotContact.properties as Record<string, string | null>;
  const { enrichContactFromHubSpot } = await import("./marketing-contact-service");
  await enrichContactFromHubSpot({
    tenantDomain,
    email,
    hubspotContactId: hubspotContact.id,
    firstName: props.firstname || null,
    lastName: props.lastname || null,
    company: props.company || null,
    jobTitle: props.jobtitle || null,
    lifecycleStage: ENRICHMENT_LIFECYCLE_MAP[(props.lifecyclestage || "").toLowerCase()] || null,
  });

  console.log(`[HubSpot] single-contact enrichment matched ${email} for ${tenantDomain}`);
  return {
    status: "matched",
    email,
    hubspotContactId: hubspotContact.id,
  };
}

// ---------------------------------------------------------------------------
// Full inbound Marketing Contacts refresh
// ---------------------------------------------------------------------------

const FULL_REFRESH_CONTACT_PROPS = [
  "firstname",
  "lastname",
  "email",
  "jobtitle",
  "company",
  "hs_linkedin_url",
  "lifecyclestage",
];
const FULL_REFRESH_PAGE_SIZE = 100;
const FULL_REFRESH_PAGE_PAUSE_MS = 250;

export interface FullHubSpotContact {
  id: string;
  properties: Record<string, string | null | undefined>;
}

export interface FullHubSpotRefreshCounts {
  pages: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  rateLimited: number;
}

export interface FullHubSpotRefreshPage {
  contacts: FullHubSpotContact[];
  nextAfter: string | null;
}

export interface FullHubSpotRefreshDeps {
  listPage: (after: string | null) => Promise<FullHubSpotRefreshPage>;
  mergeContact: (contact: FullHubSpotContact) => Promise<"created" | "updated" | "skipped">;
  onProgress?: (counts: FullHubSpotRefreshCounts, nextAfter: string | null) => Promise<void> | void;
  pause?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  startAfter?: string | null;
  initialCounts?: FullHubSpotRefreshCounts;
}

function emptyFullRefreshCounts(): FullHubSpotRefreshCounts {
  return {
    pages: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    rateLimited: 0,
  };
}

function throwIfFullRefreshCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Full HubSpot contact refresh was cancelled before completion.");
  }
}

/**
 * Paging core for the explicit operator-triggered refresh. It is deliberately
 * separate from the daily email-search enrichment sweep: this path starts with
 * the complete HubSpot population and never deletes local records.
 */
export async function _runFullHubSpotContactRefreshWithDeps(
  deps: FullHubSpotRefreshDeps,
): Promise<FullHubSpotRefreshCounts> {
  const counts = { ...emptyFullRefreshCounts(), ...(deps.initialCounts ?? {}) };
  const pause = deps.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let after: string | null = deps.startAfter ?? null;

  do {
    throwIfFullRefreshCancelled(deps.signal);
    const page = await deps.listPage(after);
    counts.pages++;

    for (const contact of page.contacts) {
      throwIfFullRefreshCancelled(deps.signal);
      counts.processed++;
      try {
        const outcome = await deps.mergeContact(contact);
        counts[outcome]++;
      } catch (err: any) {
        counts.failed++;
        console.error(`[HubSpot] full contact refresh failed to merge ${contact.id}: ${err?.message ?? err}`);
      }
    }

    after = page.nextAfter;
    await deps.onProgress?.(counts, after);
    if (after) {
      await pause(FULL_REFRESH_PAGE_PAUSE_MS);
      throwIfFullRefreshCancelled(deps.signal);
    }
  } while (after);

  return counts;
}

function normaliseFullRefreshLinkedInUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
}

function normaliseFullRefreshEmail(value: string): string {
  return value.trim().toLowerCase();
}

function fullRefreshLifecycleStage(value: string | null | undefined): string {
  const stage = (value ?? "").trim().toLowerCase();
  return ENRICHMENT_LIFECYCLE_MAP[stage] ?? "subscriber";
}

function shouldAdvanceFullRefreshLifecycleStage(current: string | null | undefined, incoming: string): boolean {
  const stages = ["subscriber", "lead", "mql", "sql", "opportunity", "customer", "evangelist"];
  const currentIndex = stages.indexOf((current ?? "subscriber").toLowerCase());
  const incomingIndex = stages.indexOf(incoming);
  return incomingIndex > Math.max(currentIndex, 0);
}

/**
 * Match only inside the tenant, in the order of strongest identifiers:
 * HubSpot ID, email, then LinkedIn URL. When two identifiers point to
 * different local contacts we skip instead of guessing or merging records.
 */
async function mergeFullHubSpotContact(
  tenantDomain: string,
  hubspotContact: FullHubSpotContact,
): Promise<"created" | "updated" | "skipped"> {
  const props = hubspotContact.properties;
  const email = props.email?.trim() ? normaliseFullRefreshEmail(props.email) : null;
  const linkedinUrl = normaliseFullRefreshLinkedInUrl(props.hs_linkedin_url);

  const identifiers = [eq(marketingContacts.hubspotContactId, hubspotContact.id)];
  if (email) identifiers.push(eq(marketingContacts.email, email));
  if (linkedinUrl) identifiers.push(eq(marketingContacts.linkedinUrl, linkedinUrl));

  const matches = await db
    .select()
    .from(marketingContacts)
    .where(and(eq(marketingContacts.tenantDomain, tenantDomain), or(...identifiers)));

  // A direct ID/email/LinkedIn lookup should identify one record. Multiple
  // rows mean a pre-existing conflict, so leave local records untouched.
  if (matches.length > 1) {
    console.warn(
      `[HubSpot] full contact refresh skipped ${hubspotContact.id} for ${tenantDomain}: identifiers map to multiple Marketing Contacts`,
    );
    return "skipped";
  }

  const existing = matches[0];
  const firstName = props.firstname?.trim() || null;
  const lastName = props.lastname?.trim() || null;
  const company = props.company?.trim() || null;
  const jobTitle = props.jobtitle?.trim() || null;

  if (existing) {
    // An email or LinkedIn URL may be recycled or stale. Never relink an
    // existing Orbit contact from one HubSpot person to another based on that
    // weaker identifier; surface the record as skipped for operator review.
    if (existing.hubspotContactId && existing.hubspotContactId !== hubspotContact.id) {
      console.warn(
        `[HubSpot] full contact refresh skipped ${hubspotContact.id} for ${tenantDomain}: local contact ${existing.id} is linked to a different HubSpot ID`,
      );
      return "skipped";
    }

    // Follow the normal HubSpot enrichment contract: only fill blanks, never
    // overwrite Orbit-owned details, and only advance the lifecycle stage.
    const update: Record<string, unknown> = {
      hubspotContactId: hubspotContact.id,
      updatedAt: new Date(),
    };
    if (!existing.firstName && firstName) update.firstName = firstName;
    if (!existing.lastName && lastName) update.lastName = lastName;
    if (!existing.company && company) update.company = company;
    if (!existing.jobTitle && jobTitle) update.jobTitle = jobTitle;
    if (!existing.linkedinUrl && linkedinUrl) update.linkedinUrl = linkedinUrl;

    const incomingStage = fullRefreshLifecycleStage(props.lifecyclestage);
    if (shouldAdvanceFullRefreshLifecycleStage(existing.lifecycleStage, incomingStage)) {
      update.lifecycleStage = incomingStage;
    }

    await db.update(marketingContacts).set(update).where(eq(marketingContacts.id, existing.id));
    return "updated";
  }

  await db.insert(marketingContacts).values({
    id: randomUUID(),
    tenantDomain,
    email,
    firstName,
    lastName,
    company,
    jobTitle,
    linkedinUrl,
    lifecycleStage: fullRefreshLifecycleStage(props.lifecyclestage),
    hubspotContactId: hubspotContact.id,
    source: "hubspot",
    lastEventAt: new Date(),
  });
  return "created";
}

interface FullHubSpotRefreshCheckpoint extends FullHubSpotRefreshCounts {
  cursor?: string | null;
  workerId?: string;
}

class FullHubSpotRefreshLeaseLostError extends Error {}

function countsFromFullRefreshResult(result: unknown): FullHubSpotRefreshCounts {
  const saved = result as Partial<FullHubSpotRefreshCounts> | null;
  const empty = emptyFullRefreshCounts();
  for (const key of Object.keys(empty) as (keyof FullHubSpotRefreshCounts)[]) {
    const value = saved?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) empty[key] = value;
  }
  return empty;
}

function checkpointFromFullRefreshResult(result: unknown): FullHubSpotRefreshCheckpoint {
  const saved = result as { cursor?: unknown } | null;
  return {
    ...countsFromFullRefreshResult(result),
    cursor: typeof saved?.cursor === "string" ? saved.cursor : null,
  };
}

function fullRefreshResult(
  counts: FullHubSpotRefreshCounts,
  cursor: string | null = null,
  workerId?: string,
) {
  return {
    scope: "all contacts in the connected HubSpot portal",
    lastProgressAt: new Date().toISOString(),
    cursor,
    ...(workerId ? { workerId } : {}),
    ...counts,
  };
}

async function assertFullHubSpotRefreshLease(jobId: string, workerId: string): Promise<void> {
  const [job] = await db
    .select({ status: scheduledJobRuns.status, result: scheduledJobRuns.result })
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.id, jobId))
    .limit(1);
  if (
    job?.status !== "running" ||
    (job.result as { workerId?: string } | null)?.workerId !== workerId
  ) {
    throw new FullHubSpotRefreshLeaseLostError("Full HubSpot contact refresh lease is no longer active.");
  }
}

const enqueuedFullHubSpotRefreshJobs = new Set<string>();

export function enqueueFullHubSpotContactRefresh(jobId: string, tenantDomain: string): void {
  if (enqueuedFullHubSpotRefreshJobs.has(jobId)) return;
  enqueuedFullHubSpotRefreshJobs.add(jobId);
  enqueue(
    "other",
    `hubspot-full-contact-refresh:${tenantDomain}`,
    (signal?: AbortSignal) => runFullHubSpotContactRefresh({ jobId, tenantDomain, signal }),
    {
      timeoutMs: 6 * 60 * 60 * 1000,
      maxRetries: 0,
      ctx: { tenantDomain, targetId: jobId, targetName: "All HubSpot contacts" },
    },
  )
    .catch((err) => console.error(`[HubSpot] full contact refresh job ${jobId} failed:`, err?.message))
    .finally(() => enqueuedFullHubSpotRefreshJobs.delete(jobId));
}

/**
 * On startup, resume every incomplete full refresh from its checkpoint. A
 * fresh process has no old in-memory worker, so its persisted row is returned
 * to pending before re-entering the regular lease claim path.
 */
export async function resumeFullHubSpotContactRefreshes(): Promise<void> {
  const jobs = await db
    .select({ id: scheduledJobRuns.id, tenantDomain: scheduledJobRuns.tenantDomain })
    .from(scheduledJobRuns)
    .where(and(
      eq(scheduledJobRuns.jobType, "hubspotFullContactRefresh"),
      inArray(scheduledJobRuns.status, ["pending", "running"]),
    ))
    .orderBy(desc(scheduledJobRuns.createdAt));

  for (const job of jobs) {
    if (!job.tenantDomain) continue;
    const resumable = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`hubspot-full-contact-refresh:${job.tenantDomain}`}))`);
      const [requeued] = await tx
        .update(scheduledJobRuns)
        .set({ status: "pending", startedAt: null, completedAt: null, errorMessage: null })
        .where(and(
          eq(scheduledJobRuns.id, job.id),
          eq(scheduledJobRuns.tenantDomain, job.tenantDomain!),
          inArray(scheduledJobRuns.status, ["pending", "running"]),
        ))
        .returning({ id: scheduledJobRuns.id });
      return requeued;
    });
    if (resumable) enqueueFullHubSpotContactRefresh(job.id, job.tenantDomain);
  }
}

/**
 * Run a durable, tenant-scoped HubSpot population refresh. The scheduled job
 * row is updated after each page so the Contacts UI can safely poll progress.
 */
export async function runFullHubSpotContactRefresh(opts: {
  jobId: string;
  tenantDomain: string;
  signal?: AbortSignal;
}): Promise<FullHubSpotRefreshCounts> {
  const { jobId, tenantDomain, signal } = opts;
  const workerId = randomUUID();

  // Claim the pending row under the same per-tenant lock as route-side
  // recovery. A delayed in-memory queue worker cannot race a new start that
  // has just reclaimed an orphaned pending row.
  const started = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`hubspot-full-contact-refresh:${tenantDomain}`}))`);
    const [job] = await tx
      .select({ result: scheduledJobRuns.result })
      .from(scheduledJobRuns)
      .where(and(
        eq(scheduledJobRuns.id, jobId),
        eq(scheduledJobRuns.tenantDomain, tenantDomain),
        eq(scheduledJobRuns.status, "pending"),
      ))
      .limit(1);
    if (!job) return null;
    const checkpoint = checkpointFromFullRefreshResult(job.result);
    const [row] = await tx
      .update(scheduledJobRuns)
      .set({
        status: "running",
        startedAt: new Date(),
        result: fullRefreshResult(checkpoint, checkpoint.cursor ?? null, workerId),
      })
      .where(and(
        eq(scheduledJobRuns.id, jobId),
        eq(scheduledJobRuns.tenantDomain, tenantDomain),
        eq(scheduledJobRuns.status, "pending"),
      ))
      .returning({ id: scheduledJobRuns.id });
    return row ? checkpoint : null;
  });
  if (!started) {
    throw new Error("Full HubSpot contact refresh was cancelled before its worker started.");
  }
  const counts = countsFromFullRefreshResult(started);
  const initialCursor = started.cursor ?? null;

  try {
    const { getTenantClient, withHubspotRetry } = await import("./hubspot-integration");
    const { client } = await getTenantClient(tenantDomain);
    const completedCounts = await _runFullHubSpotContactRefreshWithDeps({
      listPage: async (after) => {
        throwIfFullRefreshCancelled(signal);
        await assertFullHubSpotRefreshLease(jobId, workerId);
        const page: any = await withHubspotRetry(
          () => (client.crm.contacts.basicApi as any).getPage(
            FULL_REFRESH_PAGE_SIZE,
            after ?? undefined,
            FULL_REFRESH_CONTACT_PROPS,
          ),
          { label: `full contact refresh page (${tenantDomain})` },
        );
        return {
          contacts: (page.results ?? []).map((contact: any) => ({
            id: contact.id,
            properties: (contact.properties ?? {}) as Record<string, string | null | undefined>,
          })),
          nextAfter: page.paging?.next?.after ? String(page.paging.next.after) : null,
        };
      },
      mergeContact: async (contact) => {
        await assertFullHubSpotRefreshLease(jobId, workerId);
        return mergeFullHubSpotContact(tenantDomain, contact);
      },
      onProgress: async (progress, nextAfter) => {
        throwIfFullRefreshCancelled(signal);
        Object.assign(counts, progress);
        const [updated] = await db
          .update(scheduledJobRuns)
          .set({ result: fullRefreshResult(progress, nextAfter, workerId) })
          .where(and(
            eq(scheduledJobRuns.id, jobId),
            eq(scheduledJobRuns.status, "running"),
            sql`${scheduledJobRuns.result}->>'workerId' = ${workerId}`,
          ))
          .returning({ id: scheduledJobRuns.id });
        if (!updated) throw new FullHubSpotRefreshLeaseLostError("Full HubSpot contact refresh lease is no longer active.");
      },
      signal,
      startAfter: initialCursor,
      initialCounts: counts,
    });

    const [completed] = await db
      .update(scheduledJobRuns)
      .set({
        status: "completed",
        completedAt: new Date(),
        result: fullRefreshResult(completedCounts, null, workerId),
        errorMessage: null,
      })
      .where(and(
        eq(scheduledJobRuns.id, jobId),
        eq(scheduledJobRuns.status, "running"),
        sql`${scheduledJobRuns.result}->>'workerId' = ${workerId}`,
      ))
      .returning({ id: scheduledJobRuns.id });
    if (!completed) throw new FullHubSpotRefreshLeaseLostError("Full HubSpot contact refresh lease is no longer active.");
    return completedCounts;
  } catch (err: any) {
    if (err instanceof FullHubSpotRefreshLeaseLostError) throw err;
    const { isHubspotRateLimitError } = await import("./hubspot-integration");
    if (isHubspotRateLimitError(err)) counts.rateLimited++;
    await db
      .update(scheduledJobRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        result: fullRefreshResult(counts, initialCursor, workerId),
        errorMessage: err?.message ?? "Full HubSpot contact refresh failed",
      })
      .where(and(
        eq(scheduledJobRuns.id, jobId),
        eq(scheduledJobRuns.status, "running"),
        sql`${scheduledJobRuns.result}->>'workerId' = ${workerId}`,
      ));
    throw err;
  }
}

export async function _syncHubSpotContactEnrichmentWithDeps(
  opts: { tenantDomain: string; limit?: number; forceAll?: boolean },
  deps: ContactEnrichmentDeps,
): Promise<ContactEnrichmentStats> {
  const { tenantDomain, limit = 200, forceAll = false } = opts;

  // HubSpot search API: max 5 req/s. Process contacts in batches with an
  // inter-batch pause to stay within rate limits. Contacts that are still
  // rate-limited after all retry attempts are counted separately and left
  // un-enriched (hubspotContactId stays null) so the next sweep picks them up.
  const BATCH_SIZE = deps.batchSize ?? 50;
  const pause = deps.pauseFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const contacts = await deps.loadContacts(tenantDomain, limit, forceAll);
  if (contacts.length === 0) {
    return {
      examined: 0,
      matched: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      enriched: 0,
      notFound: 0,
      errors: 0,
      rateLimited: 0,
    };
  }

  const examined = contacts.length;
  let matched = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let enriched = 0;
  let notFound = 0;
  let errors = 0;
  let rateLimited = 0;

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    for (const contact of batch) {
      try {
        // Prefer the linked prospect's already-resolved HubSpot ID — this
        // skips a live API search and keeps both records in sync.
        if (contact.sourceProspectId && deps.getProspectHubspotId) {
          const prospectHsId = await deps.getProspectHubspotId(contact.sourceProspectId);
          if (prospectHsId) {
            matched++;
            await deps.enrichContact({
              tenantDomain,
              email: contact.email,
              hubspotContactId: prospectHsId,
              firstName: null,
              lastName: null,
              company: null,
              jobTitle: null,
              lifecycleStage: null,
            });
            updated++;
            enriched++;
            continue;
          }
        }

        const hsContact = await deps.searchHubSpot(contact.email);

        if (!hsContact) {
          notFound++;
          skipped++;
          continue;
        }

        matched++;
        const props = hsContact.properties;
        const hsStage = (props.lifecyclestage || "").toLowerCase();
        const mappedStage = ENRICHMENT_LIFECYCLE_MAP[hsStage] || null;

        await deps.enrichContact({
          tenantDomain,
          email: contact.email,
          hubspotContactId: hsContact.id,
          firstName: props.firstname || null,
          lastName: props.lastname || null,
          company: props.company || null,
          jobTitle: props.jobtitle || null,
          lifecycleStage: mappedStage,
        });
        updated++;
        enriched++;
      } catch (err: any) {
        if (deps.isRateLimitError(err)) {
          // Contact left un-enriched; next sweep will retry naturally.
          rateLimited++;
          skipped++;
          console.warn(
            `[HubSpot] contact enrichment rate-limited for ${contact.email} (${tenantDomain}) — deferred to next sweep`,
          );
        } else {
          console.error(`[HubSpot] enrichment failed for ${contact.email}: ${err.message}`);
          errors++;
          failed++;
        }
      }
    }
    if (i + BATCH_SIZE < contacts.length) {
      await pause(600);
    }
  }

  return {
    examined,
    matched,
    updated,
    skipped,
    failed,
    enriched,
    notFound,
    errors,
    rateLimited,
  };
}

/**
 * Push Orbit lead scores to HubSpot contact properties.
 *
 * Writes two custom properties to matching HubSpot contacts:
 *   orbit_lead_score     — current numeric score
 *   orbit_lifecycle_stage — current lifecycle stage string
 *
 * Contacts are matched by the stored hubspotContactId.  Contacts without a
 * HubSpot ID are skipped (enrichment must run first).
 *
 * Designed to be called from the nightly HubSpot sync sweep.
 */
// ---------------------------------------------------------------------------
// DI-based core for pushLeadScoresToHubSpot — exported for unit tests
// ---------------------------------------------------------------------------

export interface LeadScoreContact {
  id: string;
  email: string;
  hubspotContactId: string | null;
  score: number | null;
  lifecycleStage: string | null;
}

export interface PushLeadScoresDeps {
  /** Load contacts for a single tenant that have a HubSpot ID */
  loadContacts: (tenantDomain: string, limit: number) => Promise<LeadScoreContact[]>;
  /** Push orbit_lead_score + orbit_lifecycle_stage to one HubSpot contact */
  updateHubSpotContact: (hubspotContactId: string, score: number, stage: string) => Promise<void>;
}

export async function _pushLeadScoresWithDeps(
  tenantDomain: string,
  limit: number,
  deps: PushLeadScoresDeps,
): Promise<{ pushed: number; skipped: number; errors: number }> {
  const contacts = await deps.loadContacts(tenantDomain, limit);

  let pushed = 0;
  let skipped = 0;
  let errors = 0;

  for (const contact of contacts) {
    if (!contact.hubspotContactId) { skipped++; continue; }
    try {
      await deps.updateHubSpotContact(
        contact.hubspotContactId,
        contact.score ?? 0,
        contact.lifecycleStage ?? "subscriber",
      );
      pushed++;
    } catch (err: any) {
      console.warn(
        `[HubSpot] lead-score push failed for contact ${contact.hubspotContactId}: ${err.message}`,
      );
      errors++;
    }
  }

  return { pushed, skipped, errors };
}

export async function pushLeadScoresToHubSpot(opts: {
  tenantDomain: string;
  limit?: number;
}): Promise<{ pushed: number; skipped: number; errors: number }> {
  const { tenantDomain, limit = 500 } = opts;

  const { getTenantClient } = await import("./hubspot-integration");
  let client: any;
  try {
    const result = await getTenantClient(tenantDomain);
    client = result.client;
  } catch (err: any) {
    console.warn(
      `[HubSpot] lead-score push skipped for ${tenantDomain} — not connected: ${err.message}`,
    );
    return { pushed: 0, skipped: 0, errors: 0 };
  }

  const { db } = await import("../db");
  const { marketingContacts } = await import("@shared/schema");
  const { eq, and, isNotNull } = await import("drizzle-orm");

  const deps: PushLeadScoresDeps = {
    loadContacts: async (td, lim) => {
      const rows = await db
        .select({
          id: marketingContacts.id,
          email: marketingContacts.email,
          hubspotContactId: marketingContacts.hubspotContactId,
          score: marketingContacts.score,
          lifecycleStage: marketingContacts.lifecycleStage,
        })
        .from(marketingContacts)
        .where(
          and(
            eq(marketingContacts.tenantDomain, td),
            isNotNull(marketingContacts.hubspotContactId),
            isNotNull(marketingContacts.email),
          ),
        )
        .limit(lim);
      // email is filtered non-null above; narrow the type for the deps contract
      return rows.filter((r): r is typeof r & { email: string } => !!r.email);
    },
    updateHubSpotContact: async (hubspotContactId, score, stage) => {
      await client.crm.contacts.basicApi.update(hubspotContactId, {
        properties: {
          orbit_lead_score: String(score),
          orbit_lifecycle_stage: stage,
        },
      });
    },
  };

  const result = await _pushLeadScoresWithDeps(tenantDomain, limit, deps);

  console.log(
    `[HubSpot] lead-score push complete for ${tenantDomain} — pushed=${result.pushed} skipped=${result.skipped} errors=${result.errors}`,
  );
  return result;
}
