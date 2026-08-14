/**
 * Integration tests — GET /api/markets
 *
 * Covers:
 *   - Unauthenticated request → 401
 *   - Authorized user requesting a tenant they can't access → 403
 *   - Valid request → correct response envelope (markets, activeMarketId,
 *     multiMarketEnabled, marketLimit)
 *   - validateMarketBelongsToTenant = false → activeMarketId is null even when
 *     the X-Active-Market-Id header is set
 *   - validateMarketBelongsToTenant = true → activeMarketId echoed back from header
 *
 * All storage I/O and heavy service imports are mocked so the handler runs in
 * isolation without a real database or AI provider.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── Storage mock ──────────────────────────────────────────────────────────────

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getTenantByDomain: vi.fn(),
  getAccessibleTenants: vi.fn(),
  getTenant: vi.fn(),
  getMarketsByTenant: vi.fn(),
  validateMarketBelongsToTenant: vi.fn(),
  getCompanyProfilesByTenantDomain: vi.fn(),
  getServicePlanByName: vi.fn(),
}));

vi.mock("../../storage", () => ({ storage: storageMock }));

// ── DB mock (admin.ts imports db directly for a few one-off queries) ──────────

vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  },
}));

// ── Heavy service mocks (not exercised by /api/markets but imported at top of admin.ts) ──

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

const USER = {
  id: "user-1",
  email: "alice@acme.com",
  role: "admin",
};

const TENANT = {
  id: "tenant-1",
  domain: "acme.com",
  name: "Acme Corp",
  plan: "pro",
};

const MARKET_A = {
  id: "market-a",
  tenantId: "tenant-1",
  name: "North America",
  isDefault: true,
};

const MARKET_B = {
  id: "market-b",
  tenantId: "tenant-1",
  name: "EMEA",
  isDefault: false,
};

const SERVICE_PLAN = {
  name: "pro",
  multiMarketEnabled: true,
  marketLimit: 5,
};

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp(sessionOverrides: Record<string, any> = {}) {
  const app = express();
  app.use(express.json());
  // Inject a fake session so auth checks work.
  app.use((req, _res, next) => {
    (req as any).session = { userId: "user-1", ...sessionOverrides };
    next();
  });
  registerAdminRoutes(app);
  return app;
}

function buildUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {};
    next();
  });
  registerAdminRoutes(app);
  return app;
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default happy-path storage returns
  storageMock.getUser.mockResolvedValue(USER);
  storageMock.getTenantByDomain.mockResolvedValue(TENANT);
  storageMock.getAccessibleTenants.mockResolvedValue([TENANT]);
  storageMock.getTenant.mockResolvedValue(TENANT);
  storageMock.getMarketsByTenant.mockResolvedValue([MARKET_A, MARKET_B]);
  storageMock.validateMarketBelongsToTenant.mockResolvedValue(false);
  storageMock.getCompanyProfilesByTenantDomain.mockResolvedValue([]);
  storageMock.getServicePlanByName.mockResolvedValue(SERVICE_PLAN);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/markets", () => {
  describe("auth", () => {
    it("returns 401 when there is no session userId", async () => {
      const app = buildUnauthApp();
      const res = await request(app).get("/api/markets");

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it("returns 401 when userId is set but storage.getUser returns null", async () => {
      storageMock.getUser.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app).get("/api/markets");

      expect(res.status).toBe(401);
    });
  });

  describe("access control", () => {
    it("returns 403 when the target tenant is not in the user's accessible tenants", async () => {
      // Make the user belong to a different tenant so acme.com is inaccessible
      storageMock.getAccessibleTenants.mockResolvedValue([
        { id: "other-tenant", domain: "other.com", name: "Other" },
      ]);

      const app = buildApp();
      // Explicitly request a tenant the user cannot see via header
      const res = await request(app)
        .get("/api/markets")
        .set("X-Active-Tenant-Id", "tenant-1");

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.any(String) });
    });

    it("returns 403 when userTenant resolves to null and no accessible tenants match", async () => {
      storageMock.getTenantByDomain.mockResolvedValue(null);
      storageMock.getAccessibleTenants.mockResolvedValue([]);

      const app = buildApp();
      // Force a specific tenant id that is not accessible
      const res = await request(app)
        .get("/api/markets")
        .set("X-Active-Tenant-Id", "tenant-1");

      expect(res.status).toBe(403);
    });
  });

  describe("response shape", () => {
    it("returns the correct envelope for a valid request", async () => {
      const app = buildApp();
      const res = await request(app).get("/api/markets");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        markets: expect.any(Array),
        activeMarketId: null,        // no market header → null
        multiMarketEnabled: true,
        marketLimit: 5,
      });
    });

    it("includes all markets enriched with baseline company info", async () => {
      storageMock.getCompanyProfilesByTenantDomain.mockResolvedValue([
        {
          marketId: "market-a",
          companyName: "Acme NA",
          websiteUrl: "https://na.acme.com",
        },
      ]);

      const app = buildApp();
      const res = await request(app).get("/api/markets");

      expect(res.status).toBe(200);

      const marketA = res.body.markets.find((m: any) => m.id === "market-a");
      const marketB = res.body.markets.find((m: any) => m.id === "market-b");

      expect(marketA).toMatchObject({
        id: "market-a",
        baselineCompanyName: "Acme NA",
        baselineCompanyUrl: "https://na.acme.com",
      });
      // MARKET_B has no matching profile
      expect(marketB).toMatchObject({
        id: "market-b",
        baselineCompanyName: null,
        baselineCompanyUrl: null,
      });
    });

    it("falls back to null-marketId profile for the default market when no market-scoped profile exists", async () => {
      storageMock.getCompanyProfilesByTenantDomain.mockResolvedValue([
        {
          marketId: null,   // legacy default profile
          companyName: "Acme Legacy",
          websiteUrl: "https://acme.com",
        },
      ]);

      const app = buildApp();
      const res = await request(app).get("/api/markets");

      expect(res.status).toBe(200);

      const marketA = res.body.markets.find((m: any) => m.id === "market-a");
      // MARKET_A is isDefault=true, so the null-marketId profile should apply
      expect(marketA.baselineCompanyName).toBe("Acme Legacy");

      const marketB = res.body.markets.find((m: any) => m.id === "market-b");
      // MARKET_B is not isDefault, so no fallback
      expect(marketB.baselineCompanyName).toBeNull();
    });

    it("returns multiMarketEnabled: false and marketLimit: null when no service plan exists", async () => {
      storageMock.getServicePlanByName.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app).get("/api/markets");

      expect(res.status).toBe(200);
      expect(res.body.multiMarketEnabled).toBe(false);
      expect(res.body.marketLimit).toBeNull();
    });
  });

  describe("validateMarketBelongsToTenant gates activeMarketId", () => {
    it("returns activeMarketId: null when the header market does not belong to the tenant", async () => {
      // validateMarketBelongsToTenant returns false → stale/cross-tenant id
      storageMock.validateMarketBelongsToTenant.mockResolvedValue(false);

      const app = buildApp();
      const res = await request(app)
        .get("/api/markets")
        .set("X-Active-Market-Id", "market-a");

      expect(res.status).toBe(200);
      expect(res.body.activeMarketId).toBeNull();
      expect(storageMock.validateMarketBelongsToTenant).toHaveBeenCalledWith(
        "market-a",
        "tenant-1",
      );
    });

    it("echoes activeMarketId when validateMarketBelongsToTenant returns true", async () => {
      storageMock.validateMarketBelongsToTenant.mockResolvedValue(true);

      const app = buildApp();
      const res = await request(app)
        .get("/api/markets")
        .set("X-Active-Market-Id", "market-a");

      expect(res.status).toBe(200);
      expect(res.body.activeMarketId).toBe("market-a");
    });

    it("skips validateMarketBelongsToTenant and returns null when no market header is present", async () => {
      const app = buildApp();
      const res = await request(app).get("/api/markets");

      expect(res.status).toBe(200);
      expect(res.body.activeMarketId).toBeNull();
      // Should not have been called — Promise.resolve(false) branch
      expect(storageMock.validateMarketBelongsToTenant).not.toHaveBeenCalled();
    });
  });

  describe("parallel fetch correctness", () => {
    it("calls the round-2 fetches in parallel (both called with correct args)", async () => {
      const app = buildApp();
      await request(app).get("/api/markets");

      // Both parallel calls from round-trip 2 must have been made
      expect(storageMock.getTenantByDomain).toHaveBeenCalledWith("acme.com");
      expect(storageMock.getAccessibleTenants).toHaveBeenCalledWith(
        "user-1",
        "admin",
        "acme.com",
      );
    });

    it("calls the round-3 fetches in parallel (tenant, markets, validate)", async () => {
      storageMock.validateMarketBelongsToTenant.mockResolvedValue(true);

      const app = buildApp();
      await request(app)
        .get("/api/markets")
        .set("X-Active-Market-Id", "market-a");

      expect(storageMock.getTenant).toHaveBeenCalledWith("tenant-1");
      expect(storageMock.getMarketsByTenant).toHaveBeenCalledWith("tenant-1");
      expect(storageMock.validateMarketBelongsToTenant).toHaveBeenCalledWith(
        "market-a",
        "tenant-1",
      );
    });

    it("calls the round-4 fetches in parallel (profiles and service plan)", async () => {
      const app = buildApp();
      await request(app).get("/api/markets");

      expect(storageMock.getCompanyProfilesByTenantDomain).toHaveBeenCalledWith(
        TENANT.domain,
      );
      expect(storageMock.getServicePlanByName).toHaveBeenCalledWith(TENANT.plan);
    });
  });
});
