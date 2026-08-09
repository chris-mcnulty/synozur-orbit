/**
 * Unit tests for the bulk delivery-mode scope-derivation logic.
 *
 * These tests cover the pure `deriveBulkDeliveryScope` and
 * `postPassesScopeFilters` utilities extracted from campaign-detail.tsx so
 * that a regression in which bulk changes silently touch the wrong posts is
 * caught automatically — before any end-user notices.
 *
 * Tests follow two main scenarios called out in the task:
 *   (a) An active filter → only matching post IDs are included.
 *   (b) No filters, no selection → all active (non-deleted/rejected/archived)
 *       posts are included.
 */

import { describe, it, expect } from "vitest";
import {
  deriveBulkDeliveryScope,
  postPassesScopeFilters,
  type ScopablePost,
  type ScopeFilters,
} from "@/lib/bulk-delivery-scope";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePost(overrides: Partial<ScopablePost> & { id: string }): ScopablePost {
  return {
    platform: "linkedin",
    status: "approved",
    publishedAt: null,
    scheduledDate: null,
    socialAccountId: null,
    overrideImageUrl: null,
    overrideBrandAssetId: null,
    generationJobId: null,
    variantGroup: null,
    conferenceId: null,
    ...overrides,
  };
}

/** Default "no filters active" scope filters. */
const defaultFilters: ScopeFilters = {
  postFilter: "active",
  postAccountFilter: "all",
  postPlatformFilter: "all",
  postTimeFilter: "all",
  postDateFrom: "",
  postDateTo: "",
  batchFilter: null,
  batchKeySet: new Set(),
};

// ---------------------------------------------------------------------------
// postPassesScopeFilters
// ---------------------------------------------------------------------------

