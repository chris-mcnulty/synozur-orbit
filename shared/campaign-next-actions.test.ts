import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  groupNextActions,
  singleItemHref,
  type ActionableItem,
  type ContentItemType,
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
