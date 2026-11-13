import type { Client } from "@hubspot/api-client";

/**
 * Search both explicit contact.company values and CRM company associations.
 * Never infer an employer from email. All reads use the caller's tenant client.
 * Results are a bounded preview, not a complete CRM export.
 */
export async function searchHubspotCompanyContacts(
  client: Client, company: string, query: string, limit: number, properties: string[],
) {
  const companies = await client.crm.companies.searchApi.doSearch({
    query: company, filterGroups: [], properties: ["name", "domain"],
    sorts: [], limit: 21, after: "0",
  } as any);
  if (companies.results.length > 20 || companies.paging?.next) {
    throw new Error("Too many HubSpot companies match. Refine the company name or use its domain.");
  }
  const groups = [
    { filters: [{ propertyName: "company", operator: "CONTAINS_TOKEN", value: company }] },
    ...companies.results.map(c => ({
      filters: [{ propertyName: "associations.company", operator: "EQ", value: c.id }],
    })),
  ];
  const found = new Map<string, (typeof companies.results)[number]>();
  // HubSpot allows at most five OR filter groups in one search request.
  for (let offset = 0; offset < groups.length && found.size < limit; offset += 5) {
    const page = await client.crm.contacts.searchApi.doSearch({
      query: query || undefined, filterGroups: groups.slice(offset, offset + 5),
      properties: [...properties, "associatedcompanyid"], sorts: ["lastmodifieddate"],
      limit, after: "0",
    } as any);
    for (const contact of page.results) {
      if (found.has(contact.id) || found.size >= limit) continue;
      const associated = companies.results.find(c => c.id === contact.properties.associatedcompanyid);
      found.set(contact.id, {
        ...contact,
        properties: { ...contact.properties, company: contact.properties.company || associated?.properties.name || null },
      });
    }
  }
  return [...found.values()];
}
