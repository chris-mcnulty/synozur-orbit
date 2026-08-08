/**
 * Unit tests — email sections renderer (Task 659).
 *
 * Covers:
 *  1. reRenderSectionsHtml — mixed conference + ca_-prefixed content-asset
 *     event IDs: user-selected order preserved, mcp_ IDs silently dropped,
 *     no invalid-uuid exception thrown (regression guard for the bug that
 *     dropped the Upcoming Events column when ca_ IDs were present).
 *  2. reRenderSectionsHtml — blog posts sorted newest-first by assetDate.
 *  3. reRenderSectionsHtml — blogSectionTitle / blogIntro rendered + HTML-escaped.
 *  4. stripDuplicateAboutSection — removes "About Us" / "About <company>"
 *     h-tag and bold-paragraph headings (including multiple occurrences) but
 *     NEVER removes "About the webinar" or rows containing nested tables /
 *     CTA btn anchors.
 *
 * All DB I/O is mocked — no live database is required.
 */

import { strict as assert } from "node:assert";
import { describe, it, vi, beforeEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────
//
// Each db.select() call pops the next result from dbQ.  The terminal()
// helper creates a thenable that also exposes .orderBy() and .limit() so
// every chain variant used by reRenderSectionsHtml resolves correctly with
// one queue entry per db.select() call.

const { dbQ, terminal, mkChain, makeMockDb } = vi.hoisted(() => {
  const dbQ: any[][] = [];

  function terminal(): any {
    const val = dbQ.shift() ?? [];
    return {
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject),
      finally: (cb: any) => Promise.resolve(val).finally(cb),
      returning: () => Promise.resolve(val),
      orderBy: (..._: any[]) => Promise.resolve(val),
      limit: (_n: any) => Promise.resolve(val),
    };
  }

  function mkChain(): any {
    return {
      from: () => mkChain(),
      where: terminal,
      set: () => mkChain(),
      values: () => terminal(),
      orderBy: (..._: any[]) => Promise.resolve(dbQ.shift() ?? []),
      limit: () => mkChain(),
      leftJoin: () => mkChain(),
    };
  }

  function makeMockDb() {
    return { select: mkChain, insert: mkChain, update: mkChain, delete: () => ({ where: () => Promise.resolve([]) }) };
  }

  return { dbQ, terminal, mkChain, makeMockDb };
});

vi.mock("../../db", () => ({ db: makeMockDb() }));

// Drizzle operators and schema symbols are only used as arguments to the
// (mocked) DB chain — their actual values don't matter at test time.
vi.mock("drizzle-orm", async (importOriginal) => {
  const real = await importOriginal<typeof import("drizzle-orm")>();
  return real;
});

// ── Import the modules under test (after vi.mock) ─────────────────────────────

import {
  reRenderSectionsHtml,
  stripDuplicateAboutSection,
} from "../email-sections-renderer";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CTX = { tenantDomain: "acme.example.com", marketId: "market-1" };

const TENANT_ROW = [{ primaryColor: "#7C3AED" }];

beforeEach(() => {
  dbQ.length = 0;
});

// ═════════════════════════════════════════════════════════════════════════════
// reRenderSectionsHtml
// ═════════════════════════════════════════════════════════════════════════════

