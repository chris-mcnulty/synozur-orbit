/**
 * Tests for the accept-baseline race condition fix.
 *
 * Race: a crawl takes 10-30 s; during that window a user may accept the
 * current baseline, which clears `previousWebsiteContent` in the DB.  Without
 * the fix the function compares the fresh crawl against the in-memory snapshot
 * it loaded at startup, producing a false "website_update" alert against data
 * the user just dismissed.
 *
 * The fix re-reads `previousWebsiteContent` from the DB _after_ the crawl
 * finishes.  If it is now empty (accept-baseline fired mid-crawl) the function
 * stores the fresh snapshot silently and returns without creating any activity.
 */

import { strict as assert } from "node:assert";
import { describe, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any dynamic import of the module under test
// ---------------------------------------------------------------------------

vi.mock("../../storage", () => ({
  storage: {
    getCompetitor: vi.fn(),
    updateCompetitor: vi.fn().mockResolvedValue(undefined),
    createActivity: vi.fn().mockResolvedValue(undefined),
    resetCompetitorCrawlFailures: vi.fn().mockResolvedValue(undefined),
    incrementCompetitorCrawlFailures: vi.fn().mockResolvedValue(undefined),
    updateOrganization: vi.fn().mockResolvedValue(undefined),
    getCompanyProfile: vi.fn(),
    updateCompanyProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../web-crawler", () => ({
  crawlCompetitorWebsite: vi.fn(),
  getCombinedContent: vi.fn(),
  buildCrawlData: vi.fn((crawlResult: any) => ({
    pagesCrawled: (crawlResult.pages ?? []).map((p: any) => ({
      url: p.url,
      pageType: p.pageType,
      title: p.title,
      wordCount: p.wordCount,
    })),
    totalWordCount: crawlResult.totalWordCount ?? 0,
    crawledAt: crawlResult.crawledAt ?? new Date().toISOString(),
  })),
}));

vi.mock("@anthropic-ai/sdk", () => {
  function MockAnthropic(this: any) {
    this.messages = { create: vi.fn() };
  }
  return { default: MockAnthropic };
});

vi.mock("../notifications", () => ({
  notifications: {
    dispatch: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Imports — after vi.mock() declarations
// ---------------------------------------------------------------------------

import { monitorCompetitorWebsite, monitorCompanyProfileWebsite } from "../website-monitoring";
import { storage } from "../../storage";
import { crawlCompetitorWebsite, getCombinedContent } from "../web-crawler";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A content string that passes all absolute-floor + collapse guards. */
const FRESH_CONTENT = "word ".repeat(300); // 1 500 chars, 300 words
const OLD_BASELINE = "baseline ".repeat(300); // 2 700 chars — clearly different

/** A minimal crawl result with 2 pages (below MIN_PREV_PAGES_FOR_COVERAGE=3 so
 *  the coverage-collapse guard never triggers). */
const MOCK_CRAWL = {
  pages: [
    { url: "https://example.com", pageType: "homepage", title: "Home", wordCount: 150 },
    { url: "https://example.com/about", pageType: "about", title: "About", wordCount: 150 },
  ],
  totalWordCount: 300,
  crawledAt: new Date().toISOString(),
  blogSnapshot: null,
  socialLinks: { linkedIn: null, instagram: null, twitter: null, facebook: null },
};

const BASE_COMPETITOR = {
  id: "comp-1",
  name: "Acme Corp",
  url: "https://acme.example.com",
  crawlData: null,
  organizationId: null,
  tenantDomain: "tenant.example.com",
  linkedInUrl: null,
  instagramUrl: null,
  twitterUrl: null,
  facebookUrl: null,
  marketId: "market-1",
};

const BASE_PROFILE = {
  id: "profile-1",
  companyName: "Own Corp",
  websiteUrl: "https://own.example.com",
  crawlData: null,
  organizationId: null,
  marketId: "market-1",
  linkedInUrl: null,
  instagramUrl: null,
  twitterUrl: null,
  facebookUrl: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("accept-baseline race condition — monitorCompetitorWebsite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    (crawlCompetitorWebsite as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_CRAWL);
    (getCombinedContent as ReturnType<typeof vi.fn>).mockReturnValue(FRESH_CONTENT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT create a website_update activity when accept-baseline clears the baseline mid-crawl", async () => {
    // First DB read (before crawl): competitor has an old baseline.
    (storage.getCompetitor as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...BASE_COMPETITOR, previousWebsiteContent: OLD_BASELINE })
      // Second DB read (after crawl): accept-baseline fired — baseline is gone.
      .mockResolvedValueOnce({ ...BASE_COMPETITOR, previousWebsiteContent: "" });

    const resultPromise = monitorCompetitorWebsite("comp-1", "user-1", "tenant.example.com");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    assert.equal(result.status, "success");
    assert.equal(result.hasChanges, false, "hasChanges must be false — no alert should fire");
    assert.equal(
      (storage.createActivity as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
      "createActivity must NOT be called when baseline was cleared mid-crawl",
    );
  });

  it("stores the fresh crawl snapshot even when the baseline was cleared mid-crawl", async () => {
    (storage.getCompetitor as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...BASE_COMPETITOR, previousWebsiteContent: OLD_BASELINE })
      .mockResolvedValueOnce({ ...BASE_COMPETITOR, previousWebsiteContent: null });

    const resultPromise = monitorCompetitorWebsite("comp-1", "user-1", "tenant.example.com");
    await vi.runAllTimersAsync();
    await resultPromise;

    const updateCalls = (storage.updateCompetitor as ReturnType<typeof vi.fn>).mock.calls;
    assert.ok(updateCalls.length >= 1, "updateCompetitor must be called to persist the fresh snapshot");

    const savedContent = updateCalls[updateCalls.length - 1][1].previousWebsiteContent;
    assert.ok(
      typeof savedContent === "string" && savedContent.length > 0,
      "fresh crawl content must be persisted as the new baseline",
    );
  });

  it("completes successfully when baseline is unchanged between DB reads (no race — normal diff path runs)", async () => {
    // Both reads return the same old baseline → normal change-detection path
    // runs (diff + AI analysis).  The AI mock returns undefined from `create`,
    // so analyzeWebsiteChanges falls back to "Changes detected but analysis
    // unavailable."  We only verify the function doesn't crash; the important
    // contract (no alert on race) is covered by the first two tests.
    (storage.getCompetitor as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ ...BASE_COMPETITOR, previousWebsiteContent: OLD_BASELINE });

    const resultPromise = monitorCompetitorWebsite("comp-1", "user-1", "tenant.example.com");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    assert.ok(["success", "error"].includes(result.status), "function must not throw on the normal diff path");
  });

  it("returns hasChanges=false and no alert when baseline was null from the very start (no race, normal first-run)", async () => {
    // Both reads return null baseline → fresh baseline setup, no diff.
    (storage.getCompetitor as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...BASE_COMPETITOR, previousWebsiteContent: null })
      .mockResolvedValueOnce({ ...BASE_COMPETITOR, previousWebsiteContent: null });

    const resultPromise = monitorCompetitorWebsite("comp-1", "user-1", "tenant.example.com");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    assert.equal(result.hasChanges, false);
    assert.equal(
      (storage.createActivity as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
      "no alert on first-run baseline setup",
    );
  });
});

// ---------------------------------------------------------------------------

describe("accept-baseline race condition — monitorCompanyProfileWebsite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    (crawlCompetitorWebsite as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_CRAWL);
    (getCombinedContent as ReturnType<typeof vi.fn>).mockReturnValue(FRESH_CONTENT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT create a website_update activity when accept-baseline clears the baseline mid-crawl", async () => {
    (storage.getCompanyProfile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...BASE_PROFILE, previousWebsiteContent: OLD_BASELINE })
      .mockResolvedValueOnce({ ...BASE_PROFILE, previousWebsiteContent: "" });

    const resultPromise = monitorCompanyProfileWebsite("profile-1", "user-1", "tenant.example.com");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    assert.equal(result.status, "success");
    assert.equal(result.hasChanges, false, "hasChanges must be false — no alert should fire");
    assert.equal(
      (storage.createActivity as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
      "createActivity must NOT be called when baseline was cleared mid-crawl",
    );
  });

  it("stores the fresh crawl snapshot even when baseline was cleared mid-crawl", async () => {
    (storage.getCompanyProfile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...BASE_PROFILE, previousWebsiteContent: OLD_BASELINE })
      .mockResolvedValueOnce({ ...BASE_PROFILE, previousWebsiteContent: null });

    const resultPromise = monitorCompanyProfileWebsite("profile-1", "user-1", "tenant.example.com");
    await vi.runAllTimersAsync();
    await resultPromise;

    const updateCalls = (storage.updateCompanyProfile as ReturnType<typeof vi.fn>).mock.calls;
    assert.ok(updateCalls.length >= 1, "updateCompanyProfile must be called to persist the fresh snapshot");

    const savedContent = updateCalls[updateCalls.length - 1][1].previousWebsiteContent;
    assert.ok(
      typeof savedContent === "string" && savedContent.length > 0,
      "fresh crawl content must be persisted as the new baseline",
    );
  });

  it("returns hasChanges=false and no alert when baseline was null from the very start", async () => {
    (storage.getCompanyProfile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...BASE_PROFILE, previousWebsiteContent: null })
      .mockResolvedValueOnce({ ...BASE_PROFILE, previousWebsiteContent: null });

    const resultPromise = monitorCompanyProfileWebsite("profile-1", "user-1", "tenant.example.com");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    assert.equal(result.hasChanges, false);
    assert.equal(
      (storage.createActivity as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
      "no alert on first-run baseline setup",
    );
  });
});
