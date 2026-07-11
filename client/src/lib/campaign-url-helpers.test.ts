import { describe, it, expect } from "vitest";
import { tabFromHash, filterFromSearch, CAMPAIGN_TABS } from "./campaign-url-helpers";

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
