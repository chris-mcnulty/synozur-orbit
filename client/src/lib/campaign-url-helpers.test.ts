import { describe, it, expect } from "vitest";
import { tabFromHash, filterFromSearch, CAMPAIGN_TABS } from "./campaign-url-helpers";

/**
 * Cross-campaign navigation contract
 * -----------------------------------
 * When the user navigates from Campaign A to Campaign B, the [id] effect in
 * campaign-detail.tsx runs with the new URL already in place.  It does:
 *
 *   setPostFilter(filterFromSearch(window.location.search) ?? "active");
 *
 * The `?? "active"` fallback is critical: it resets stale filter state from
 * Campaign A when Campaign B's URL carries no ?filter= param.
 *
 * The tests in "cross-campaign navigation" below pin the exact helper outputs
 * that the effect depends on so a future refactor cannot silently break them.
 */

describe("tabFromHash", () => {
  it("returns the tab for every valid campaign tab (with # prefix)", () => {
    for (const tab of CAMPAIGN_TABS) {
      expect(tabFromHash(`#${tab}`)).toBe(tab);
    }
  });

  it("returns the tab when hash has no # prefix", () => {
    expect(tabFromHash("posts")).toBe("posts");
    expect(tabFromHash("review")).toBe("review");
  });

  it("defaults to 'plan' for an empty hash", () => {
    expect(tabFromHash("")).toBe("plan");
    expect(tabFromHash("#")).toBe("plan");
  });

  it("defaults to 'plan' for an unknown hash value", () => {
    expect(tabFromHash("#unknown-tab")).toBe("plan");
    expect(tabFromHash("#settings")).toBe("plan");
    expect(tabFromHash("#POSTS")).toBe("plan"); // case-sensitive
  });

  it("correctly identifies the 'posts' tab — the nudge-link target for social failures", () => {
    expect(tabFromHash("#posts")).toBe("posts");
  });

  it("correctly identifies the 'review' tab — the nudge-link target for approvals", () => {
    expect(tabFromHash("#review")).toBe("review");
  });
});

describe("filterFromSearch", () => {
  it("extracts a filter value from a search string", () => {
    expect(filterFromSearch("?filter=publish_failed")).toBe("publish_failed");
  });

  it("returns null when no filter param is present", () => {
    expect(filterFromSearch("")).toBeNull();
    expect(filterFromSearch("?")).toBeNull();
    expect(filterFromSearch("?foo=bar")).toBeNull();
  });

  it("returns null for a blank/whitespace-only filter value", () => {
    expect(filterFromSearch("?filter=")).toBeNull();
    expect(filterFromSearch("?filter=   ")).toBeNull();
  });

  it("trims whitespace from the filter value", () => {
    expect(filterFromSearch("?filter=  publish_failed  ")).toBe("publish_failed");
  });

  it("handles other query params alongside filter", () => {
    expect(filterFromSearch("?post=abc123&filter=publish_failed")).toBe("publish_failed");
    expect(filterFromSearch("?filter=active&foo=bar")).toBe("active");
  });

  it("returns 'publish_failed' when the fix-failures nudge link is followed", () => {
    expect(filterFromSearch("?filter=publish_failed")).toBe("publish_failed");
  });
});

/**
 * Cross-campaign navigation contract
 *
 * The [id] effect in campaign-detail.tsx evaluates:
 *
 *   setPostFilter(filterFromSearch(window.location.search) ?? "active");
 *
 * The `?? "active"` fallback resets stale filter state from the previous
 * campaign when the new URL carries no ?filter= param.  These tests pin the
 * exact helper outputs the effect depends on so a future refactor cannot
 * silently regress it.
 */
describe("cross-campaign navigation", () => {
  it("filterFromSearch returns null for a bare campaign URL (no query string) — triggers the ?? 'active' reset", () => {
    // Campaign B has no ?filter= → stale filter from Campaign A must be cleared.
    expect(filterFromSearch("")).toBeNull();
    expect(filterFromSearch("?")).toBeNull();
  });

  it("filterFromSearch returns null when the URL only carries ?post= (no ?filter=) — ?post= deep-link clears filter itself", () => {
    expect(filterFromSearch("?post=abc123")).toBeNull();
  });

  it("filterFromSearch extracts the filter when Campaign B carries ?filter= (e.g. failure nudge link)", () => {
    // window.location.search never includes the hash — the browser separates them.
    expect(filterFromSearch("?filter=publish_failed")).toBe("publish_failed");
    expect(filterFromSearch("?filter=active")).toBe("active");
  });

  it("tabFromHash returns the correct tab for Campaign B's hash — no bleed from Campaign A", () => {
    expect(tabFromHash("#posts")).toBe("posts");
    expect(tabFromHash("#plan")).toBe("plan");
    // No hash on Campaign B → defaults to 'plan' (does not inherit Campaign A's tab via URL)
    expect(tabFromHash("")).toBe("plan");
  });

  it("filterFromSearch + ?? 'active' expression produces the right default for both navigation directions", () => {
    // A→B where B has no filter: null → "active" (stale filter cleared)
    const noFilter = filterFromSearch("") ?? "active";
    expect(noFilter).toBe("active");

    // A→B where B has ?filter=publish_failed: explicit filter applied
    const withFilter = filterFromSearch("?filter=publish_failed") ?? "active";
    expect(withFilter).toBe("publish_failed");

    // A→B where B only has ?post= (deep-link): no filter → defaults to "active"
    const postOnly = filterFromSearch("?post=abc123") ?? "active";
    expect(postOnly).toBe("active");
  });
});
