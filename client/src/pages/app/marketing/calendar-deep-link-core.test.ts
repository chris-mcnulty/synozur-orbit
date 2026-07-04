import { describe, it, expect } from "vitest";
import {
  decideDeepLinkLanding,
  decideBatchLocateLanding,
  shouldOpenDayPanel,
  matchesTypeFilter,
  isoToDayKey,
  monthAnchorYmd,
  type DeepLinkItem,
  type DecideDeepLinkInput,
} from "./calendar-deep-link-core";

// A settled, do-nothing view: calendar/month/no-group, no filters, and the
// month already anchored on July 2026 (where the fixtures live). Individual
// tests override just the field under test.
const BASE: Omit<DecideDeepLinkInput, "target"> = {
  loading: false,
  honoredDeepLink: null,
  batchResolveAttempted: null,
  scheduled: [],
  backlogItems: [],
  view: "calendar",
  grouping: "month",
  groupBy: "none",
  typeFilter: "all",
  filters: { campaignId: "all", solutionAreaId: "all", conferenceId: "all" },
  anchorYmd: "2026-07-01",
};

function datedSocial(id: string, iso: string, extra: Partial<DeepLinkItem> = {}): DeepLinkItem {
  return { type: "social", id, date: iso, ...extra };
}

describe("isoToDayKey / monthAnchorYmd", () => {
  it("returns null for missing/invalid timestamps", () => {
    expect(isoToDayKey(null)).toBeNull();
    expect(isoToDayKey(undefined)).toBeNull();
    expect(isoToDayKey("not-a-date")).toBeNull();
  });

  it("collapses a day key to the first of its month", () => {
    expect(monthAnchorYmd("2026-07-15")).toBe("2026-07-01");
    expect(monthAnchorYmd("2026-12-31")).toBe("2026-12-01");
  });
});

describe("matchesTypeFilter", () => {
  it("passes everything under 'all'", () => {
    expect(matchesTypeFilter({ type: "social" }, "all")).toBe(true);
  });

  it("matches a bare bucket", () => {
    expect(matchesTypeFilter({ type: "email" }, "email")).toBe(true);
    expect(matchesTypeFilter({ type: "social" }, "email")).toBe(false);
  });

  it("matches a social channel sub-filter (case-insensitive)", () => {
    expect(matchesTypeFilter({ type: "social", platform: "LinkedIn" }, "social:linkedin")).toBe(true);
    expect(matchesTypeFilter({ type: "social", platform: "twitter" }, "social:linkedin")).toBe(false);
  });

  it("matches a content format sub-filter", () => {
    expect(matchesTypeFilter({ type: "content", format: "blog_post" }, "content:blog_post")).toBe(true);
    expect(matchesTypeFilter({ type: "content", format: "whitepaper" }, "content:blog_post")).toBe(false);
  });
});

describe("decideDeepLinkLanding — guard clauses", () => {
  it("waits when there is no target", () => {
    expect(decideDeepLinkLanding({ ...BASE, target: null })).toEqual({ kind: "wait" });
  });

  it("waits while the grid/backlog are still loading", () => {
    expect(
      decideDeepLinkLanding({ ...BASE, loading: true, target: { type: "social", id: "p1" } }),
    ).toEqual({ kind: "wait" });
  });

  it("does nothing once the target has already been honored", () => {
    expect(
      decideDeepLinkLanding({
        ...BASE,
        honoredDeepLink: "social:p1",
        target: { type: "social", id: "p1" },
        scheduled: [datedSocial("p1", "2026-07-15T10:00:00Z")],
      }),
    ).toEqual({ kind: "already-honored" });
  });
});

describe("decideDeepLinkLanding — dated post lands on its day cell", () => {
  it("focuses the target's day when everything is aligned", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      target: { type: "social", id: "p1" },
      scheduled: [datedSocial("p1", "2026-07-15T10:00:00Z")],
    });
    expect(action).toEqual({ kind: "focus-day", dayKey: isoToDayKey("2026-07-15T10:00:00Z"), honorKey: "social:p1" });
  });

  it("settles to the target's month before focusing when anchored elsewhere", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      anchorYmd: "2026-06-01",
      target: { type: "social", id: "p1" },
      scheduled: [datedSocial("p1", "2026-07-15T10:00:00Z")],
    });
    expect(action).toEqual({ kind: "settle", changes: { anchorYmd: "2026-07-01" } });
  });

  it("relaxes a hiding type filter (and switches to calendar/month) before focusing", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      view: "backlog",
      grouping: "quarter",
      typeFilter: "social:linkedin",
      target: { type: "social", id: "p1" },
      // The target is an X post, so the linkedin filter would hide it.
      scheduled: [datedSocial("p1", "2026-07-15T10:00:00Z", { platform: "twitter" })],
    });
    expect(action).toEqual({
      kind: "settle",
      changes: { view: "calendar", grouping: "month", typeFilter: "all" },
    });
  });

  it("does not relax a type filter the target already satisfies", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      typeFilter: "social:linkedin",
      target: { type: "social", id: "p1" },
      scheduled: [datedSocial("p1", "2026-07-15T10:00:00Z", { platform: "linkedin" })],
    });
    expect(action).toEqual({ kind: "focus-day", dayKey: isoToDayKey("2026-07-15T10:00:00Z"), honorKey: "social:p1" });
  });

  it("ignores a batch summary sharing the target id (only real items match)", () => {
    // A collapsed batch may carry the same id shape but isBatch=true; it must
    // not be treated as the resolved item.
    const action = decideDeepLinkLanding({
      ...BASE,
      target: { type: "social", id: "p1" },
      scheduled: [datedSocial("p1", "2026-07-15T10:00:00Z", { isBatch: true })],
    });
    // Falls through to the social batch-resolve path instead of focus-day.
    expect(action).toEqual({ kind: "resolve-batch", honorKey: "social:p1" });
  });
});

