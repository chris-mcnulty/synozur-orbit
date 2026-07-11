import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  groupNextActions,
  singleItemHref,
  headlineAction,
  socialPostAction,
  briefAction,
  emailAction,
  actionTab,
  actionFilter,
  groupHref,
  type ActionableItem,
  type ActionGroup,
  type ContentItemType,
  type NextAction,
} from "@shared/campaign-next-actions";
import { tabFromHash, filterFromSearch } from "@/lib/campaign-url-helpers";

let n = 0;
function item(over: Partial<ActionableItem> = {}): ActionableItem {
  return {
    id: `i${n++}`,
    itemType: "brief",
    action: "approve",
    status: "drafted",
    ...over,
  };
}

describe("groupNextActions — single-item nudge deep-link (itemId)", () => {
  it("a one-item group exposes its itemId", () => {
    const groups = groupNextActions([item({ id: "brief-1", batchKey: "b1", batchLabel: "Batch 1" })]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].total, 1);
    assert.equal(groups[0].itemId, "brief-1");
  });

  it("clears itemId the moment a second item joins the group", () => {
    const groups = groupNextActions([
      item({ id: "brief-1", batchKey: "b1", batchLabel: "Batch 1" }),
      item({ id: "brief-2", batchKey: "b1", batchLabel: "Batch 1" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].total, 2);
    assert.equal(groups[0].itemId, undefined);
  });

  it("keeps itemId undefined for a 3+ item (batched) group", () => {
    const groups = groupNextActions([
      item({ id: "s1", itemType: "social", batchKey: "run1", batchLabel: "Run 1" }),
      item({ id: "s2", itemType: "social", batchKey: "run1", batchLabel: "Run 1" }),
      item({ id: "s3", itemType: "social", batchKey: "run1", batchLabel: "Run 1" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].total, 3);
    assert.equal(groups[0].itemId, undefined);
  });

  it("tracks itemId per group — two separate one-item groups each keep their own id", () => {
    const groups = groupNextActions([
      item({ id: "brief-1", batchKey: "b1", batchLabel: "Batch 1" }),
      item({ id: "brief-2", batchKey: "b2", batchLabel: "Batch 2" }),
    ]);
    assert.equal(groups.length, 2);
    const byKey = new Map(groups.map((g) => [g.key, g]));
    assert.equal(byKey.get("b1")!.itemId, "brief-1");
    assert.equal(byKey.get("b2")!.itemId, "brief-2");
  });

  it("a lone loose item (no batch) still exposes its itemId under its type bucket", () => {
    const groups = groupNextActions([item({ id: "email-1", itemType: "email", status: "draft", action: "approve" })]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].key, "type:email");
    assert.equal(groups[0].itemId, "email-1");
  });
});

describe("singleItemHref — each item type maps to the right deep-link", () => {
  function oneItemGroup(itemType: ContentItemType, itemId: string) {
    return groupNextActions([item({ id: itemId, itemType, batchKey: "b1", batchLabel: "Batch 1" })])[0];
  }

  it("brief → editorial calendar with campaign + brief params", () => {
    const href = singleItemHref("camp-1", oneItemGroup("brief", "brief-9"));
    assert.equal(href, "/app/marketing/editorial-calendar?campaignId=camp-1&brief=brief-9");
  });

  it("email → email newsletters with emailId param", () => {
    const href = singleItemHref("camp-1", oneItemGroup("email", "email-9"));
    assert.equal(href, "/app/marketing/email-newsletters?emailId=email-9");
  });

  it("social → campaign Social Posts tab with post param + #posts hash", () => {
    const href = singleItemHref("camp-1", oneItemGroup("social", "post-9"));
    assert.equal(href, "/app/marketing/campaigns/camp-1?post=post-9#posts");
  });

  it("URL-encodes campaign and item ids", () => {
    const href = singleItemHref("camp/A B", oneItemGroup("brief", "id&x=1"));
    assert.equal(href, "/app/marketing/editorial-calendar?campaignId=camp%2FA%20B&brief=id%26x%3D1");
  });

  it("returns undefined for a multi-item (batched) group", () => {
    const group = groupNextActions([
      item({ id: "s1", itemType: "social", batchKey: "run1", batchLabel: "Run 1" }),
      item({ id: "s2", itemType: "social", batchKey: "run1", batchLabel: "Run 1" }),
    ])[0];
    assert.equal(singleItemHref("camp-1", group), undefined);
  });
});

describe("headlineAction — highest-priority pending step wins", () => {
  it("picks 'fix' over every other pending action in a mixed group", () => {
    assert.equal(
      headlineAction({ fix: 1, generate: 2, draft: 3, approve: 1, schedule: 5, post: 4 }),
      "fix",
    );
  });

  it("respects the full fix > generate > draft > approve > schedule > post order", () => {
    // Drop the highest-priority action each time; the next one should surface.
    assert.equal(headlineAction({ generate: 1, draft: 1, approve: 1, schedule: 1, post: 1 }), "generate");
    assert.equal(headlineAction({ draft: 1, approve: 1, schedule: 1, post: 1 }), "draft");
    assert.equal(headlineAction({ approve: 1, schedule: 1, post: 1 }), "approve");
    assert.equal(headlineAction({ schedule: 1, post: 1 }), "schedule");
    assert.equal(headlineAction({ post: 1 }), "post");
  });

  it("returns 'done' when there are no pending actions", () => {
    assert.equal(headlineAction({}), "done");
    assert.equal(headlineAction({ done: 5 }), "done");
    // Zero-count entries must not be treated as pending.
    assert.equal(headlineAction({ fix: 0, schedule: 0, done: 3 }), "done");
  });

  it("agrees with the group rollup: a mixed group headlines the most urgent step", () => {
    const groups = groupNextActions([
      item({ id: "a", itemType: "social", action: "schedule", batchKey: "run1", batchLabel: "Run 1" }),
      item({ id: "b", itemType: "social", action: "post", batchKey: "run1", batchLabel: "Run 1" }),
      item({ id: "c", itemType: "social", action: "fix", batchKey: "run1", batchLabel: "Run 1" }),
      item({ id: "d", itemType: "social", action: "done", batchKey: "run1", batchLabel: "Run 1" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].headlineAction, "fix");
  });

  it("a group whose items are all complete headlines 'done'", () => {
    const groups = groupNextActions([
      item({ id: "a", itemType: "social", action: "done", batchKey: "run1", batchLabel: "Run 1" }),
      item({ id: "b", itemType: "social", action: "done", batchKey: "run1", batchLabel: "Run 1" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].headlineAction, "done");
    assert.equal(groups[0].pending, 0);
  });
});

describe("socialPostAction — status → next action across all branches", () => {
  const cases: Array<[string, Partial<import("@shared/campaign-next-actions").SocialPostLike>, NextAction]> = [
    ["published status → done", { status: "published" }, "done"],
    ["exported status → done", { status: "exported" }, "done"],
    ["scheduled_external status → done", { status: "scheduled_external" }, "done"],
    ["publishedAt set → done regardless of status", { status: "approved", publishedAt: "2026-01-01" }, "done"],
    ["rejected → done", { status: "rejected" }, "done"],
    ["deleted → done", { status: "deleted" }, "done"],
    ["archived → done", { status: "archived" }, "done"],
    ["publish_failed → fix", { status: "publish_failed" }, "fix"],
    ["publishError present → fix", { status: "approved", publishError: "boom" }, "fix"],
    ["approved, no scheduled date → schedule", { status: "approved" }, "schedule"],
    ["approved + scheduled + csv delivery → post", { status: "approved", scheduledDate: "2026-01-01", deliveryMode: "csv" }, "post"],
    ["approved + scheduled + orbit auto-post → done", { status: "approved", scheduledDate: "2026-01-01", deliveryMode: null }, "done"],
    ["draft → approve", { status: "draft" }, "approve"],
    ["unknown/earlier status → approve", { status: "generating" }, "approve"],
  ];
  for (const [name, over, expected] of cases) {
    it(name, () => {
      assert.equal(socialPostAction({ status: "draft", ...over }), expected);
    });
  }
});

describe("briefAction — brief status → next action", () => {
  const cases: Array<[string, NextAction]> = [
    ["suggested", "generate"],
    ["accepted", "generate"],
    ["in_progress", "draft"],
    ["drafted", "approve"],
    ["approved", "schedule"],
    ["scheduled", "post"],
    ["published", "done"],
    ["removed", "done"],
    ["something_else", "draft"],
  ];
  for (const [status, expected] of cases) {
    it(`${status} → ${expected}`, () => {
      assert.equal(briefAction(status), expected);
    });
  }
});

describe("emailAction — email status → next action", () => {
  it("sent → done", () => assert.equal(emailAction("sent"), "done"));
  it("approved → post", () => assert.equal(emailAction("approved"), "post"));
  it("draft → approve", () => assert.equal(emailAction("draft"), "approve"));
  it("unknown status → approve", () => assert.equal(emailAction("whatever"), "approve"));
});

// A minimal group is all actionTab/actionFilter/groupHref read: itemType +
// headlineAction. Build them directly so each case is unambiguous.
function group(itemType: ActionGroup["itemType"], headlineAction: NextAction): ActionGroup {
  return {
    key: "g",
    label: "G",
    itemType,
    total: 2,
    headlineAction,
    actionCounts: {},
    statusCounts: {},
    pending: 2,
  };
}

describe("actionTab — batched group opens the right campaign tab", () => {
  it("brief groups always open the Plan tab, whatever the headline action", () => {
    for (const a of ["generate", "draft", "approve", "schedule", "post", "fix"] as NextAction[]) {
      assert.equal(actionTab(group("brief", a)), "plan", `brief/${a}`);
    }
  });

  it("email groups always open the Plan tab, whatever the headline action", () => {
    for (const a of ["approve", "schedule", "post", "fix"] as NextAction[]) {
      assert.equal(actionTab(group("email", a)), "plan", `email/${a}`);
    }
  });

  it("social approve → Review tab", () => {
    assert.equal(actionTab(group("social", "approve")), "review");
  });

  it("social generate / draft → Plan tab (content still being made)", () => {
    assert.equal(actionTab(group("social", "generate")), "plan");
    assert.equal(actionTab(group("social", "draft")), "plan");
  });

  it("social schedule / post / fix → Posts tab", () => {
    assert.equal(actionTab(group("social", "schedule")), "posts");
    assert.equal(actionTab(group("social", "post")), "posts");
    assert.equal(actionTab(group("social", "fix")), "posts");
  });

  it("mixed groups follow the social rules (not the brief/email short-circuit)", () => {
    assert.equal(actionTab(group("mixed", "approve")), "review");
    assert.equal(actionTab(group("mixed", "generate")), "plan");
    assert.equal(actionTab(group("mixed", "schedule")), "posts");
    assert.equal(actionTab(group("mixed", "fix")), "posts");
  });
});

describe("actionFilter — only failures pre-filter the Posts tab", () => {
  it("returns publish_failed for a fix headline", () => {
    assert.equal(actionFilter(group("social", "fix")), "publish_failed");
  });

  it("returns undefined for every non-fix headline action", () => {
    for (const a of ["generate", "draft", "approve", "schedule", "post", "done"] as NextAction[]) {
      assert.equal(actionFilter(group("social", a)), undefined, `social/${a}`);
    }
  });
});

describe("groupHref — composes the tab hash and optional ?filter=", () => {
  it("plain tab link (no filter) for a non-fix group", () => {
    assert.equal(
      groupHref("camp-1", group("social", "approve")),
      "/app/marketing/campaigns/camp-1#review",
    );
  });

  it("brief group links to the Plan tab", () => {
    assert.equal(
      groupHref("camp-1", group("brief", "approve")),
      "/app/marketing/campaigns/camp-1#plan",
    );
  });

  it("fix group adds the publish_failed filter before the Posts tab hash", () => {
    assert.equal(
      groupHref("camp-1", group("social", "fix")),
      "/app/marketing/campaigns/camp-1?filter=publish_failed#posts",
    );
  });

  it("URL-encodes the campaign id", () => {
    assert.equal(
      groupHref("camp/A B", group("social", "post")),
      "/app/marketing/campaigns/camp%2FA%20B#posts",
    );
  });
});

// ── Hub → campaign-detail full link flow ─────────────────────────────────────
// These tests exercise the complete round-trip that a user takes when they click
// a nudge card in the Planning Hub:
//
//   1. groupHref() builds the URL (shared/campaign-next-actions.ts)
//   2. The browser navigates; campaign-detail.tsx's [id] effect fires:
//        setActiveTab(tabFromHash(window.location.hash))
//        setPostFilter(filterFromSearch(window.location.search) ?? "active")
//
// A regression in either half (link generation or URL parsing) would silently
// land the user on the wrong tab / wrong filter.  These tests pin the contract
// so both sides are verified together.

describe("Hub → campaign-detail link flow: fix-failures nudge", () => {
  it("groupHref emits the expected URL shape for a fix group", () => {
    const href = groupHref("camp-1", group("social", "fix"));
    assert.equal(href, "/app/marketing/campaigns/camp-1?filter=publish_failed#posts");
  });

  it("tabFromHash parses the hash portion → Posts tab", () => {
    // Simulate what the browser exposes as window.location.hash after navigation.
    const hash = "#posts";
    assert.equal(tabFromHash(hash), "posts");
  });

  it("filterFromSearch parses the search portion → publish_failed", () => {
    // Simulate window.location.search (browser separates hash from search).
    const search = "?filter=publish_failed";
    assert.equal(filterFromSearch(search), "publish_failed");
  });

  it("end-to-end: fix-failures URL → Posts tab + publish_failed filter", () => {
    const href = groupHref("camp-1", group("social", "fix"));
    // Split into the search and hash the way the browser presents them.
    const url = new URL(href, "https://example.com");
    assert.equal(tabFromHash(url.hash), "posts",
      "fix nudge must open the Posts tab");
    assert.equal(filterFromSearch(url.search), "publish_failed",
      "fix nudge must pre-apply the publish_failed filter");
  });

  it("filterFromSearch ?? 'active' expression resolves to publish_failed (not the default)", () => {
    const search = "?filter=publish_failed";
    const postFilter = filterFromSearch(search) ?? "active";
    assert.equal(postFilter, "publish_failed");
  });
});

describe("Hub → campaign-detail link flow: non-fix nudge (Plan tab, no filter)", () => {
  it("groupHref emits a plain hash-only URL for a non-fix group (brief/approve)", () => {
    const href = groupHref("camp-1", group("brief", "approve"));
    assert.equal(href, "/app/marketing/campaigns/camp-1#plan");
  });

  it("groupHref emits a #review hash for a social approve group (not Posts)", () => {
    const href = groupHref("camp-1", group("social", "approve"));
    assert.equal(href, "/app/marketing/campaigns/camp-1#review");
  });

  it("end-to-end: non-fix brief nudge URL → Plan tab + 'active' default filter", () => {
    const href = groupHref("camp-1", group("brief", "approve"));
    const url = new URL(href, "https://example.com");
    assert.equal(tabFromHash(url.hash), "plan",
      "brief nudge must open the Plan tab");
    // No ?filter= → filterFromSearch returns null → ?? 'active' kicks in
    const postFilter = filterFromSearch(url.search) ?? "active";
    assert.equal(postFilter, "active",
      "absence of ?filter= must reset the Posts filter to 'active'");
  });

  it("end-to-end: social schedule nudge URL → Posts tab + 'active' default filter", () => {
    const href = groupHref("camp-1", group("social", "schedule"));
    const url = new URL(href, "https://example.com");
    assert.equal(tabFromHash(url.hash), "posts",
      "schedule nudge must open the Posts tab");
    const postFilter = filterFromSearch(url.search) ?? "active";
    assert.equal(postFilter, "active",
      "non-fix nudge must not pre-apply any filter");
  });

  it("filterFromSearch ?? 'active' expression resolves to 'active' when no ?filter= present", () => {
    // This is the exact expression campaign-detail.tsx's [id] effect evaluates.
    const search = "";
    const postFilter = filterFromSearch(search) ?? "active";
    assert.equal(postFilter, "active");
  });
});
