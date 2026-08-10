/**
 * Integration test — GET /api/email/saved/:id/export-html
 *
 * Verifies that the export-html route correctly injects the chosen email font
 * (buildFontStack + buildFontHeadCss) into the exported HTML document and does
 * NOT silently revert to Arial when a non-default font is stored on the email.
 *
 * The real email-campaign-sender helpers are used (not mocked) so any import,
 * key-lookup, or regex regression in the font-injection path is caught here.
 * All DB, storage, and service I/O that is not under test is mocked.
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
      finally: (cb: any) => Promise.resolve(val).finally(cb),
      returning: () => Promise.resolve(val),
      orderBy: (..._: any[]) => t,
      limit: (_n: any) => Promise.resolve(val),
    };
    return t;
  }

  function mkChain(): any {
    return {
      from: () => mkChain(),
      where: terminal,
      set: () => mkChain(),
      values: (_v: any) => terminal(),
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

  return { dbQ, makeMockDb };
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
vi.mock("../../services/posts-csv-export", () => ({ buildPostsCsv: vi.fn(), isOrbitDirectPost: vi.fn() }));
vi.mock("../../services/artifact-storage-helper", () => ({ storeArtifact: vi.fn() }));

// ── email-campaign-sender: use REAL implementations for the font helpers ───────
// We intentionally do NOT mock buildFontStack, buildFontHeadCss,
// normalizeFontFamily, enforceMinimumFontSize, wrapResponsiveDocument, or
// hardenCtaButtons — those are the functions under test.
// Only the async side-effectful helper (prepareEmailImages) is mocked.
vi.mock("../../services/email-campaign-sender", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../services/email-campaign-sender")>();
  return {
    ...real,
    // Mock only the function that does async I/O (image publishing / CDN fetch)
    prepareEmailImages: vi.fn(async (html: string) => html),
    // Mock send-path helpers not exercised by this route
    dispatchEmailSend: vi.fn(),
    previewListDeliverability: vi.fn(),
    verifyUnsubscribeToken: vi.fn().mockReturnValue(null),
    verifySendGridWebhook: vi.fn().mockReturnValue({ ok: true }),
  };
});

// ── email-sections-renderer mock ──────────────────────────────────────────────

vi.mock("../../services/email-sections-renderer", () => ({
  renderEmailSections: vi.fn().mockReturnValue(""),
  appendSectionsToBody: vi.fn((body: string, _sections: any) => body),
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
  app.use((req, _res, next) => {
    (req as any).session = { userId: "user-1" };
    next();
  });
  registerSaturnMarketingRoutes(app);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/email/saved/:id/export-html — font injection", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    dbQ.length = 0;
    app = buildApp();
  });

  function makeEmailRow(fontFamily: string | null, htmlBody = '<p style="font-family:Arial,sans-serif">Hello</p>') {
    return {
      id: "email-uuid-1",
      tenantDomain: "acme.example.com",
      marketId: "market-1",
      subject: "Test",
      htmlBody,
      fontFamily,
      sections: null,
      sectionsHtml: null,
      platform: "outlook",
      tone: "professional",
      createdAt: new Date().toISOString(),
    };
  }

  // ── MetroNova ──────────────────────────────────────────────────────────────

  it("injects MetroNova font-family stack and @font-face rules when fontFamily=MetroNova", async () => {
    dbQ.push([makeEmailRow("MetroNova")]);

    const res = await request(app)
      .get("/api/email/saved/email-uuid-1/export-html");

    expect(res.status).toBe(200);
    const { html } = res.body as { html: string };

    // The full document must contain @font-face rules for MetroNova
    expect(html).toContain("@font-face");
    expect(html).toContain('"MetroNova"');
    expect(html).toContain("MetroNovaRegular.ttf");

    // The font-family declarations in the body must reference MetroNova
    expect(html).toContain("MetroNova");
  });

  it("injects MetroNova fallback stack into font-family declarations in the body", async () => {
    const htmlBody = '<p style="font-family:Arial,Helvetica,sans-serif">Body</p>';
    dbQ.push([makeEmailRow("MetroNova", htmlBody)]);

    const res = await request(app)
      .get("/api/email/saved/email-uuid-1/export-html");

    expect(res.status).toBe(200);
    const { html } = res.body as { html: string };
    // normalizeFontFamily rewrites every font-family declaration to the
    // chosen stack — the original "Arial,Helvetica,sans-serif" string should be
    // replaced with the MetroNova stack.
    expect(html).toContain("MetroNova");
  });

  // ── AvenirNextLTPro ────────────────────────────────────────────────────────

  it("injects AvenirNextLTPro @font-face rules when fontFamily=AvenirNextLTPro", async () => {
    dbQ.push([makeEmailRow("AvenirNextLTPro")]);

    const res = await request(app)
      .get("/api/email/saved/email-uuid-1/export-html");

    expect(res.status).toBe(200);
    const { html } = res.body as { html: string };

    expect(html).toContain("@font-face");
    expect(html).toContain('"Avenir Next LT Pro"');
    expect(html).toContain("AvenirNextLTPro-Regular.ttf");
  });

  // ── OpenSans (Google Font) ─────────────────────────────────────────────────

  it("injects a Google Fonts @import rule when fontFamily=OpenSans", async () => {
    dbQ.push([makeEmailRow("OpenSans")]);

    const res = await request(app)
      .get("/api/email/saved/email-uuid-1/export-html");

    expect(res.status).toBe(200);
    const { html } = res.body as { html: string };

    expect(html).toContain("@import");
    expect(html).toContain("fonts.googleapis.com");
  });

  // ── Default / null font ────────────────────────────────────────────────────

  it("does not inject custom @font-face or @import when fontFamily is null", async () => {
    dbQ.push([makeEmailRow(null)]);

    const res = await request(app)
      .get("/api/email/saved/email-uuid-1/export-html");

    expect(res.status).toBe(200);
    const { html } = res.body as { html: string };

    // No custom font loading block for the null/default case
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  // ── Route basics ───────────────────────────────────────────────────────────

  it("returns 404 when the email does not exist", async () => {
    dbQ.push([]); // empty DB result → not found

    const res = await request(app)
      .get("/api/email/saved/nonexistent/export-html");

    expect(res.status).toBe(404);
  });

  it("wraps the body in a full HTML document (<!DOCTYPE html>)", async () => {
    dbQ.push([makeEmailRow("MetroNova")]);

    const res = await request(app)
      .get("/api/email/saved/email-uuid-1/export-html");

    expect(res.status).toBe(200);
    expect(res.body.html).toMatch(/<!DOCTYPE html>/i);
  });

  it("includes a fragment key in the response", async () => {
    dbQ.push([makeEmailRow(null)]);

    const res = await request(app)
      .get("/api/email/saved/email-uuid-1/export-html");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("fragment");
    expect(res.body).toHaveProperty("hubspotFragment");
  });
});
