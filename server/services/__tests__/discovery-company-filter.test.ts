import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  rows: [] as unknown[][],
  web: vi.fn(),
  apollo: vi.fn(),
  expand: vi.fn(),
}));

vi.mock("../../db", () => {
  const chain = (): any => ({
    from: chain, innerJoin: chain,
    where: async () => io.rows.shift() ?? [],
  });
  return { db: { select: chain } };
});
vi.mock("../prospect-contact-service", () => ({
  addCampaignMembership: vi.fn(), ensureContactForPerson: vi.fn(), getProspectsWithContacts: vi.fn(),
}));
vi.mock("../web-discovery-provider", () => ({
  searchWeb: io.web, isWebSearchAvailable: () => true, webDiscoveryReason: () => "",
}));
vi.mock("../salesnav-discovery-provider", () => ({
  searchSalesNavigator: vi.fn(), isSalesNavigatorAvailable: () => false, salesNavigatorReason: () => "",
  SalesNavDiscoveryError: class extends Error {},
}));
vi.mock("../apollo-discovery-provider", () => ({
  searchApollo: io.apollo, searchApolloCompaniesFirst: vi.fn(),
  isApolloAvailable: () => true, apolloReason: () => "",
  ApolloDiscoveryError: class extends Error {},
}));
vi.mock("../discovery-intent-expansion", () => ({ expandCriteria: io.expand }));

import { discoverProspects } from "../discovery-service";

const campaign = {
  id: "campaign", tenantDomain: "test.example", targetPersonaIds: [],
  targetingFilter: { namedAccounts: ["Other"] }, goalType: "event_invite",
};
const candidates = [
  { name: "Alice Chen", companyName: "Acme, Inc.", companyDomain: "acme.com", source: "web" },
  { name: "Bob Jones", companyName: "Other", companyDomain: "other.com", source: "web" },
];

beforeEach(() => {
  vi.clearAllMocks();
  io.rows = [[campaign], []];
  io.web.mockResolvedValue({
    candidates, droppedCount: 0, usage: { inputTokens: 1, outputTokens: 1 },
    searchCount: 1, provider: "test", model: "test",
  });
  io.apollo.mockResolvedValue({ candidates: [], droppedCount: 0, appliedFilters: {} });
});

describe("per-search company restriction", () => {
  it.each(["Acme", "acme.com"])("restricts web candidates to %s without changing campaign targeting", async (company) => {
    const result = await discoverProspects("test.example", "campaign", { company, backend: "web" });
    expect(result.candidates.map(row => row.candidate.name)).toEqual(["Alice Chen"]);
    expect(io.web).toHaveBeenCalledWith("test.example", expect.objectContaining({ company, namedAccounts: [company] }));
    expect(io.expand).not.toHaveBeenCalled();
    expect(campaign.targetingFilter.namedAccounts).toEqual(["Other"]);
  });

  it("keeps the restriction through Apollo's web fallback", async () => {
    const result = await discoverProspects("test.example", "campaign", { company: "Acme", backend: "apollo" });
    expect(io.apollo).toHaveBeenCalledWith("test.example", expect.objectContaining({ company: "Acme", namedAccounts: ["Acme"] }));
    expect(io.web).toHaveBeenCalledWith("test.example", expect.objectContaining({ company: "Acme", broaden: true }));
    expect(result.candidates).toHaveLength(1);
    expect(result.fallbackReason).toContain("restricted to the selected company");
  });
});