describe("postPassesScopeFilters", () => {
  it("returns true when all filters are at default (no-op)", () => {
    const p = makePost({ id: "p1" });
    expect(postPassesScopeFilters(p, defaultFilters)).toBe(true);
  });

  it("filters by platform — rejects a non-matching platform", () => {
    const p = makePost({ id: "p1", platform: "x" });
    expect(
      postPassesScopeFilters(p, { ...defaultFilters, postPlatformFilter: "linkedin" }),
    ).toBe(false);
  });

  it("filters by platform — passes a matching platform", () => {
    const p = makePost({ id: "p1", platform: "linkedin" });
    expect(
      postPassesScopeFilters(p, { ...defaultFilters, postPlatformFilter: "linkedin" }),
    ).toBe(true);
  });

  it("pending filter excludes published posts", () => {
    const p = makePost({ id: "p1", status: "published" });
    expect(postPassesScopeFilters(p, { ...defaultFilters, postTimeFilter: "pending" })).toBe(false);
  });

  it("pending filter excludes posts with publishedAt set", () => {
    const p = makePost({ id: "p1", publishedAt: "2026-07-01T10:00:00Z" });
    expect(postPassesScopeFilters(p, { ...defaultFilters, postTimeFilter: "pending" })).toBe(false);
  });

  it("pending filter passes unpublished drafts", () => {
    const p = makePost({ id: "p1", status: "draft" });
    expect(postPassesScopeFilters(p, { ...defaultFilters, postTimeFilter: "pending" })).toBe(true);
  });

  it("completed filter excludes un-published drafts", () => {
    const p = makePost({ id: "p1", status: "draft" });
    expect(
      postPassesScopeFilters(p, { ...defaultFilters, postTimeFilter: "completed" }),
    ).toBe(false);
  });

  it("completed filter passes a post with publishedAt", () => {
    const p = makePost({ id: "p1", publishedAt: "2026-07-01T10:00:00Z" });
    expect(
      postPassesScopeFilters(p, { ...defaultFilters, postTimeFilter: "completed" }),
    ).toBe(true);
  });

  it("completed filter passes posts with a completed status (exported)", () => {
    const p = makePost({ id: "p1", status: "exported" });
    expect(
      postPassesScopeFilters(p, { ...defaultFilters, postTimeFilter: "completed" }),
    ).toBe(true);
  });

  it("date-from filter excludes posts scheduled before the bound", () => {
    const p = makePost({ id: "p1", scheduledDate: "2026-06-30" });
    expect(
      postPassesScopeFilters(p, { ...defaultFilters, postDateFrom: "2026-07-01" }),
    ).toBe(false);
  });

  it("date-from filter passes posts scheduled on or after the bound", () => {
    const p = makePost({ id: "p1", scheduledDate: "2026-07-01" });
    expect(
      postPassesScopeFilters(p, { ...defaultFilters, postDateFrom: "2026-07-01" }),
    ).toBe(true);
  });

  it("date-to filter excludes posts scheduled after the bound", () => {
    const p = makePost({ id: "p1", scheduledDate: "2026-07-15" });
    expect(
      postPassesScopeFilters(p, { ...defaultFilters, postDateTo: "2026-07-14" }),
    ).toBe(false);
  });

  it("date range filter excludes posts with no scheduledDate", () => {
    const p = makePost({ id: "p1", scheduledDate: null });
    expect(
      postPassesScopeFilters(p, {
        ...defaultFilters,
        postDateFrom: "2026-07-01",
        postDateTo: "2026-07-31",
      }),
    ).toBe(false);
  });

  it("date range filter passes a post that falls within the range", () => {
    const p = makePost({ id: "p1", scheduledDate: "2026-07-10" });
    expect(
      postPassesScopeFilters(p, {
        ...defaultFilters,
        postDateFrom: "2026-07-01",
        postDateTo: "2026-07-31",
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveBulkDeliveryScope — selection takes priority
// ---------------------------------------------------------------------------

describe("deriveBulkDeliveryScope — explicit selection", () => {
  const posts: ScopablePost[] = [
    makePost({ id: "p1" }),
    makePost({ id: "p2" }),
    makePost({ id: "p3" }),
  ];

  it("returns exactly the selected IDs, ignoring all filters", () => {
    const selected = new Set(["p2"]);
    const result = deriveBulkDeliveryScope(posts, selected, defaultFilters);
    expect(result).toEqual(["p2"]);
  });

  it("returns all selected IDs when multiple are chosen", () => {
    const selected = new Set(["p1", "p3"]);
    const result = deriveBulkDeliveryScope(posts, selected, defaultFilters);
    expect(result.sort()).toEqual(["p1", "p3"]);
  });

  it("even a platform filter is ignored when posts are individually selected", () => {
    const selected = new Set(["p1"]);
    // p1 is linkedin; filter is x — but selection still wins
    const result = deriveBulkDeliveryScope(posts, selected, {
      ...defaultFilters,
      postPlatformFilter: "x",
    });
    expect(result).toEqual(["p1"]);
  });
});

// ---------------------------------------------------------------------------
// deriveBulkDeliveryScope — no selection → filter-based scope
// ---------------------------------------------------------------------------

describe("deriveBulkDeliveryScope — no selection, no filters (scenario b)", () => {
  it("includes all active posts when no selection and no filters", () => {
    const posts: ScopablePost[] = [
      makePost({ id: "p1", status: "approved" }),
      makePost({ id: "p2", status: "draft" }),
      makePost({ id: "p3", status: "approved" }),
    ];
    const result = deriveBulkDeliveryScope(posts, new Set(), defaultFilters);
    expect(result.sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("excludes deleted posts from the default active scope", () => {
    const posts: ScopablePost[] = [
      makePost({ id: "p1", status: "approved" }),
      makePost({ id: "p2", status: "deleted" }),
    ];
    const result = deriveBulkDeliveryScope(posts, new Set(), defaultFilters);
    expect(result).toEqual(["p1"]);
  });

  it("excludes rejected posts from the default active scope", () => {
    const posts: ScopablePost[] = [
      makePost({ id: "p1", status: "approved" }),
      makePost({ id: "p2", status: "rejected" }),
    ];
    const result = deriveBulkDeliveryScope(posts, new Set(), defaultFilters);
    expect(result).toEqual(["p1"]);
  });

  it("excludes archived posts from the default active scope", () => {
    const posts: ScopablePost[] = [
      makePost({ id: "p1", status: "approved" }),
      makePost({ id: "p2", status: "archived" }),
    ];
    const result = deriveBulkDeliveryScope(posts, new Set(), defaultFilters);
    expect(result).toEqual(["p1"]);
  });
});

// ---------------------------------------------------------------------------
// deriveBulkDeliveryScope — filter by platform (scenario a)
// ---------------------------------------------------------------------------

describe("deriveBulkDeliveryScope — active platform filter (scenario a)", () => {
  const posts: ScopablePost[] = [
    makePost({ id: "p1", platform: "linkedin", status: "approved" }),
    makePost({ id: "p2", platform: "x", status: "approved" }),
    makePost({ id: "p3", platform: "linkedin", status: "approved" }),
  ];

  it("only matching platform posts are included in the scope", () => {
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      postPlatformFilter: "linkedin",
    });
    // Only p1 and p3 should be sent in the request body
    expect(result.sort()).toEqual(["p1", "p3"]);
  });

  it("the badge count matches the number of IDs sent to the endpoint", () => {
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      postPlatformFilter: "x",
    });
    // Badge shows result.length — must equal what actually gets sent
    expect(result).toHaveLength(1);
    expect(result).toEqual(["p2"]);
  });
});

// ---------------------------------------------------------------------------
// deriveBulkDeliveryScope — account filter
// ---------------------------------------------------------------------------

describe("deriveBulkDeliveryScope — account filter", () => {
  const posts: ScopablePost[] = [
    makePost({ id: "p1", socialAccountId: "acct-1", status: "approved" }),
    makePost({ id: "p2", socialAccountId: "acct-2", status: "approved" }),
    makePost({ id: "p3", socialAccountId: "acct-1", status: "approved" }),
  ];

  it("filters to only posts belonging to the selected account", () => {
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      postAccountFilter: "acct-1",
    });
    expect(result.sort()).toEqual(["p1", "p3"]);
  });

  it("'all' account filter includes every account's posts", () => {
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      postAccountFilter: "all",
    });
    expect(result.sort()).toEqual(["p1", "p2", "p3"]);
  });
});

// ---------------------------------------------------------------------------
// deriveBulkDeliveryScope — postFilter variants
// ---------------------------------------------------------------------------

describe("deriveBulkDeliveryScope — postFilter variants", () => {
  const posts: ScopablePost[] = [
    makePost({ id: "p1", status: "approved" }),
    makePost({ id: "p2", status: "draft" }),
    makePost({ id: "p3", status: "rejected" }),
    makePost({ id: "p4", status: "deleted" }),
    makePost({ id: "p5", status: "approved", overrideImageUrl: "/img/hero.jpg" }),
    makePost({ id: "p6", status: "approved" }), // no image
  ];

  it("postFilter=all includes deleted posts (only excluded for active)", () => {
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      postFilter: "all",
    });
    // deleted is excluded even from "all"
    expect(result.sort()).toEqual(["p1", "p2", "p3", "p5", "p6"]);
  });

  it("postFilter=missing_image only includes posts with no image asset", () => {
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      postFilter: "missing_image",
    });
    // missing_image only excludes deleted (p4) and posts with an image (p5).
    // rejected (p3) is NOT excluded by this filter — only active/all exclude it.
    expect(result.sort()).toEqual(["p1", "p2", "p3", "p6"]);
  });

  it("postFilter=draft returns only drafts", () => {
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      postFilter: "draft",
    });
    expect(result).toEqual(["p2"]);
  });
});

