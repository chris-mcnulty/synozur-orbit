import { strict as assert } from "node:assert";
import {
  rollupSocialItems,
  resolveBatchSource,
  type RollupSocialItem,
} from "../calendar-rollup-core";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`[ok]   ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

function post(over: Partial<RollupSocialItem> = {}): RollupSocialItem {
  return {
    id: Math.random().toString(36).slice(2),
    platform: "linkedin",
    date: "2026-07-01T12:00:00.000Z",
    lifecycle: "draft",
    ...over,
  };
}

(async () => {
  await test("resolveBatchSource honors priority order", () => {
    assert.equal(resolveBatchSource(post({ generationJobId: "job1", variantGroup: "vg1" })), "job1");
    assert.equal(resolveBatchSource(post({ variantGroup: "vg1", conferenceId: "c1" })), "vg1");
    assert.equal(resolveBatchSource(post({ conferenceId: "c1", campaignId: "camp1" })), "c1");
    assert.equal(resolveBatchSource(post({ campaignId: "camp1" })), "camp1");
    assert.equal(resolveBatchSource(post({})), null);
  });

  await test("collapses a dense batch on the same day with platform breakdown", () => {
    const items: RollupSocialItem[] = [];
    for (let i = 0; i < 30; i++) items.push(post({ generationJobId: "job1", platform: "twitter" }));
    for (let i = 0; i < 24; i++) items.push(post({ generationJobId: "job1", platform: "linkedin" }));
    const { batches, loose } = rollupSocialItems(items, { threshold: 3 });
    assert.equal(batches.length, 1);
    assert.equal(loose.length, 0);
    assert.equal(batches[0].count, 54);
    assert.equal(batches[0].type, "social_batch");
    assert.equal(batches[0].batchKey, "job1");
    assert.equal(batches[0].day, "2026-07-01"); // day component surfaced for drill-down
    assert.deepEqual(batches[0].platforms, { twitter: 30, linkedin: 24 });
    assert.deepEqual(batches[0].lifecycleCounts, { draft: 54 });
  });

  await test("batch surfaces assignment ids only when consistent across members", () => {
    const mixed: RollupSocialItem[] = [];
    // Same run+day, but campaignId differs across members; conferenceId shared.
    for (let i = 0; i < 5; i++) mixed.push(post({ generationJobId: "job9", campaignId: "campA", conferenceId: "confZ" }));
    mixed.push(post({ generationJobId: "job9", campaignId: "campB", conferenceId: "confZ" }));
    const { batches } = rollupSocialItems(mixed, { threshold: 3 });
    assert.equal(batches.length, 1);
    assert.equal(batches[0].campaignId, null); // mixed -> null
    assert.equal(batches[0].conferenceId, "confZ"); // consistent -> surfaced
  });

  await test("same source on different days splits, each carrying its own day", () => {
    const items: RollupSocialItem[] = [];
    for (let i = 0; i < 5; i++) items.push(post({ generationJobId: "jobD", date: "2026-07-01T09:00:00.000Z" }));
    for (let i = 0; i < 4; i++) items.push(post({ generationJobId: "jobD", date: "2026-07-02T09:00:00.000Z" }));
    const { batches } = rollupSocialItems(items, { threshold: 3 });
    assert.equal(batches.length, 2);
    const days = batches.map((b) => b.day).sort();
    assert.deepEqual(days, ["2026-07-01", "2026-07-02"]);
    // batchKey (source) is shared; day disambiguates the drill-down.
    assert.ok(batches.every((b) => b.batchKey === "jobD"));
  });

  await test("small groups and standalone posts pass through untouched", () => {
    const items: RollupSocialItem[] = [
      post({ generationJobId: "job1" }),
      post({ generationJobId: "job1" }), // group of 2 (<= threshold) -> loose
      post({}), // standalone -> loose
    ];
    const { batches, loose } = rollupSocialItems(items, { threshold: 3 });
    assert.equal(batches.length, 0);
    assert.equal(loose.length, 3);
  });

  await test("same batch on different days does not merge", () => {
    const items: RollupSocialItem[] = [];
    for (let i = 0; i < 5; i++) items.push(post({ campaignId: "camp1", date: "2026-07-01T09:00:00.000Z" }));
    for (let i = 0; i < 5; i++) items.push(post({ campaignId: "camp1", date: "2026-07-02T09:00:00.000Z" }));
    const { batches } = rollupSocialItems(items, { threshold: 3 });
    assert.equal(batches.length, 2);
    assert.equal(batches[0].count, 5);
    assert.equal(batches[1].count, 5);
  });

  await test("unscheduled posts in a batch group together", () => {
    const items: RollupSocialItem[] = [];
    for (let i = 0; i < 8; i++) items.push(post({ variantGroup: "vg1", date: null }));
    const { batches } = rollupSocialItems(items, { threshold: 3 });
    assert.equal(batches.length, 1);
    assert.equal(batches[0].count, 8);
    assert.equal(batches[0].date, null);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll calendar-rollup-core tests passed");
})();
