import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  isCoverageCollapse,
  MIN_PREV_PAGES_FOR_COVERAGE,
  COVERAGE_COLLAPSE_FRACTION,
  COVERAGE_COLLAPSE_MAX_AGE_MS,
} from "../website-monitoring";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal crawlData object with N pages and a crawledAt timestamp. */
function crawlData(pageCount: number, ageMs = 0): { pagesCrawled: string[]; crawledAt: string } {
  const crawledAt = new Date(Date.now() - ageMs).toISOString();
  return {
    pagesCrawled: Array.from({ length: pageCount }, (_, i) => `https://example.com/page${i}`),
    crawledAt,
  };
}

/** A fresh crawl (just happened). */
const NOW = 0;

/** An age that is safely inside the 30-day escape-hatch window. */
const RECENT_MS = COVERAGE_COLLAPSE_MAX_AGE_MS - 1;

/** An age that trips the stale-baseline escape hatch (> 30 days old). */
const STALE_MS = COVERAGE_COLLAPSE_MAX_AGE_MS + 1;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isCoverageCollapse", () => {
  // -------------------------------------------------------------------------
  // Genuine multi-page collapse — must be suppressed
  // -------------------------------------------------------------------------

  it("returns true when a large multi-page site collapses to a single page", () => {
    // Previously crawled 10 pages; now only 1 (well under 40% of 10).
    const prev = crawlData(10, NOW);
    assert.equal(isCoverageCollapse(prev, 1), true);
  });

  it("returns true when current page count is just below the collapse fraction", () => {
    // Prev = MIN_PREV_PAGES_FOR_COVERAGE (3); boundary is 3 * 0.4 = 1.2, so
    // current must be < 1.2, i.e. 0 or 1 to trigger.
    const prev = crawlData(MIN_PREV_PAGES_FOR_COVERAGE, NOW);
    const collapseThreshold = Math.ceil(MIN_PREV_PAGES_FOR_COVERAGE * COVERAGE_COLLAPSE_FRACTION);
    assert.equal(isCoverageCollapse(prev, collapseThreshold - 1), true);
  });

  it("returns true for a 20-page site that suddenly yields only 3 pages", () => {
    const prev = crawlData(20, NOW);
    // 3 / 20 = 0.15 — well below COVERAGE_COLLAPSE_FRACTION (0.4)
    assert.equal(isCoverageCollapse(prev, 3), true);
  });

  // -------------------------------------------------------------------------
  // Full or sufficient crawl of a small site — must NOT be flagged
  // -------------------------------------------------------------------------

  it("returns false for a site that was always only 2 pages (below MIN_PREV_PAGES_FOR_COVERAGE)", () => {
    // The guard only activates for sites we've seen as multi-page (>= 3 pages).
    const prev = crawlData(MIN_PREV_PAGES_FOR_COVERAGE - 1, NOW);
    assert.equal(isCoverageCollapse(prev, 1), false);
  });

  it("returns false when a 5-page site is still returning 5 pages", () => {
    const prev = crawlData(5, NOW);
    assert.equal(isCoverageCollapse(prev, 5), false);
  });

  it("returns false when current pages exactly meets the collapse fraction boundary", () => {
    // Prev = 10 pages; fraction = 10 * 0.4 = 4.0.
    // currentPageCount >= 4 must not be flagged.
    const prev = crawlData(10, NOW);
    assert.equal(isCoverageCollapse(prev, 4), false);
  });

  it("returns false when crawl only slightly decreased (above collapse fraction)", () => {
    // 10 → 7 pages: 0.7 > COVERAGE_COLLAPSE_FRACTION (0.4) — a real reduction, not a collapse.
    const prev = crawlData(10, NOW);
    assert.equal(isCoverageCollapse(prev, 7), false);
  });

  // -------------------------------------------------------------------------
  // Site that genuinely shrunk — must still alert
  // -------------------------------------------------------------------------

  it("returns false when a site genuinely reduced to half its pages (above fraction)", () => {
    // 8 → 4 pages: ratio = 0.5 > 0.4; this is a real business change, not a crawl failure.
    const prev = crawlData(8, NOW);
    assert.equal(isCoverageCollapse(prev, 4), false);
  });

  it("returns false when a large site reduced by one quarter (not a collapse)", () => {
    // 20 → 15 pages: 0.75 ratio — not a coverage collapse.
    const prev = crawlData(20, NOW);
    assert.equal(isCoverageCollapse(prev, 15), false);
  });

  // -------------------------------------------------------------------------
  // Stale-baseline escape hatch
  // -------------------------------------------------------------------------

  it("returns false when the previous crawl is older than COVERAGE_COLLAPSE_MAX_AGE_MS", () => {
    // The baseline is over 30 days stale — the reduced count is now the real
    // site shape, so the guard should stand down.
    const prev = crawlData(10, STALE_MS);
    assert.equal(isCoverageCollapse(prev, 1), false);
  });

  it("returns true when the previous crawl is just within the freshness window", () => {
    // One millisecond inside the 30-day window — guard is still active.
    const prev = crawlData(10, RECENT_MS);
    assert.equal(isCoverageCollapse(prev, 1), true);
  });

  it("returns true when crawledAt is missing (guard stays active — escape hatch requires a real timestamp)", () => {
    // No crawledAt → crawledAt resolves to 0.  The explicit `if (!crawledAt) return true`
    // guard keeps the escape hatch inactive: without a real timestamp we cannot confirm
    // the baseline is stale, so we conservatively treat the collapse as genuine.
    const prev = { pagesCrawled: Array.from({ length: 10 }, (_, i) => `https://example.com/p${i}`) };
    assert.equal(isCoverageCollapse(prev, 1), true);
  });

  // -------------------------------------------------------------------------
  // Malformed / missing prevCrawlData — must never throw
  // -------------------------------------------------------------------------

  it("returns false when prevCrawlData is null", () => {
    assert.equal(isCoverageCollapse(null, 1), false);
  });

  it("returns false when prevCrawlData is undefined", () => {
    assert.equal(isCoverageCollapse(undefined, 1), false);
  });

  it("returns false when pagesCrawled is not an array", () => {
    assert.equal(isCoverageCollapse({ pagesCrawled: "not-an-array", crawledAt: new Date().toISOString() }, 1), false);
  });

  it("returns false when pagesCrawled is an empty array (zero prior pages)", () => {
    const prev = crawlData(0, NOW);
    assert.equal(isCoverageCollapse(prev, 1), false);
  });
});
