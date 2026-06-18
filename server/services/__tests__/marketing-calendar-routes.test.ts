/**
 * Integration tests for the marketing-calendar API routes.
 *
 * Spins up a real Express app with all I/O dependencies mocked so the tests
 * run in-process without a database or network. Covers three high-risk flows:
 * manual item creation (POST /items), item updates (PATCH /items/:type/:id),
 * and date-load advice (GET /date-advice).
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── DB mock (queue-based chainable proxy) ─────────────────────────────────────

const { dbQ, makeMockDb } = vi.hoisted(() => {
  const dbQ: any[][] = [];

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
      values: terminal,
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
      transaction: async (fn: any) => fn(db),
    };
    return db;
  }

  return { dbQ, makeMockDb };
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

vi.mock("../repurpose-service", () => ({
  repurposeAsset: vi.fn(),
}));

vi.mock("../posts-csv-export", () => ({
  buildPostsCsv: vi.fn().mockResolvedValue("col1,col2\nval1,val2"),
}));

vi.mock("../repurpose-core", () => ({
  coercePlatform: vi.fn((p: string) => p),
  SUPPORTED_PLATFORMS: ["linkedin", "twitter", "facebook", "instagram"],
}));

vi.mock("../schedule-load", () => ({
  getScheduledDayCounts: vi.fn(),
}));

vi.mock("../calendar-rollup-core", () => ({
  rollupSocialItems: vi.fn().mockReturnValue({ batches: [], loose: [] }),
  batchDayKey: vi.fn((d: string | null) => d ?? ""),
}));

vi.mock("../artifact-storage-helper", () => ({
  storeArtifact: vi.fn().mockResolvedValue("https://storage.example.com/artifact.csv"),
}));

// ── Import under test AFTER all mocks are wired ───────────────────────────────

import { registerMarketingCalendarRoutes } from "../../routes/marketing-calendar";
import { getRequestContext } from "../../context";
import { guardFeature } from "../../routes/helpers";
import { getScheduledDayCounts } from "../schedule-load";

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
  registerMarketingCalendarRoutes(app);
  return app;
}

function pushDb(...rows: any[]) {
  dbQ.push(rows);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("marketing-calendar routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    dbQ.length = 0;
    vi.mocked(getRequestContext).mockResolvedValue(TEST_CTX as any);
    vi.mocked(guardFeature).mockResolvedValue(true);
    app = buildApp();
  });

  // ── POST /api/marketing-calendar/items ────────────────────────────────────

  describe("POST /api/marketing-calendar/items", () => {
    it("returns 400 when type is missing", async () => {
      const res = await request(app)
        .post("/api/marketing-calendar/items")
        .send({ title: "My Post" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/type/i) });
    });

    it("returns 400 when type is invalid", async () => {
      const res = await request(app)
        .post("/api/marketing-calendar/items")
        .send({ type: "video", title: "My Video" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/type/i) });
    });

    it("returns 400 when title is missing", async () => {
      const res = await request(app)
        .post("/api/marketing-calendar/items")
        .send({ type: "social" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/title/i) });
    });

    it("creates a social item and returns 201 with type and id", async () => {
      const NEW_POST = { id: "post-1", tenantDomain: "acme.com", platform: "linkedin", content: "Hello LinkedIn" };

      // insert generatedPosts.values().returning() → [NEW_POST]
      pushDb(NEW_POST);

      const res = await request(app)
        .post("/api/marketing-calendar/items")
        .send({ type: "social", title: "Hello LinkedIn", platform: "linkedin" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type: "social", id: "post-1" });
    });

    it("creates an email item and returns 201 with type and id", async () => {
      const NEW_EMAIL = { id: "email-1", tenantDomain: "acme.com", subject: "Q3 Newsletter" };

      // insert generatedEmails.values().returning() → [NEW_EMAIL]
      pushDb(NEW_EMAIL);

      const res = await request(app)
        .post("/api/marketing-calendar/items")
        .send({ type: "email", title: "Q3 Newsletter" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type: "email", id: "email-1" });
    });

    it("creates a content item (finds existing manual calendar) and returns 201", async () => {
      const MANUAL_CAL = { id: "cal-manual", tenantDomain: "acme.com", name: "Marketing Calendar (manual)" };
      const NEW_BRIEF = { id: "brief-1", tenantDomain: "acme.com", title: "My Blog Idea", format: "blog_post" };

      // getOrCreateManualCalendar: select editorialCalendars.where().limit(1) → [MANUAL_CAL]
      pushDb(MANUAL_CAL);
      // insert contentBriefs.values().returning() → [NEW_BRIEF]
      pushDb(NEW_BRIEF);

      const res = await request(app)
        .post("/api/marketing-calendar/items")
        .send({ type: "content", title: "My Blog Idea", format: "blog_post" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type: "content", id: "brief-1" });
    });

    it("returns 403 when the feature is gated", async () => {
      vi.mocked(guardFeature).mockImplementation(async (_req, res, _feature) => {
        res.status(403).json({ error: "Feature not available on your plan." });
        return false;
      });

      const res = await request(app)
        .post("/api/marketing-calendar/items")
        .send({ type: "social", title: "Gated Post" });

      expect(res.status).toBe(403);
    });
  });

  // ── PATCH /api/marketing-calendar/items/:type/:id ─────────────────────────

  describe("PATCH /api/marketing-calendar/items/:type/:id", () => {
    it("updates a social item's scheduled date and returns 200 ok", async () => {
      const UPDATED = { id: "post-1" };

      // update generatedPosts.set().where().returning() → [UPDATED]
      pushDb(UPDATED);

      const res = await request(app)
        .patch("/api/marketing-calendar/items/social/post-1")
        .send({ date: "2026-07-15" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
    });

    it("returns 404 when the social item does not exist", async () => {
      // update returns empty row → not found
      pushDb(); // empty

      const res = await request(app)
        .patch("/api/marketing-calendar/items/social/nonexistent")
        .send({ date: "2026-07-15" });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/not found/i) });
    });

    it("updates an email item and returns 200 ok", async () => {
      const UPDATED = { id: "email-1" };

      // update generatedEmails.set().where().returning() → [UPDATED]
      pushDb(UPDATED);

      const res = await request(app)
        .patch("/api/marketing-calendar/items/email/email-1")
        .send({ campaignId: "camp-1" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
    });

    it("returns 400 for an unknown item type", async () => {
      const res = await request(app)
        .patch("/api/marketing-calendar/items/video/video-1")
        .send({ date: "2026-07-15" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/unknown type/i) });
    });
  });

  // ── GET /api/marketing-calendar/date-advice ───────────────────────────────

  describe("GET /api/marketing-calendar/date-advice", () => {
    it("returns 400 when date query param is missing", async () => {
      const res = await request(app).get("/api/marketing-calendar/date-advice");

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/date/i) });
    });

    it("returns 400 when date format is wrong", async () => {
      const res = await request(app).get("/api/marketing-calendar/date-advice?date=not-a-date");

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/date/i) });
    });

    it("returns busy=false when the day has fewer activities than the threshold", async () => {
      // getScheduledDayCounts returns a map with count=1 for the queried date
      vi.mocked(getScheduledDayCounts).mockResolvedValue(new Map([["2026-07-15", 1]]));

      const res = await request(app).get("/api/marketing-calendar/date-advice?date=2026-07-15");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ date: "2026-07-15", count: 1, busy: false });
    });

    it("returns busy=true and a suggestion when the day is crowded", async () => {
      // Fill the target day and several nearby weekdays beyond the threshold (3).
      // Leave 2026-07-20 (Monday) open so the route suggests it.
      const counts = new Map<string, number>([
        ["2026-07-15", 5], // crowded (Wed)
        ["2026-07-16", 5], // Thu — also busy
        ["2026-07-14", 5], // Tue — also busy
        ["2026-07-17", 5], // Fri — also busy
        ["2026-07-13", 5], // Mon — also busy
        // 2026-07-18 Sat, 2026-07-19 Sun — skipped (weekends)
        // 2026-07-20 Mon — not in map → count 0 → free → suggestion
      ]);
      vi.mocked(getScheduledDayCounts).mockResolvedValue(counts);

      const res = await request(app).get("/api/marketing-calendar/date-advice?date=2026-07-15");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ date: "2026-07-15", busy: true, suggestion: expect.any(String) });
    });
  });
});
