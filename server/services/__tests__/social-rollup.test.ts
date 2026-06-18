import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  rollupPosts,
  batchSourceOf,
  type BatchablePost,
} from "@shared/social-rollup";


let n = 0;
function post(over: Partial<BatchablePost> = {}): BatchablePost {
  return { id: `p${n++}`, platform: "linkedin", status: "draft", ...over };
}

describe("social-rollup", () => {
  it("batchSourceOf honors run > variantGroup > conference", () => {
    assert.equal(batchSourceOf(post({ generationJobId: "j", variantGroup: "v", conferenceId: "c" })), "j");
    assert.equal(batchSourceOf(post({ variantGroup: "v", conferenceId: "c" })), "v");
    assert.equal(batchSourceOf(post({ conferenceId: "c" })), "c");
    assert.equal(batchSourceOf(post({})), null);
  });

  it("collapses a large run into one batch with breakdowns", () => {
    const posts: BatchablePost[] = [];
    for (let i = 0; i < 30; i++) posts.push(post({ generationJobId: "run1", platform: "twitter", status: "exported" }));
    for (let i = 0; i < 24; i++) posts.push(post({ generationJobId: "run1", platform: "linkedin", status: "draft" }));
    const { batches, loose } = rollupPosts(posts, { threshold: 3 });
    assert.equal(loose.length, 0);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].count, 54);
    assert.equal(batches[0].key, "run1");
    assert.deepEqual(batches[0].platforms, { twitter: 30, linkedin: 24 });
    assert.deepEqual(batches[0].statusCounts, { exported: 30, draft: 24 });
    assert.equal(batches[0].posts.length, 54);
  });

  it("small groups and standalone posts stay loose", () => {
    const posts: BatchablePost[] = [
      post({ variantGroup: "v1" }),
      post({ variantGroup: "v1" }),
      post({}),
    ];
    const { batches, loose } = rollupPosts(posts, { threshold: 3 });
    assert.equal(batches.length, 0);
    assert.equal(loose.length, 3);
  });

  it("batches sort largest first", () => {
    const posts: BatchablePost[] = [];
    for (let i = 0; i < 4; i++) posts.push(post({ generationJobId: "small" }));
    for (let i = 0; i < 10; i++) posts.push(post({ generationJobId: "big" }));
    const { batches } = rollupPosts(posts, { threshold: 3 });
    assert.equal(batches.length, 2);
    assert.equal(batches[0].key, "big");
    assert.equal(batches[1].key, "small");
  });

});