describe("shouldOpenDayPanel", () => {
  const target = { type: "social" as const, id: "p9" };
  const filler = (n: number): DeepLinkItem[] =>
    Array.from({ length: n }, (_, i) => datedSocial(`f${i}`, "2026-07-15T10:00:00Z"));

  it("keeps the panel closed when the item is within the 4-pill cap", () => {
    const dayItems = [...filler(3), datedSocial("p9", "2026-07-15T10:00:00Z")]; // idx 3
    expect(shouldOpenDayPanel(dayItems, target)).toBe(false);
  });

  it("opens the panel when the item is in the +N more overflow", () => {
    const dayItems = [...filler(4), datedSocial("p9", "2026-07-15T10:00:00Z")]; // idx 4
    expect(shouldOpenDayPanel(dayItems, target)).toBe(true);
  });
});

describe("decideDeepLinkLanding — undated post lands in the backlog rail", () => {
  const undated: DeepLinkItem = { type: "social", id: "u1", date: null };

  it("focuses the backlog row when the rail already shows it", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      target: { type: "social", id: "u1" },
      backlogItems: [undated],
    });
    expect(action).toEqual({ kind: "focus-backlog", backlogKey: "social-u1", honorKey: "social:u1" });
  });

  it("relaxes the view + grouping + groupBy that hide the rail before focusing", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      view: "backlog",
      grouping: "quarter",
      groupBy: "campaign",
      target: { type: "social", id: "u1" },
      backlogItems: [undated],
    });
    expect(action).toEqual({
      kind: "settle",
      changes: { view: "calendar", grouping: "month", groupBy: "none" },
    });
  });

  it("relaxes only the campaign/type filters that would hide the target", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      typeFilter: "social:linkedin",
      filters: { campaignId: "c-other", solutionAreaId: "all", conferenceId: "all" },
      target: { type: "social", id: "u1" },
      backlogItems: [{ type: "social", id: "u1", date: null, platform: "twitter", campaignId: "c-mine" }],
    });
    expect(action).toEqual({
      kind: "settle",
      changes: { typeFilter: "all", filters: { campaignId: "all" } },
    });
  });

  it("keeps a filter that the target already satisfies", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      filters: { campaignId: "c-mine", solutionAreaId: "all", conferenceId: "all" },
      target: { type: "social", id: "u1" },
      backlogItems: [{ type: "social", id: "u1", date: null, campaignId: "c-mine" }],
    });
    expect(action).toEqual({ kind: "focus-backlog", backlogKey: "social-u1", honorKey: "social:u1" });
  });
});

describe("decideDeepLinkLanding — social batch resolution", () => {
  it("asks the server to locate an unfound social post once", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      target: { type: "social", id: "hidden" },
    });
    expect(action).toEqual({ kind: "resolve-batch", honorKey: "social:hidden" });
  });

  it("does not re-ask once a locate has already been attempted", () => {
    const action = decideDeepLinkLanding({
      ...BASE,
      batchResolveAttempted: "social:hidden",
      target: { type: "social", id: "hidden" },
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("never tries to locate non-social targets", () => {
    expect(
      decideDeepLinkLanding({ ...BASE, target: { type: "content", id: "b1" } }),
    ).toEqual({ kind: "none" });
    expect(
      decideDeepLinkLanding({ ...BASE, target: { type: "email", id: "e1" } }),
    ).toEqual({ kind: "none" });
  });
});

describe("decideBatchLocateLanding — dated drills, unscheduled never does", () => {
  it("drills into a dated batch and anchors on its month", () => {
    const action = decideBatchLocateLanding({
      found: true,
      date: "2026-07-15T10:00:00Z",
      batch: { key: "job-1", day: "2026-07-15" },
    });
    expect(action).toEqual({
      kind: "drill",
      anchorYmd: "2026-07-01",
      batch: { key: "job-1", day: "2026-07-15" },
    });
  });

  it("never drills an 'unscheduled' batch (its members live in the backlog rail)", () => {
    const action = decideBatchLocateLanding({
      found: true,
      date: null,
      batch: { key: "job-2", day: "unscheduled" },
    });
    expect(action).toEqual({ kind: "no-drill" });
  });

  it("does nothing when the post is not found or has no batch", () => {
    expect(decideBatchLocateLanding({ found: false, date: null, batch: null })).toEqual({ kind: "no-drill" });
    expect(decideBatchLocateLanding({ found: true, date: "2026-07-15T10:00:00Z", batch: null })).toEqual({ kind: "no-drill" });
  });
});
