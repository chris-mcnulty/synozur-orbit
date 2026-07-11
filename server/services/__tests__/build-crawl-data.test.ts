import { strict as assert } from "node:assert";
import { describe, it, vi, afterEach } from "vitest";
import { buildCrawlData } from "../web-crawler";
import {
  isCoverageCollapse,
  COVERAGE_COLLAPSE_MAX_AGE_MS,
} from "../website-monitoring";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal CrawlSummary with N pages, optionally overriding crawledAt. */
function makeSummary(pageCount: number, crawledAt?: string) {
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    url: `https://example.com/page${i}`,
    pageType: "other" as const,
    title: `Page ${i}`,
    content: "content",
    wordCount: 100,
    crawledAt: crawledAt ?? new Date().toISOString(),
  }));
  return {
    baseUrl: "https://example.com",
    pages,
    totalWordCount: pageCount * 100,
    crawledAt: crawledAt as string, // may be undefined — intentional for test cases
    socialLinks: {},
  };
}

// ---------------------------------------------------------------------------
// buildCrawlData — happy path
// ---------------------------------------------------------------------------

describe("buildCrawlData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes crawledAt through unchanged when it is present", () => {
    const ts = "2025-06-01T12:00:00.000Z";
    const summary = makeSummary(3, ts);
    const result = buildCrawlData(summary);
    assert.equal(result.crawledAt, ts);
  });

  it("maps pages to the expected shape", () => {
    const ts = new Date().toISOString();
    const summary = makeSummary(2, ts);
    const result = buildCrawlData(summary);
    assert.equal(result.pagesCrawled.length, 2);
    const p0 = result.pagesCrawled[0];
    assert.ok("url" in p0);
    assert.ok("pageType" in p0);
    assert.ok("title" in p0);
    assert.ok("wordCount" in p0);
    // content must NOT leak into the stored payload
    assert.ok(!("content" in p0));
  });

  it("returns the correct totalWordCount", () => {
    const ts = new Date().toISOString();
    const summary = makeSummary(4, ts);
    const result = buildCrawlData(summary);
    assert.equal(result.totalWordCount, 400);
  });

  it("does not emit a warning when crawledAt is present", () => {
    const warn = vi.spyOn(console, "warn");
    const ts = new Date().toISOString();
    buildCrawlData(makeSummary(2, ts));
    assert.equal(warn.mock.calls.length, 0);
  });

  // ---------------------------------------------------------------------------
  // Backfill behaviour — missing crawledAt
  // ---------------------------------------------------------------------------

  it("backfills crawledAt with a valid ISO string when it is missing", () => {
    const before = Date.now();
    const summary = makeSummary(3); // crawledAt will be undefined on the summary
    (summary as any).crawledAt = undefined;
    const result = buildCrawlData(summary as any);
    const after = Date.now();

    assert.ok(typeof result.crawledAt === "string", "crawledAt should be a string");
    const ts = Date.parse(result.crawledAt);
    assert.ok(!isNaN(ts), "backfilled crawledAt should be a valid date");
    assert.ok(ts >= before && ts <= after, "backfilled crawledAt should be close to now");
  });

  it("emits a console.warn when crawledAt is missing", () => {
    const warn = vi.spyOn(console, "warn");
    const summary = makeSummary(3);
    (summary as any).crawledAt = undefined;
    buildCrawlData(summary as any);
    assert.equal(warn.mock.calls.length, 1);
    const message: string = warn.mock.calls[0][0];
    assert.ok(message.includes("[buildCrawlData]"), "warning should identify the source");
    assert.ok(
      message.toLowerCase().includes("missing") || message.toLowerCase().includes("backfill"),
      "warning should explain what happened"
    );
  });

  it("emits exactly one warning per call, not multiple", () => {
    const warn = vi.spyOn(console, "warn");
    const summary = makeSummary(5);
    (summary as any).crawledAt = undefined;
    buildCrawlData(summary as any);
    assert.equal(warn.mock.calls.length, 1);
  });

  // ---------------------------------------------------------------------------
  // isCoverageCollapse guard interaction
  //
  // A backfilled crawledAt (= now) is a valid, fresh timestamp.  The guard's
  // stale-baseline escape hatch must NOT fire for a fresh baseline, so
  // isCoverageCollapse correctly stays active and catches genuine collapses.
  // Without a backfill (crawledAt missing), the guard's `!crawledAt` branch
  // also keeps it active — but that path is fragile: a single undefined could
  // silently bypass the escape-hatch logic in future.  buildCrawlData's
  // backfill ensures the guard always receives a real timestamp.
  // ---------------------------------------------------------------------------

  it("guard stays active when previous crawlData has a backfilled (fresh) timestamp", () => {
    const summary = makeSummary(10);
    (summary as any).crawledAt = undefined;

    const crawlData = buildCrawlData(summary as any);
    // Simulate storing the result then using it as prevCrawlData on the next run
    const prevCrawlData = {
      pagesCrawled: crawlData.pagesCrawled.map((p) => p.url),
      crawledAt: crawlData.crawledAt, // the backfilled, fresh timestamp
    };

    // Fresh baseline → stale-baseline escape hatch must NOT fire →
    // guard is active → collapse should be detected (10 → 1 pages)
    assert.equal(isCoverageCollapse(prevCrawlData, 1), true);
  });

  it("guard correctly exits via escape hatch when backfilled timestamp is aged past the staleness window", () => {
    // Build with a backfill, then pretend time has passed beyond the window.
    const summary = makeSummary(10);
    (summary as any).crawledAt = undefined;
    const crawlData = buildCrawlData(summary as any);

    // Simulate a stale baseline by back-dating the timestamp
    const staleTs = new Date(
      Date.now() - (COVERAGE_COLLAPSE_MAX_AGE_MS + 1)
    ).toISOString();
    const prevCrawlData = {
      pagesCrawled: crawlData.pagesCrawled.map((p) => p.url),
      crawledAt: staleTs,
    };

    // Stale baseline → escape hatch fires → guard stands down
    assert.equal(isCoverageCollapse(prevCrawlData, 1), false);
  });

  it("guard with backfilled timestamp behaves identically to an explicit fresh timestamp for collapse detection", () => {
    const summary = makeSummary(10);
    (summary as any).crawledAt = undefined;
    const crawlData = buildCrawlData(summary as any);

    const fromBackfill = {
      pagesCrawled: crawlData.pagesCrawled.map((p) => p.url),
      crawledAt: crawlData.crawledAt,
    };
    const fromExplicit = {
      pagesCrawled: fromBackfill.pagesCrawled,
      crawledAt: new Date().toISOString(),
    };

    // Both must agree on the collapse decision
    assert.equal(
      isCoverageCollapse(fromBackfill, 1),
      isCoverageCollapse(fromExplicit, 1)
    );
  });
});
