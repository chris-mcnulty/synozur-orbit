import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  groupNextActions,
  singleItemHref,
  headlineAction,
  socialPostAction,
  briefAction,
  emailAction,
  type ActionableItem,
  type ContentItemType,
  type NextAction,
} from "@shared/campaign-next-actions";

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
