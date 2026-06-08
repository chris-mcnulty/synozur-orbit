import { strict as assert } from "node:assert";
import {
  indexVsBaseline,
  rankContent,
  underperformers,
  parsePerformanceResponse,
  formatMetricsForPrompt,
  type ContentPerf,
} from "../performance-core";
import type { MarketingPerformanceMetrics } from "@shared/schema";

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

(async () => {
  await test("indexVsBaseline normalizes per-day rates", () => {
    // current 100 over 10 days = 10/day; baseline 50 over 10 days = 5/day -> 200
    assert.equal(indexVsBaseline(100, 10, 50, 10), 200);
    assert.equal(indexVsBaseline(50, 10, 50, 10), 100);
    assert.equal(indexVsBaseline(10, 5, 0, 5), null); // no baseline rate
    assert.equal(indexVsBaseline(10, 0, 5, 5), null); // no current days
  });

  await test("rankContent sorts by clicks then posts; underperformers flags zero-click", () => {
    const items: ContentPerf[] = [
      { assetId: "a", title: "A", postsPublished: 2, clicks: 1, campaigns: [] },
      { assetId: "b", title: "B", postsPublished: 5, clicks: 0, campaigns: [] },
      { assetId: "c", title: "C", postsPublished: 1, clicks: 9, campaigns: [] },
    ];
    const ranked = rankContent(items);
    assert.deepEqual(ranked.map((r) => r.assetId), ["c", "a", "b"]);
    assert.deepEqual(underperformers(items).map((r) => r.assetId), ["b"]);
  });

  await test("parsePerformanceResponse parses summary + recs and coerces impact", () => {
    const json = JSON.stringify({
      summary: "Clicks up, conversions flat.",
      recommendations: [
        { title: "Double down on X", description: "It drove most clicks.", impact: "HIGH" },
        { title: "", description: "no title -> dropped", impact: "low" },
        { title: "Fix funnel", description: "Add decision content.", impact: "weird" },
      ],
    });
    const p = parsePerformanceResponse("```json\n" + json + "\n```");
    assert.equal(p.summary, "Clicks up, conversions flat.");
    assert.equal(p.recommendations.length, 2);
    assert.equal(p.recommendations[0].impact, "High");
    assert.equal(p.recommendations[1].impact, "Medium"); // "weird" -> default
  });

  await test("parsePerformanceResponse tolerates junk", () => {
    const p = parsePerformanceResponse("not json at all");
    assert.equal(p.summary, null);
    assert.deepEqual(p.recommendations, []);
  });

  await test("formatMetricsForPrompt includes totals, benchmark, campaigns, content", () => {
    const m: MarketingPerformanceMetrics = {
      totals: { posts: 3, clicks: 40, conversions: 2, revenue: 5000, sessions: 120 },
      benchmark: { hasBaseline: true, clicksIndex: 150, conversionsIndex: 90 },
      byCampaign: [{ campaignId: "c1", name: "Launch", posts: 3, clicks: 40, conversions: 2, revenue: 5000 }],
      perContent: [{ assetId: "a1", title: "Pillar", postsPublished: 2, clicks: 30, campaigns: ["Launch"] }],
    };
    const s = formatMetricsForPrompt(m);
    assert.ok(s.includes("clicks: 40"));
    assert.ok(s.includes("clicks index: 150"));
    assert.ok(s.includes("Launch"));
    assert.ok(s.includes("Pillar"));
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll performance-core tests passed");
})();
