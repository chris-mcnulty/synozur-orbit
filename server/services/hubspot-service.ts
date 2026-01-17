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
