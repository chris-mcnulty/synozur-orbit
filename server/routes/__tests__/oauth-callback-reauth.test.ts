/**
 * Route integration test: OAuth callback clears lastPublishError.
 *
 * Verifies that a successful POST /api/social-accounts/oauth/callback
 * issues a DB update that includes `lastPublishError: null`, regardless of
 * what the account's current lastPublishError value is.
 *
 * All external I/O (DB, social publisher) is mocked. The test seeds the
 * in-memory oauthStates Map directly via the package-internal export so we
 * can exercise the callback handler without performing a real OAuth connect.
 */

import { describe, it, vi, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Shared mutable mock state ─────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  /** Queue of result arrays for sequential db.select() calls */
  selectQueue: [] as any[][],
  /** Captured payloads passed to db.update().set() */
  updateSets: [] as any[],
  /** Captured values passed to db.insert().values() */
  insertValues: [] as any[],
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("../../db", () => {
  function mkChain(): any {
    return {
      from: () => mkChain(),
      where: (_cond: any) => Promise.resolve(mockState.selectQueue.shift() ?? []),
      set: (payload: any) => {
        mockState.updateSets.push(payload);
        return { where: (_cond: any) => Promise.resolve([]) };
      },
      values: (v: any) => {
        mockState.insertValues.push(v);
        return { onConflictDoNothing: () => Promise.resolve([]) };
      },
      leftJoin: () => mkChain(),
      limit: () => Promise.resolve(mockState.selectQueue.shift() ?? []),
    };
  }
  return {
    db: {
      select: (_fields?: any) => mkChain(),
      update: (_table: any) => mkChain(),
      insert: (_table: any) => mkChain(),
      delete: () => ({ where: () => Promise.resolve([]) }),
    },
  };
});

// ── Context mock ──────────────────────────────────────────────────────────────

vi.mock("../../context", () => ({
  getRequestContext: vi.fn().mockResolvedValue({
    tenantDomain: "tenant.example.com",
    userId: "user-1",
  }),
}));

// ── Feature-gate mock (always allowed) ───────────────────────────────────────

vi.mock("../../services/plan-policy", () => ({
  checkFeatureAccessAsync: vi.fn().mockResolvedValue({ allowed: true }),
}));

// ── Encryption mock ───────────────────────────────────────────────────────────

vi.mock("../../utils/encryption", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
}));

// ── Social publisher mock ─────────────────────────────────────────────────────

vi.mock("../../services/social-publishers", () => ({
  getPublisher: vi.fn(() => ({
    getOAuthAuthorizeUrl: vi.fn().mockResolvedValue("https://linkedin.com/oauth"),
    exchangeOAuthCode: vi.fn().mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: new Date(Date.now() + 3_600_000),
      scope: "r_liteprofile w_member_social",
      authorUrn: "urn:li:person:abc123",
      authorMode: "person",
      availableAuthors: [],
      accountId: "li-account-id",
      accountName: "Test User",
      profileUrl: "https://linkedin.com/in/test-user",
    }),
  })),
}));

// ── Storage mock ──────────────────────────────────────────────────────────────

vi.mock("../../storage", () => ({
  storage: { getTenantByDomain: vi.fn().mockResolvedValue({ plan: "pro" }) },
}));

// ── Misc service mocks (not relevant to the tested behaviour) ─────────────────

vi.mock("../../services/marketing-publish-worker", () => ({
  publishPostNow: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../services/email-campaign-sender", () => ({
  dispatchEmailSend: vi.fn(),
  previewListDeliverability: vi.fn(),
  verifyUnsubscribeToken: vi.fn().mockReturnValue(null),
  verifySendGridWebhook: vi.fn().mockReturnValue({ ok: true }),
  CURATED_EMAIL_FONTS: [],
  buildFontStack: vi.fn(() => "Arial,Helvetica,sans-serif"),
  buildFontHeadCss: vi.fn(() => ""),
  enforceMinimumFontSize: vi.fn((html: string) => html),
  normalizeFontFamily: vi.fn((html: string) => html),
  wrapResponsiveDocument: vi.fn((html: string) => html),
  prepareEmailImages: vi.fn(async (html: string) => html),
  hardenCtaButtons: vi.fn((html: string) => html),
}));
vi.mock("../../services/hubspot-timeline", () => ({
  pushEmailTimelineEvent: vi.fn(),
}));
vi.mock("../../services/hubspot-email-sync-core", () => ({
  timelineEventId: vi.fn().mockReturnValue("evt-id"),
}));
vi.mock("../../services/hubspot-email-sync", () => ({
  pushUnsubscribe: vi.fn(),
  pushSubscribe: vi.fn(),
}));

