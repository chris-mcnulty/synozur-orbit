/**
 * Integration tests — GET /api/markets/:marketId/export
 *
 * Verifies the full assembled markdown export after the parallel-fetch
 * (Promise.all) refactor:
 *   - All sections appear: Company Profiles, Competitors (incl. Orbit Score
 *     and Battlecard subsections), Projects, Products, Marketing Plans,
 *     Assessments, Activity Log
 *   - Default market includes null-marketId (legacy) company profiles
 *   - Non-default market excludes null-marketId profiles
 *   - 404 for missing market, 403 for cross-tenant market
 *
 * All storage I/O and heavy service imports are mocked so the handler runs in
 * isolation without a real database or AI provider.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── Storage mock ──────────────────────────────────────────────────────────────

const storageMock = vi.hoisted(() => ({
  getMarket: vi.fn(),
  getCompanyProfilesByTenantDomain: vi.fn(),
  getCompetitorsByContext: vi.fn(),
  getClientProjectsByContext: vi.fn(),
  getProductsByContext: vi.fn(),
  getMarketingPlans: vi.fn(),
  getActivityByContext: vi.fn(),
  getAssessmentsByContext: vi.fn(),
  getBattlecardsByContext: vi.fn(),
  getCompetitorScoresByContext: vi.fn(),
  getExecutiveSummary: vi.fn(),
  getProjectProducts: vi.fn(),
  getLongFormRecommendationsByProject: vi.fn(),
  getProductBattlecardsByProject: vi.fn(),
  getProductFeaturesByProduct: vi.fn(),
  getRoadmapItemsByProduct: vi.fn(),
  getFeatureRecommendationsByProduct: vi.fn(),
  getMarketingTasks: vi.fn(),
}));

vi.mock("../../storage", () => ({ storage: storageMock }));

// ── Context mock (handler auth/tenant resolution) ─────────────────────────────

const contextMock = vi.hoisted(() => ({
  getRequestContext: vi.fn(),
}));

vi.mock("../../context", () => ({
  getRequestContext: contextMock.getRequestContext,
  ContextError: class ContextError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  getActiveTenantId: vi.fn(),
  getActiveMarketId: vi.fn(),
}));

// ── DB mock (admin.ts imports db directly for a few one-off queries) ──────────

vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  },
}));

// ── Heavy service mocks (imported at top of admin.ts) ─────────────────────────

vi.mock("../../services/plan-policy", () => ({
  checkFeatureAccessAsync: vi.fn().mockResolvedValue({ allowed: true }),
  getPlanFeaturesAsync: vi.fn().mockResolvedValue({}),
  invalidatePlanCache: vi.fn(),
  FEATURE_REGISTRY: {},
  FEATURE_CATEGORIES: {},
  MANUAL_ACTION_KEYS: [],
  MANUAL_ACTION_LABELS: {},
}));

vi.mock("../../services/manual-action-quota", () => ({
  getManualActionUsageSummary: vi.fn().mockResolvedValue([]),
  grantManualActionBonus: vi.fn(),
  listManualActionBonuses: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../ai-service", () => ({
  analyzeCompetitorWebsite: vi.fn(),
  aiCompanyResearch: vi.fn(),
}));

vi.mock("../../services/web-crawler", () => ({
  crawlCompetitorWebsite: vi.fn(),
  getCombinedContent: vi.fn(),
  buildCrawlData: vi.fn(),
}));

vi.mock("../../services/website-monitoring", () => ({
  monitorCompetitorWebsite: vi.fn(),
  monitorCompanyProfileWebsite: vi.fn(),
}));

vi.mock("../../services/social-monitoring", () => ({
  monitorCompetitorSocialMedia: vi.fn(),
}));

vi.mock("../../services/scheduled-jobs", () => ({
  invalidateMarketStatusCache: vi.fn(),
}));

vi.mock("../../utils/url-validator", () => ({
  validateCompetitorUrl: vi.fn().mockReturnValue({ ok: true }),
  validateBlogUrl: vi.fn().mockReturnValue({ ok: true }),
}));

vi.mock("../../services/scoring-service", () => ({
  calculateBaselineScore: vi.fn(),
  getCurrentWeeklyPeriod: vi.fn(),
}));

vi.mock("../../services/document-extraction", () => ({
  documentExtractionService: { extract: vi.fn() },
}));

vi.mock("../../replit_integrations/object_storage/objectStorage", () => ({
  objectStorageClient: { upload: vi.fn(), download: vi.fn() },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./product-feedback", () => ({
  PUBLIC_TENANT_RATE_LIMIT_MAX: 100,
}));

vi.mock("./helpers", () => ({
  toContextFilter: vi.fn().mockReturnValue({}),
  validateResourceContext: vi.fn(),
  hasAdminAccess: vi.fn().mockReturnValue(true),
  hasContentAccess: vi.fn().mockReturnValue(true),
  hasCrossTenantReadAccess: vi.fn().mockReturnValue(false),
  logAiUsage: vi.fn(),
  parseManualResearch: vi.fn(),
  switchTenantSchema: vi.fn(),
  switchMarketSchema: vi.fn(),
  createMarketSchema: { parse: vi.fn() },
  updateMarketSchema: { parse: vi.fn() },
  guardManualAction: vi.fn().mockResolvedValue({ allowed: true }),
  guardFeature: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { registerAdminRoutes } from "../admin";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CTX = {
  userId: "user-1",
  tenantId: "tenant-1",
  tenantDomain: "acme.com",
  marketId: "market-a",
};

const DEFAULT_MARKET = {
  id: "market-a",
  tenantId: "tenant-1",
  name: "North America",
  isDefault: true,
  status: "active",
  createdAt: new Date("2026-01-01"),
};

const NON_DEFAULT_MARKET = {
  id: "market-b",
  tenantId: "tenant-1",
  name: "EMEA",
  isDefault: false,
  status: "active",
  createdAt: new Date("2026-01-01"),
};

const PROFILES = [
  { id: "prof-scoped", marketId: "market-a", companyName: "Acme Scoped", websiteUrl: "https://na.acme.com" },
  { id: "prof-legacy", marketId: null, companyName: "Acme Legacy", websiteUrl: "https://acme.com" },
  { id: "prof-other", marketId: "market-z", companyName: "Acme Other Market", websiteUrl: "https://z.acme.com" },
  { id: "prof-emea", marketId: "market-b", companyName: "Acme EMEA", websiteUrl: "https://emea.acme.com" },
];

const COMPETITOR = {
  id: "comp-1",
  name: "Rival Corp",
  url: "https://rival.example.com",
  status: "active",
  analysisData: { summary: "Rival analysis summary", strengths: ["Fast"], weaknesses: ["Pricey"] },
};

const COMPETITOR_SCORE = {
  competitorId: "comp-1",
  overallScore: 82,
  marketPresenceScore: 80,
  innovationScore: 75,
  trendDirection: "up",
  trendDelta: 3,
};

const BATTLECARD = {
  competitorId: "comp-1",
  strengths: ["Big sales team"],
  weaknesses: ["Legacy stack"],
  ourAdvantages: ["Better UX"],
  objections: [{ objection: "Too new", response: "Fast-growing customer base" }],
  talkTracks: [{ scenario: "Pricing", script: "Focus on TCO" }],
};

const PRODUCT = {
  id: "prod-1",
  name: "Orbit Platform",
  companyName: "Acme Corp",
  url: "https://acme.com/orbit",
};

const MARKETING_PLAN = {
  id: "plan-1",
  name: "Q3 Launch Plan",
};

const ASSESSMENT = {
  id: "assess-1",
  name: "Rival Deep Dive",
  isProxy: false,
  status: "completed",
  createdAt: new Date("2026-05-01"),
  description: "Assessment of Rival Corp",
};

const ACTIVITY = [
  {
    id: "act-1",
    type: "website_update",
    competitorName: "Rival Corp",
    summary: "Homepage redesigned",
    createdAt: new Date("2026-08-01"),
  },
];

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: "user-1" };
    next();
  });
  registerAdminRoutes(app);
  return app;
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  contextMock.getRequestContext.mockResolvedValue(CTX);

  storageMock.getMarket.mockResolvedValue(DEFAULT_MARKET);
  storageMock.getCompanyProfilesByTenantDomain.mockResolvedValue(PROFILES);
  storageMock.getCompetitorsByContext.mockResolvedValue([COMPETITOR]);
  storageMock.getClientProjectsByContext.mockResolvedValue([]);
  storageMock.getProductsByContext.mockResolvedValue([PRODUCT]);
  storageMock.getMarketingPlans.mockResolvedValue([MARKETING_PLAN]);
  storageMock.getActivityByContext.mockResolvedValue(ACTIVITY);
  storageMock.getAssessmentsByContext.mockResolvedValue([ASSESSMENT]);
  storageMock.getBattlecardsByContext.mockResolvedValue([BATTLECARD]);
  storageMock.getCompetitorScoresByContext.mockResolvedValue([COMPETITOR_SCORE]);

  // Per-item lookups inside section loops
  storageMock.getExecutiveSummary.mockResolvedValue(null);
  storageMock.getProjectProducts.mockResolvedValue([]);
  storageMock.getLongFormRecommendationsByProject.mockResolvedValue([]);
  storageMock.getProductBattlecardsByProject.mockResolvedValue([]);
  storageMock.getProductFeaturesByProduct.mockResolvedValue([]);
  storageMock.getRoadmapItemsByProduct.mockResolvedValue([]);
  storageMock.getFeatureRecommendationsByProduct.mockResolvedValue([]);
  storageMock.getMarketingTasks.mockResolvedValue([]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/markets/:marketId/export", () => {
  it("returns a downloadable markdown file containing every section", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/markets/market-a/export");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toContain(
      'attachment; filename="North_America_complete_export.md"',
    );

    const md = res.text;

    // Top-level document
    expect(md).toContain("# North America - Complete Market Intelligence Export");
    expect(md).toContain("**Tenant:** acme.com");

    // All major section headings
    expect(md).toContain("## Market Overview");
    expect(md).toContain("## Company Profiles");
    expect(md).toContain("## Competitors");
    expect(md).toContain("## Projects");
    expect(md).toContain("## Products");
    expect(md).toContain("## Marketing Plans");
    expect(md).toContain("## Assessments");
    expect(md).toContain("## Activity Log");

    // Section contents from each of the 9 parallel fetches
    expect(md).toContain("### Acme Scoped"); // company profile (scoped)
    expect(md).toContain("### Rival Corp"); // competitor
    expect(md).toContain("Rival analysis summary"); // competitor analysis
    expect(md).toContain("#### Orbit Score"); // competitor score joined
    expect(md).toContain("**Overall Score:** 82/100");
    expect(md).toContain("#### Battlecard"); // battlecard joined
    expect(md).toContain("Big sales team");
    expect(md).toContain("### Orbit Platform"); // product
    expect(md).toContain("### Q3 Launch Plan"); // marketing plan
    expect(md).toContain("### Rival Deep Dive"); // assessment
    expect(md).toContain("**Rival Corp** - website_update"); // activity
    expect(md).toContain("Homepage redesigned");
  });

  it("includes null-marketId (legacy) profiles for the default market and excludes other markets' profiles", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/markets/market-a/export");

    expect(res.status).toBe(200);
    const md = res.text;

    expect(md).toContain("### Acme Scoped"); // marketId === market-a
    expect(md).toContain("### Acme Legacy"); // marketId === null → included on default market
    expect(md).not.toContain("Acme Other Market"); // different market excluded
    expect(md).not.toContain("Acme EMEA");

    // Summary statistics reflect the filtered count (2 profiles)
    expect(md).toContain("- **Company Profiles:** 2");
  });

  it("excludes null-marketId profiles for a non-default market", async () => {
    storageMock.getMarket.mockResolvedValue(NON_DEFAULT_MARKET);

    const app = buildApp();
    const res = await request(app).get("/api/markets/market-b/export");

    expect(res.status).toBe(200);
    const md = res.text;

    expect(md).toContain("### Acme EMEA"); // marketId === market-b
    expect(md).not.toContain("Acme Legacy"); // null marketId excluded on non-default
    expect(md).not.toContain("Acme Scoped");
    expect(md).not.toContain("Acme Other Market");
    expect(md).toContain("- **Company Profiles:** 1");
  });

  it("fetches all 9 data sources with the correct market-scoped context", async () => {
    const app = buildApp();
    await request(app).get("/api/markets/market-a/export");

    const expectedCtx = {
      tenantId: "tenant-1",
      marketId: "market-a",
      tenantDomain: "acme.com",
      isDefaultMarket: true,
    };

    expect(storageMock.getCompanyProfilesByTenantDomain).toHaveBeenCalledWith("acme.com");
    expect(storageMock.getCompetitorsByContext).toHaveBeenCalledWith(expectedCtx);
    expect(storageMock.getClientProjectsByContext).toHaveBeenCalledWith(expectedCtx);
    expect(storageMock.getProductsByContext).toHaveBeenCalledWith(expectedCtx);
    expect(storageMock.getMarketingPlans).toHaveBeenCalledWith({
      tenantDomain: "acme.com",
      marketId: "market-a",
    });
    expect(storageMock.getActivityByContext).toHaveBeenCalledWith(expectedCtx);
    expect(storageMock.getAssessmentsByContext).toHaveBeenCalledWith(expectedCtx);
    expect(storageMock.getBattlecardsByContext).toHaveBeenCalledWith(expectedCtx);
    expect(storageMock.getCompetitorScoresByContext).toHaveBeenCalledWith(expectedCtx);
  });

  it("returns 404 when the market does not exist", async () => {
    storageMock.getMarket.mockResolvedValue(null);

    const app = buildApp();
    const res = await request(app).get("/api/markets/nope/export");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 403 when the market belongs to a different tenant", async () => {
    storageMock.getMarket.mockResolvedValue({ ...DEFAULT_MARKET, tenantId: "other-tenant" });

    const app = buildApp();
    const res = await request(app).get("/api/markets/market-a/export");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });
});
