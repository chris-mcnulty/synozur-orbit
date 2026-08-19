import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getDefaultMarket: vi.fn(),
    getMarket: vi.fn(),
    getCompanyProfileByContext: vi.fn(),
  },
}));

vi.mock("../../storage", () => ({ storage: storageMock }));

import { resolveEligibleBriefingMarket } from "../briefing-market-resolver";

const tenant = {
  id: "synozur-tenant",
  domain: "synozur.com",
} as any;

const marketA = {
  id: "market-a",
  tenantId: "synozur-tenant",
  name: "Retail intelligence",
  status: "active",
  isDefault: true,
} as any;

describe("resolveEligibleBriefingMarket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses only the tenant default baseline when legacy digest delivery has no market selection", async () => {
    storageMock.getDefaultMarket.mockResolvedValue(marketA);
    storageMock.getCompanyProfileByContext.mockResolvedValue({
      companyName: "Retail Baseline",
      marketId: "market-a",
    });

    const result = await resolveEligibleBriefingMarket(tenant);

    expect(result).toMatchObject({
      market: { id: "market-a", name: "Retail intelligence" },
      baseline: { companyName: "Retail Baseline" },
      context: {
        tenantId: "synozur-tenant",
        tenantDomain: "synozur.com",
        marketId: "market-a",
        isDefaultMarket: true,
      },
    });
    expect(storageMock.getMarket).not.toHaveBeenCalled();
  });

  it("suppresses delivery instead of accepting another tenant's market", async () => {
    storageMock.getMarket.mockResolvedValue({
      ...marketA,
      id: "market-b",
      tenantId: "other-tenant",
    });

    const result = await resolveEligibleBriefingMarket(tenant, "market-b");

    expect(result).toBeNull();
    expect(storageMock.getCompanyProfileByContext).not.toHaveBeenCalled();
  });

  it("suppresses delivery when the selected market has no baseline profile", async () => {
    storageMock.getMarket.mockResolvedValue({ ...marketA, isDefault: false });
    storageMock.getCompanyProfileByContext.mockResolvedValue(undefined);

    const result = await resolveEligibleBriefingMarket(tenant, "market-a");

    expect(result).toBeNull();
  });
});