// ── Imports (after vi.mock) ───────────────────────────────────────────────────

import {
  registerMarketingDeliveryPublicRoutes,
  registerMarketingDeliveryRoutes,
  _oauthStates,
} from "../marketing-delivery";

// ── Test app factory ──────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  // Inject a fake session so guardFeature is satisfied.
  app.use((req, _res, next) => {
    (req as any).session = { userId: "user-1" };
    next();
  });
  registerMarketingDeliveryPublicRoutes(app);
  registerMarketingDeliveryRoutes(app);
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedOAuthState(state: string, accountId = "acct-1") {
  _oauthStates.set(state, {
    tenantDomain: "tenant.example.com",
    userId: "user-1",
    socialAccountId: accountId,
    expiresAt: Date.now() + 60_000,
    redirectUri: "https://host/api/social-accounts/oauth/callback",
  });
}

function makeAccountRow(overrides: Partial<{ lastPublishError: string | null }> = {}) {
  return {
    id: "acct-1",
    tenantDomain: "tenant.example.com",
    platform: "linkedin",
    status: "active",
    accountName: "Test User",
    accountId: null,
    profileUrl: null,
    lastPublishError: "needs_reauth",
    ...overrides,
  };
}

beforeEach(() => {
  mockState.selectQueue.length = 0;
  mockState.updateSets.length = 0;
  mockState.insertValues.length = 0;
  _oauthStates.clear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("OAuth callback — clears lastPublishError on successful token exchange", () => {
  it("includes lastPublishError: null in the DB update when exchange succeeds", async () => {
    const app = buildApp();
    const STATE = "test-state-abc";

    // Seed the in-memory oauth state as if connect was called.
    seedOAuthState(STATE, "acct-1");

    // DB select returns the account row (currently marked needs_reauth).
    mockState.selectQueue.push([makeAccountRow({ lastPublishError: "needs_reauth" })]);

    const res = await request(app)
      .get("/api/social-accounts/oauth/callback")
      .query({ state: STATE, code: "auth-code-from-linkedin" });

    // The callback serves an HTML success page.
    expect(res.status).toBe(200);
    expect(res.text).toContain("Connected");

    // The critical assertion: the DB update must clear lastPublishError.
    const tokenUpdate = mockState.updateSets.find(
      (s) => "lastPublishError" in s && s.lastPublishError === null,
    );
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate.lastPublishError).toBeNull();
    expect(tokenUpdate.status).toBe("active");
  });

  it("clears lastPublishError even when the account had no prior error", async () => {
    const app = buildApp();
    const STATE = "test-state-xyz";

    seedOAuthState(STATE, "acct-1");
    mockState.selectQueue.push([makeAccountRow({ lastPublishError: null })]);

    const res = await request(app)
      .get("/api/social-accounts/oauth/callback")
      .query({ state: STATE, code: "auth-code-fresh" });

    expect(res.status).toBe(200);

    const tokenUpdate = mockState.updateSets.find(
      (s) => "lastPublishError" in s,
    );
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate.lastPublishError).toBeNull();
  });

  it("returns 400 when the OAuth state is missing or expired", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/api/social-accounts/oauth/callback")
      .query({ state: "no-such-state", code: "code" });

    expect(res.status).toBe(400);
    // No DB update should have been attempted.
    expect(mockState.updateSets.length).toBe(0);
  });
});
