/**
 * Integration tests for the editorial-calendar API routes.
 *
 * Spins up a real Express app with all I/O dependencies mocked so the tests
 * run in-process without a database or network. Covers the two highest-risk
 * write flows: PATCH /api/content-briefs/:id (field updates) and
 * POST /api/content-briefs/:id/finalize (approve brief + activate draft).
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── DB mock (queue-based chainable proxy) ─────────────────────────────────────
//
// vi.hoisted runs BEFORE vi.mock so the objects it returns are usable inside
// mock factories (which are also hoisted).

const { dbQ, capturedInserts, makeMockDb } = vi.hoisted(() => {
  const dbQ: any[][] = [];
  // Records the values passed to .values() so tests can assert on what was
  // written (e.g. that a produced asset carries its sourceBriefId).
  const capturedInserts: any[] = [];

  function terminal(): any {
    const val = dbQ.shift() ?? [];
    return {
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject),
      finally: (cb: any) => Promise.resolve(val).finally(cb),
      returning: () => Promise.resolve(val),
      orderBy: () => Promise.resolve(val),
      limit: () => Promise.resolve(val),
    };
  }

  function mkChain(): any {
    return {
      from: () => mkChain(),
      where: terminal,
      set: () => mkChain(),
      values: (v: any) => {
        capturedInserts.push(v);
        return terminal();
      },
      orderBy: () => Promise.resolve(dbQ.shift() ?? []),
      returning: () => Promise.resolve(dbQ.shift() ?? []),
      limit: () => mkChain(),
      leftJoin: () => mkChain(),
      innerJoin: () => mkChain(),
      onConflictDoUpdate: () => ({ returning: () => Promise.resolve(dbQ.shift() ?? []) }),
    };
  }

  function makeMockDb() {
    const db: any = {
      select: mkChain,
      insert: mkChain,
      update: mkChain,
      delete: () => ({ where: () => Promise.resolve([]) }),
      selectDistinct: mkChain,
      // transaction: call the callback with db itself as `tx` so the same
      // queue-based chain handles all operations inside the transaction.
      transaction: async (fn: any) => fn(db),
    };
    return db;
  }

  return { dbQ, capturedInserts, makeMockDb };
});

// ── Mock all I/O modules used by the route file ───────────────────────────────

vi.mock("../../db", () => ({ db: makeMockDb() }));

vi.mock("../../context", () => ({
  getRequestContext: vi.fn(),
  ContextError: class ContextError extends Error {
    status: number;
    constructor(msg: string, status = 403) {
      super(msg);
      this.status = status;
    }
  },
}));

vi.mock("../../routes/helpers", () => ({
  guardFeature: vi.fn().mockResolvedValue(true),
  guardManualAction: vi.fn().mockResolvedValue(true),
  logAiUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../editorial-calendar-service", () => ({
  generateContentBriefs: vi.fn(),
}));

vi.mock("../copywriter-service", () => ({
  draftFromBrief: vi.fn(),
}));

vi.mock("../outbound-voice-service", () => ({
  getPersonalVoiceProfile: vi.fn().mockResolvedValue(null),
}));

vi.mock("../editorial-calendar-core", () => ({
  DEFAULT_FUNNEL_TARGETS: { awareness: 40, consideration: 40, decision: 20 },
  briefFormatToAssetType: vi.fn().mockReturnValue("article"),
  recommendedBriefCount: vi.fn().mockReturnValue(8),
}));

// ── Import under test AFTER all mocks are wired ───────────────────────────────

import { registerEditorialCalendarRoutes } from "../../routes/editorial-calendar";
import { getRequestContext } from "../../context";
import { guardFeature } from "../../routes/helpers";
import { draftFromBrief } from "../copywriter-service";

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
  registerEditorialCalendarRoutes(app);
  return app;
}

function pushDb(...rows: any[]) {
  dbQ.push(rows);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("editorial-calendar routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    dbQ.length = 0;
    capturedInserts.length = 0;
    vi.mocked(getRequestContext).mockResolvedValue(TEST_CTX as any);
    vi.mocked(guardFeature).mockResolvedValue(true);
    app = buildApp();
  });

  // ── PATCH /api/content-briefs/:id ─────────────────────────────────────────

  describe("PATCH /api/content-briefs/:id", () => {
    const UPDATED_BRIEF = {
      id: "brief-1",
      tenantDomain: "acme.com",
      marketId: "market-1",
      title: "Updated Title",
      format: "blog_post",
      status: "approved",
    };

    it("updates editable fields and returns 200 with the row", async () => {
      // update contentBriefs.where().returning() → [UPDATED_BRIEF]
      pushDb(UPDATED_BRIEF);

      const res = await request(app)
        .patch("/api/content-briefs/brief-1")
        .send({ status: "approved", title: "Updated Title" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: "brief-1", status: "approved" });
    });

    it("returns 400 when no editable fields are provided", async () => {
      const res = await request(app)
        .patch("/api/content-briefs/brief-1")
        .send({ unknownField: "value" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/no editable/i) });
    });

    it("returns 400 when an unknown format is provided", async () => {
      const res = await request(app)
        .patch("/api/content-briefs/brief-1")
        .send({ format: "not_a_real_format" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/unknown format/i) });
    });

    it("returns 404 when the brief does not exist", async () => {
      // update returns empty → [row] is undefined → triggers 404
      pushDb(); // empty — brief not found after update

      const res = await request(app)
        .patch("/api/content-briefs/nonexistent")
        .send({ status: "approved" });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/not found/i) });
    });

    it("returns 403 when the feature is gated", async () => {
      vi.mocked(guardFeature).mockImplementation(async (_req, res, _feature) => {
        res.status(403).json({ error: "Feature not available on your plan." });
        return false;
      });

      const res = await request(app)
        .patch("/api/content-briefs/brief-1")
        .send({ status: "approved" });

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/content-briefs/:id/finalize ─────────────────────────────────

  describe("POST /api/content-briefs/:id/finalize", () => {
    const BRIEF_WITH_DRAFT = {
      id: "brief-1",
      tenantDomain: "acme.com",
      marketId: "market-1",
      title: "Q3 Blog Post",
      format: "blog_post",
      status: "drafted",
      contentAssetId: "asset-1",
    };

    const BRIEF_NO_DRAFT = {
      ...BRIEF_WITH_DRAFT,
      contentAssetId: null,
      status: "suggested",
    };

    const APPROVED_BRIEF = { ...BRIEF_WITH_DRAFT, status: "approved" };

    it("approves the brief and activates the linked draft, returns 200", async () => {
      // select brief → [BRIEF_WITH_DRAFT]
      pushDb(BRIEF_WITH_DRAFT);
      // tx.update contentBriefs.where().returning() → [APPROVED_BRIEF]
      pushDb(APPROVED_BRIEF);
      // tx.update contentAssets.set().where() → [] (no returning clause)
      pushDb();

      const res = await request(app).post("/api/content-briefs/brief-1/finalize");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: "brief-1", status: "approved" });
    });

    it("returns 404 when the brief does not exist", async () => {
      // select → [] (not found)
      pushDb();

      const res = await request(app).post("/api/content-briefs/nonexistent/finalize");

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/not found/i) });
    });

    it("returns 409 when the brief has no draft yet", async () => {
      // select → [BRIEF_NO_DRAFT]
      pushDb(BRIEF_NO_DRAFT);

      const res = await request(app).post("/api/content-briefs/brief-1/finalize");

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/draft/i) });
    });
  });

  // ── POST /api/content-briefs/:id/draft ────────────────────────────────────
  // The produced asset must carry sourceBriefId so the asset owns the brief↔
  // draft link (input → output points forward).

  describe("POST /api/content-briefs/:id/draft", () => {
    const BRIEF = {
      id: "brief-1",
      tenantDomain: "acme.com",
      marketId: "market-1",
      title: "Q3 Blog Post",
      format: "blog_post",
      status: "accepted",
    };

    it("links the produced asset back to the brief via sourceBriefId", async () => {
      vi.mocked(draftFromBrief).mockResolvedValue({
        title: "Q3 Blog Post",
        body: "A real draft body.",
        format: "blog_post",
      } as any);

      // select brief → [BRIEF]
      pushDb(BRIEF);
      // tx insert contentAssets → [asset]
      pushDb({ id: "asset-1", title: "Q3 Blog Post", sourceBriefId: "brief-1" });
      // tx update contentBriefs → [updatedBrief]
      pushDb({ ...BRIEF, status: "drafted", contentAssetId: "asset-1" });

      const res = await request(app)
        .post("/api/content-briefs/brief-1/draft")
        .send({});

      expect(res.status).toBe(201);
      // The content_assets insert (first captured insert) carries the link.
      const assetInsert = capturedInserts[0];
      expect(assetInsert).toMatchObject({ sourceBriefId: "brief-1" });
    });
  });
});
