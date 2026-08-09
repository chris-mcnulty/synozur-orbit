/**
 * Route integration test — POST /api/email/saved sections carryforward (Task 659).
 *
 * Verifies that creating a new email via POST /api/email/saved carries forward
 * the reusable section settings (eventsCalendarUrl, blogIndexUrl,
 * blogSectionTitle, blogIntro, generalInfo) from the most recently configured
 * email, and writes null when there is no previous email with sections.
 *
 * All DB, storage, and service I/O is mocked. The test wires up a real
 * Express app with registerSaturnMarketingRoutes so the route handler executes
 * exactly as it does in production.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { dbQ, capturedInserts, makeMockDb } = vi.hoisted(() => {
  const dbQ: any[][] = [];
  const capturedInserts: any[] = [];

  function terminal(): any {
    const val = dbQ.shift() ?? [];
    // All chain methods after .where() must resolve to the SAME val without
    // popping additional queue entries — so .where().orderBy().limit() is
    // idempotent with respect to the queue.
    const t: any = {
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject),
      finally: (cb: any) => Promise.resolve(val).finally(cb),
      returning: () => Promise.resolve(val),
      orderBy: (..._: any[]) => t,   // returns self, same val, no extra pop
      limit: (_n: any) => Promise.resolve(val),
    };
    return t;
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
      orderBy: (..._: any[]) => terminal(),
      limit: () => mkChain(),
      leftJoin: () => mkChain(),
      innerJoin: () => mkChain(),
      returning: () => Promise.resolve(dbQ.shift() ?? []),
      onConflictDoUpdate: () => ({ returning: () => Promise.resolve(dbQ.shift() ?? []) }),
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

  return { dbQ, capturedInserts, makeMockDb };
});

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("../../db", () => ({ db: makeMockDb() }));

// ── Context mock ──────────────────────────────────────────────────────────────

vi.mock("../../context", () => ({
  getRequestContext: vi.fn().mockResolvedValue({
    tenantDomain: "acme.example.com",
    marketId: "market-1",
    userId: "user-1",
    userRole: "Domain Admin",
  }),
  ContextError: class ContextError extends Error {
    status: number;
    constructor(msg: string, status = 403) { super(msg); this.status = status; }
  },
}));

// ── Feature gate (always allowed) ─────────────────────────────────────────────

vi.mock("../../services/plan-policy", () => ({
  checkFeatureAccessAsync: vi.fn().mockResolvedValue({ allowed: true }),
}));

// ── Storage mock ──────────────────────────────────────────────────────────────

vi.mock("../../storage", () => ({
  storage: { getTenantByDomain: vi.fn().mockResolvedValue({ plan: "enterprise" }) },
}));

// ── Service mocks not under test ──────────────────────────────────────────────

vi.mock("../../services/ai-provider", () => ({ completeForFeature: vi.fn() }));
vi.mock("../../services/content-extraction", () => ({
  extractContentFromUrl: vi.fn(),
  generateContentSummary: vi.fn(),
  loadGroundingContext: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../services/strategic-context", () => ({
  loadStrategicContext: vi.fn().mockResolvedValue({}),
  formatStrategicContextForPrompt: vi.fn().mockReturnValue(""),
  formatPersonaContextForPrompt: vi.fn().mockReturnValue(""),
  formatFoundingSignalsForPrompt: vi.fn().mockReturnValue(""),
}));
vi.mock("../../services/founding-signals", () => ({ captureFoundingSignals: vi.fn() }));
vi.mock("../../services/marketing-links-helpers", () => ({
  wrapOutboundLinksInText: vi.fn((html: string) => html),
  slugifyForUtm: vi.fn((s: string) => s),
}));
vi.mock("../../services/conference-promotion-service", () => ({
  generateBrandedPostGraphic: vi.fn(),
}));
vi.mock("../../services/brand-asset-url", () => ({
  resolveBrandAssetUrl: vi.fn().mockResolvedValue(null),
}));
vi.mock("../helpers", () => ({
  guardManualAction: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../services/job-queue", () => ({ enqueue: vi.fn() }));
vi.mock("../../services/posts-csv-export", () => ({ buildPostsCsv: vi.fn() }));
vi.mock("../../services/artifact-storage-helper", () => ({ storeArtifact: vi.fn() }));
vi.mock("../../services/email-campaign-sender", () => ({
  enforceMinimumFontSize: vi.fn((html: string) => html),
  normalizeFontFamily: vi.fn((html: string) => html),
  wrapResponsiveDocument: vi.fn((html: string) => html),
  prepareEmailImages: vi.fn(async (html: string) => html),
  hardenCtaButtons: vi.fn((html: string) => html),
  CURATED_EMAIL_FONTS: [],
  buildFontStack: vi.fn(() => "Arial,Helvetica,sans-serif"),
  buildFontHeadCss: vi.fn(() => ""),
  dispatchEmailSend: vi.fn(),
  previewListDeliverability: vi.fn(),
  verifyUnsubscribeToken: vi.fn().mockReturnValue(null),
  verifySendGridWebhook: vi.fn().mockReturnValue({ ok: true }),
}));
vi.mock("../../services/email-sections-renderer", () => ({
  renderEmailSections: vi.fn().mockReturnValue(""),
  appendSectionsToBody: vi.fn((body: string) => body),
  reRenderSectionsHtml: vi.fn().mockResolvedValue(null),
  stripDuplicateAboutSection: vi.fn((html: string) => html),
}));
vi.mock("../../services/website-mcp-client", () => ({
  getConferenceEvents: vi.fn().mockResolvedValue([]),
  getRecentPosts: vi.fn().mockResolvedValue([]),
  getLandingPages: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../utils/pagination", () => ({
  parsePaginationParams: vi.fn().mockReturnValue({ page: 1, pageSize: 50, q: undefined }),
  buildPaginatedEnvelope: vi.fn(),
  toContainsPattern: vi.fn((q: string) => `%${q}%`),
}));

// ── Import under test (after all vi.mock calls) ───────────────────────────────

import { registerSaturnMarketingRoutes } from "../marketing-saturn";

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  // Inject a fake session so guardFeature passes the userId check.
  app.use((req, _res, next) => {
    (req as any).session = { userId: "user-1" };
    next();
  });
  registerSaturnMarketingRoutes(app);
  return app;
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const PREV_SECTIONS = {
  eventsCalendarUrl: "https://acme.example.com/events",
  blogIndexUrl: "https://acme.example.com/blog",
  blogSectionTitle: "From the Acme Team",
  blogIntro: "Catch up on our latest thinking.",
  generalInfo: { senderName: "Chris", senderTitle: "CTO", aboutTitle: "About Acme", aboutText: "We help teams." },
  // item selections (must NOT be carried forward)
  eventIds: ["conf-uuid-1"],
  blogAssetIds: ["post-uuid-1"],
};

const SAVED_EMAIL_ROW = {
  id: "new-email-uuid",
  tenantDomain: "acme.example.com",
  marketId: "market-1",
  subject: "Test Email",
  htmlBody: "<p>Hello world</p>",
  platform: "outlook",
  tone: "professional",
  sections: null,
  createdAt: new Date().toISOString(),
};

const BASE_BODY = {
  subject: "Test Email",
  htmlBody: "<p>Hello world</p>",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/email/saved — sections carryforward", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    dbQ.length = 0;
    capturedInserts.length = 0;
    app = buildApp();
  });

  it("carries forward eventsCalendarUrl, blogIndexUrl, blogSectionTitle, blogIntro, generalInfo from the latest configured email", async () => {
    // Queue:
    //   [0] db.select({sections}).from(generatedEmails).where(...).orderBy(...).limit(1)
    //       → returns a previous email row with full sections
    //   [1] db.insert(generatedEmails).values({...}).returning()
    //       → returns the newly created email row
    dbQ.push(
      [{ sections: PREV_SECTIONS }], // previous email lookup
      [SAVED_EMAIL_ROW],             // insert .returning()
    );

    const res = await request(app)
      .post("/api/email/saved")
      .send(BASE_BODY);

    expect(res.status).toBe(201);

    // The captured insert payload must carry forward the URL + metadata fields
    expect(capturedInserts.length).toBeGreaterThanOrEqual(1);
    const inserted = capturedInserts.find((v: any) => v.subject === "Test Email");
    expect(inserted).toBeDefined();

    const sections = inserted.sections as any;
    expect(sections).not.toBeNull();
    expect(sections.eventsCalendarUrl).toBe("https://acme.example.com/events");
    expect(sections.blogIndexUrl).toBe("https://acme.example.com/blog");
    expect(sections.blogSectionTitle).toBe("From the Acme Team");
    expect(sections.blogIntro).toBe("Catch up on our latest thinking.");
    expect(sections.generalInfo).toMatchObject({ senderName: "Chris", aboutTitle: "About Acme" });
  });

  it("does NOT carry forward item-selection fields (eventIds, blogAssetIds, caseStudyAssetId)", async () => {
    dbQ.push(
      [{ sections: PREV_SECTIONS }],
      [SAVED_EMAIL_ROW],
    );

    await request(app).post("/api/email/saved").send(BASE_BODY);

    const inserted = capturedInserts.find((v: any) => v.subject === "Test Email");
    const sections = inserted?.sections as any;
    expect(sections?.eventIds).toBeUndefined();
    expect(sections?.blogAssetIds).toBeUndefined();
    expect(sections?.caseStudyAssetId).toBeUndefined();
  });

  it("writes null sections when no previous email has sections configured", async () => {
    // Previous email lookup returns an empty array (no prior emails)
    dbQ.push(
      [],              // no previous email
      [SAVED_EMAIL_ROW],
    );

    const res = await request(app)
      .post("/api/email/saved")
      .send(BASE_BODY);

    expect(res.status).toBe(201);

    const inserted = capturedInserts.find((v: any) => v.subject === "Test Email");
    expect(inserted).toBeDefined();
    expect(inserted.sections).toBeNull();
  });

  it("writes null sections when previous email sections has none of the carryforward fields", async () => {
    // Previous email has sections but only item-selection data — nothing to carry.
    dbQ.push(
      [{ sections: { eventIds: ["conf-1"], blogAssetIds: [] } }],
      [SAVED_EMAIL_ROW],
    );

    await request(app).post("/api/email/saved").send(BASE_BODY);

    const inserted = capturedInserts.find((v: any) => v.subject === "Test Email");
    expect(inserted.sections).toBeNull();
  });

  it("carries forward only the fields that are present (partial previous sections)", async () => {
    const partialSections = {
      blogIndexUrl: "https://acme.example.com/blog",
      // No eventsCalendarUrl, no blogSectionTitle, no blogIntro, no generalInfo
    };

    dbQ.push(
      [{ sections: partialSections }],
      [SAVED_EMAIL_ROW],
    );

    await request(app).post("/api/email/saved").send(BASE_BODY);

    const inserted = capturedInserts.find((v: any) => v.subject === "Test Email");
    const sections = inserted?.sections as any;
    expect(sections).not.toBeNull();
    expect(sections.blogIndexUrl).toBe("https://acme.example.com/blog");
    expect(sections.eventsCalendarUrl).toBeUndefined();
    expect(sections.blogSectionTitle).toBeUndefined();
  });

  it("returns 400 when subject is missing", async () => {
    const res = await request(app)
      .post("/api/email/saved")
      .send({ htmlBody: "<p>Body</p>" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subject/i);
  });

  it("returns 400 when both htmlBody and textBody are absent", async () => {
    const res = await request(app)
      .post("/api/email/saved")
      .send({ subject: "No body at all" });

    expect(res.status).toBe(400);
  });
});
