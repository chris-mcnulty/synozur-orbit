import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connection: vi.fn() }));
vi.mock("../../storage", () => ({ storage: { getHubspotConnection: mocks.connection } }));
vi.mock("../../utils/encryption", () => ({ encryptSecret: vi.fn(), decryptSecret: () => "test-token-not-a-secret" }));
import { readConferenceHubspotContacts } from "../hubspot-integration";
const contact = (id: string) => ({ id, properties: { firstname: "Example", company: "Acme", hubspot_owner_id: "owner", lifecyclestage: "customer", hs_email_optout: "true" } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.connection.mockResolvedValue({ expiresAt: new Date(Date.now() + 3600000), encryptedAccessToken: "test-fixture" });
});
afterEach(() => vi.unstubAllGlobals());
describe("bounded HubSpot conference discovery", () => {
  it("samples at most four pages, descending by modification, and explains truncation", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [contact("123")], paging: { next: { after: "cursor" } } }) });
    vi.stubGlobal("fetch", fetcher);
    const result = await readConferenceHubspotContacts("tenant", { queries: ["Acme", "Beta", "Gamma", "Delta"] });
    expect(fetcher).toHaveBeenCalledTimes(4);
    const bodies = fetcher.mock.calls.map(c => JSON.parse(c[1].body));
    expect(bodies[0]).toMatchObject({ limit: 100, sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }] });
    expect(bodies.slice(1).map(b => b.limit)).toEqual([25, 25, 25]);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({ optedOut: true, crmOwnerId: "owner", lifecycleStage: "customer" });
    expect(result.limitations.join(" ")).toContain("more matches");
  });
  it("marks partial target-search failures without pretending the pool is complete", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [contact("123")] }) })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetcher);
    const result = await readConferenceHubspotContacts("tenant", { queries: ["Acme"] });
    expect(result.contacts).toHaveLength(1);
    expect(result.limitations.join(" ")).toContain("partial");
  });
  it("fails explicitly if no contact sample is accessible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(readConferenceHubspotContacts("tenant", {})).rejects.toThrow("contact permissions");
  });
  it("re-fetches only selected ids and rejects partial batch results", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [contact("123")] }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(readConferenceHubspotContacts("tenant", { ids: ["123", "456"] })).rejects.toThrow("unavailable");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).inputs).toEqual([{ id: "123" }, { id: "456" }]);
    await expect(readConferenceHubspotContacts("tenant", { ids: Array(11).fill("123") })).rejects.toThrow("between 1 and 10");
  });
});
