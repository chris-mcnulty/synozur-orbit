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
}): Promise<{ enriched: number; notFound: number; errors: number }> {
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
    return { enriched: 0, notFound: 0, errors: 0 };
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

  if (contacts.length === 0) return { enriched: 0, notFound: 0, errors: 0 };

  let enriched = 0;
  let notFound = 0;
  let errors = 0;

  // HubSpot search API: max 100 req/10s. Process in small batches with a
  // brief pause between to stay comfortably within rate limits.
  const BATCH_SIZE = 50;
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    for (const contact of batch) {
      try {
        const result = await client.crm.contacts.searchApi.doSearch({
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
        });

        if (result.results.length === 0) {
          notFound++;
          continue;
        }

        const hs = result.results[0];
        const props = hs.properties as Record<string, string | null>;

        // Map HubSpot lifecycle stage names to Orbit's spine values.
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
        console.error(`[HubSpot] enrichment failed for ${contact.email}: ${err.message}`);
        errors++;
      }
    }
    if (i + BATCH_SIZE < contacts.length) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  console.log(
    `[HubSpot] contact enrichment complete for ${tenantDomain} — enriched=${enriched} notFound=${notFound} errors=${errors}`,
  );
  return { enriched, notFound, errors };
}
