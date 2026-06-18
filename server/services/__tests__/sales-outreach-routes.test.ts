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
import { guardFeature } from "../../routes/helpers";
import { createCampaignFromInterview, getCampaign } from "../outreach-interview-service";
import { assertApprovalAllowed } from "../cadence-service";
import { createOutlookDraft } from "../outlook-draft-service";
import { getLinkedInCapabilities } from "../linkedin-provider";

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
});
