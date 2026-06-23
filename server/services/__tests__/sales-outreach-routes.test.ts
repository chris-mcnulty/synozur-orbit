/**
 * Integration tests for the main sales-outreach API routes.
 *
 * Spins up a real Express app with all I/O dependencies mocked so the tests
 * run in-process without a database or network. Covers the three high-risk
 * flows called out in the task: create campaign, approve touch, and update
 * prospect state (mark-replied).
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── DB mock (queue-based chainable proxy) ─────────────────────────────────────
//
// vi.hoisted runs BEFORE vi.mock so the objects it returns are usable inside
// mock factories (which are also hoisted).

const { dbQ, makeMockDb } = vi.hoisted(() => {
  const dbQ: any[][] = [];

  function terminal(): any {
    const val = dbQ.shift() ?? [];
    return {
      // Thenable — so `await chain.where(...)` resolves to val
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject),
      finally: (cb: any) => Promise.resolve(val).finally(cb),
      // Chainable — returning/orderBy return the SAME val already popped,
      // not a fresh pop, so update().set().where().returning() works correctly.
      returning: () => Promise.resolve(val),
      orderBy: () => Promise.resolve(val),
    };
  }

  function mkChain(): any {
    return {
      from: () => mkChain(),
      where: terminal,
      set: () => mkChain(),
      values: terminal,
      orderBy: () => Promise.resolve(dbQ.shift() ?? []),
      returning: () => Promise.resolve(dbQ.shift() ?? []),
      onConflictDoUpdate: () => ({ returning: () => Promise.resolve(dbQ.shift() ?? []) }),
    };
  }

  function makeMockDb() {
    return {
      select: mkChain,
      insert: mkChain,
      update: mkChain,
      delete: () => ({ where: () => Promise.resolve([]) }),
    };
  }

  return { dbQ, makeMockDb };
});

// ── Mock all I/O modules used by the route file ───────────────────────────────

vi.mock("../../db", () => ({ db: makeMockDb() }));

vi.mock("../../context", () => ({
  getRequestContext: vi.fn(),
  ContextError: class ContextError extends Error {
    status: number;
    constructor(msg: string, status = 403) { super(msg); this.status = status; }
  },
}));

vi.mock("../../routes/helpers", () => ({
  guardFeature: vi.fn().mockResolvedValue(true),
  guardManualAction: vi.fn().mockResolvedValue(true),
  logAiUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../storage", () => ({
  storage: {
    getTenantByDomain: vi.fn().mockResolvedValue({ plan: "enterprise" }),
    getHubspotConnection: vi.fn().mockResolvedValue(null),
    getUser: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../outreach-interview-service", () => ({
  createCampaignFromInterview: vi.fn(),
  getCampaign: vi.fn(),
}));

vi.mock("../outbound-voice-service", () => ({
  getPersonalVoiceProfile: vi.fn().mockResolvedValue(null),
  extractOutboundVoice: vi.fn(),
  VoiceExtractError: class VoiceExtractError extends Error {
    code: string;
    constructor(msg: string, code: string) { super(msg); this.code = code; }
  },
}));

vi.mock("../cadence-service", () => ({
  assertApprovalAllowed: vi.fn().mockResolvedValue({ allowed: true }),
  getOutreachSummary: vi.fn().mockResolvedValue({}),
  tickCadence: vi.fn().mockResolvedValue({}),
  detectMailboxActivity: vi.fn().mockResolvedValue({ touchesConfirmedSent: 0, repliesDetected: 0 }),
}));

vi.mock("../outlook-draft-service", () => ({
  createOutlookDraft: vi.fn(),
  OutlookDraftError: class OutlookDraftError extends Error {
    code: string;
    constructor(msg: string, code: string) { super(msg); this.code = code; }
  },
}));

vi.mock("../linkedin-provider", () => ({
  getLinkedInCapabilities: vi.fn().mockReturnValue({ canMessage: false, reason: "Not configured" }),
  sendLinkedInMessage: vi.fn(),
}));

vi.mock("../outreach-composer-service", () => ({
  composeTouch: vi.fn(),
  loadComplianceContext: vi.fn().mockResolvedValue({ suppressedEmails: [], ownDomains: [], forbidden: [] }),
}));

vi.mock("../compliance-core", () => ({
  scanCompliance: vi.fn().mockReturnValue({ pass: true, flags: [], suggestedFixes: [] }),
}));

vi.mock("../sales-outreach-readiness", () => ({
  assessSalesOutreachReadiness: vi.fn().mockResolvedValue({}),
}));

vi.mock("../prospector-service", () => ({
  researchProspect: vi.fn(),
}));

vi.mock("../prospect-enrich-service", () => ({
  enrichProspectContact: vi.fn(),
  EnrichError: class EnrichError extends Error {
    code: string;
    constructor(msg: string, code: string) { super(msg); this.code = code; }
  },
}));

vi.mock("../discovery-service", () => ({
  discoverProspects: vi.fn(),
  importDiscoveredProspects: vi.fn(),
  getDiscoveryBackends: vi.fn().mockReturnValue([]),
}));

vi.mock("../planner-graph-client", () => ({
  buildPlannerConsentUrl: vi.fn().mockReturnValue(null),
  MAIL_SCOPES: ["Mail.ReadWrite"],
}));

vi.mock("../../routes/planner", () => ({
  getRedirectUri: vi.fn().mockReturnValue("https://localhost/callback"),
}));

vi.mock("../hubspot-integration", () => ({
  listContacts: vi.fn().mockResolvedValue([]),
  upsertContact: vi.fn().mockResolvedValue("hs-1"),
  logContactNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../outreach-performance-service", () => ({
  getCampaignPerformance: vi.fn(),
}));

vi.mock("../manual-action-quota", () => ({
  reserveManualAction: vi.fn().mockResolvedValue({ ok: false }),
}));

// ── Import under test AFTER all mocks are wired ───────────────────────────────

import { registerSalesOutreachRoutes } from "../../routes/sales-outreach";
import { getRequestContext } from "../../context";
import { guardFeature, guardManualAction } from "../../routes/helpers";
import { createCampaignFromInterview, getCampaign } from "../outreach-interview-service";
import { assertApprovalAllowed, tickCadence, detectMailboxActivity } from "../cadence-service";
import { createOutlookDraft } from "../outlook-draft-service";
import { getLinkedInCapabilities } from "../linkedin-provider";
import { composeTouch } from "../outreach-composer-service";
import { discoverProspects, importDiscoveredProspects } from "../discovery-service";
import { enrichProspectContact, EnrichError } from "../prospect-enrich-service";

// ── Shared test context ───────────────────────────────────────────────────────

const TEST_CTX = {
  userId: "user-1",
  tenantId: "tenant-1",
  marketId: "market-1",
  userRole: "Domain Admin",
  tenantDomain: "acme.com",
  isDefaultMarket: true,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  registerSalesOutreachRoutes(app);
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pushDb(...rows: any[]) {
  dbQ.push(rows);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sales-outreach routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    dbQ.length = 0;
    vi.mocked(getRequestContext).mockResolvedValue(TEST_CTX as any);
    vi.mocked(guardFeature).mockResolvedValue(true);
    app = buildApp();
  });

  // ── POST /api/sales-outreach/campaigns ──────────────────────────────────────

  describe("POST /api/sales-outreach/campaigns", () => {
    const CAMPAIGN = {
      id: "camp-1",
      tenantDomain: "acme.com",
      name: "Q3 PE Outreach",
      goalType: "meeting",
      status: "active",
      createdBy: "user-1",
    };

    it("creates a campaign and returns 201", async () => {
      vi.mocked(createCampaignFromInterview).mockResolvedValue(CAMPAIGN as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns")
        .send({ name: "Q3 PE Outreach", answers: { goal: "book 10 discovery calls" } });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: "camp-1", name: "Q3 PE Outreach" });
      expect(createCampaignFromInterview).toHaveBeenCalledWith(
        expect.objectContaining({ tenantDomain: "acme.com", name: "Q3 PE Outreach" }),
      );
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app)
        .post("/api/sales-outreach/campaigns")
        .send({ answers: {} });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/name/i) });
      expect(createCampaignFromInterview).not.toHaveBeenCalled();
    });

    it("returns 400 when name is blank", async () => {
      const res = await request(app)
        .post("/api/sales-outreach/campaigns")
        .send({ name: "   ", answers: {} });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/name/i) });
    });

    it("returns 403 when the feature is gated", async () => {
      // The real guardFeature sends a response AND returns false, so the mock
      // must do the same — otherwise the route never responds and the test hangs.
      vi.mocked(guardFeature).mockImplementation(async (_req, res, _feature) => {
        res.status(403).json({ error: "Feature not available on your plan." });
        return false;
      });

      const res = await request(app)
        .post("/api/sales-outreach/campaigns")
        .send({ name: "My Campaign" });

      expect(res.status).toBe(403);
      expect(createCampaignFromInterview).not.toHaveBeenCalled();
    });
  });

  // ── POST /api/sales-outreach/touches/:id/approve ────────────────────────────

  describe("POST /api/sales-outreach/touches/:id/approve", () => {
    const TOUCH = {
      id: "touch-1",
      tenantDomain: "acme.com",
      prospectId: "prospect-1",
      channel: "email",
      stepNumber: 1,
      status: "draft_pending_approval",
      subject: "Quick question",
      body: "Hi Jane — worth a call?",
      complianceFlags: null,
      voiceProfileId: null,
      outlookDraftId: null,
      linkedinThreadRef: null,
    };

    const PROSPECT = {
      id: "prospect-1",
      tenantDomain: "acme.com",
      campaignId: "camp-1",
      name: "Jane Doe",
      email: "jane@fund.com",
      linkedinUrl: null,
      status: "draft_pending_approval",
      hubspotContactId: null,
    };

    const UPDATED_TOUCH = {
      ...TOUCH,
      status: "approved",
      outlookDraftId: "draft-1",
    };

    it("approves an email touch and returns 200 with the outlook webLink", async () => {
      // select touch → [TOUCH]
      pushDb(TOUCH);
      // select prospect → [PROSPECT]
      pushDb(PROSPECT);
      // update touch → [UPDATED_TOUCH]
      pushDb(UPDATED_TOUCH);
      // update prospect → [] (no returning)
      pushDb();
      // insert send ledger → [] (terminal after values)
      pushDb();

      vi.mocked(assertApprovalAllowed).mockResolvedValue({ allowed: true } as any);
      vi.mocked(createOutlookDraft).mockResolvedValue({
        draftId: "draft-1",
        webLink: "https://outlook.office.com/drafts/draft-1",
      } as any);

      const res = await request(app).post("/api/sales-outreach/touches/touch-1/approve");

      expect(res.status).toBe(200);
      expect(res.body.touch).toMatchObject({ status: "approved" });
      expect(res.body.webLink).toBe("https://outlook.office.com/drafts/draft-1");
      expect(createOutlookDraft).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Quick question", body: "Hi Jane — worth a call?" }),
      );
    });

    it("returns 404 when the touch does not exist", async () => {
      // select touch → [] (not found)
      pushDb();

      const res = await request(app).post("/api/sales-outreach/touches/nonexistent/approve");

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/not found/i) });
    });

    it("returns 409 when the touch is not pending approval", async () => {
      pushDb({ ...TOUCH, status: "approved" });

      const res = await request(app).post("/api/sales-outreach/touches/touch-1/approve");

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/not pending/i) });
    });

    it("returns 422 when compliance has hard blockers", async () => {
      const touchWithBlocker = {
        ...TOUCH,
        complianceFlags: {
          pass: false,
          flags: [{ kind: "suppression", detail: "Recipient is suppressed" }],
        },
      };
      pushDb(touchWithBlocker);

      const res = await request(app).post("/api/sales-outreach/touches/touch-1/approve");

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/compliance/i) });
      expect(createOutlookDraft).not.toHaveBeenCalled();
    });

    it("returns 423 when the send cap is reached", async () => {
      pushDb(TOUCH);
      pushDb(PROSPECT);

      vi.mocked(assertApprovalAllowed).mockResolvedValue({
        allowed: false,
        reason: "Master daily cap of 100 reached",
      } as any);

      const res = await request(app).post("/api/sales-outreach/touches/touch-1/approve");

      expect(res.status).toBe(423);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/cap/i), code: "cap_reached" });
    });
  });

  // ── POST /api/sales-outreach/prospects/:id/mark-replied ────────────────────

  describe("POST /api/sales-outreach/prospects/:id/mark-replied", () => {
    const PROSPECT = {
      id: "prospect-1",
      tenantDomain: "acme.com",
      campaignId: "camp-1",
      name: "Jane Doe",
      email: "jane@fund.com",
      status: "awaiting_reply",
    };

    const UPDATED_PROSPECT = { ...PROSPECT, status: "replied", nextActionAt: null };

    it("marks the prospect as replied and returns 200", async () => {
      // select prospect → [PROSPECT]
      pushDb(PROSPECT);
      // update prospect → [UPDATED_PROSPECT]
      pushDb(UPDATED_PROSPECT);

      const res = await request(app).post("/api/sales-outreach/prospects/prospect-1/mark-replied");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: "prospect-1", status: "replied" });
    });

    it("returns 404 when the prospect does not exist", async () => {
      // select → [] (not found)
      pushDb();

      const res = await request(app).post("/api/sales-outreach/prospects/nonexistent/mark-replied");

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/not found/i) });
    });

    it("returns 404 when the prospect belongs to a different tenant", async () => {
      // select returns a prospect from a different tenant
      pushDb({ ...PROSPECT, tenantDomain: "other.com" });

      const res = await request(app).post("/api/sales-outreach/prospects/prospect-1/mark-replied");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/sales-outreach/campaigns/:id/prospects ───────────────────────

  describe("POST /api/sales-outreach/campaigns/:id/prospects", () => {
    const CAMPAIGN = {
      id: "camp-1",
      tenantDomain: "acme.com",
      name: "Q3 PE Outreach",
    };

    const NEW_PROSPECT = {
      id: "prospect-new",
      tenantDomain: "acme.com",
      campaignId: "camp-1",
      name: "Bob Smith",
      email: "bob@partner.com",
      status: "new",
    };

    it("adds a prospect to a campaign and returns 201", async () => {
      vi.mocked(getCampaign).mockResolvedValue(CAMPAIGN as any);
      // insert prospect → [NEW_PROSPECT]
      pushDb(NEW_PROSPECT);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/camp-1/prospects")
        .send({ name: "Bob Smith", email: "bob@partner.com" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: "Bob Smith", status: "new" });
    });

    it("returns 400 when prospect name is missing", async () => {
      vi.mocked(getCampaign).mockResolvedValue(CAMPAIGN as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/camp-1/prospects")
        .send({ email: "bob@partner.com" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/name/i) });
    });

    it("returns 404 when the campaign does not exist", async () => {
      vi.mocked(getCampaign).mockResolvedValue(undefined as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/nonexistent/prospects")
        .send({ name: "Bob Smith" });

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/sales-outreach/prospects/:id/compose ──────────────────────────

  describe("POST /api/sales-outreach/prospects/:id/compose", () => {
    const PROSPECT = {
      id: "prospect-1",
      tenantDomain: "acme.com",
      campaignId: "camp-1",
      name: "Jane Doe",
      email: "jane@fund.com",
      linkedinUrl: null,
      status: "new",
    };

    const COMPOSE_RESULT = {
      id: "touch-1",
      prospectId: "prospect-1",
      channel: "email",
      stepNumber: 1,
      subject: "Quick intro",
      body: "Hi Jane, ...",
      provider: "openai",
      model: "gpt-4o",
      usage: { inputTokens: 200, outputTokens: 80 },
    };

    it("composes a touch and returns 201", async () => {
      vi.mocked(guardManualAction).mockResolvedValue(true);
      // select prospect → [PROSPECT]
      pushDb(PROSPECT);
      vi.mocked(composeTouch).mockResolvedValue(COMPOSE_RESULT as any);

      const res = await request(app)
        .post("/api/sales-outreach/prospects/prospect-1/compose")
        .send({ channel: "email", stepNumber: 1 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ subject: "Quick intro", channel: "email" });
      expect(composeTouch).toHaveBeenCalledWith(
        "acme.com",
        "prospect-1",
        expect.objectContaining({ channel: "email", stepNumber: 1 }),
      );
    });

    it("returns 404 when the prospect does not exist", async () => {
      vi.mocked(guardManualAction).mockResolvedValue(true);
      // select → [] (not found)
      pushDb();

      const res = await request(app)
        .post("/api/sales-outreach/prospects/nonexistent/compose")
        .send({ channel: "email" });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/not found/i) });
      expect(composeTouch).not.toHaveBeenCalled();
    });

    it("returns 404 when the prospect belongs to a different tenant", async () => {
      vi.mocked(guardManualAction).mockResolvedValue(true);
      pushDb({ ...PROSPECT, tenantDomain: "other.com" });

      const res = await request(app)
        .post("/api/sales-outreach/prospects/prospect-1/compose")
        .send({ channel: "email" });

      expect(res.status).toBe(404);
      expect(composeTouch).not.toHaveBeenCalled();
    });

    it("returns 403 when the feature is gated", async () => {
      vi.mocked(guardFeature).mockImplementation(async (_req, res, _feature) => {
        res.status(403).json({ error: "Feature not available on your plan." });
        return false;
      });

      const res = await request(app)
        .post("/api/sales-outreach/prospects/prospect-1/compose")
        .send({ channel: "email" });

      expect(res.status).toBe(403);
      expect(composeTouch).not.toHaveBeenCalled();
    });
  });

  // ── POST /api/sales-outreach/campaigns/:id/discover ─────────────────────────

  describe("POST /api/sales-outreach/campaigns/:id/discover", () => {
    const CAMPAIGN = {
      id: "camp-1",
      tenantDomain: "acme.com",
      name: "Q3 PE Outreach",
    };

    const DISCOVER_RESULT = {
      candidates: [
        { name: "Alice Chen", title: "CFO", companyName: "Apex Capital", email: null, linkedinUrl: null },
      ],
      provider: "openai",
      model: "gpt-4o",
      usage: { inputTokens: 300, outputTokens: 150 },
      searchCount: 4,
      backend: "web",
    };

    it("runs discovery and returns the candidate list", async () => {
      vi.mocked(getCampaign).mockResolvedValue(CAMPAIGN as any);
      vi.mocked(guardManualAction).mockResolvedValue(true);
      vi.mocked(discoverProspects).mockResolvedValue(DISCOVER_RESULT as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/camp-1/discover")
        .send({ limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(1);
      expect(discoverProspects).toHaveBeenCalledWith(
        "acme.com",
        "camp-1",
        expect.objectContaining({ limit: 10 }),
      );
    });

    it("returns 404 when the campaign does not exist", async () => {
      vi.mocked(getCampaign).mockResolvedValue(undefined as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/nonexistent/discover")
        .send({});

      expect(res.status).toBe(404);
      expect(discoverProspects).not.toHaveBeenCalled();
    });

    it("returns 403 when the feature is gated", async () => {
      vi.mocked(guardFeature).mockImplementation(async (_req, res, _feature) => {
        res.status(403).json({ error: "Feature not available on your plan." });
        return false;
      });

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/camp-1/discover")
        .send({});

      expect(res.status).toBe(403);
      expect(discoverProspects).not.toHaveBeenCalled();
    });
  });

  // ── POST /api/sales-outreach/campaigns/:id/discover/import ──────────────────

  describe("POST /api/sales-outreach/campaigns/:id/discover/import", () => {
    const CAMPAIGN = {
      id: "camp-1",
      tenantDomain: "acme.com",
      name: "Q3 PE Outreach",
    };

    const CANDIDATES = [
      { name: "Alice Chen", title: "CFO", companyName: "Apex Capital", email: "alice@apex.com", linkedinUrl: null },
      { name: "Bob Ng", title: "Partner", companyName: "Beta Fund", email: null, linkedinUrl: "https://linkedin.com/in/bobng" },
    ];

    const IMPORT_RESULT = {
      imported: [
        { id: "p-1", name: "Alice Chen", status: "new" },
        { id: "p-2", name: "Bob Ng", status: "new" },
      ],
      skipped: 0,
    };

    it("imports candidates and returns 201 with counts", async () => {
      vi.mocked(getCampaign).mockResolvedValue(CAMPAIGN as any);
      vi.mocked(importDiscoveredProspects).mockResolvedValue(IMPORT_RESULT as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/camp-1/discover/import")
        .send({ candidates: CANDIDATES });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ imported: 2, skipped: 0 });
      expect(importDiscoveredProspects).toHaveBeenCalledWith(
        "acme.com",
        "camp-1",
        expect.arrayContaining([expect.objectContaining({ name: "Alice Chen" })]),
        expect.objectContaining({ ownerUserId: "user-1" }),
      );
    });

    it("returns 400 when no candidates are provided", async () => {
      vi.mocked(getCampaign).mockResolvedValue(CAMPAIGN as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/camp-1/discover/import")
        .send({ candidates: [] });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/no candidates/i) });
      expect(importDiscoveredProspects).not.toHaveBeenCalled();
    });

    it("returns 400 when candidates field is missing", async () => {
      vi.mocked(getCampaign).mockResolvedValue(CAMPAIGN as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/camp-1/discover/import")
        .send({});

      expect(res.status).toBe(400);
      expect(importDiscoveredProspects).not.toHaveBeenCalled();
    });

    it("returns 404 when the campaign does not exist", async () => {
      vi.mocked(getCampaign).mockResolvedValue(undefined as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/nonexistent/discover/import")
        .send({ candidates: CANDIDATES });

      expect(res.status).toBe(404);
      expect(importDiscoveredProspects).not.toHaveBeenCalled();
    });

    it("strips candidates whose names are blank", async () => {
      vi.mocked(getCampaign).mockResolvedValue(CAMPAIGN as any);
      vi.mocked(importDiscoveredProspects).mockResolvedValue({ imported: [], skipped: 0 } as any);

      const res = await request(app)
        .post("/api/sales-outreach/campaigns/camp-1/discover/import")
        .send({ candidates: [{ name: "   ", email: "x@x.com" }] });

      // All candidates filtered out → 400
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/no valid candidates/i) });
    });
  });

  // ── POST /api/sales-outreach/prospects/:id/enrich ───────────────────────────

  describe("POST /api/sales-outreach/prospects/:id/enrich", () => {
    const PROSPECT = {
      id: "prospect-1",
      tenantDomain: "acme.com",
      campaignId: "camp-1",
      name: "Jane Doe",
      email: null,
      linkedinUrl: null,
      status: "new",
    };

    const ENRICH_RESULT = {
      prospect: { ...PROSPECT, email: "jane@fund.com" },
      found: { email: true, linkedinUrl: false },
      sources: ["apollo"],
      notes: null,
      provider: null,
      model: null,
    };

    it("enriches a prospect's contact details and returns 200", async () => {
      vi.mocked(guardManualAction).mockResolvedValue(true);
      // select prospect → [PROSPECT]
      pushDb(PROSPECT);
      vi.mocked(enrichProspectContact).mockResolvedValue(ENRICH_RESULT as any);

      const res = await request(app).post("/api/sales-outreach/prospects/prospect-1/enrich");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ found: { email: true } });
      expect(enrichProspectContact).toHaveBeenCalledWith("acme.com", "prospect-1");
    });

    it("returns 404 when the prospect does not exist", async () => {
      vi.mocked(guardManualAction).mockResolvedValue(true);
      // select → [] (not found)
      pushDb();

      const res = await request(app).post("/api/sales-outreach/prospects/nonexistent/enrich");

      expect(res.status).toBe(404);
      expect(enrichProspectContact).not.toHaveBeenCalled();
    });

    it("returns 404 when the prospect belongs to a different tenant", async () => {
      vi.mocked(guardManualAction).mockResolvedValue(true);
      pushDb({ ...PROSPECT, tenantDomain: "other.com" });

      const res = await request(app).post("/api/sales-outreach/prospects/prospect-1/enrich");

      expect(res.status).toBe(404);
      expect(enrichProspectContact).not.toHaveBeenCalled();
    });

    it("returns 409 when both email and linkedinUrl are already present", async () => {
      vi.mocked(guardManualAction).mockResolvedValue(true);
      pushDb({ ...PROSPECT, email: "jane@fund.com", linkedinUrl: "https://linkedin.com/in/jane" });

      const res = await request(app).post("/api/sales-outreach/prospects/prospect-1/enrich");

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "nothing_missing" });
      expect(enrichProspectContact).not.toHaveBeenCalled();
    });

    it("returns 503 when the enrichment source is unavailable", async () => {
      vi.mocked(guardManualAction).mockResolvedValue(true);
      pushDb(PROSPECT);
      vi.mocked(enrichProspectContact).mockRejectedValue(
        new (EnrichError as any)("Apollo is not configured", "source_unavailable"),
      );

      const res = await request(app).post("/api/sales-outreach/prospects/prospect-1/enrich");

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: "source_unavailable" });
    });
  });

  // ── POST /api/sales-outreach/cadence/tick ───────────────────────────────────

  describe("POST /api/sales-outreach/cadence/tick", () => {
    it("runs the cadence tick and returns the merged result", async () => {
      vi.mocked(tickCadence).mockResolvedValue({
        advanced: 3,
        paused: 1,
        errors: 0,
      } as any);
      vi.mocked(detectMailboxActivity).mockResolvedValue({
        touchesConfirmedSent: 2,
        repliesDetected: 1,
      } as any);

      const res = await request(app).post("/api/sales-outreach/cadence/tick");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        advanced: 3,
        paused: 1,
        touchesConfirmedSent: 2,
        repliesDetected: 1,
      });
      expect(tickCadence).toHaveBeenCalledWith("acme.com");
      expect(detectMailboxActivity).toHaveBeenCalledWith("user-1", "acme.com");
    });

    it("still returns tick data when mailbox activity detection fails", async () => {
      vi.mocked(tickCadence).mockResolvedValue({ advanced: 0, paused: 0, errors: 0 } as any);
      vi.mocked(detectMailboxActivity).mockRejectedValue(new Error("Graph token expired"));

      const res = await request(app).post("/api/sales-outreach/cadence/tick");

      expect(res.status).toBe(200);
      // detectMailboxActivity failure falls back to zeros — tick data still present
      expect(res.body).toMatchObject({ advanced: 0, touchesConfirmedSent: 0, repliesDetected: 0 });
    });

    it("returns 403 when the feature is gated", async () => {
      vi.mocked(guardFeature).mockImplementation(async (_req, res, _feature) => {
        res.status(403).json({ error: "Feature not available on your plan." });
        return false;
      });

      const res = await request(app).post("/api/sales-outreach/cadence/tick");

      expect(res.status).toBe(403);
      expect(tickCadence).not.toHaveBeenCalled();
    });
  });

  // ── GET /api/sales-outreach/prospects/:id/marketing-touches ─────────────────
  describe("GET /api/sales-outreach/prospects/:id/marketing-touches", () => {
    const PROSPECT = {
      id: "prospect-1",
      tenantDomain: "acme.com",
      name: "Jane Doe",
      email: "jane@fund.com",
      status: "new",
    };

    const RECIPIENT_ROW = {
      id: "recv-1",
      sendId: "send-1",
      sentAt: "2026-01-15T10:00:00Z",
      openedAt: "2026-01-15T14:00:00Z",
      clickedAt: null,
      status: "delivered",
    };

    const SEND_ROW = { id: "send-1", generatedEmailId: "email-1" };
    const EMAIL_ROW = { id: "email-1", subject: "Synozur Q1 Insights" };

    it("returns marketing touches for a prospect with matching sends", async () => {
      pushDb(PROSPECT);
      pushDb(RECIPIENT_ROW);
      pushDb(SEND_ROW);
      pushDb(EMAIL_ROW);

      const res = await request(app).get("/api/sales-outreach/prospects/prospect-1/marketing-touches");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        sendId: "send-1",
        subject: "Synozur Q1 Insights",
        openedAt: "2026-01-15T14:00:00Z",
        clickedAt: null,
      });
    });

    it("returns empty array when prospect has no email address", async () => {
      pushDb({ ...PROSPECT, email: null });

      const res = await request(app).get("/api/sales-outreach/prospects/prospect-1/marketing-touches");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns empty array when no send recipients match the prospect email", async () => {
      pushDb(PROSPECT);
      pushDb(); // empty recipientRows

      const res = await request(app).get("/api/sales-outreach/prospects/prospect-1/marketing-touches");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 404 when prospect does not exist", async () => {
      pushDb(); // no prospect found

      const res = await request(app).get("/api/sales-outreach/prospects/nonexistent/marketing-touches");

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/not found/i) });
    });

    it("returns 404 when prospect belongs to a different tenant", async () => {
      pushDb({ ...PROSPECT, tenantDomain: "other.com" });

      const res = await request(app).get("/api/sales-outreach/prospects/prospect-1/marketing-touches");

      expect(res.status).toBe(404);
    });
  });
});