describe("reRenderSectionsHtml — mixed event IDs", () => {
  it("preserves user-selected order, drops mcp_ IDs, does not throw for ca_ IDs", async () => {
    // Three event IDs: one conference, one content-asset (ca_), one MCP (mcp_)
    const confId = "aaaaaaaa-0000-0000-0000-000000000001";
    const caRawId = "bbbbbbbb-0000-0000-0000-000000000002";
    const caId = `ca_${caRawId}`;
    const mcpId = "mcp_external-event-x";

    const sections = { eventIds: [confId, caId, mcpId] };

    // Queue order matches the Promise.all order in reRenderSectionsHtml:
    //   [0] caseStudy  → short-circuits (no caseStudyAssetId) — no db.select
    //   [1] confEventIds query → db.select for conferences
    //   [2] caEventIds query   → db.select for contentAssets (ca_ events)
    //   [3] blogAssetIds       → short-circuits (no blogAssetIds) — no db.select
    //   [4] tenantRows         → db.select for tenant color
    dbQ.push(
      // conferences query result
      [{ id: confId, name: "Dev Summit", startDate: new Date("2026-09-10"), endDate: new Date("2026-09-12"), location: "Seattle", website: "https://devsummit.example" }],
      // contentAssets (ca_ events) query result
      [{ id: caRawId, title: "Live Workshop", assetDate: new Date("2026-09-05"), url: "https://workshop.example" }],
      // tenant row
      TENANT_ROW,
    );

    const html = await reRenderSectionsHtml(sections, CTX);

    assert.ok(html, "should produce non-empty HTML");
    // Both real events must appear
    assert.ok(html!.includes("Dev Summit"), "conference event name present");
    assert.ok(html!.includes("Live Workshop"), "ca_ event name present");
    // mcp_ event had no matching DB row — must not appear in output
    assert.ok(!html!.includes("mcp_external-event-x"), "mcp_ event must not appear");
    // Order: Dev Summit (conf, first in wantedEventIds) must precede Live Workshop (ca_, second)
    assert.ok(
      html!.indexOf("Dev Summit") < html!.indexOf("Live Workshop"),
      "user-selected order preserved",
    );
  });

  it("returns non-null even when only ca_ IDs exist (regression: used to silently return null)", async () => {
    const caRawId = "cccccccc-0000-0000-0000-000000000003";
    const sections = { eventIds: [`ca_${caRawId}`] };

    // confEventIds → empty → no db.select call (short-circuits)
    // caEventIds → db.select
    // tenantRows  → db.select
    dbQ.push(
      [{ id: caRawId, title: "Webinar: AI in Practice", assetDate: new Date("2026-10-01"), url: null }],
      TENANT_ROW,
    );

    const html = await reRenderSectionsHtml(sections, CTX);

    assert.ok(html, "HTML must be produced when only ca_ IDs are present");
    assert.ok(html!.includes("Webinar: AI in Practice"), "ca_-only event name rendered");
  });

  it("returns null when all IDs are mcp_ (nothing to render)", async () => {
    const sections = { eventIds: ["mcp_abc", "mcp_def"] };

    // Both IDs are stripped — confEventIds and caEventIds are both empty.
    // Only the tenant query runs.
    dbQ.push(TENANT_ROW);

    const html = await reRenderSectionsHtml(sections, CTX);

    // All items filtered out → renderEmailSections produces empty string → null
    assert.equal(html, null, "all-mcp_ input should yield null");
  });
});

describe("reRenderSectionsHtml — blog post sort order", () => {
  it("sorts blog posts newest-first by assetDate regardless of DB return order", async () => {
    const ids = ["post-alpha", "post-beta", "post-gamma"];
    const sections = { blogAssetIds: ids };

    // DB returns posts in an unordered sequence; the service must re-sort them.
    // Dates: alpha=2024-01-01, beta=2024-03-15, gamma=2024-02-20
    // Newest-first order: beta → gamma → alpha
    dbQ.push(
      // blogRows (order intentionally scrambled)
      [
        { id: "post-alpha", title: "Alpha Post",  assetDate: new Date("2024-01-01"), url: "https://blog.example/alpha",  status: "active" },
        { id: "post-beta",  title: "Beta Post",   assetDate: new Date("2024-03-15"), url: "https://blog.example/beta",   status: "active" },
        { id: "post-gamma", title: "Gamma Post",  assetDate: new Date("2024-02-20"), url: "https://blog.example/gamma",  status: "active" },
      ],
      // tenantRows
      TENANT_ROW,
    );

    const html = await reRenderSectionsHtml(sections, CTX);

    assert.ok(html, "HTML must be produced");
    const betaIdx  = html!.indexOf("Beta Post");
    const gammaIdx = html!.indexOf("Gamma Post");
    const alphaIdx = html!.indexOf("Alpha Post");

    assert.ok(betaIdx  < gammaIdx, "Beta (March) before Gamma (Feb)");
    assert.ok(gammaIdx < alphaIdx, "Gamma (Feb) before Alpha (Jan)");
  });

  it("falls back to createdAt when assetDate is null", async () => {
    const sections = { blogAssetIds: ["old-post", "new-post"] };

    dbQ.push(
      [
        { id: "old-post", title: "Old Post", assetDate: null, createdAt: new Date("2023-05-01"), url: null, status: "active" },
        { id: "new-post", title: "New Post", assetDate: null, createdAt: new Date("2023-09-01"), url: null, status: "active" },
      ],
      TENANT_ROW,
    );

    const html = await reRenderSectionsHtml(sections, CTX);

    assert.ok(html, "HTML produced");
    assert.ok(html!.indexOf("New Post") < html!.indexOf("Old Post"), "newer createdAt renders first");
  });
});

