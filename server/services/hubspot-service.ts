// HubSpot CRM Integration Service
// Uses Replit HubSpot connection for OAuth authentication

import { Client } from '@hubspot/api-client';

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
}): Promise<{ enriched: number; notFound: number; errors: number; rateLimited: number }> {
  const { tenantDomain, limit = 200, forceAll = false } = opts;

  // Use the per-tenant OAuth client — this is the same client the daily
  // HubSpot sweep uses, so it always operates on the correct CRM portal.
  const { getTenantClient } = await import("./hubspot-integration");
  let client: any;
  try {
    const result = await getTenantClient(tenantDomain);
    client = result.client;
  } catch (err: any) {
    console.warn(
      `[HubSpot] contact enrichment skipped for ${tenantDomain} — not connected: ${err.message}`,
    );
    return { enriched: 0, notFound: 0, errors: 0, rateLimited: 0 };
  }

  const { db } = await import("../db");
  const { marketingContacts } = await import("@shared/schema");
  const { enrichContactFromHubSpot } = await import("./marketing-contact-service");
  const { eq, and, isNull } = await import("drizzle-orm");

  const conditions: any[] = [eq(marketingContacts.tenantDomain, tenantDomain)];
  if (!forceAll) conditions.push(isNull(marketingContacts.hubspotContactId));

  const contacts = await db
    .select({ id: marketingContacts.id, email: marketingContacts.email })
    .from(marketingContacts)
    .where(and(...conditions))
    .limit(limit);

  if (contacts.length === 0) return { enriched: 0, notFound: 0, errors: 0, rateLimited: 0 };

  const { withHubspotRetry, isHubspotRateLimitError } = await import("./hubspot-integration");

  let enriched = 0;
  let notFound = 0;
  let errors = 0;
  let rateLimited = 0;

  // HubSpot search API: max 5 req/s on the search endpoint. Process contacts
  // one at a time with withHubspotRetry (exponential backoff on 429) and a
  // brief inter-request pause to stay within rate limits.
  // Contacts that are still rate-limited after all retry attempts are counted
  // separately and left un-enriched (hubspotContactId stays null) so the next
  // sweep naturally picks them up — they are NOT silently skipped.
  const BATCH_SIZE = 50;
  const LIFECYCLE_MAP: Record<string, string> = {
    subscriber: "subscriber",
    lead: "lead",
    marketingqualifiedlead: "mql",
    salesqualifiedlead: "sql",
    opportunity: "opportunity",
    customer: "customer",
    evangelist: "evangelist",
    other: "lead",
  };

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    for (const contact of batch) {
      try {
        const result: any = await withHubspotRetry(
          () =>
            client.crm.contacts.searchApi.doSearch({
              filterGroups: [
                {
                  filters: [
                    { propertyName: "email", operator: "EQ" as any, value: contact.email },
                  ],
                },
              ],
              properties: ["email", "firstname", "lastname", "company", "jobtitle", "lifecyclestage"],
              limit: 1,
              after: "0",
              sorts: [],
            }),
          { label: `contact email-search (${tenantDomain})` },
        );

        if (result.results.length === 0) {
          notFound++;
          continue;
        }

        const hs = result.results[0];
        const props = hs.properties as Record<string, string | null>;

        const hsStage = (props.lifecyclestage || "").toLowerCase();
        const mappedStage = LIFECYCLE_MAP[hsStage] || null;

        await enrichContactFromHubSpot({
          tenantDomain,
          email: contact.email,
          hubspotContactId: hs.id,
          firstName: props.firstname || null,
          lastName: props.lastname || null,
          company: props.company || null,
          jobTitle: props.jobtitle || null,
          lifecycleStage: mappedStage,
        });
        enriched++;
      } catch (err: any) {
        if (isHubspotRateLimitError(err)) {
          // Contact left un-enriched; next sweep will retry naturally.
          rateLimited++;
          console.warn(
            `[HubSpot] contact enrichment rate-limited for ${contact.email} (${tenantDomain}) — deferred to next sweep`,
          );
        } else {
          console.error(`[HubSpot] enrichment failed for ${contact.email}: ${err.message}`);
          errors++;
        }
      }
    }
    if (i + BATCH_SIZE < contacts.length) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  console.log(
    `[HubSpot] contact enrichment complete for ${tenantDomain} — enriched=${enriched} notFound=${notFound} errors=${errors} rateLimited=${rateLimited}`,
  );
  return { enriched, notFound, errors, rateLimited };
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
    loadContacts: async (td, lim) =>
      db
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
          ),
        )
        .limit(lim),
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
