/**
 * Route integration tests — HubSpot lists as send audiences (Task 709).
 *
 * Covers:
 *   - GET  /api/marketing/hubspot-lists                 (browse + linked-segment merge)
 *   - POST /api/marketing/hubspot-lists/:listId/import  (import as linked segment)
 *   - POST /api/marketing-segments/:id/hubspot-sync     (manual re-sync)
 *   - POST /api/generated-emails/:id/send               (send targeting a linked segment)
 *
 * All DB and service I/O is mocked; a real Express app is wired with
 * registerMarketingDeliveryRoutes so handlers run as in production.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { dbQ, makeMockDb } = vi.hoisted(() => {
  const dbQ: any[][] = [];

  function terminal(): any {
    const val = dbQ.shift() ?? [];
    const t: any = {
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject),
      returning: () => Promise.resolve(val),
      orderBy: (..._: any[]) => t,
      groupBy: (..._: any[]) => t,
      limit: (_n: any) => Promise.resolve(val),
    };
    return t;
  }

  function mkChain(): any {
    return {
      from: () => mkChain(),
      where: terminal,
      set: () => mkChain(),
      values: () => terminal(),
      orderBy: (..._: any[]) => terminal(),
      groupBy: (..._: any[]) => terminal(),
      limit: () => mkChain(),
      leftJoin: () => mkChain(),
      innerJoin: () => mkChain(),
      returning: () => Promise.resolve(dbQ.shift() ?? []),
    };
  }

  function makeMockDb() {
    const db: any = {
      select: mkChain,
      insert: mkChain,
      update: mkChain,
      delete: () => ({ where: () => Promise.resolve([]) }),
      transaction: async (fn: any) => fn(db),
    };
    return db;
  }

  return { dbQ, makeMockDb };
});

vi.mock("../../db", () => ({ db: makeMockDb() }));

vi.mock("../../context", () => ({
  getRequestContext: vi.fn().mockResolvedValue({
    tenantDomain: "acme.example.com",
    marketId: null,
  }),
}));

vi.mock("../../storage", () => ({
  storage: {
    getTenantByDomain: vi.fn().mockResolvedValue({ domain: "acme.example.com", plan: "enterprise" }),
    getUser: vi.fn().mockResolvedValue({ id: "user-1", role: "Standard User" }),
  },
}));

vi.mock("../../services/plan-policy", () => ({
  checkFeatureAccessAsync: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Modules imported at top of marketing-delivery.ts but irrelevant here.
vi.mock("../../services/email-ab-test", () => ({ resolveTokensPreview: vi.fn(), KNOWN_TOKENS: [] }));
vi.mock("../../utils/encryption", () => ({ encryptSecret: vi.fn(), decryptSecret: vi.fn() }));
vi.mock("../../services/social-publishers", () => ({ getPublisher: vi.fn() }));
vi.mock("../../services/social-publishers/linkedin", () => ({ LinkedInPublisher: class {} }));
vi.mock("../../services/marketing-publish-worker", () => ({ publishPostNow: vi.fn() }));
vi.mock("../../services/hubspot-timeline", () => ({ pushEmailTimelineEvent: vi.fn() }));
vi.mock("../../services/hubspot-email-sync-core", () => ({ timelineEventId: vi.fn() }));
vi.mock("../../services/hubspot-email-sync", () => ({ pushUnsubscribe: vi.fn(), pushSubscribe: vi.fn() }));

const dispatchEmailSend = vi.hoisted(() => vi.fn());
vi.mock("../../services/email-campaign-sender", () => ({
  dispatchEmailSend,
  previewListDeliverability: vi.fn(),
  verifyUnsubscribeToken: vi.fn(),
  verifySendGridWebhook: vi.fn(),
}));

const listHubspotContactLists = vi.hoisted(() => vi.fn());
vi.mock("../../services/hubspot-integration", () => ({
  listHubspotContactLists,
}));

const ensureHubspotListSegment = vi.hoisted(() => vi.fn());
const enqueueHubspotListSegmentSync = vi.hoisted(() => vi.fn());
vi.mock("../../services/hubspot-list-segment-service", () => ({
  ensureHubspotListSegment,
  enqueueHubspotListSegmentSync,
}));

import { registerMarketingDeliveryRoutes } from "../marketing-delivery";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = { userId: "user-1" };
    next();
  });
  registerMarketingDeliveryRoutes(app);
  return app;
}

beforeEach(() => {
  dbQ.length = 0;
  dispatchEmailSend.mockReset().mockResolvedValue({ sendId: "send-1", totalRecipients: 3 });
  listHubspotContactLists.mockReset();
  ensureHubspotListSegment.mockReset();
  enqueueHubspotListSegmentSync.mockReset().mockResolvedValue(3);
});

// ── Browse ────────────────────────────────────────────────────────────────────

describe("GET /api/marketing/hubspot-lists", () => {
  it("returns HubSpot lists merged with linked segment status + member counts", async () => {
    listHubspotContactLists.mockResolvedValue([
      { listId: "10", name: "Newsletter", memberCount: 250 },
      { listId: "20", name: "Webinar", memberCount: 40 },
    ]);
    // 1) linked segments query
    dbQ.push([{
      id: "seg-1",
      hubspotListId: "10",
      name: "HubSpot: Newsletter",
      hubspotSyncStatus: "synced",
      hubspotSyncError: null,
      lastHubspotSyncAt: new Date("2026-08-01T00:00:00Z"),
    }]);
    // 2) member counts query
    dbQ.push([{ segmentId: "seg-1", memberCount: 245 }]);

    const res = await request(makeApp()).get("/api/marketing/hubspot-lists");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const newsletter = res.body.find((l: any) => l.listId === "10");
    expect(newsletter.linkedSegment).toMatchObject({
      id: "seg-1",
      syncStatus: "synced",
      memberCount: 245,
    });
    const webinar = res.body.find((l: any) => l.listId === "20");
    expect(webinar.linkedSegment).toBeNull();
  });

  it("returns 502 when HubSpot is unreachable", async () => {
    listHubspotContactLists.mockRejectedValue(new Error("HubSpot lists API error 401: expired"));
    const res = await request(makeApp()).get("/api/marketing/hubspot-lists");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/401/);
  });
});

// ── Import ────────────────────────────────────────────────────────────────────

describe("POST /api/marketing/hubspot-lists/:listId/import", () => {
  it("creates the linked segment and enqueues the sync", async () => {
    listHubspotContactLists.mockResolvedValue([{ listId: "10", name: "Newsletter", memberCount: 250 }]);
    const segment = { id: "seg-1", hubspotListId: "10", source: "hubspot_list", tenantDomain: "acme.example.com" };
    ensureHubspotListSegment.mockResolvedValue({ segment, created: true });

    const res = await request(makeApp()).post("/api/marketing/hubspot-lists/10/import");
    expect(res.status).toBe(201);
    expect(res.body.segment.id).toBe("seg-1");
    expect(res.body.syncing).toBe(true);
    expect(ensureHubspotListSegment).toHaveBeenCalledWith({
      tenantDomain: "acme.example.com",
      listId: "10",
      listName: "Newsletter",
      createdBy: "user-1",
    });
    expect(enqueueHubspotListSegmentSync).toHaveBeenCalledWith(segment);
  });

  it("404s for a list id that doesn't exist in the tenant's HubSpot", async () => {
    listHubspotContactLists.mockResolvedValue([{ listId: "10", name: "Newsletter", memberCount: 250 }]);
    const res = await request(makeApp()).post("/api/marketing/hubspot-lists/999/import");
    expect(res.status).toBe(404);
    expect(ensureHubspotListSegment).not.toHaveBeenCalled();
    expect(enqueueHubspotListSegmentSync).not.toHaveBeenCalled();
  });
});

// ── Manual re-sync ────────────────────────────────────────────────────────────

describe("POST /api/marketing-segments/:id/hubspot-sync", () => {
  it("enqueues a re-sync for a hubspot_list segment", async () => {
    dbQ.push([{ id: "seg-1", source: "hubspot_list", hubspotListId: "10", tenantDomain: "acme.example.com" }]);
    const res = await request(makeApp()).post("/api/marketing-segments/seg-1/hubspot-sync");
    expect(res.status).toBe(202);
    expect(enqueueHubspotListSegmentSync).toHaveBeenCalled();
  });

  it("rejects a rules-based segment", async () => {
    dbQ.push([{ id: "seg-2", source: "rules", hubspotListId: null, tenantDomain: "acme.example.com" }]);
    const res = await request(makeApp()).post("/api/marketing-segments/seg-2/hubspot-sync");
    expect(res.status).toBe(400);
    expect(enqueueHubspotListSegmentSync).not.toHaveBeenCalled();
  });

  it("404s for a segment from another tenant", async () => {
    dbQ.push([]);
    const res = await request(makeApp()).post("/api/marketing-segments/seg-x/hubspot-sync");
    expect(res.status).toBe(404);
  });
});

// ── Send targeting ────────────────────────────────────────────────────────────

describe("POST /api/generated-emails/:id/send with a linked segment", () => {
  it("dispatches the send with the linked segment id", async () => {
    // 1) generated email lookup
    dbQ.push([{ id: "email-1", tenantDomain: "acme.example.com", status: "approved" }]);
    // 2) segment tenant validation
    dbQ.push([{ id: "seg-1" }]);

    const res = await request(makeApp())
      .post("/api/generated-emails/email-1/send")
      .send({ segmentId: "seg-1" });
    expect(res.status).toBe(201);
    expect(dispatchEmailSend).toHaveBeenCalledWith(expect.objectContaining({
      segmentId: "seg-1",
      listId: null,
      tenantDomain: "acme.example.com",
    }));
  });

  it("404s when the segment belongs to another tenant", async () => {
    dbQ.push([{ id: "email-1", tenantDomain: "acme.example.com", status: "approved" }]);
    dbQ.push([]); // segment validation finds nothing
    const res = await request(makeApp())
      .post("/api/generated-emails/email-1/send")
      .send({ segmentId: "seg-other-tenant" });
    expect(res.status).toBe(404);
    expect(dispatchEmailSend).not.toHaveBeenCalled();
  });
});