describe("reRenderSectionsHtml — blogSectionTitle and blogIntro", () => {
  it("renders a custom blogSectionTitle in the blog column heading", async () => {
    const sections = {
      blogAssetIds: ["p1"],
      blogSectionTitle: "Recent Insights",
      blogIntro: null,
    };

    dbQ.push(
      [{ id: "p1", title: "Article One", assetDate: new Date("2024-06-01"), url: "https://blog.example/1", status: "active" }],
      TENANT_ROW,
    );

    const html = await reRenderSectionsHtml(sections, CTX);
    assert.ok(html!.includes("Recent Insights"), "custom section title rendered");
    // Default heading must NOT appear when custom title is set
    assert.ok(!html!.includes("From Our Blog"), "default heading suppressed");
  });

  it("renders blogIntro above the post list", async () => {
    const sections = {
      blogAssetIds: ["p1"],
      blogSectionTitle: null,
      blogIntro: "Catch up on what we've been writing.",
    };

    dbQ.push(
      [{ id: "p1", title: "Article Two", assetDate: new Date("2024-06-01"), url: null, status: "active" }],
      TENANT_ROW,
    );

    const html = await reRenderSectionsHtml(sections, CTX);
    assert.ok(html!.includes("Catch up on what we&#x27;ve been writing.") ||
              html!.includes("Catch up on what we&apos;ve been writing.") ||
              html!.includes("Catch up on what we've been writing."),
      "blogIntro text present in output");
    // blogIntro must appear before the post list item
    const introIdx = html!.indexOf("Catch up");
    const articleIdx = html!.indexOf("Article Two");
    assert.ok(introIdx < articleIdx, "intro appears before post list");
  });

  it("HTML-escapes special characters in blogSectionTitle and blogIntro", async () => {
    const sections = {
      blogAssetIds: ["p1"],
      blogSectionTitle: "Updates & <News>",
      blogIntro: 'Read "our" notes',
    };

    dbQ.push(
      [{ id: "p1", title: "Safe Article", assetDate: new Date("2024-01-01"), url: null, status: "active" }],
      TENANT_ROW,
    );

    const html = await reRenderSectionsHtml(sections, CTX);
    // Raw angle brackets or unescaped ampersands must not appear in title/intro
    assert.ok(!html!.includes("<News>"), "angle brackets in title must be escaped");
    assert.ok(
      html!.includes("Updates &amp; &lt;News&gt;") || html!.includes("Updates &amp;"),
      "ampersand in title escaped",
    );
  });

  it("falls back to 'From Our Blog' heading when blogSectionTitle is null", async () => {
    const sections = { blogAssetIds: ["p1"], blogSectionTitle: null };

    dbQ.push(
      [{ id: "p1", title: "Fallback Post", assetDate: new Date("2024-01-01"), url: null, status: "active" }],
      TENANT_ROW,
    );

    const html = await reRenderSectionsHtml(sections, CTX);
    assert.ok(html!.includes("From Our Blog"), "default heading rendered when no custom title");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// stripDuplicateAboutSection  (pure string processing — no DB)
// ═════════════════════════════════════════════════════════════════════════════

describe("stripDuplicateAboutSection", () => {
  // ── removes heading variants ──────────────────────────────────────────────

  it("removes an <h2>About Us</h2> row from AI body", () => {
    const html = `<table><tr><td><h2>About Us</h2><p>We are great.</p></td></tr></table>`;
    const result = stripDuplicateAboutSection(html);
    assert.ok(!result.includes("About Us"), "About Us heading removed");
    assert.ok(!result.includes("We are great."), "associated paragraph removed with the row");
  });

  it("removes <h3>About Acme</h3> when companyName matches", () => {
    const html = `<tr><td><h3>About Acme</h3><p>Acme makes stuff.</p></td></tr>`;
    const result = stripDuplicateAboutSection(html, null, "Acme");
    assert.ok(!result.includes("About Acme"), "About <company> heading removed");
  });

  it("removes the configured aboutTitle heading", () => {
    const html = `<tr><td><h2>About Synozur</h2><p>Platform description.</p></td></tr>`;
    const result = stripDuplicateAboutSection(html, "About Synozur", "Synozur");
    assert.ok(!result.includes("About Synozur"), "configured aboutTitle removed");
  });

  it("removes a bold-paragraph heading (<p><strong>About Us</strong></p>)", () => {
    const html = `<table><tr><td><p><strong>About Us</strong></p><p>Body text here.</p></td></tr></table>`;
    const result = stripDuplicateAboutSection(html);
    assert.ok(!result.includes("About Us"), "bold-paragraph About Us removed");
  });

  it("removes multiple duplicate About blocks (AI sometimes writes two)", () => {
    const html = [
      `<tr><td><h2>About Us</h2><p>First copy.</p></td></tr>`,
      `<p>Main content here.</p>`,
      `<tr><td><h2>About Us</h2><p>Second copy.</p></td></tr>`,
    ].join("\n");
    const result = stripDuplicateAboutSection(html);
    // Neither occurrence should remain
    const count = (result.match(/About Us/g) ?? []).length;
    assert.equal(count, 0, "both About Us occurrences removed");
  });

  it("tolerates inline markup inside the heading tag", () => {
    const html = `<tr><td><h2><strong>About Us</strong></h2><p>Info.</p></td></tr>`;
    const result = stripDuplicateAboutSection(html);
    assert.ok(!result.includes("About Us"), "inline-markup heading removed");
  });

  // ── must NOT remove legitimate content ───────────────────────────────────

  it("does NOT remove 'About the webinar' (too specific a match would be wrong)", () => {
    const html = `<tr><td><h2>About the webinar</h2><p>Join us for details.</p></td></tr>`;
    const result = stripDuplicateAboutSection(html);
    assert.ok(result.includes("About the webinar"), "legitimate webinar heading preserved");
  });

  it("does NOT remove 'About this event' (non-company About)", () => {
    const html = `<tr><td><h3>About this event</h3><p>Event details.</p></td></tr>`;
    const result = stripDuplicateAboutSection(html);
    assert.ok(result.includes("About this event"), "event heading preserved");
  });

  it("does NOT remove CTA module content when row contains nested tables", () => {
    const html = [
      `<tr><td>`,
      `<h2>About Us</h2>`,
      `<table><tr><td><a href="https://cta.example" class="btn">Learn More</a></td></tr></table>`,
      `</td></tr>`,
    ].join("\n");
    // The nested <table> blocks whole-row removal (tr-isolation check fails).
    // The fallback only removes the heading tag itself, so the CTA module
    // content ("Learn More") must survive.
    const result = stripDuplicateAboutSection(html);
    assert.ok(result.includes("Learn More"), "CTA content inside nested table preserved");
    assert.ok(result.includes("cta.example"), "CTA href preserved");
  });

  it("does NOT remove rows that contain a .btn anchor (CTA button)", () => {
    const html = [
      `<tr><td>`,
      `<p><strong>About Us</strong></p>`,
      `<a href="https://cta.example" class="btn-primary btn">Get Started</a>`,
      `</td></tr>`,
    ].join("\n");
    const result = stripDuplicateAboutSection(html);
    assert.ok(result.includes("Get Started"), "CTA anchor preserved");
  });

  it("does NOT remove the orbit:sections block", () => {
    const html = [
      `<!-- orbit:sections:start -->`,
      `<tr><td><h2>About Us</h2><p>Configured About block.</p></td></tr>`,
      `<!-- orbit:sections:end -->`,
    ].join("\n");
    const result = stripDuplicateAboutSection(html);
    // The row contains the sections marker so it must be left untouched.
    assert.ok(result.includes("orbit:sections:start"), "sections block preserved");
  });

  it("returns input unchanged when no About heading is present", () => {
    const html = `<p>Just a normal email body with no About section.</p>`;
    const result = stripDuplicateAboutSection(html);
    assert.equal(result, html, "unmodified when no match");
  });
});