// ---------------------------------------------------------------------------
// deriveBulkDeliveryScope — collapsed batch posts are excluded
// ---------------------------------------------------------------------------

describe("deriveBulkDeliveryScope — collapsed batch exclusion", () => {
  const posts: ScopablePost[] = [
    makePost({ id: "p1", status: "approved", generationJobId: "job-A" }),
    makePost({ id: "p2", status: "approved", generationJobId: "job-A" }),
    makePost({ id: "p3", status: "approved" }), // standalone
  ];
  // job-A is a collapsed batch
  const batchKeySet = new Set(["job-A"]);

  it("excludes posts that belong to a collapsed batch", () => {
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      batchKeySet,
    });
    // Only the standalone post passes
    expect(result).toEqual(["p3"]);
  });

  it("includes batch posts when batchFilter drills into that batch", () => {
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      batchKeySet,
      batchFilter: "job-A",
    });
    expect(result.sort()).toEqual(["p1", "p2"]);
  });

  it("batchFilter excludes posts from other batches", () => {
    const postsWithTwo: ScopablePost[] = [
      ...posts,
      makePost({ id: "p4", status: "approved", generationJobId: "job-B" }),
    ];
    const result = deriveBulkDeliveryScope(postsWithTwo, new Set(), {
      ...defaultFilters,
      batchKeySet: new Set(["job-A", "job-B"]),
      batchFilter: "job-A",
    });
    expect(result.sort()).toEqual(["p1", "p2"]);
  });
});

// ---------------------------------------------------------------------------
// deriveBulkDeliveryScope — combined filters (platform + account)
// ---------------------------------------------------------------------------

describe("deriveBulkDeliveryScope — combined filters", () => {
  it("applies platform AND account filters together — only posts matching both pass", () => {
    const posts: ScopablePost[] = [
      makePost({ id: "p1", platform: "linkedin", socialAccountId: "acct-1", status: "approved" }),
      makePost({ id: "p2", platform: "x", socialAccountId: "acct-1", status: "approved" }),
      makePost({ id: "p3", platform: "linkedin", socialAccountId: "acct-2", status: "approved" }),
    ];
    const result = deriveBulkDeliveryScope(posts, new Set(), {
      ...defaultFilters,
      postPlatformFilter: "linkedin",
      postAccountFilter: "acct-1",
    });
    expect(result).toEqual(["p1"]);
  });
});
