import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock, createMessage, fetchCompetitorNews } = vi.hoisted(() => ({
  storageMock: {
    getTenantByDomain: vi.fn(),
    getMarket: vi.fn(),
    getActivityByTenantForPeriod: vi.fn(),
    getCompetitorsByContext: vi.fn(),
    getCompanyProfileByContext: vi.fn(),
    createIntelligenceBriefing: vi.fn(),
  },
  createMessage: vi.fn(),
  fetchCompetitorNews: vi.fn(),
}));

vi.mock("../../storage", () => ({ storage: storageMock }));
vi.mock("../news-service", () => ({
  fetchCompetitorNews,
  buildNewsSummary: () => "",
}));
vi.mock("../competitor-document-context", () => ({
  buildCompetitorDocumentContextForCompetitors: async () => ({ context: "" }),
}));
vi.mock("../ai-usage-logger", () => ({ logAiUsage: vi.fn() }));
vi.mock("../notifications", () => ({ notifications: { dispatch: vi.fn() } }));
vi.mock("../hubspot-integration", () => ({ autoPushBriefing: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMessage };
  },
}));

import { generateBriefing } from "../intelligence-briefing-service";

describe("generateBriefing market isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-key";
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://example.test";

    storageMock.getTenantByDomain.mockResolvedValue({ id: "synozur-tenant" });
    storageMock.getMarket.mockResolvedValue({
      id: "market-a",
      tenantId: "synozur-tenant",
      isDefault: false,
    });
    storageMock.getActivityByTenantForPeriod.mockResolvedValue([
      {
        competitorId: "competitor-a",
        competitorName: "Market A Competitor",
        type: "website_change",
        impact: "High",
        description: "Market A pricing update",
        sourceType: "competitor",
      },
    ]);
    storageMock.getCompetitorsByContext.mockResolvedValue([
      {
        id: "competitor-a",
        name: "Market A Competitor",
        url: "https://market-a.example",
      },
    ]);
    storageMock.getCompanyProfileByContext.mockResolvedValue({
      companyName: "Market A Baseline",
      websiteUrl: "https://baseline-a.example",
    });
    fetchCompetitorNews.mockResolvedValue([]);
    createMessage.mockResolvedValue({
      usage: {},
      content: [{
        type: "text",
        text: JSON.stringify({
          executiveSummary: "Market A moved on pricing.",
          keyThemes: [{
            title: "Pricing",
            description: "Only Market A is relevant.",
            competitors: ["Market A Competitor", "Market B Competitor"],
            significance: "high",
          }],
          competitorMovements: [
            { name: "Market A Competitor", signals: ["Pricing"], interpretation: "Changed pricing", threatLevel: "high" },
            { name: "Market B Competitor", signals: ["Unrelated"], interpretation: "Unrelated", threatLevel: "low" },
          ],
          actionItems: [{
            title: "Review pricing",
            description: "Assess the Market A change.",
            urgency: "this_week",
            category: "pricing",
            relatedCompetitors: ["Market A Competitor", "Market B Competitor"],
          }],
          riskAlerts: [],
          signalDigest: { highlights: ["Market A update"] },
        }),
      }],
    });
    storageMock.createIntelligenceBriefing.mockImplementation(async (input) => ({
      id: "briefing-a",
      ...input,
    }));
  });

  it("loads, persists, and prompts with only the requested market's data", async () => {
    const briefing = await generateBriefing("synozur.com", 8, "market-a");

    expect(storageMock.getActivityByTenantForPeriod).toHaveBeenCalledWith("synozur.com", 8, "market-a");
    expect(storageMock.getCompetitorsByContext).toHaveBeenCalledWith({
      tenantId: "synozur-tenant",
      tenantDomain: "synozur.com",
      marketId: "market-a",
      isDefaultMarket: false,
    });
    expect(fetchCompetitorNews).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "Market A Competitor" })]),
      expect.anything(),
      8,
    );
    expect(createMessage.mock.calls[0][0].messages[0].content).toContain("Market A Competitor");
    expect(createMessage.mock.calls[0][0].messages[0].content).not.toContain("Market B Competitor");
    expect(briefing.marketId).toBe("market-a");
    expect((briefing.briefingData as any).competitorMovements).toEqual([
      expect.objectContaining({ name: "Market A Competitor" }),
    ]);
    expect((briefing.briefingData as any).keyThemes[0].competitors).toEqual(["Market A Competitor"]);
    expect((briefing.briefingData as any).actionItems[0].relatedCompetitors).toEqual(["Market A Competitor"]);
  });

  it("rejects mismatched explicit and request-context markets before loading data", async () => {
    await expect(generateBriefing("synozur.com", 8, "market-a", {
      tenantId: "synozur-tenant",
      tenantDomain: "synozur.com",
      marketId: "market-b",
    })).rejects.toThrow("Briefing context market does not match the requested market");

    expect(storageMock.getActivityByTenantForPeriod).not.toHaveBeenCalled();
    expect(storageMock.createIntelligenceBriefing).not.toHaveBeenCalled();
  });

  it("rejects tenant-wide briefing generation when no market scope is supplied", async () => {
    await expect(generateBriefing("synozur.com", 8)).rejects.toThrow(
      "Briefing generation requires an explicit market context",
    );

    expect(storageMock.getActivityByTenantForPeriod).not.toHaveBeenCalled();
    expect(storageMock.createIntelligenceBriefing).not.toHaveBeenCalled();
  });

  it("rejects a context that claims the requested tenant with another tenant's ID", async () => {
    await expect(generateBriefing("synozur.com", 8, undefined, {
      tenantId: "other-tenant",
      tenantDomain: "synozur.com",
      marketId: "market-a",
    })).rejects.toThrow("Cannot generate briefing for an invalid market context");

    expect(storageMock.getActivityByTenantForPeriod).not.toHaveBeenCalled();
    expect(storageMock.createIntelligenceBriefing).not.toHaveBeenCalled();
  });
});