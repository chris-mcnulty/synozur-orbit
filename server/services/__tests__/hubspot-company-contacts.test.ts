import { describe, expect, it, vi } from "vitest";
import type { Client } from "@hubspot/api-client";
import { searchHubspotCompanyContacts } from "../hubspot-company-contacts";

function setup(companies: any[] = [], contacts: any[] = []) {
  const companySearch = vi.fn().mockResolvedValue({ results: companies });
  const contactSearch = vi.fn().mockResolvedValue({ results: contacts });
  const client = { crm: {
    companies: { searchApi: { doSearch: companySearch } },
    contacts: { searchApi: { doSearch: contactSearch } },
  } } as unknown as Client;
  return { client, companySearch, contactSearch };
}
describe("HubSpot company contact search", () => {
  it("looks up company records and searches explicit employer fields OR company associations", async () => {
    const { client, companySearch, contactSearch } = setup([{ id: "42", properties: { name: "Acme" } }], [
      { id: "person", properties: { firstname: "Alex", associatedcompanyid: "42", company: "" } },
    ]);
    const result = await searchHubspotCompanyContacts(client, "Acme", "Alex", 50, ["firstname", "company"]);
    expect(companySearch).toHaveBeenCalledWith(expect.objectContaining({ query: "Acme" }));
    expect(contactSearch).toHaveBeenCalledWith(expect.objectContaining({
      query: "Alex", limit: 50, filterGroups: [
        { filters: [{ propertyName: "company", operator: "CONTAINS_TOKEN", value: "Acme" }] },
        { filters: [{ propertyName: "associations.company", operator: "EQ", value: "42" }] },
      ],
    }));
    expect(result[0].properties.company).toBe("Acme");
  });
  it("still searches the explicit company property when there is no CRM company record", async () => {
    const { client, contactSearch } = setup();
    expect(await searchHubspotCompanyContacts(client, "Acme", "", 50, [])).toEqual([]);
    expect(contactSearch.mock.calls[0][0].filterGroups).toHaveLength(1);
    expect(contactSearch.mock.calls[0][0].query).toBeUndefined();
  });
  it("batches OR filters, deduplicates records and caps the preview", async () => {
    const { client, contactSearch } = setup(Array.from({ length: 7 }, (_, i) => ({ id: String(i), properties: {} })));
    contactSearch.mockResolvedValueOnce({ results: [{ id: "a", properties: {} }] })
      .mockResolvedValueOnce({ results: [{ id: "a", properties: {} }, { id: "b", properties: {} }, { id: "c", properties: {} }] });
    const rows = await searchHubspotCompanyContacts(client, "Acme", "", 2, []);
    expect(rows.map(row => row.id)).toEqual(["a", "b"]);
    expect(contactSearch.mock.calls.map(([body]) => body.filterGroups.length)).toEqual([5, 3]);
  });
  it("does not silently broaden scope or claim no contacts after provider failure", async () => {
    const { client, companySearch, contactSearch } = setup();
    companySearch.mockRejectedValue(new Error("HubSpot permission denied"));
    await expect(searchHubspotCompanyContacts(client, "Acme", "", 50, [])).rejects.toThrow("permission denied");
    expect(contactSearch).not.toHaveBeenCalled();
  });
  it("asks for a narrower search rather than silently dropping matching companies", async () => {
    const { client, companySearch, contactSearch } = setup();
    companySearch.mockResolvedValue({ results: [], paging: { next: { after: "21" } } });
    await expect(searchHubspotCompanyContacts(client, "Group", "", 50, [])).rejects.toThrow("Refine");
    expect(contactSearch).not.toHaveBeenCalled();
  });
});
